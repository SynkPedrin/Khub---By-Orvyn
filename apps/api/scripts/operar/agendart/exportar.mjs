#!/usr/bin/env node
/**
 * EXPORTAÇÃO SOMENTE LEITURA do Agendart (clínica da Dra. Bárbara) para migrar
 * ao KHUB. Usa os mesmos caminhos da tela: lista de pacientes e a exportação
 * nativa do financeiro ("Exportar CSV"), que gera o arquivo em
 * "exportações recentes". Nada é criado, alterado ou enviado a paciente.
 *
 *   node scripts/operar/agendart/exportar.mjs [--desde 2024-01-01] [--ate 2027-12-31]
 *
 * Saída: ~/Downloads/agendart-export/<data>/ (chmod 700 — contém dado pessoal).
 * Prontuário (anamnese, evolução, exames, documentos) NÃO é exportado: é dado
 * de saúde (LGPD art. 11) e o KHUB não tem módulo de prontuário.
 */
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Agendart, BASE } from './cliente.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const DESDE = arg('--desde', '2024-01-01');
const ATE = arg('--ate', '2027-12-31');
const DIR = `${homedir()}/Downloads/agendart-export/${new Date().toISOString().slice(0, 10)}`;
mkdirSync(DIR, { recursive: true });
chmodSync(`${homedir()}/Downloads/agendart-export`, 0o700);
const salvar = (nome, dados) => writeFileSync(`${DIR}/${nome}`, typeof dados === 'string' ? dados : JSON.stringify(dados, null, 1));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const a = new Agendart();
const login = await a.login();
const calendario = await a.pagina(new URL(login.location, BASE).pathname);
const P = calendario.props ?? {};
const CLINICA = P.clinicUuid;
if (!CLINICA) throw new Error('não achei a clínica na sessão');
console.log(`clínica: ${P.clinicName} · fuso ${P.clinicTimezone} · desde ${P.clinicCreatedAt}`);

// 1) Cadastro da clínica: profissionais, serviços, agenda, unidades, campos personalizados.
const meta = Object.fromEntries(['clinicName', 'clinicTimezone', 'clinicCreatedAt', 'clinicDays', 'professionals', 'services', 'schedule', 'units', 'companies', 'customFields', 'customFieldsPatient', 'customFieldsProfessional', 'clinicModules', 'clinicPlan'].map((k) => [k, P[k] ?? null]));
salvar('clinica.json', meta);
console.log(`profissionais: ${(P.professionals ?? []).length} · serviços: ${(P.services ?? []).length} · unidades: ${(P.units ?? []).length}`);

// 2) Pacientes (lista paginada da tela).
const pacientes = [];
// Mesmos filtros da tela de Pacientes; ativos e arquivados.
for (const archived of ['no', 'yes']) {
  for (let pagina = 1; pagina < 1000; pagina++) {
    const q = new URLSearchParams({ page: String(pagina), rows: '100', sortField: '', sortOrder: 'asc', patient: '', archived, group: '', health_insurance: '', gender: '', in_treatment: 'false', payment_status: '', company_id: '', professional_id: '' });
    const r = await a.req('GET', `/clinica/${CLINICA}/fetch-patients?${q}`);
    if (r.status !== 200) throw new Error(`pacientes ${archived} p${pagina}: HTTP ${r.status}`);
    const lote = Array.isArray(r.dados?.data) ? r.dados.data : [];
    pacientes.push(...lote.map((x) => ({ ...x, _arquivado: archived === 'yes' })));
    if (pagina === 1) console.log(`pacientes (${archived === 'no' ? 'ativos' : 'arquivados'}): total ${r.dados?.total ?? '?'}`);
    if (lote.length < 100) break;
  }
}
const unicos = [...new Map(pacientes.map((x) => [x.uuid ?? x.id, x])).values()];
pacientes.length = 0; pacientes.push(...unicos);
salvar('pacientes.json', pacientes);
console.log(`pacientes exportados: ${pacientes.length}`);

// 2b) Agenda completa, mês a mês (mesma chamada do calendário), com o detalhe de cada atendimento.
const eventos = new Map();
const [aI, mI] = DESDE.slice(0, 7).split('-').map(Number);
const [aF, mF] = ATE.slice(0, 7).split('-').map(Number);
for (let ano = aI, mes = mI; ano < aF || (ano === aF && mes <= mF); mes === 12 ? (ano++, mes = 1) : mes++) {
  const ini = `${ano}-${String(mes).padStart(2, '0')}-01T00:00:00-03:00`;
  const [an, mn] = mes === 12 ? [ano + 1, 1] : [ano, mes + 1];
  const fim = `${an}-${String(mn).padStart(2, '0')}-01T00:00:00-03:00`;
  const r = await a.req('POST', `/clinica/${CLINICA}/events`, { corpo: { start: ini, end: fim } });
  if (r.status !== 200) throw new Error(`agenda ${ano}-${mes}: HTTP ${r.status}`);
  for (const e of r.dados?.events ?? []) eventos.set(e.id, e);
}
console.log(`atendimentos na agenda: ${eventos.size}`);
const ids = [...eventos.keys()];
const detalhes = [];
for (let i = 0; i < ids.length; i += 4) {
  const lote = await Promise.all(ids.slice(i, i + 4).map(async (id) => {
    const d = await a.req('GET', `/clinica/${CLINICA}/get-event/${id}`);
    const ev = d.dados?.event ?? d.dados;
    if (d.status !== 200 || !ev?.id) return { ...eventos.get(id), _semDetalhe: d.status };
    // Sem dados internos da conta/clínica que não servem à migração.
    const { clinic: _c, professional, patient, ...resto } = ev;
    return { ...resto, professional: professional ? { id: professional.id, name: professional.name } : null, patient: patient ? { id: patient.id, uuid: patient.uuid, name: patient.name, phone: patient.phone, country_code: patient.country_code } : null };
  }));
  detalhes.push(...lote);
  if (i % 200 === 0) process.stdout.write(`  detalhes ${detalhes.length}/${ids.length}\r`);
}
salvar('agenda.json', detalhes);
const soma = (k) => detalhes.reduce((t, e) => t + Number(e[k] ?? 0), 0);
console.log(`\nagenda exportada: ${detalhes.length} · valor total R$ ${soma('value').toFixed(2)} · pago R$ ${soma('paid_value').toFixed(2)} · com serviço: ${detalhes.filter((e) => (e.services ?? []).length).length} · status: ${JSON.stringify(detalhes.reduce((m, e) => ({ ...m, [e.status]: (m[e.status] ?? 0) + 1 }), {}))}`);

// 2c) Telas do financeiro (props das páginas): confirma se há dinheiro lançado fora dos atendimentos.
for (const tela of ['finance/dashboard', 'finance/receive_bills', 'finance/pay_bills', 'finance/commission', 'finance/monthly_payments_bills', 'settings/services']) {
  const p = await a.pagina(`/clinica/${CLINICA}/${tela}`);
  const props = p.props ?? {};
  const util = Object.fromEntries(Object.entries(props).filter(([k]) => !['ziggy', 'jetstream', 'auth', 'errors', 'errorBags', 'flash', 'csrf_token', 'systemSettings', 'permissions', 'roles'].includes(k) && !k.startsWith('clinicDesign')));
  salvar(`tela-${tela.replace('/', '-')}.json`, util);
  console.log(`tela ${tela}: ${p.component ?? p.status} · ${Object.keys(util).length} props`);
}

// 3) Exportação nativa do financeiro (CSV): atendimentos, a receber, a pagar, comissões.
const antes = await a.req('GET', `/clinica/${CLINICA}/user-exports/list`);
const idsAntes = new Set((Array.isArray(antes.dados) ? antes.dados : []).map((e) => e.id));
for (const tipo of ['appointments', 'receive', 'payment', 'commission']) {
  const q = new URLSearchParams({ startDate: DESDE, endDate: ATE, data_type: 'appointment', user_time_zone: P.clinicTimezone ?? 'America/Sao_Paulo' });
  const r = await a.req('GET', `/clinica/${CLINICA}/finance/export/${tipo}/csv?${q}`);
  const d = r.dados ?? {};
  if (d.url && d.success) {
    const arq = await fetch(d.url, { signal: AbortSignal.timeout(120_000) });
    salvar(`financeiro-${tipo}.csv`, await arq.text());
    console.log(`${tipo}: baixado direto`);
    continue;
  }
  if (!d.success) { console.log(`${tipo}: sem dados ou recusado (HTTP ${r.status}) ${JSON.stringify(d).slice(0, 160)}`); continue; }
  console.log(`${tipo}: exportação enfileirada, aguardando…`);
  let pronto = null;
  for (let t = 0; t < 60 && !pronto; t++) {
    await espera(10_000);
    const l = await a.req('GET', `/clinica/${CLINICA}/user-exports/list`);
    const novos = (Array.isArray(l.dados) ? l.dados : []).filter((e) => !idsAntes.has(e.id));
    pronto = novos.find((e) => /conclu|complete|done|finish|ready|success/i.test(String(e.status ?? '')) || e.url || e.file_path);
    if (t === 0 && novos[0]) console.log(`   item: ${JSON.stringify(Object.keys(novos[0]))} status=${novos[0].status}`);
  }
  if (!pronto) { console.log(`${tipo}: não ficou pronta em 10 min`); continue; }
  idsAntes.add(pronto.id);
  const dl = await a.req('GET', `/clinica/${CLINICA}/user-exports/download/${pronto.id}`, { json: false });
  const url = dl.location ?? dl.dados?.url ?? pronto.url;
  const conteudo = url ? await (await fetch(url, { signal: AbortSignal.timeout(120_000) })).text() : dl.texto;
  salvar(`financeiro-${tipo}.csv`, conteudo);
  console.log(`${tipo}: ${conteudo.split('\n').length - 1} linhas`);
}
console.log(`pronto em ${DIR}`);
