// QA — Simulador de campanhas Meta, contra a API REAL da stack orvyn-qa.
//   cd apps/api && node scripts/qa/simulador-campanhas.mjs [caminho-de-uma-imagem.jpg]
// Classificação: REAL_RUNTIME_TEST (API :4010 + Postgres :55440). A análise de IA usa o
// provedor configurado na API de QA (Ollama local); sem provedor, espera 501 config_required.
// Confere:
//  - simular sem histórico usa a referência; valida o corpo (400);
//  - com histórico em ad_insights, calibra pela conta; o histórico de OUTRO tenant não vaza (RLS);
//  - A/B: o criativo forte vence o fraco;
//  - analisar com imagem devolve análise estruturada (ou 501 sem IA).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const API = process.env.QA_API ?? 'http://localhost:4010/v1';
const RUN = Date.now().toString(36);
const PASS = 'QaSenha#2026x';
let falhas = 0;
const rec = (nome, ok, detalhe = '') => { if (!ok) falhas++; console.log(`${ok ? 'PASS' : 'FAIL'} ${nome}${ok ? '' : ' :: ' + JSON.stringify(detalhe).slice(0, 400)}`); };

async function api(method, path, token, body) {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
function sql(q) {
  const r = spawnSync('docker', ['exec', '-i', 'orvyn-qa-pg', 'psql', '-U', 'postgres', '-d', 'orvyn_qa', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim().split('\n')[0];
}
async function signup(label) {
  const email = `qa-${label}-${RUN}@khub-qa.test`;
  const r = await api('POST', '/auth/signup', null, { email, password: PASS, nome: `QA ${label}`, empresa: `Empresa ${label} ${RUN}` });
  if (r.status >= 300) throw new Error(`signup ${label}: ${r.status} ${JSON.stringify(r.body)}`);
  const me = await api('GET', '/auth/me', r.body.access);
  return { email, access: r.body.access, tenantId: me.body.tenantId ?? me.body.tenant?.id };
}

const forte = { nome: 'A', formato: 'video', hook: 'Você ainda sente dor ao sorrir? Resolva em 1 consulta', copy: 'Mais de 1.200 pacientes atendidos.\n\nAvaliação completa, sem surpresa no preço.\n\nRestam 8 vagas esta semana: chame no WhatsApp e agende.', titulo: 'Avaliação odontológica', cta: 'enviar_mensagem', videoSegundos: 15, legendas: true, rosto: true };
const fraco = { nome: 'B', formato: 'imagem', hook: 'CONHEÇA A NOSSA EMPRESA!!!', copy: 'Somos uma empresa.', titulo: '', cta: 'comprar', textoNaImagem: 'muito' };
const sim = (over = {}) => ({ objetivo: 'mensagens', orcamentoDia: 50, dias: 14, publico: 400000, posicionamento: 'automatico', ticketMedio: 300, taxaFechamento: 20, criativos: [forte], ...over });

const a = await signup('sim-a');
const b = await signup('sim-b');
rec('dois tenants criados', !!a.tenantId && !!b.tenantId && a.tenantId !== b.tenantId, { a: a.tenantId, b: b.tenantId });

// 1) sem histórico
const s1 = await api('POST', '/ads/simulador/simular', a.access, sim());
rec('simular sem histórico → 200, base de referência', s1.status === 200 && s1.body.base?.fonte === 'referencia' && s1.body.calibracao === null, s1);
rec('investimento = verba × dias e faixa ordenada', s1.body.total?.investimento === 700 && s1.body.total.resultados.p10 <= s1.body.total.resultados.p50 && s1.body.total.resultados.p50 <= s1.body.total.resultados.p90, s1.body.total);
rec('série tem um ponto por dia + curva de verba', s1.body.serie?.length === 14 && s1.body.curvaVerba?.length >= 5, { serie: s1.body.serie?.length, curva: s1.body.curvaVerba?.length });

// 2) validação
const ruim = await api('POST', '/ads/simulador/simular', a.access, sim({ orcamentoDia: 2, criativos: [] }));
rec('corpo inválido → 400', ruim.status === 400, ruim);
const semToken = await api('POST', '/ads/simulador/simular', null, sim());
rec('sem login → 401', semToken.status === 401, semToken.status);

// 3) calibração com histórico do tenant B (CPM R$ 60) — A não pode enxergar
for (let d = 1; d <= 20; d++) {
  sql(`INSERT INTO ad_insights(tenant_id,level,provider,external_ref_id,date,spend,impressions,clicks,leads) VALUES ('${b.tenantId}','campaign','meta','camp-${RUN}',current_date - ${d},600,10000,150,15)`);
}
const sb = await api('POST', '/ads/simulador/simular', b.access, sim());
rec('tenant com histórico → calibrado pela conta', sb.status === 200 && sb.body.base.fonte === 'conta' && sb.body.calibracao?.impressoes === 200000, sb.body.base);
rec('CPM calibrado puxa para o da conta (R$ 60)', sb.body.base.cpm > 45, sb.body.base.cpm);
const sa = await api('POST', '/ads/simulador/simular', a.access, sim());
rec('histórico de OUTRO tenant não vaza (RLS)', sa.body.base?.fonte === 'referencia' && sa.body.calibracao === null, sa.body.base);

// 4) A/B
const ab = await api('POST', '/ads/simulador/simular', a.access, sim({ criativos: [forte, fraco] }));
rec('A/B: forte vence o fraco e verba dividida', ab.status === 200 && ab.body.vencedor === 'A' && ab.body.criativos[0].orcamentoDia === 25 && ab.body.criativos[0].nota.geral > ab.body.criativos[1].nota.geral, { venc: ab.body.vencedor, notas: ab.body.criativos?.map((c) => c.nota.geral) });

// 5) análise com IA (imagem)
const caminho = process.argv[2];
const imagens = caminho ? [{ tipo: 'image/jpeg', base64: readFileSync(caminho).toString('base64'), rotulo: 'imagem do anúncio' }] : [];
const t0 = Date.now();
const an = await api('POST', '/ads/simulador/analisar', a.access, { objetivo: 'mensagens', criativo: { ...forte, formato: imagens.length ? 'imagem' : 'video' }, negocio: 'Clínica odontológica', imagens });
const ms = Date.now() - t0;
if (an.status === 501) rec('analisar sem IA configurada → 501 config_required', an.body.code === 'config_required', an.body);
else {
  rec(`analisar → 200 com análise estruturada (${ms} ms)`, an.status === 200 && typeof an.body.resumo === 'string' && Array.isArray(an.body.hooksAlternativos) && an.body.hooksAlternativos.length > 0, an);
  if (imagens.length) rec('com imagem: nota visual numérica e flag de visão', typeof an.body.notaVisual === 'number' && an.body.analisouImagem === true, { nota: an.body.notaVisual, vis: an.body.analisouImagem });
  console.log('\n  resumo da IA:', an.body.resumo, '\n  hooks:', an.body.hooksAlternativos, '\n  melhorias:', an.body.melhorias);
  const uso = sql(`SELECT count(*) FROM ai_usage_events WHERE tenant_id='${a.tenantId}' AND agente='ads:simulador'`);
  rec('uso de IA registrado no tenant', Number(uso) >= 1, uso);
}
const anRuim = await api('POST', '/ads/simulador/analisar', a.access, { objetivo: 'mensagens', criativo: forte, imagens: [{ tipo: 'image/jpeg', base64: '<script>alert(1)</script>'.repeat(10) }] });
rec('analisar com imagem não-base64 → 400', anRuim.status === 400, anRuim.status);

console.log(`\n${falhas ? `FALHAS: ${falhas}` : 'TUDO PASSOU'}`);
console.log(`Login de QA (tenant sem histórico): ${a.email} / ${PASS}`);
console.log(`Login de QA (tenant com histórico Meta): ${b.email} / ${PASS}`);
process.exitCode = falhas ? 1 : 0;
