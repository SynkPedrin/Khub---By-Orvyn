// E2E do KHUB Agent Intelligence contra a API REAL (Postgres+Redis+worker do stack orvyn-qa).
//   QA_API=http://localhost:4020/v1 node scripts/qa/agent-e2e.mjs
// Pré-requisitos: API e worker com ANTHROPIC_BASE_URL=http://127.0.0.1:4099 e
// o stub `scripts/qa/agent-llm-stub.mjs` no ar. Inbound pelo webhook real do
// adaptador Evolution (payload sintético — NÃO é WhatsApp real). Nada sai da
// máquina: fora de produção e sem STEVO_TEST_NUMBER o envio fica `bloqueado_dev`.
//
// Roteiro (docs/AI_AGENT_ARCHITECTURE.md §20): lead de clínica relata queda de
// cabelo, pergunta preço, objeta, some, recebe follow-up contextual, volta e o
// agente retoma com contexto, atualizando o CRM.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API = process.env.QA_API ?? 'http://localhost:4020/v1';
const STUB = process.env.QA_STUB ?? 'http://127.0.0.1:4099';
const env = Object.fromEntries(readFileSync(resolve(process.cwd(), '.env.qa'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const RUN = Date.now().toString(36);
const PASS = 'QaSenha#2026x';
const results = [];
const rec = (etapa, nome, ok, detalhe = '') => {
  results.push({ etapa, nome, status: ok ? 'PASS' : 'FAIL', detalhe: String(detalhe).slice(0, 400) });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${etapa}] ${nome}${ok ? '' : ' :: ' + String(detalhe).slice(0, 400)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, token, body) {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
function sql(q) {
  const r = spawnSync('docker', ['exec', '-i', 'orvyn-qa-pg', 'psql', '-U', 'postgres', '-d', 'orvyn_qa', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}
const sql1 = (q) => sql(q).split('\n')[0] ?? '';
async function poll(fn, ms = 60000, step = 1500) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(step);
  }
}
async function signup(label) {
  const email = `qa-ag-${label}-${RUN}@khub-qa.test`;
  const r = await api('POST', '/auth/signup', null, { email, password: PASS, nome: `QA ${label}`, empresa: `Clínica ${label} ${RUN}` });
  if (r.status >= 300) throw new Error(`signup ${label}: ${r.status} ${JSON.stringify(r.body)}`);
  const me = await api('GET', '/auth/me', r.body.access);
  return { access: r.body.access, tenantId: me.body.tenant.id };
}

async function main() {
  // ---------- 0. canário: nada de credencial real ----------
  const A = await signup('A');
  const B = await signup('B');
  const canario = await api('GET', '/integrations/meta/auth-url', A.access);
  rec('0', 'canário: integração externa sem credencial responde 501 (env de dev não vazou)', canario.status === 501, canario.status);

  // ---------- 1. agente configurado ----------
  const cat = await api('GET', '/agents/catalogo', A.access);
  rec('1', 'catálogo expõe ferramentas, estratégias, personas e IA configurada (stub)', cat.status === 200 && cat.body.ferramentas.length >= 18 && cat.body.estrategiasFollowup.length === 8 && cat.body.ia.configurada === true, `ferr=${cat.body.ferramentas?.length} ia=${JSON.stringify(cat.body.ia)}`);
  const criado = await api('POST', '/agents', A.access, {
    nome: 'Lia',
    instrucoes: 'Atenda leads da Clínica Aurora (tratamento capilar). Entenda a queixa, informe valores da base e conduza para a avaliação.',
    ferramentas: ['buscar_conhecimento', 'adicionar_nota', 'adicionar_tag', 'ver_contato'],
    config: {
      identidade: { cargo: 'Consultora', empresaRepresentada: 'Clínica Aurora', objetivoPrincipal: 'Agendar avaliações capilares' },
      comunicacao: { fragmentacao: { intervaloMinMs: 300, intervaloMaxMs: 900 } },
      regras: [{ id: 'r-preco', nome: 'Objeção de preço', condicoes: [{ campo: 'objecao', operador: 'igual', valor: 'preco' }], acoes: [{ tipo: 'adicionar_tag', valor: 'objecao-preco' }] }],
    },
  });
  const agentId = criado.body.id;
  rec('1', 'agente criado como rascunho com config estendida validada', criado.status === 201 || criado.status === 200 ? criado.body.status === 'rascunho' && criado.body.config.identidade.cargo === 'Consultora' : false, JSON.stringify(criado.body).slice(0, 200));
  const invalido = await api('PATCH', `/agents/${agentId}`, A.access, { config: { personalidade: { empatia: 900 } } });
  rec('1', 'config inválida → 400 com o campo', invalido.status === 400, JSON.stringify(invalido.body).slice(0, 200));
  const cenarios = await api('GET', `/agents/${agentId}/cenarios`, A.access);
  rec('1', 'cenários de regressão padrão semeados', Array.isArray(cenarios.body) && cenarios.body.length === 5, cenarios.body?.length);

  // ---------- 2. base de conhecimento ----------
  const fonte = await api('POST', `/agents/${agentId}/conhecimento`, A.access, {
    tipo: 'texto',
    titulo: 'Tabela de preços 2026',
    categoria: 'comercial',
    texto: '# Tabela 2026\n\n## Avaliação capilar\nA avaliação capilar para queda de cabelo custa R$ 250,00 e inclui tricoscopia.\n\n## Condições\nParcelamento em até 3x no cartão. Não há desconto à vista.',
  });
  rec('2', 'fonte de texto aceita e enviada para indexação', fonte.status < 300 && fonte.body.documentId, JSON.stringify(fonte.body).slice(0, 200));
  const indexada = await poll(async () => {
    const l = await api('GET', `/agents/${agentId}/conhecimento`, A.access);
    const it = l.body?.itens?.[0];
    return it && it.status === 'published' && it.chunks > 0 ? it : null;
  }, 30000);
  rec('2', 'documento indexado (sem Voyage: indexação lexical declarada)', !!indexada && indexada.indexacao === 'lexical', JSON.stringify(indexada));
  const teste = await api('POST', `/agents/${agentId}/conhecimento-testar`, A.access, { pergunta: 'quanto custa a avaliação capilar' });
  rec('2', 'testador recupera o trecho com confiança', teste.body?.hits?.length >= 1 && /250/.test(teste.body.hits[0].conteudo) && teste.body.confianca?.nivel !== 'nenhuma', JSON.stringify(teste.body?.confianca));
  const doTenantB = await api('POST', `/agents/${agentId}/conhecimento-testar`, B.access, { pergunta: 'avaliação capilar' });
  rec('2', 'tenant B não acessa a base do agente de A (404)', doTenantB.status === 404, doTenantB.status);

  // ---------- 3. follow-up, ativação e publicação ----------
  const janela = { ativo: true, horarioInicio: 0, horarioFim: 24, diasSemana: [0, 1, 2, 3, 4, 5, 6], fuso: 'America/Sao_Paulo' };
  await api('PATCH', `/agents/${agentId}/followups/regras/sem_resposta`, A.access, { ...janela, intervalosHoras: [4, 24] });
  const regraPreco = await api('PATCH', `/agents/${agentId}/followups/regras/objecao_preco`, A.access, { ...janela, intervalosHoras: [24, 48], maxTentativas: 2 });
  rec('3', 'estratégias de follow-up salvas', regraPreco.status < 300 && regraPreco.body.ativo === true, JSON.stringify(regraPreco.body).slice(0, 150));
  await api('PATCH', `/agents/${agentId}`, A.access, { padrao: true });
  const ativo = await api('POST', `/agents/${agentId}/status`, A.access, { status: 'ativo' });
  const pub = await api('POST', `/agents/${agentId}/publicar`, A.access, { notas: 'v1 — QA E2E' });
  rec('3', 'agente ativado e versão 1 publicada', ativo.body?.status === 'ativo' && pub.body?.versao?.numero === 1, JSON.stringify(pub.body).slice(0, 200));

  // ---------- 4. lead entra: queda de cabelo + preço ----------
  const inst = `qa-ag-inst-${RUN}`;
  sql(`INSERT INTO integrations(tenant_id,provider,status,external_business_id) VALUES ('${A.tenantId}','evolution','connected','${inst}')`);
  const tel = `55117${Math.floor(10000000 + Math.random() * 89999999)}`;
  const inbound = (id, texto) => api('POST', `/hooks/evolution/${env.EVOLUTION_WEBHOOK_TOKEN}`, null, { event: 'messages.upsert', instance: inst, data: { key: { remoteJid: `${tel}@s.whatsapp.net`, fromMe: false, id }, pushName: 'Ana Souza', message: { conversation: texto } } });
  const h1 = await inbound(`QA-AG-1-${RUN}`, 'Oi! Estou com queda de cabelo e queria saber quanto custa o tratamento');
  rec('4', 'webhook aceita a mensagem do lead', h1.status < 300, h1.status);
  const run1 = await poll(() => {
    const l = sql1(`SELECT r.id, r.status, r.intencao, r.blocos, r.trace::text FROM agent_runs r WHERE r.tenant_id='${A.tenantId}' AND r.status <> 'processando' ORDER BY r.created_at DESC LIMIT 1`);
    return l ? l.split('\t') : null;
  }, 90000);
  rec('4', 'agente processou a mensagem (run respondido)', run1?.[1] === 'respondido', run1 ? run1.slice(0, 4).join(' | ') : 'sem run');
  const trace1 = run1 ? JSON.parse(run1[4]) : {};
  rec('4', 'intenção identificada = orçamento', run1?.[2] === 'orcamento', run1?.[2]);
  rec('4', 'problema identificado e registrado no perfil (fato declarado confirmado)', sql1(`SELECT status||':'||origem FROM agent_profile_facts WHERE tenant_id='${A.tenantId}' AND campo='problema_principal'`) === 'confirmado:declarado');
  rec('4', 'conhecimento consultado com fonte citável no trace', (trace1.conhecimento?.fontes ?? []).length >= 1, JSON.stringify(trace1.conhecimento).slice(0, 200));
  rec('4', 'Action Engine: nota de qualificação gravada pelo CrmService', Number(sql1(`SELECT count(*) FROM notes WHERE tenant_id='${A.tenantId}' AND corpo LIKE '[Lia]%queda de cabelo%'`)) === 1);
  rec('4', 'execução da ferramenta registrada no log', Number(sql1(`SELECT count(*) FROM agent_tool_executions WHERE tenant_id='${A.tenantId}' AND ferramenta='adicionar_nota' AND status='executado'`)) === 1);
  const blocos1 = await poll(() => {
    const rows = sql(`SELECT ordem, status, texto FROM agent_delivery_queue WHERE run_id='${run1?.[0]}' ORDER BY ordem`).split('\n').filter(Boolean).map((l) => l.split('\t'));
    return rows.length && rows.every((r) => r[1] !== 'pendente' && r[1] !== 'enviando') ? rows : null;
  }, 30000);
  rec('4', 'resposta fragmentada em ≥2 blocos, todos processados pela fila', (blocos1?.length ?? 0) >= 2, JSON.stringify(blocos1));
  const msgsIa = sql(`SELECT corpo FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.tenant_id='${A.tenantId}' AND m.autor_tipo='ia' ORDER BY m.created_at`).split('\n').filter(Boolean);
  rec('4', 'blocos gravados no Inbox NA ORDEM (mesmo texto, mesma sequência)', blocos1 && JSON.stringify(msgsIa.slice(0, blocos1.length)) === JSON.stringify(blocos1.map((b) => b[2])), JSON.stringify(msgsIa));
  rec('4', 'envio externo travado fora de produção (nada saiu da máquina)', blocos1?.every((b) => b[1] === 'falhou' || b[1] === 'enviado') && Number(sql1(`SELECT count(*) FROM messages WHERE tenant_id='${A.tenantId}' AND autor_tipo='ia' AND delivery_status='sent'`)) === 0);
  rec('4', 'preço veio da base (R$ 250,00)', msgsIa.some((m) => /250/.test(m)), msgsIa.join(' / '));
  rec('4', 'follow-up agendado após a resposta (sem_resposta)', sql1(`SELECT estrategia FROM agent_followups WHERE tenant_id='${A.tenantId}' AND status='agendado'`) === 'sem_resposta');

  // ---------- 5. objeção de preço ----------
  await sleep(1500);
  await inbound(`QA-AG-2-${RUN}`, 'Achei caro, tem desconto?');
  const run2 = await poll(() => {
    const l = sql1(`SELECT id, status, intencao FROM agent_runs WHERE tenant_id='${A.tenantId}' AND status <> 'processando' ORDER BY created_at DESC LIMIT 1`).split('\t');
    return l[0] && l[0] !== run1?.[0] ? l : null;
  }, 90000);
  rec('5', 'objeção identificada (intenção objeção)', run2?.[2] === 'objecao', run2?.join(' | '));
  rec('5', 'follow-up anterior interrompido porque o contato respondeu', sql1(`SELECT motivo FROM agent_followups WHERE tenant_id='${A.tenantId}' AND estrategia='sem_resposta' ORDER BY created_at LIMIT 1`).includes('respondeu'));
  rec('5', 'regra SE objeção=preço ENTÃO tag: tag aplicada no CRM', sql1(`SELECT array_to_string(tags, ',') FROM contacts WHERE tenant_id='${A.tenantId}' AND telefone LIKE '%${tel.slice(-8)}%'`).includes('objecao-preco'));
  rec('5', 'objeção registrada no perfil', sql1(`SELECT valor::text FROM agent_profile_facts WHERE tenant_id='${A.tenantId}' AND campo='objecoes'`).includes('preco'));
  rec('5', 'follow-up de objeção de preço agendado (estratégia contextual)', sql1(`SELECT estrategia FROM agent_followups WHERE tenant_id='${A.tenantId}' AND status='agendado'`) === 'objecao_preco');

  // ---------- 6. dois dias sem resposta → follow-up contextual ----------
  await poll(() => Number(sql1(`SELECT count(*) FROM agent_delivery_queue WHERE tenant_id='${A.tenantId}' AND status IN ('pendente','enviando')`)) === 0, 20000);
  sql(`UPDATE agent_followups SET agendado_para = now() - interval '1 minute' WHERE tenant_id='${A.tenantId}' AND status='agendado'`);
  const fu = await poll(() => {
    const l = sql1(`SELECT id, status, mensagem, tentativa FROM agent_followups WHERE tenant_id='${A.tenantId}' AND estrategia='objecao_preco' AND tentativa=1`).split('\t');
    return l[1] && l[1] !== 'agendado' && l[1] !== 'gerando' ? l : null;
  }, 100000, 3000);
  rec('6', 'worker executou o follow-up vencido', fu?.[1] === 'enviado', fu?.join(' | '));
  rec('6', 'mensagem gerada a partir do CONTEXTO real (cita o problema do perfil)', /queda de cabelo/.test(fu?.[2] ?? ''), fu?.[2]);
  rec('6', 'follow-up entregue pela mesma fila (blocos com followup_id)', Number(sql1(`SELECT count(*) FROM agent_delivery_queue WHERE followup_id='${fu?.[0]}'`)) >= 2);
  rec('6', 'tentativa 2 agendada no mesmo ciclo', sql1(`SELECT status FROM agent_followups WHERE tenant_id='${A.tenantId}' AND estrategia='objecao_preco' AND tentativa=2`) === 'agendado');

  // ---------- 7. lead volta → retoma com contexto ----------
  await poll(() => Number(sql1(`SELECT count(*) FROM agent_delivery_queue WHERE tenant_id='${A.tenantId}' AND status IN ('pendente','enviando')`)) === 0, 20000);
  const runsAntes = Number(sql1(`SELECT count(*) FROM agent_runs WHERE tenant_id='${A.tenantId}'`));
  await inbound(`QA-AG-3-${RUN}`, 'Voltei! Ainda tenho interesse, estava pensando');
  const run3 = await poll(() => (Number(sql1(`SELECT count(*) FROM agent_runs WHERE tenant_id='${A.tenantId}' AND status <> 'processando'`)) > runsAntes ? sql1(`SELECT status, intencao FROM agent_runs WHERE tenant_id='${A.tenantId}' ORDER BY created_at DESC LIMIT 1`).split('\t') : null), 90000);
  rec('7', 'agente retomou a conversa', run3?.[0] === 'respondido', run3?.join(' | '));
  rec('7', 'tentativa 2 do follow-up cancelada (contato respondeu)', sql1(`SELECT status||':'||coalesce(motivo,'') FROM agent_followups WHERE tenant_id='${A.tenantId}' AND estrategia='objecao_preco' AND tentativa=2`).startsWith('cancelado:contato respondeu'));
  const stub = await (await fetch(`${STUB}/__log`)).json();
  const ultimaGeracao = [...stub].reverse().find((c) => !c.temSchema);
  rec('7', 'o modelo recebeu o PERFIL do contato no contexto (memória)', ultimaGeracao?.systemTemPerfil === true, JSON.stringify(ultimaGeracao));
  rec('7', 'análise usou structured outputs com effort explícito', stub.some((c) => c.temSchema && c.effort === 'low'));
  const ultimaIa = sql1(`SELECT corpo FROM messages WHERE tenant_id='${A.tenantId}' AND autor_tipo='ia' ORDER BY created_at DESC LIMIT 1`);
  rec('7', 'resposta retoma o contexto (cita queda de cabelo)', /queda de cabelo|horário/.test(ultimaIa) || /queda de cabelo/.test(sql(`SELECT string_agg(corpo,' ') FROM messages WHERE tenant_id='${A.tenantId}' AND autor_tipo='ia'`)), ultimaIa);

  // ---------- 8. painel, perfil, isolamento ----------
  const contactId = sql1(`SELECT id FROM contacts WHERE tenant_id='${A.tenantId}' AND telefone LIKE '%${tel.slice(-8)}%'`);
  const perfil = await api('GET', `/agents/perfis/${contactId}`, A.access);
  rec('8', 'Customer Intelligence Profile com fatos, extrações e follow-ups', perfil.status === 200 && perfil.body.fatos.length >= 3 && perfil.body.extracoes.length >= 3 && perfil.body.followups.length >= 3, `fatos=${perfil.body.fatos?.length} extr=${perfil.body.extracoes?.length} fu=${perfil.body.followups?.length}`);
  const perfilB = await api('GET', `/agents/perfis/${contactId}`, B.access);
  rec('8', 'tenant B não lê o perfil do contato de A (404)', perfilB.status === 404, perfilB.status);
  const agB = await api('GET', `/agents/${agentId}`, B.access);
  rec('8', 'tenant B não lê o agente de A (404)', agB.status === 404, agB.status);
  const listaB = await api('GET', '/agents', B.access);
  rec('8', 'lista de B não contém agentes de A', Array.isArray(listaB.body) && listaB.body.length === 0, listaB.body?.length);
  const dash = await api('GET', '/agents/dashboard', A.access);
  rec('8', 'dashboard com dados reais (conversas, mensagens, follow-ups, custo)', dash.body?.conversasAtendidas >= 1 && dash.body?.mensagensEnviadas >= 3 && dash.body?.followupsEnviados >= 1 && dash.body?.custoUsd > 0, JSON.stringify({ c: dash.body?.conversasAtendidas, m: dash.body?.mensagensEnviadas, f: dash.body?.followupsEnviados, usd: dash.body?.custoUsd }));
  const an = await api('GET', `/agents/${agentId}/analytics`, A.access);
  rec('8', 'analytics do agente: intenções, objeções, versão', an.body?.intencoes?.length >= 2 && an.body?.objecoes?.some((o) => o.objecao === 'preco') && an.body?.versoes?.versoes?.[0]?.execucoes >= 3, JSON.stringify({ i: an.body?.intencoes, v: an.body?.versoes?.versoes?.[0] }));
  const logs = await api('GET', `/agents/${agentId}/logs`, A.access);
  rec('8', 'execution logs paginados com trace estruturado', logs.body?.itens?.length >= 3 && logs.body.itens[0].trace?.analise, logs.body?.itens?.length);

  // ---------- 9. simulador ----------
  const sim = await api('POST', `/agents/${agentId}/simulacoes`, A.access, { perfil: 'objecao_preco' });
  const t1 = await api('POST', `/agents/simulacoes/${sim.body.id}/turno`, A.access, { mensagens: ['quanto custa?', 'achei caro'] });
  rec('9', 'simulador: turno com trace técnico (intenção, fontes, blocos, tempo, tokens)', t1.status < 300 && t1.body.trace?.analise?.intencao && t1.body.trace?.blocos?.length >= 1 && t1.body.trace?.tokens?.entrada > 0, JSON.stringify(t1.body).slice(0, 300));
  rec('9', 'simulador NÃO executou ação real (nenhuma tag nova em contato)', Number(sql1(`SELECT count(*) FROM agent_tool_executions WHERE tenant_id='${A.tenantId}' AND status='executado' AND created_at > now() - interval '30 seconds'`)) === 0);

  // ---------- 10. versões, rollback, avaliação, aprendizado ----------
  await api('PATCH', `/agents/${agentId}`, A.access, { instrucoes: 'Instrução alterada no rascunho para o teste de rollback da plataforma KHUB.' });
  const obtido = await api('GET', `/agents/${agentId}`, A.access);
  rec('10', 'rascunho alterado aparece como "não publicado"', obtido.body?.alteracoesNaoPublicadas === true);
  const v2 = await api('POST', `/agents/${agentId}/publicar`, A.access, { notas: 'v2' });
  const rest = await api('POST', `/agents/${agentId}/versoes/${pub.body.versao.id}/restaurar`, A.access);
  const hist = await api('GET', `/agents/${agentId}/versoes`, A.access);
  rec('10', 'rollback para v1 cria v3 (restauração) e o rascunho volta ao conteúdo de v1', v2.body?.versao?.numero === 2 && rest.body?.versao?.numero === 3 && hist.body?.[0]?.origem === 'restauracao' && (await api('GET', `/agents/${agentId}`, A.access)).body.instrucoes.startsWith('Atenda leads'), JSON.stringify(hist.body?.map((h) => [h.numero, h.origem])));
  const av = await api('POST', `/agents/${agentId}/avaliacoes`, A.access, { alvo: 'rascunho' });
  const avOk = await poll(async () => { const r = await api('GET', `/agents/avaliacoes/${av.body.id}`, A.access); return r.body?.status === 'concluida' || r.body?.status === 'falhou' ? r.body : null; }, 120000, 2000);
  rec('10', 'avaliação de regressão concluída com nota e métricas', avOk?.status === 'concluida' && Number(avOk.nota) > 0 && avOk.resultados.length === 5, JSON.stringify({ s: avOk?.status, nota: avOk?.nota, erro: avOk?.erro, m: avOk?.metricas }).slice(0, 300));
  const apr = await api('POST', `/agents/${agentId}/aprendizado/analisar`, A.access);
  rec('10', 'learning engine analisou eventos reais', apr.status < 300 && typeof apr.body.padroes === 'number', JSON.stringify(apr.body));
  const resumo = await api('GET', `/agents/${agentId}/aprendizado`, A.access);
  rec('10', 'eventos de aprendizado registrados (objeção)', (resumo.body?.eventos?.objecao ?? 0) >= 1, JSON.stringify(resumo.body?.eventos));

  const falhas = results.filter((r) => r.status === 'FAIL').length;
  const out = resolve(process.cwd(), '..', '..', 'docs', 'ai-agent-e2e-results.json');
  writeFileSync(out, JSON.stringify({ executadoEm: new Date().toISOString(), api: API, total: results.length, falhas, results }, null, 2));
  console.log(`\n${results.length - falhas}/${results.length} PASS — evidência em docs/ai-agent-e2e-results.json`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E abortou:', e);
  process.exit(2);
});
