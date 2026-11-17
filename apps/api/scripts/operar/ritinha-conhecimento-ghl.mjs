#!/usr/bin/env node
/**
 * Leva a base de conhecimento da "IA - RITA" do GHL para a Ritinha do KHUB,
 * pela API OFICIAL de produção (mesma validação, RLS, indexação e auditoria da
 * tela). Login com ~/.khub/khub.env (KHUB_EMAIL/KHUB_SENHA) — nunca impresso.
 *
 *   node scripts/operar/ritinha-conhecimento-ghl.mjs <fontes-khub.json> [--carregar] [--testar] [--ativar] [--simular] [--publicar "notas"]
 *
 * <fontes-khub.json>: [{ titulo, categoria, texto }] montado do export do GHL
 * (fora do git: tem preço, PIX e dado do negócio).
 *  --carregar  adiciona as fontes que ainda não existem (por título) e espera indexar
 *  --testar    pergunta à busca da base (o que a IA vai achar)
 *  --ativar    liga "usar base de conhecimento" no RASCUNHO
 *  --simular   conversa no simulador com o RASCUNHO (nada é enviado a ninguém)
 *  --publicar  publica o rascunho (passa a valer para as clientes)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const BASE = process.env.KHUB_URL ?? 'https://khub-os.vercel.app';
const arquivo = process.argv[2];
const flag = (f) => process.argv.includes(f);
const arg = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
const SUBCONTA = process.env.SUBCONTA ?? 'Studio da Beleza';
const AGENTE = process.env.AGENTE ?? 'Ritinha';

const env = Object.fromEntries(readFileSync(`${homedir()}/.khub/khub.env`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const jar = new Map();
async function req(metodo, caminho, corpo) {
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(jar.size ? { cookie: [...jar.values()].join('; ') } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(150_000),
  });
  for (const sc of r.headers.getSetCookie?.() ?? []) { const kv = sc.split(';')[0]; jar.set(kv.slice(0, kv.indexOf('=')), kv); }
  const t = await r.text();
  let json = null; try { json = JSON.parse(t); } catch { /* vazio */ }
  return { status: r.status, json, erro: json?.title ?? json?.message ?? t.slice(0, 200) };
}
const ok = (r, o) => { if (r.status >= 300) throw new Error(`${o}: HTTP ${r.status} ${r.erro}`); return r.json; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await req('POST', '/api/auth/login', { email: env.KHUB_EMAIL, password: env.KHUB_SENHA });
ok(login, 'login');
const me = ok(await req('GET', '/api/v1/auth/me'), 'me');
const nomeTenant = me?.tenant?.nome ?? '';
console.log(`sessão: papel ${me?.role ?? me?.tenant?.role ?? '?'} · subconta "${nomeTenant}"`);
if (!nomeTenant.toLowerCase().includes(SUBCONTA.toLowerCase())) {
  console.log(`a sessão não está na subconta "${SUBCONTA}" — troque de subconta antes (nada foi feito)`);
  process.exit(2);
}
const agentes = ok(await req('GET', '/api/v1/agents'), 'agentes');
const ag = (Array.isArray(agentes) ? agentes : agentes.itens).find((a) => a.nome === AGENTE);
if (!ag) throw new Error(`agente ${AGENTE} não encontrado`);
console.log(`agente: ${ag.nome} · ${ag.status} · padrão ${ag.padrao} · base ${ag.conhecimentoAtivo ? 'LIGADA' : 'desligada'} · fontes ${ag.fontesConhecimento} · versão publicada ${ag.versaoPublicada?.numero ?? '-'}`);

if (flag('--carregar')) {
  const fontes = JSON.parse(readFileSync(arquivo, 'utf8'));
  const existentes = ok(await req('GET', `/api/v1/agents/${ag.id}/conhecimento`), 'listar fontes');
  const lista = Array.isArray(existentes) ? existentes : existentes.fontes ?? existentes.itens ?? [];
  for (const f of fontes) {
    if (lista.some((x) => (x.titulo ?? x.documento?.titulo) === f.titulo)) { console.log(`= já existe: ${f.titulo}`); continue; }
    const r = ok(await req('POST', `/api/v1/agents/${ag.id}/conhecimento`, { tipo: 'markdown', titulo: f.titulo, categoria: f.categoria, texto: f.texto }), `adicionar ${f.titulo}`);
    console.log(`+ ${f.titulo} · ${r.caracteres} caracteres · ${r.status}${r.duplicado ? ' (duplicado)' : ''}`);
  }
  for (let i = 0; i < 40; i++) {
    const l = ok(await req('GET', `/api/v1/agents/${ag.id}/conhecimento`), 'listar');
    const arr = Array.isArray(l) ? l : l.fontes ?? l.itens ?? [];
    const pend = arr.filter((x) => !['published', 'pronto', 'indexado'].includes(x.status ?? x.documento?.status));
    if (!pend.length) { console.log(`indexação concluída: ${arr.map((x) => `${x.titulo ?? x.documento?.titulo} [${x.status ?? x.documento?.status}, ${x.chunks ?? x.documento?.chunks ?? '?'} trechos]`).join(' · ')}`); break; }
    if (i === 39) console.log(`ainda indexando: ${pend.map((x) => `${x.titulo} [${x.status}]`).join(', ')}`);
    await espera(3000);
  }
}

if (flag('--testar')) {
  for (const p of ['quanto custa manicure e pedicure?', 'quanto fica as luzes?', 'qual a política de cancelamento?', 'precisa pagar sinal?', 'qual o endereço e horário de vocês?', 'quanto custa a escova?', 'qual a chave pix?']) {
    // Voyage sem cartão = 3 consultas/min: espaçar para não medir o limite em vez da base.
    await espera(Number(process.env.ESPACO_MS ?? 21000));
    const r = ok(await req('POST', `/api/v1/agents/${ag.id}/conhecimento-testar`, { pergunta: p }), `testar "${p}"`);
    const hits = r.trechos ?? r.hits ?? r.resultados ?? [];
    console.log(`? ${p}\n   → ${hits.slice(0, 2).map((h) => `[${(h.titulo ?? '').slice(0, 30)} ${Number(h.score ?? h.relevancia ?? 0).toFixed(2)}] ${(h.conteudo ?? h.trecho ?? '').replace(/\s+/g, ' ').slice(0, 130)}`).join('\n   → ') || JSON.stringify(r).slice(0, 300)}`);
  }
}

if (flag('--ativar')) {
  // Só as fontes DELA (a auditoria viu chunk global de fotografia/fiscal na busca do Studio) e até 8 trechos.
  const r = ok(await req('PATCH', `/api/v1/agents/${ag.id}`, {
    conhecimentoAtivo: true,
    config: { conhecimento: { somenteFontesDoAgente: true, categorias: [], consultarEm: ['duvida', 'orcamento', 'compra', 'agendamento', 'objecao', 'comparacao'], maxTrechos: 8 } },
  }), 'ativar base');
  console.log(`base de conhecimento no rascunho: ${r.conhecimentoAtivo ? 'LIGADA' : 'desligada'}`);
}

if (flag('--simular')) {
  const CENARIOS = [
    ['Oi, quanto custa manicure e pedicure?'],
    ['oi! quanto fica fazer luzes?'],
    ['vcs fazem escova? qto custa'],
    ['qual a política se eu precisar cancelar?'],
    ['onde fica o studio e que horas abre sábado?'],
    ['achei caro o lash lift, tem desconto?'],
    ['quero fazer design de sobrancelha, tem horário quinta à tarde?'],
    ['preciso pagar alguma coisa antes pra marcar maquiagem?'],
  ];
  const saida = [];
  for (const msgs of CENARIOS) {
    await espera(Number(process.env.ESPACO_MS ?? 21000));
    const sim = ok(await req('POST', `/api/v1/agents/${ag.id}/simulacoes`, { perfil: 'livre', usarRascunho: true }), 'criar simulação');
    const t = ok(await req('POST', `/api/v1/agents/simulacoes/${sim.id}/turno`, { mensagens: msgs }), 'turno');
    const resp = (t.resposta ?? []).map((m) => m.texto).join(' ⏎ ');
    const tr = t.trace ?? {};
    console.log(`\n👤 ${msgs.join(' | ')}\n🤖 ${resp}\n   decisão: ${JSON.stringify(t.decisao?.acao ?? t.decisao)} · fontes: ${(tr.conhecimento?.fontes ?? tr.fontes ?? []).map?.((f) => f.titulo ?? f).join(', ') ?? '-'} · avisos: ${(tr.validacao ?? []).join('; ') || '-'} · US$ ${Number(tr.custoUsd ?? 0).toFixed(4)}`);
    saida.push({ msgs, resp, decisao: t.decisao, validacao: tr.validacao, custo: tr.custoUsd });
    await req('DELETE', `/api/v1/agents/simulacoes/${sim.id}`).catch(() => null);
  }
  if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify(saida, null, 1));
}

if (flag('--publicar')) {
  const notas = arg('--publicar') ?? 'base de conhecimento do GHL (preços, studio, políticas, FAQ, dados)';
  const r = ok(await req('POST', `/api/v1/agents/${ag.id}/publicar`, { notas }), 'publicar');
  console.log(`publicado: versão ${r.versao?.numero}`);
}
