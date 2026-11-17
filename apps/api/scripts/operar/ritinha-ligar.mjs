#!/usr/bin/env node
/**
 * Liga a Ritinha para TODOS os leads do WhatsApp do Studio, pela API oficial
 * (login ~/.khub/khub.env, nunca impresso).
 *
 *   node scripts/operar/ritinha-ligar.mjs --segunda   rascunho: segunda fechada (instrução + horário do agente)
 *   node scripts/operar/ritinha-ligar.mjs --simular   simulador (nada é enviado): segunda × terça
 *   node scripts/operar/ritinha-ligar.mjs --publicar  publica o rascunho
 *   node scripts/operar/ritinha-ligar.mjs --principal agente principal do WhatsApp (piloto automático: conversa
 *                                                     nova nasce com a IA e as abertas sem responsável passam para ela)
 *   node scripts/operar/ritinha-ligar.mjs --estado
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const BASE = 'https://khub-os.vercel.app';
const flag = (f) => process.argv.includes(f);
const REGRA_SEGUNDA = 'SEGUNDA O SALÃO NÃO ABRE: nunca ofereça nem marque segunda-feira.';
const env = Object.fromEntries(readFileSync(`${homedir()}/.khub/khub.env`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const jar = new Map();
async function req(metodo, caminho, corpo) {
  for (let t = 1; ; t++) {
    try {
      const r = await fetch(`${BASE}${caminho}`, {
        method: metodo,
        headers: { 'content-type': 'application/json', ...(jar.size ? { cookie: [...jar.values()].join('; ') } : {}) },
        body: corpo ? JSON.stringify(corpo) : undefined, redirect: 'manual', signal: AbortSignal.timeout(170_000),
      });
      for (const sc of r.headers.getSetCookie?.() ?? []) { const kv = sc.split(';')[0]; jar.set(kv.slice(0, kv.indexOf('=')), kv); }
      const t2 = await r.text();
      let json = null; try { json = JSON.parse(t2); } catch { /* */ }
      if (r.status >= 500 && t < 4) { await new Promise((ok) => setTimeout(ok, 4000 * t)); continue; }
      return { status: r.status, json, erro: json?.detail ?? json?.title ?? json?.message ?? t2.slice(0, 300) };
    } catch (e) { if (t >= 4) throw e; await new Promise((ok) => setTimeout(ok, 4000 * t)); }
  }
}
const ok = (r, o) => { if (r.status >= 300) throw new Error(`${o}: HTTP ${r.status} ${JSON.stringify(r.erro).slice(0, 400)}`); return r.json; };

ok(await req('POST', '/api/auth/login', { email: env.KHUB_EMAIL, password: env.KHUB_SENHA }), 'login');
const me = ok(await req('GET', '/api/v1/auth/me'), 'me');
if (!/studio da beleza/i.test(me?.tenant?.nome ?? '')) { console.log(`sessão em "${me?.tenant?.nome}", não no Studio: nada feito`); process.exit(2); }
const lista = ok(await req('GET', '/api/v1/agents'), 'agentes');
const rita = (Array.isArray(lista) ? lista : lista.itens).find((a) => /ritinha/i.test(a.nome));
const detalhe = () => req('GET', `/api/v1/agents/${rita.id}`).then((r) => ok(r, 'ritinha'));

if (flag('--estado')) {
  const d = await detalhe();
  console.log(`Ritinha: ${d.status} · principal ${d.padrao} · canais ${d.canais} · v${d.versaoPublicada?.numero} · não publicado: ${d.alteracoesNaoPublicadas} · segunda: ${JSON.stringify(d.config?.horario?.dias?.seg)} · regra no prompt: ${d.instrucoes.includes(REGRA_SEGUNDA)}`);
}

if (flag('--segunda')) {
  const d = await detalhe();
  const instrucoes = d.instrucoes.includes(REGRA_SEGUNDA) ? d.instrucoes : `${d.instrucoes.trimEnd()}\n${REGRA_SEGUNDA}`;
  const horario = { ...(d.config?.horario ?? {}), dias: { ...(d.config?.horario?.dias ?? {}), seg: [], dom: [] } };
  const r = ok(await req('PATCH', `/api/v1/agents/${rita.id}`, { instrucoes, config: { horario } }), 'rascunho');
  console.log(`rascunho: ${r.instrucoes.length} caracteres · segunda ${JSON.stringify(r.config?.horario?.dias?.seg ?? horario.dias.seg)} · domingo ${JSON.stringify(horario.dias.dom)}`);
}

if (flag('--simular')) {
  const casos = [
    ['Oi! Tem horário pra manicure na segunda de manhã?'],
    ['oi, queria fazer design de sobrancelha terça à tarde, tem vaga?'],
  ];
  for (const msgs of casos) {
    const sim = ok(await req('POST', `/api/v1/agents/${rita.id}/simulacoes`, { perfil: 'livre', usarRascunho: true }), 'simulação');
    const t = ok(await req('POST', `/api/v1/agents/simulacoes/${sim.id}/turno`, { mensagens: msgs }), 'turno');
    const tr = t.trace ?? {};
    console.log(`\n👤 ${msgs.join(' | ')}\n🤖 ${(t.resposta ?? []).map((m) => m.texto).join(' ⏎ ')}\n   decisão ${JSON.stringify(t.decisao?.acao ?? t.decisao)} · ferramentas ${(tr.ferramentas ?? []).map((f) => `${f.nome}${f.ok ? '' : '✗'}`).join(', ') || '-'} · avisos ${(tr.validacao ?? []).join('; ') || '-'}`);
    await req('DELETE', `/api/v1/agents/simulacoes/${sim.id}`).catch(() => null);
    await new Promise((r) => setTimeout(r, 21000)); // Voyage sem cartão: 3/min
  }
}

if (flag('--publicar')) {
  const r = ok(await req('POST', `/api/v1/agents/${rita.id}/publicar`, { notas: 'segunda fechada; Ritinha principal para todos os leads' }), 'publicar');
  console.log(`publicado: v${r.versao?.numero}`);
}

if (flag('--principal')) {
  const r = ok(await req('PATCH', `/api/v1/agents/${rita.id}`, { padrao: true, canais: ['WhatsApp'] }), 'principal');
  console.log(`Ritinha principal: ${r.padrao} · canais ${r.canais}`);
}
