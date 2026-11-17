#!/usr/bin/env node
/**
 * Agendart → formato dos importadores oficiais do KHUB (o mesmo de
 * scripts/operar/avec/importar.mjs): khub/contatos.json e khub/agenda.json.
 *
 *   node scripts/operar/agendart/converter.mjs [~/Downloads/agendart-export/<data>]
 *
 * Regras:
 * - contato = paciente com telefone (DDI + número, só dígitos); sem telefone, o
 *   paciente entra pela referência estável "agendart:<id>" no próprio atendimento;
 * - status: attended→concluido, confirmed→confirmado, scheduled→agendado,
 *   cancel*→cancelado, falta/no_show/missed→faltou (desconhecido → agendado + aviso);
 * - valor: o do atendimento (o Agendart guarda o dinheiro no evento). No KHUB,
 *   concluído com valor vira entrada no caixa — fonte única, nada contado duas vezes;
 * - serviço = nome do serviço do atendimento (catálogo da clínica); sem serviço, "Consulta".
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';

const raiz = `${homedir()}/Downloads/agendart-export`;
const DIR = process.argv[2] ?? `${raiz}/${readdirSync(raiz).sort().at(-1)}`;
const ler = (n) => JSON.parse(readFileSync(`${DIR}/${n}`, 'utf8'));
const pacientes = ler('pacientes.json');
const agenda = ler('agenda.json');
const clinica = ler('clinica.json');
mkdirSync(`${DIR}/khub`, { recursive: true });

const digitos = (s) => String(s ?? '').replace(/\D/g, '');
function telefone(p) {
  const n = digitos(p?.phone);
  if (n.length < 10) return null;
  const ddi = digitos(p?.country_code) || '55';
  return n.startsWith(ddi) && n.length > 11 ? n : `${ddi}${n}`;
}
const dataBr = (iso, fuso) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { data: `${p.day}/${p.month}/${p.year}`, hora: `${p.hour}:${p.minute}` };
};
const FUSO = clinica.clinicTimezone || 'America/Sao_Paulo';
const avisos = [];
function status(s) {
  const t = String(s ?? '').toLowerCase();
  if (/attend|conclu|finish|done|realiz/.test(t)) return 'concluido';
  if (/confirm/.test(t)) return 'confirmado';
  if (/cancel|desmarc/.test(t)) return 'cancelado';
  if (/miss|no_?show|absent|falt/.test(t)) return 'faltou';
  if (/schedul|agend|pend|wait/.test(t)) return 'agendado';
  avisos.push(`status desconhecido "${s}" → agendado`);
  return 'agendado';
}
const servicoNome = new Map((clinica.services ?? []).map((s) => [s.id, s.name ?? s.title ?? s.nome]));
const nomeServico = (e) => {
  const s = (e.services ?? [])[0];
  return (s && (s.name ?? s.title ?? s.service?.name ?? servicoNome.get(s.service_id ?? s.id))) || 'Consulta';
};
const centavosBr = (v) => { const n = Number(v ?? 0); return n > 0 ? n.toFixed(2).replace('.', ',') : undefined; };

// contatos
const contatos = [];
const vistos = new Set();
for (const p of pacientes) {
  const tel = telefone(p);
  if (!tel || vistos.has(tel)) continue;
  vistos.add(tel);
  contatos.push({ nome: (p.social_name || p.name || '').trim() || `Paciente ${p.id}`, telefone: tel, origem: 'Agendart', tags: 'agendart', observacao: `Paciente Agendart #${p.id}${p._arquivado ? ' (arquivado)' : ''}` });
}

// agenda
const linhas = agenda.map((e) => {
  const { data, hora } = dataBr(e.start, FUSO);
  const dur = e.end ? Math.max(5, Math.round((new Date(e.end) - new Date(e.start)) / 60000)) : 60;
  const pac = e.patient ?? pacientes.find((p) => p.id === e.patient_id);
  const tel = telefone(pac);
  const st = status(e.status);
  return {
    data, hora, duracaoMin: String(dur), status: st,
    servico: nomeServico(e),
    profissional: e.professional?.name || undefined,
    contatoTelefone: tel || undefined,
    contatoNome: pac?.name || undefined,
    contatoRef: pac?.id ? `agendart:${pac.id}` : undefined,
    // Concluído com valor vira entrada PAGA no caixa do KHUB: só o que foi pago de fato.
    // O saldo não pago vai para o financeiro como "a receber" (abaixo).
    valor: st === 'concluido' ? centavosBr(e.paid_value) : centavosBr(e.value),
    _origem: { id: e.id, status: e.status, pago: Number(e.paid_value ?? 0), formaPagamento: e.payment_method ?? null, convenio: e.health_insurance ?? null },
  };
});

// financeiro: saldo a receber dos atendimentos concluídos (valor cobrado − pago)
const financeiro = [];
agenda.forEach((e, i) => {
  if (linhas[i].status !== 'concluido') return;
  const saldo = Number(e.value ?? 0) - Number(e.paid_value ?? 0);
  if (saldo <= 0.005) return;
  financeiro.push({
    tipo: 'entrada', status: 'pendente', categoria: 'Atendimentos (Agendart)',
    valor: saldo.toFixed(2).replace('.', ','), data: linhas[i].data,
    descricao: `Saldo a receber: ${linhas[i].servico} de ${linhas[i].data}${linhas[i].contatoNome ? ` (${linhas[i].contatoNome})` : ''}`,
    ocorrencia: 1,
  });
});
writeFileSync(`${DIR}/khub/financeiro.json`, JSON.stringify(financeiro, null, 1));
writeFileSync(`${DIR}/khub/contatos.json`, JSON.stringify(contatos, null, 1));
writeFileSync(`${DIR}/khub/agenda.json`, JSON.stringify(linhas.map(({ _origem, ...l }) => l), null, 1));
writeFileSync(`${DIR}/khub/agenda-origem.json`, JSON.stringify(linhas, null, 1));
const porStatus = linhas.reduce((m, l) => ({ ...m, [l.status]: (m[l.status] ?? 0) + 1 }), {});
const futuros = linhas.filter((l, i) => new Date(agenda[i].start) > new Date() && ['agendado', 'confirmado'].includes(l.status)).length;
console.log(JSON.stringify({
  pacientes: pacientes.length, contatosComTelefone: contatos.length, semTelefone: pacientes.length - contatos.length,
  atendimentos: linhas.length, porStatus, futurosAtivos: futuros,
  comValor: linhas.filter((l) => l.valor).length,
  aReceber: financeiro.length, somaAReceber: financeiro.reduce((t, f) => t + Number(f.valor.replace(',', '.')), 0).toFixed(2),
  somaValorConcluidos: linhas.filter((l) => l.valor && l.status === 'concluido').reduce((t, l) => t + Number(l.valor.replace(',', '.')), 0).toFixed(2),
  servicos: [...new Set(linhas.map((l) => l.servico))],
  profissionais: [...new Set(linhas.map((l) => l.profissional))],
  avisos: [...new Set(avisos)],
}, null, 1));
