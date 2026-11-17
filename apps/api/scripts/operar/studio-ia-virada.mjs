// Configuração do Studio da Beleza em produção pela API OFICIAL (login ~/.khub/khub.env, nunca impresso).
//   node scripts/operar/studio-ia-virada.mjs --rascunho        instruções v4 + ferramentas de agenda no RASCUNHO da Ritinha
//   node scripts/operar/studio-ia-virada.mjs --simular         conversas no simulador com o rascunho (nada é enviado)
//   node scripts/operar/studio-ia-virada.mjs --publicar        publica o rascunho da Ritinha
//   node scripts/operar/studio-ia-virada.mjs --notificacao     Notificação Interna (importado do GHL) → número do GHL
//   node scripts/operar/studio-ia-virada.mjs --virada          publica Novo Lead v14 e pausa as versões simplificadas (SÓ com o GHL desligado)
//   node scripts/operar/studio-ia-virada.mjs --estado          mostra o estado
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const BASE = 'https://khub-os.vercel.app';
const FONE_GHL = '5518935000971';
const V4 = new URL('./ritinha-instrucoes-v4.txt', import.meta.url).pathname;
const flag = (f) => process.argv.includes(f);
const env = Object.fromEntries(readFileSync(`${homedir()}/.khub/khub.env`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const jar = new Map();
async function req(metodo, caminho, corpo) {
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(jar.size ? { cookie: [...jar.values()].join('; ') } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(170_000),
  });
  for (const sc of r.headers.getSetCookie?.() ?? []) { const kv = sc.split(';')[0]; jar.set(kv.slice(0, kv.indexOf('=')), kv); }
  const t = await r.text();
  let json = null; try { json = JSON.parse(t); } catch { /* */ }
  return { status: r.status, json, erro: json?.detail ?? json?.title ?? json?.message ?? t.slice(0, 300) };
}
const ok = (r, o) => { if (r.status >= 300) throw new Error(`${o}: HTTP ${r.status} ${JSON.stringify(r.erro).slice(0, 400)}`); return r.json; };
const mascara = (s) => `…${String(s).replace(/\D/g, '').slice(-4)}`;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

ok(await req('POST', '/api/auth/login', { email: env.KHUB_EMAIL, password: env.KHUB_SENHA }), 'login');
const me = ok(await req('GET', '/api/v1/auth/me'), 'me');
if (!/studio da beleza/i.test(me?.tenant?.nome ?? '')) { console.log(`sessão em "${me?.tenant?.nome}", não no Studio: nada feito`); process.exit(2); }
const lista = ok(await req('GET', '/api/v1/agents'), 'agentes');
const rita = (Array.isArray(lista) ? lista : lista.itens).find((a) => /ritinha/i.test(a.nome));
const fluxos = ok(await req('GET', '/api/v1/automations/workflows'), 'fluxos');
const wf = (nome) => (Array.isArray(fluxos) ? fluxos : fluxos.itens).find((f) => f.nome === nome);

if (flag('--estado')) {
  const d = ok(await req('GET', `/api/v1/agents/${rita.id}`), 'ritinha');
  console.log(`Ritinha: ${d.status} · padrão ${d.padrao} · publicada v${d.versaoPublicada?.numero ?? '-'} · alterações não publicadas: ${d.alteracoesNaoPublicadas}`);
  console.log(`  ferramentas: ${d.ferramentas.join(', ')}`);
  console.log(`  instruções: ${d.instrucoes.length} caracteres · v4: ${d.instrucoes.includes('FLUXO DE AGENDA (agenda do KHUB)')}`);
  for (const f of Array.isArray(fluxos) ? fluxos : fluxos.itens) console.log(`  [${f.status}] ${f.nome}`);
}

if (flag('--rascunho')) {
  const d = ok(await req('GET', `/api/v1/agents/${rita.id}`), 'ritinha');
  const ferramentas = [...new Set([...d.ferramentas, 'ver_horarios_salao', 'reservar_horario_salao'])];
  const r = ok(await req('PATCH', `/api/v1/agents/${rita.id}`, { instrucoes: readFileSync(V4, 'utf8'), ferramentas }), 'atualizar rascunho');
  console.log(`rascunho: ${r.instrucoes?.length} caracteres · ferramentas: ${r.ferramentas?.join(', ')}`);
}

if (flag('--simular')) {
  const amanha = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' }).format(new Date(Date.now() + 86_400_000));
  const conversas = [
    ['oi, quanto custa pé e mão?'],
    [`queria fazer pé ${amanha} de manhã, tem horário?`, 'pode ser o primeiro horário', 'sim, pode reservar'],
    ['tem horário pra escova amanhã à tarde?'],
    ['quero fazer design de sobrancelha', 'sexta à tarde'],
    ['vcs atendem domingo?'],
  ];
  const saida = [];
  for (const turnos of conversas) {
    const sim = ok(await req('POST', `/api/v1/agents/${rita.id}/simulacoes`, { perfil: 'livre', usarRascunho: true }), 'criar simulação');
    for (const m of turnos) {
      await espera(Number(process.env.ESPACO_MS ?? 4000));
      const t = await req('POST', `/api/v1/agents/simulacoes/${sim.id}/turno`, { mensagens: [m] });
      if (t.status >= 300) { console.log(`\n👤 ${m}\n   ✗ HTTP ${t.status} ${JSON.stringify(t.erro).slice(0, 200)}`); continue; }
      const j = t.json;
      const resp = (j.resposta ?? []).map((x) => x.texto).join(' ⏎ ');
      const tools = (j.trace?.ferramentas ?? j.ferramentas ?? []).map((f) => `${f.nome ?? f.ferramenta}${f.ok === false || f.resultado?.ok === false ? '✗' : ''}`).join(', ');
      console.log(`\n👤 ${m}\n🤖 ${resp}\n   ferramentas: ${tools || '-'} · decisão: ${JSON.stringify(j.decisao?.acao ?? j.decisao ?? '').slice(0, 60)} · US$ ${Number(j.trace?.custoUsd ?? 0).toFixed(4)}`);
      saida.push({ m, resp, trace: j.trace, decisao: j.decisao });
    }
    await req('DELETE', `/api/v1/agents/simulacoes/${sim.id}`).catch(() => null);
  }
  writeFileSync('/tmp/simulacoes-ritinha.json', JSON.stringify(saida, null, 1));
}

if (flag('--publicar')) {
  const r = ok(await req('POST', `/api/v1/agents/${rita.id}/publicar`, { notas: 'agenda do salão (ver/reservar horários) + base de preços do GHL + instruções v4' }), 'publicar');
  console.log(`Ritinha publicada: versão ${r.versao?.numero ?? r.numero ?? JSON.stringify(r).slice(0, 80)}`);
}

if (flag('--notificacao')) {
  const f = wf('Notificação Interna 🔔 (importado do GHL)');
  const d = ok(await req('GET', `/api/v1/automations/workflows/${f.id}`), 'fluxo');
  const grafo = structuredClone(d.grafo);
  let trocados = 0;
  for (const n of grafo.nos) if (n.tipo === 'acao.notificar_equipe' && String(n.config?.telefone ?? '').replace(/\D/g, '') !== FONE_GHL) { n.config.telefone = FONE_GHL; trocados++; }
  console.log(`"${f.nome}": ${trocados} aviso(s) → ${mascara(FONE_GHL)}`);
  if (trocados) {
    ok(await req('PATCH', `/api/v1/automations/workflows/${f.id}/grafo`, { grafo }), 'salvar rascunho');
    const v = ok(await req('POST', `/api/v1/automations/workflows/${f.id}/validar`, {}), 'validar');
    if (!v.ok) throw new Error(`não valida: ${JSON.stringify(v).slice(0, 300)}`);
    ok(await req('POST', `/api/v1/automations/workflows/${f.id}/publicar`, {}), 'publicar');
    console.log('  publicado');
  }
}

if (flag('--virada')) {
  const v14 = wf('Novo Lead 🚀 (importado do GHL v14)');
  const val = ok(await req('POST', `/api/v1/automations/workflows/${v14.id}/validar`, {}), 'validar v14');
  if (!val.ok) throw new Error(`v14 não valida: ${JSON.stringify(val).slice(0, 300)}`);
  if (v14.status !== 'ativo') { ok(await req('POST', `/api/v1/automations/workflows/${v14.id}/publicar`, {}), 'publicar v14'); console.log('+ Novo Lead v14 publicado'); }
  for (const nome of ['Novo Lead 🚀', 'Notificação Interna 🔔']) {
    const f = wf(nome);
    if (f?.status === 'ativo') { ok(await req('PATCH', `/api/v1/automations/workflows/${f.id}/status`, { status: 'pausado' }), `pausar ${nome}`); console.log(`- pausado: ${nome}`); }
  }
}
