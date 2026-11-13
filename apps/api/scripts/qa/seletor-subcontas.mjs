// QA — Seletor de subcontas (estilo GHL) + sincronização de acesso, contra a API REAL da stack orvyn-qa.
//   cd apps/api && node scripts/qa/seletor-subcontas.mjs
// Classificação: REAL_RUNTIME_TEST (API :4010 + Postgres :55440 reais). Nenhuma chamada externa.
// Cria uma agência "Agência Seletor <run>" com 4 subcontas com endereço e um membro, e confere:
//  - GET /agency/switcher (lista leve, endereço, fixado, recentes);
//  - PATCH /agency/clients/:id/pin (só subconta visível);
//  - rebaixar papel e restringir subcontas valem DENTRO das subcontas na hora (403/401).
// No fim imprime o login do dono (só QA) para o teste visual no navegador.
import { spawnSync } from 'node:child_process';

const API = process.env.QA_API ?? 'http://localhost:4010/v1';
const RUN = Date.now().toString(36);
const PASS = 'QaSenha#2026x';
let falhas = 0;
const rec = (nome, ok, detalhe = '') => { if (!ok) falhas++; console.log(`${ok ? 'PASS' : 'FAIL'} ${nome}${ok ? '' : ' :: ' + JSON.stringify(detalhe).slice(0, 300)}`); };

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
async function signup(label, empresa) {
  const email = `qa-${label}-${RUN}@khub-qa.test`;
  const r = await api('POST', '/auth/signup', null, { email, password: PASS, nome: `QA ${label}`, empresa });
  if (r.status >= 300) throw new Error(`signup ${label}: ${r.status} ${JSON.stringify(r.body)}`);
  const me = await api('GET', '/auth/me', r.body.access);
  return { email, access: r.body.access, identityId: me.body.identityId };
}

const dono = await signup('seletor-dono', `Agência Seletor ${RUN}`);
const membro = await signup('seletor-membro', `Membro Seletor ${RUN}`);
const ag = sql(`INSERT INTO agencies(name,slug,owner_identity_id) VALUES ('Agência Seletor ${RUN}','ag-seletor-${RUN}','${dono.identityId}') RETURNING id`);
sql(`INSERT INTO agency_members(agency_id,identity_id,role) VALUES ('${ag}','${dono.identityId}','owner')`);
const membroId = sql(`INSERT INTO agency_members(agency_id,identity_id,role) VALUES ('${ag}','${membro.identityId}','admin') RETURNING id`);

const subcontas = [
  ['Studio da Beleza', 'Avenida Umuarama, 1000 - Araçatuba, SP'],
  ['Instituto Barbara Lopes', 'Av. Brasília, 500 - Araçatuba, São Paulo'],
  ['Clínica Vitta Prime', 'Rua Marcílio Dias, 220 - Birigui, SP'],
  ['Helios Energia', null],
];
const ids = {};
for (const [nome, endereco] of subcontas) {
  const c = await api('POST', '/agency/clients', dono.access, { nome });
  ids[nome] = c.body;
  if (endereco) sql(`UPDATE tenants SET endereco='${endereco}' WHERE id='${c.body.tenantId}'`);
}

// 1) seletor leve
const s1 = await api('GET', '/agency/switcher', dono.access);
rec('switcher lista as 4 subcontas com endereço', s1.status === 200 && s1.body.length === 4 && s1.body.find((c) => c.nome === 'Studio da Beleza')?.endereco === 'Avenida Umuarama, 1000 - Araçatuba, SP', s1);
rec('switcher sem endereço vem null', s1.body.find((c) => c.nome === 'Helios Energia')?.endereco === null, s1.body);

// 2) fixar
const p1 = await api('PATCH', `/agency/clients/${ids['Instituto Barbara Lopes'].id}/pin`, dono.access, { fixado: true });
const s2 = await api('GET', '/agency/switcher', dono.access);
rec('fixar marca a subconta', p1.status === 200 && s2.body.find((c) => c.nome === 'Instituto Barbara Lopes')?.fixado === true, { p1, s2: s2.body });
const pInv = await api('PATCH', `/agency/clients/00000000-0000-4000-8000-000000000000/pin`, dono.access, { fixado: true });
rec('fixar subconta que não é da agência = 404', pInv.status === 404, pInv);
const pRuim = await api('PATCH', `/agency/clients/${ids['Instituto Barbara Lopes'].id}/pin`, dono.access, { fixado: 'sim' });
rec('fixar com corpo inválido = 400', pRuim.status === 400, pRuim);

// 3) recentes
await api('POST', `/agency/clients/${ids['Studio da Beleza'].id}/activate`, dono.access);
const s3 = await api('GET', '/agency/switcher', dono.access);
rec('entrar grava último acesso (Recentes)', !!s3.body.find((c) => c.nome === 'Studio da Beleza')?.ultimoAcessoEm, s3.body);

// 4) acesso do membro acompanha a agência
const a1 = await api('POST', `/agency/clients/${ids['Instituto Barbara Lopes'].id}/activate`, membro.access);
const a2 = await api('POST', `/agency/clients/${ids['Helios Energia'].id}/activate`, membro.access);
rec('membro admin entra em 2 subcontas', a1.status < 300 && a2.status < 300, { a1: a1.status, a2: a2.status });
const tokHelios = a2.body.access;
const antes = await api('GET', '/auth/me', tokHelios);
rec('token do membro na Helios funciona antes da restrição', antes.status === 200, antes.status);

const upd = await api('PATCH', `/agency/members/${membroId}`, dono.access, { role: 'viewer', clientIds: [ids['Instituto Barbara Lopes'].id] });
rec('restringir + rebaixar devolve o que sincronizou', upd.status === 200 && upd.body.subcontasRevogadas === 1 && upd.body.papeisAjustados === 1, upd);
const depois = await api('GET', '/auth/me', tokHelios);
rec('acesso à subconta retirada cai NA HORA (mesmo token)', depois.status === 401 || depois.status === 403, depois.status);
const papel = sql(`SELECT m.role FROM memberships m WHERE m.identity_id='${membro.identityId}' AND m.tenant_id='${ids['Instituto Barbara Lopes'].tenantId}'`);
rec('papel na subconta que ficou virou viewer', papel === 'viewer', papel);
const reentra = await api('POST', `/agency/clients/${ids['Helios Energia'].id}/activate`, membro.access);
rec('membro não consegue mais entrar na subconta retirada', reentra.status === 403, reentra.status);
const sm = await api('GET', '/agency/switcher', membro.access);
rec('switcher do membro mostra só a subconta liberada', sm.status === 200 && sm.body.length === 1 && sm.body[0].nome === 'Instituto Barbara Lopes', sm.body);
const pinM = await api('PATCH', `/agency/clients/${ids['Studio da Beleza'].id}/pin`, membro.access, { fixado: true });
rec('membro não fixa subconta que não vê', pinM.status === 404, pinM.status);

console.log(`\n${falhas ? `FALHAS: ${falhas}` : 'TUDO PASSOU'}`);
console.log(`Login de QA (dono da agência): ${dono.email} / ${PASS}`);
process.exitCode = falhas ? 1 : 0;
