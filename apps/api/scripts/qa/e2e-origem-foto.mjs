// E2E real (QA, Postgres/RLS reais): origem do lead + foto durável (db/066).
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const API = 'http://localhost:3343/v1';
const STEVO_SECRET = 'whsec_teste_e2e_066';
const META_SECRET = 'metasecret_teste_e2e_066';
const sfx = Date.now().toString(36);
const INST = `inst-e2e-${sfx}`;
const IG = `1784140${String(Date.now()).slice(-9)}`;
let falhas = 0;
const ok = (c, m, x) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}${!c && x !== undefined ? `  -> ${JSON.stringify(x).slice(0, 300)}` : ''}`); if (!c) falhas++; };
const sql = (q) => execFileSync('docker', ['exec', 'orvyn-qa-pg', 'psql', '-U', 'postgres', '-d', 'orvyn_qa', '-At', '-c', q]).toString().trim();
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function req(method, path, token, body, headers = {}) {
  const r = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const ct = r.headers.get('content-type') ?? '';
  return { status: r.status, ct, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}
const stevo = (eventId, data) => {
  const corpo = JSON.stringify({ event_id: eventId, type: 'message.received', attempt: 1, created_at: new Date().toISOString(), account_id: 'acc', instance: { id: INST, external_ref: null, metadata: null, engine: 'smv2' }, data });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `sha256=${createHmac('sha256', STEVO_SECRET).update(`${ts}.${corpo}`).digest('hex')}`;
  return req('POST', '/webhooks/stevo-api', null, corpo, { 'x-stevo-timestamp': ts, 'x-stevo-signature': sig });
};
const meta = (body) => {
  const corpo = JSON.stringify(body);
  return req('POST', '/webhooks/meta', null, corpo, { 'x-hub-signature-256': `sha256=${createHmac('sha256', META_SECRET).update(corpo).digest('hex')}` });
};
const contatoPorTel = (dig) => sql(`select id||'|'||coalesce(origem,'')||'|'||atribuicao::text from contacts where tenant_id='${T}' and regexp_replace(coalesce(telefone,''),'[^0-9]','','g') like '%${dig}'`);

const s = await req('POST', '/auth/signup', null, { email: `e2e-origem-${sfx}@teste.invalido`, password: 'OrigemE2E!2026', nome: 'Dono E2E', empresa: `E2E Origem ${sfx}` });
ok(s.status === 201, 'subconta de teste criada', s.body);
const TK = s.body.access; const T = s.body.user.tenantId;
try {
  sql(`insert into integrations (tenant_id, provider, status, external_business_id) values ('${T}', 'stevo_api', 'connected', '${INST}')`);
  sql(`insert into channel_connections (tenant_id, rede, external_id, nome, status) values ('${T}', 'instagram', '${IG}', 'IG teste', 'conectado')`);

  // 1. WhatsApp vindo de anúncio (clique para WhatsApp)
  const t0 = Date.now();
  const w1 = await stevo(`evt-a-${sfx}`, { message_id: `w-a-${sfx}`, chat: '5511988880001@s.whatsapp.net', from: '5511988880001@s.whatsapp.net', from_me: false, is_group: false, push_name: 'Ana Anúncio', type: 'text', text: 'Oi, vi o anúncio do botox', referral: { source_id: '120210000000000777', source_type: 'ad', headline: 'Botox 20% off', ctwa_clid: 'clid-777' } });
  const ms = Date.now() - t0;
  ok(w1.status === 200, `webhook Stevo aceito (${ms} ms)`, w1.body);
  ok(sql(`select count(*) from messages where tenant_id='${T}' and corpo='Oi, vi o anúncio do botox'`) === '1', 'TEMPO REAL: mensagem já gravada quando o webhook respondeu (sem esperar o worker)');
  ok(sql(`select status from outbox_events where tenant_id='${T}' and dedupe_key='stevo_api-evt-a-${sfx}'`) === 'processed', 'evento marcado como processado na hora (o worker não repete)');
  await espera(1500);
  let [id1, origem1, atr1] = contatoPorTel('988880001').split('|');
  let a1 = JSON.parse(atr1);
  ok(a1.fonte === 'meta_ads' && a1.confianca === 'confirmada' && a1.adId === '120210000000000777' && a1.cliqueId === 'clid-777' && a1.anuncio === 'Botox 20% off', 'lead do anúncio: Meta Ads confirmada com ad_id, clique e título', a1);
  ok(origem1 === 'Meta Ads', 'campo Origem preenchido como Meta Ads', origem1);

  // 2. mesma pessoa manda outra mensagem sem anúncio: origem não muda
  await stevo(`evt-b-${sfx}`, { message_id: `w-b-${sfx}`, chat: '5511988880001@s.whatsapp.net', from: '5511988880001@s.whatsapp.net', from_me: false, is_group: false, push_name: 'Ana Anúncio', type: 'text', text: 'Qual o valor?' });
  await espera(1500);
  a1 = JSON.parse(contatoPorTel('988880001').split('|')[2]);
  ok(a1.fonte === 'meta_ads' && (a1.toques ?? 1) === 1, 'mensagem seguinte (sem anúncio) não sobrescreve a origem', a1);

  // 3. contato direto (sem anúncio)
  await stevo(`evt-c-${sfx}`, { message_id: `w-c-${sfx}`, chat: '5511988880002@s.whatsapp.net', from: '5511988880002@s.whatsapp.net', from_me: false, is_group: false, push_name: 'Bia Direta', type: 'text', text: 'Bom dia' });
  await espera(1500);
  const a2 = JSON.parse(contatoPorTel('988880002').split('|')[2]);
  ok(a2.fonte === 'whatsapp_direto' && a2.confianca === 'desconhecida', 'contato direto: WhatsApp direto, sem chute de anúncio', a2);

  // 4. figurinha sem texto chega com rótulo amigável
  await stevo(`evt-d-${sfx}`, { message_id: `w-d-${sfx}`, chat: '5511988880002@s.whatsapp.net', from: '5511988880002@s.whatsapp.net', from_me: false, is_group: false, push_name: 'Bia Direta', type: 'sticker', media: { url: 'https://example.invalid/x.webp', mimetype: 'image/webp' } });
  ok(sql(`select count(*) from messages where tenant_id='${T}' and corpo='🖼️ Figurinha'`) === '1', 'figurinha aparece no Inbox como "🖼️ Figurinha" (não "[sticker]")');

  // 5. Instagram: DM com anúncio + imagem (webhook da Meta assinado)
  const m1 = await meta({ object: 'instagram', entry: [{ id: IG, time: Date.now(), messaging: [{ sender: { id: `igsid${sfx}` }, recipient: { id: IG }, timestamp: Date.now(), message: { mid: `mid-${sfx}`, text: 'Quero agendar', attachments: [{ type: 'image', payload: { url: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1' } }], referral: { ad_id: '120210000000000888', ref: 'promo', source: 'ADS', type: 'OPEN_THREAD', ads_context_data: { ad_title: 'Progressiva', post_id: 'p1' } } } }] }] });
  ok(m1.status === 200, 'webhook da Meta (Instagram) aceito', m1.body);
  await espera(2000);
  const ig = sql(`select c.atribuicao::text||'|'||m.corpo from contacts c join conversations cv on cv.contact_id=c.id join messages m on m.conversation_id=cv.id where c.tenant_id='${T}' and cv.canal='Instagram' limit 1`);
  const [igAtr, igCorpo] = ig.split('|');
  const a3 = JSON.parse(igAtr || '{}');
  ok(a3.fonte === 'meta_ads' && a3.canal === 'Instagram' && a3.adId === '120210000000000888' && a3.anuncio === 'Progressiva', 'DM do Instagram vinda de anúncio: Meta Ads confirmada', a3);
  ok(igCorpo === 'Quero agendar\n📎 https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1', 'imagem da DM gravada como mídia (antes era descartada)', igCorpo);

  // 6. Instagram direto (sem anúncio), só imagem
  await meta({ object: 'instagram', entry: [{ id: IG, time: Date.now(), messaging: [{ sender: { id: `igsid2${sfx}` }, recipient: { id: IG }, timestamp: Date.now(), message: { mid: `mid2-${sfx}`, attachments: [{ type: 'image', payload: { url: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=2' } }] } }] }] });
  await espera(2000);
  ok(sql(`select count(*) from contacts c join conversations cv on cv.contact_id=c.id where c.tenant_id='${T}' and cv.canal='Instagram' and c.atribuicao->>'fonte'='instagram_direto'`) === '1', 'DM só com imagem (sem anúncio) entra como Instagram direto');

  // 7. backfill pela tag importada do GHL
  sql(`insert into contacts (tenant_id, nome, tags) values ('${T}', 'Importado GHL', '{Lead,kroma-ads}')`);
  const bf = await req('POST', '/crm/atribuicao/backfill', TK);
  ok(bf.status === 200 && bf.body.porFonte?.meta_ads >= 1, 'backfill: contato com tag kroma-ads vira Meta Ads (provável)', bf.body);
  ok(sql(`select atribuicao->>'confianca' from contacts where tenant_id='${T}' and nome='Importado GHL'`) === 'provavel', 'confiança do backfill é "provável", não "confirmada"');

  // 8. origem e resumo pela API (com RLS)
  const og = await req('GET', `/crm/contacts/${id1}/origem`, TK);
  ok(og.status === 200 && og.body.rotulo === 'Meta Ads' && og.body.atribuicao?.adId === '120210000000000777', 'GET origem do contato', og.body);
  const rs = await req('GET', '/crm/atribuicao/resumo?dias=30', TK);
  ok(rs.status === 200 && rs.body.porFonte.some((f) => f.fonte === 'meta_ads' && f.leads >= 2), 'resumo de leads por fonte', rs.body);

  // 9. foto durável servida pela API
  const jpeg = 'ffd8ffe000104a46494600010100000100010000ffd9';
  sql(`insert into contact_fotos (contact_id, tenant_id, mime, bytes, fonte) values ('${id1}', '${T}', 'image/jpeg', '\\x${jpeg}'::bytea, 'whatsapp')`);
  const f = await req('GET', `/crm/contacts/${id1}/foto`, TK);
  ok(f.status === 200 && f.ct === 'image/jpeg' && Buffer.isBuffer(f.body) && f.body.toString('hex') === jpeg, 'foto servida como imagem (bytes intactos)', { status: f.status, ct: f.ct });
  const outro = await req('POST', '/auth/signup', null, { email: `e2e-origem-b-${sfx}@teste.invalido`, password: 'OrigemE2E!2026', nome: 'Outro', empresa: `E2E Origem B ${sfx}` });
  ok((await req('GET', `/crm/contacts/${id1}/foto`, outro.body.access)).status === 404, 'outra subconta NÃO vê a foto (RLS)');
  ok((await req('GET', `/crm/contacts/${id1}/origem`, outro.body.access)).status === 404, 'outra subconta NÃO vê a origem (RLS)');
} finally {
  try {
    execFileSync('docker', ['exec', '-i', 'orvyn-qa-pg', 'psql', '-U', 'postgres', '-d', 'orvyn_qa', '-v', 'ON_ERROR_STOP=1', '-At'], { input: `
      BEGIN; ALTER TABLE audit_logs DISABLE TRIGGER USER;
      DELETE FROM outbox_events WHERE tenant_id IN (SELECT id FROM tenants WHERE nome LIKE 'E2E Origem%${sfx}');
      DELETE FROM webhook_events WHERE tenant_id IN (SELECT id FROM tenants WHERE nome LIKE 'E2E Origem%${sfx}');
      DELETE FROM tenants WHERE nome LIKE 'E2E Origem%${sfx}';
      DELETE FROM identities WHERE email LIKE 'e2e-origem%${sfx}@teste.invalido';
      ALTER TABLE audit_logs ENABLE TRIGGER USER; COMMIT;` });
    console.log('limpeza: restam', sql(`select count(*) from tenants where nome like 'E2E Origem%${sfx}'`));
  } catch (e) { console.log('LIMPEZA FALHOU', e.message.split('\n')[0]); falhas++; }
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CENÁRIOS PASSARAM');
  process.exitCode = falhas ? 1 : 0;
}
