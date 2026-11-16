// Importa os dados convertidos do Avec numa subconta do KHUB pelas rotas oficiais de importação.
// uso: node importar.mjs <API base ex. http://localhost:4010/v1> <arquivo de credenciais KHUB_EMAIL/KHUB_SENHA> "<nome da subconta>" [etapas: contatos,agenda,financeiro]
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
const [API, credArq, alvo, etapasArg] = process.argv.slice(2);
const ETAPAS = (etapasArg ?? 'contatos,agenda,financeiro').split(',');
const D = `${homedir()}/Downloads/avec-export/2026-11-14/khub`;
const cred = Object.fromEntries(readFileSync(credArq, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
let token = null;
async function api(method, caminho, body, tentativas = 5) {
  for (let t = 1; ; t++) {
    let r;
    try {
      r = await fetch(API + caminho, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(180_000) });
    } catch (e) {
      // Falha de rede/DNS ou servidor dormindo (Render gratuito): insiste mais.
      if (t >= Math.max(tentativas, 12)) throw e;
      await espera(Math.min(30000, 4000 * t)); continue;
    }
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { j = txt; }
    if (r.status === 401 && token && caminho !== '/auth/login' && t < tentativas) { await entrar(); continue; }
    if ((r.status >= 500 || r.status === 429) && t < tentativas) { await espera(5000 * t); continue; }
    if (r.status >= 400) throw new Error(`${method} ${caminho}: ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
    return j;
  }
}

// 1) login e subconta (refeito sozinho quando o acesso de 15 min expira)
const nomeDe = (m) => m?.tenant?.nome ?? m?.tenant?.name ?? m?.tenantNome ?? '';
let me;
async function entrar() {
  token = null;
  token = (await api('POST', '/auth/login', { email: cred.KHUB_EMAIL, password: cred.KHUB_SENHA })).access;
  me = await api('GET', '/auth/me');
  if (norm(nomeDe(me)) !== norm(alvo)) {
    const subs = await api('GET', '/agency/switcher').catch(() => []);
    const s = (Array.isArray(subs) ? subs : []).find((c) => norm(c.nome) === norm(alvo));
    if (!s) throw new Error(`subconta "${alvo}" não encontrada para este login (atual: "${nomeDe(me)}")`);
    token = (await api('POST', `/agency/clients/${s.id}/activate`)).access;
    me = await api('GET', '/auth/me');
  }
}
await entrar();
console.log(`subconta: ${nomeDe(me) || alvo} (tenant ${me.tenant?.id})`);
const relatorio = { alvo, api: API, inicio: new Date().toISOString(), etapas: {} };

async function emLotes(nome, rota, linhas, tamanho, montar) {
  const r = { total: linhas.length, criados: 0, ignorados: 0, atualizados: 0, erros: [], avisos: 0, avisosExemplo: [] };
  for (let i = 0; i < linhas.length; i += tamanho) {
    const lote = linhas.slice(i, i + tamanho);
    const res = await api('POST', rota, montar(lote, i + 1));
    r.criados += res.criados ?? res.criadas ?? 0;
    r.ignorados += res.ignorados ?? res.ignoradas ?? res.duplicados ?? 0;
    r.atualizados += res.atualizados ?? 0;
    for (const e of res.erros ?? []) if (r.erros.length < 200) r.erros.push(e);
    r.avisos += (res.avisos ?? []).length;
    for (const a of res.avisos ?? []) if (r.avisosExemplo.length < 30) r.avisosExemplo.push(a);
    process.stdout.write(`\r${nome}: ${Math.min(i + tamanho, linhas.length)}/${linhas.length} (criados ${r.criados}, ignorados ${r.ignorados}, erros ${r.erros.length})   `);
  }
  process.stdout.write('\n');
  relatorio.etapas[nome] = r;
  writeFileSync(`${D}/relatorio-${norm(alvo).replace(/ /g, '-')}-${API.includes('localhost') ? 'qa' : 'producao'}.json`, JSON.stringify(relatorio, null, 1));
  return r;
}

// 2) contatos
if (ETAPAS.includes('contatos')) {
  const contatos = JSON.parse(readFileSync(`${D}/contatos.json`, 'utf8'));
  await emLotes('contatos', '/crm/import/contacts', contatos, 200, (lote, n) => ({ linhas: lote, linhaInicial: n }));
}

// 3) agenda: equipe + contatos do KHUB para ligar pelo nome único
if (ETAPAS.includes('agenda')) {
  const membros = await api('GET', '/automations/responsaveis');
  const porNomeMembro = new Map((Array.isArray(membros) ? membros : []).map((m) => [norm(m.nome), m.nome]));
  const telPorNome = new Map();
  const repetido = new Set();
  for (let cursor = null, pag = 0; pag < 2000; pag++) {
    const p = await api('GET', `/crm/contacts?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const c of p.items ?? []) {
      const n = norm(c.nome);
      if (!n || !c.telefone) continue;
      if (telPorNome.has(n) && telPorNome.get(n) !== c.telefone) repetido.add(n);
      telPorNome.set(n, c.telefone);
    }
    cursor = p.nextCursor;
    if (!cursor) break;
  }
  for (const n of repetido) telPorNome.delete(n);
  const agenda = JSON.parse(readFileSync(`${D}/agenda.json`, 'utf8'));
  let porNome = 0;
  const linhas = agenda.map((a) => {
    let tel = a.contatoTelefone;
    if (!tel && telPorNome.has(norm(a.cliente))) { tel = telPorNome.get(norm(a.cliente)); porNome++; }
    const membro = porNomeMembro.get(norm(a.profissional));
    // Formato limpo (agenda por profissional): título = serviço; profissional e
    // cliente nos campos próprios. Cliente sem telefone: criado uma vez pela referência.
    return {
      data: a.data, hora: a.hora, status: a.status,
      duracaoMin: a.duracaoMin ? String(a.duracaoMin) : undefined,
      servico: a.servico || 'Atendimento',
      profissional: a.profissional || undefined,
      responsavel: membro || undefined,
      contatoTelefone: tel || undefined,
      contatoNome: a.cliente || undefined,
      contatoRef: a.clienteRef || undefined,
    };
  });
  const ligados = linhas.filter((l) => l.contatoTelefone).length;
  console.log(`agenda: ${ligados}/${linhas.length} ligados a contato (${porNome} pelo nome no KHUB); equipe no KHUB: ${porNomeMembro.size} membro(s)`);
  relatorio.agendaVinculo = { ligados, porNome, total: linhas.length, membrosKhub: [...porNomeMembro.values()] };
  await emLotes('agenda', '/agenda/importar', linhas, 200, (lote, n) => ({ linhas: lote, linhaInicial: n, opcoes: { gerarComissoes: false } }));
}

// 4) financeiro
if (ETAPAS.includes('financeiro')) {
  const fin = JSON.parse(readFileSync(`${D}/financeiro.json`, 'utf8'));
  await emLotes('financeiro', '/financeiro/importar', fin, 200, (lote, n) => ({ linhas: lote, linhaInicial: n, opcoes: { gerarComissoes: false } }));
}
relatorio.fim = new Date().toISOString();
writeFileSync(`${D}/relatorio-${norm(alvo).replace(/ /g, '-')}-${API.includes('localhost') ? 'qa' : 'producao'}.json`, JSON.stringify(relatorio, null, 1));
console.log(JSON.stringify(Object.fromEntries(Object.entries(relatorio.etapas).map(([k, v]) => [k, { total: v.total, criados: v.criados, ignorados: v.ignorados, erros: v.erros.length, avisos: v.avisos }]))));
