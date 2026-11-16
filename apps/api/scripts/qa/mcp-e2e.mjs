// E2E do conector MCP (ADR-0049) contra a API REAL do stack QA — faz o papel do
// Claude/ChatGPT do começo ao fim: descoberta → cadastro (RFC 7591) → authorize
// → consentimento (dono logado) → troca do código com PKCE → MCP initialize →
// tools/list → leitura → editar rascunho → testar agente → ação sensível vira
// aprovação → humano aprova no KHUB → executa → refresh rotativo → revogação.
//
//   QA_BASE=http://localhost:4011 node scripts/qa/mcp-e2e.mjs
//
// Nada sai da máquina: tenants descartáveis no orvyn_qa; IA pelo stub local.
import { createHash, randomBytes } from 'node:crypto';

const BASE = process.env.QA_BASE ?? 'http://localhost:4011';
const RUN = Date.now().toString(36);
const PASS = `Qa!${RUN}Senha-forte-123`;
const resultados = [];
const rec = (nome, ok, detalhe = '') => {
  resultados.push({ nome, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${nome}${ok ? '' : ' :: ' + String(typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe)).slice(0, 500)}`);
};

async function http(method, path, { token, body, form, headers = {}, redirect = 'manual' } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(BASE + path, { method, headers: h, body: payload, redirect });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json, headers: r.headers };
}

async function signup(label) {
  const email = `qa-mcp-${label}-${RUN}@khub-qa.test`;
  const r = await http('POST', '/v1/auth/signup', { body: { email, password: PASS, nome: `QA ${label}`, empresa: `Studio ${label} ${RUN}` } });
  if (r.status >= 300) throw new Error(`signup ${label}: ${r.status} ${JSON.stringify(r.body)}`);
  return { access: r.body.access, email };
}

let rpcId = 0;
const mcp = (token, method, params) => http('POST', '/mcp', { token, body: { jsonrpc: '2.0', id: ++rpcId, method, params }, headers: { accept: 'application/json, text/event-stream' } });
const tool = async (token, name, args = {}) => {
  const r = await mcp(token, 'tools/call', { name, arguments: args });
  const res = r.body?.result;
  const text = res?.content?.[0]?.text ?? '';
  let dados; try { dados = JSON.parse(text); } catch { dados = text; }
  return { status: r.status, isError: !!res?.isError, text, dados, structured: res?.structuredContent, raw: r.body };
};

async function main() {
  const dono = await signup('dono');
  const outro = await signup('outro');

  // ---------- descoberta ----------
  const semToken = await mcp(undefined, 'initialize', { protocolVersion: '2025-06-18' });
  const www = semToken.headers.get('www-authenticate') ?? '';
  rec('POST /mcp sem token → 401 com resource_metadata', semToken.status === 401 && www.includes('resource_metadata="'), www);
  const prm = await http('GET', '/.well-known/oauth-protected-resource');
  const asm = await http('GET', '/.well-known/oauth-authorization-server');
  rec('metadados do recurso e do servidor de autorização', prm.status === 200 && asm.status === 200 && asm.body.code_challenge_methods_supported?.includes('S256') && prm.body.authorization_servers?.[0] === asm.body.issuer);

  // ---------- cadastro dinâmico ----------
  const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
  const ruim = await http('POST', '/oauth/register', { body: { client_name: 'X', redirect_uris: ['http://evil.example/cb'] } });
  rec('cadastro recusa redirect http fora de localhost', ruim.status === 400 && ruim.body.error === 'invalid_redirect_uri', ruim.body);
  const reg = await http('POST', '/oauth/register', { body: { client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] } });
  rec('cadastro público (none) devolve client_id sem segredo', reg.status === 201 && /^kcl_/.test(reg.body.client_id) && !reg.body.client_secret, reg.body);
  const regSec = await http('POST', '/oauth/register', { body: { client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'], token_endpoint_auth_method: 'client_secret_post' } });
  rec('cadastro confidencial (client_secret_post) devolve segredo', regSec.status === 201 && /^kcs_/.test(regSec.body.client_secret ?? ''), regSec.body);
  const CID = reg.body.client_id;

  // ---------- authorize ----------
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const q = (o) => '/oauth/authorize?' + new URLSearchParams(o).toString();
  const naoCadastrado = await http('GET', q({ response_type: 'code', client_id: CID, redirect_uri: 'https://evil.example/cb', code_challenge: challenge, code_challenge_method: 'S256', state: 's1' }));
  rec('authorize com redirect não cadastrado: página de erro, NUNCA redireciona', naoCadastrado.status === 400 && !naoCadastrado.headers.get('location'));
  const semPkce = await http('GET', q({ response_type: 'code', client_id: CID, redirect_uri: REDIRECT, state: 's1' }));
  const locSemPkce = semPkce.headers.get('location') ?? '';
  rec('authorize sem PKCE volta ao app com invalid_request e o state', semPkce.status === 302 && locSemPkce.startsWith(REDIRECT) && locSemPkce.includes('error=invalid_request') && locSemPkce.includes('state=s1'), locSemPkce);
  const auth = await http('GET', q({ response_type: 'code', client_id: CID, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'estado-123', scope: 'khub', resource: `${BASE}/mcp` }));
  const loc = auth.headers.get('location') ?? '';
  const pedido = loc.split('/conectar-ia/')[1];
  rec('authorize válido → tela de consentimento do KHUB', auth.status === 302 && !!pedido, loc);

  // ---------- consentimento ----------
  const det = await http('GET', `/v1/conector-ia/pedido/${pedido}`, { token: dono.access });
  rec('consentimento mostra app, subconta e permite autorizar (dono)', det.status === 200 && det.body.aplicativo === 'Claude' && det.body.podeAutorizar === true && det.body.negar?.includes('error=access_denied'), det.body);
  const adulterado = pedido.slice(0, -3) + (pedido.endsWith('AAA') ? 'BBB' : 'AAA');
  const detAdult = await http('GET', `/v1/conector-ia/pedido/${adulterado}`, { token: dono.access });
  rec('pedido adulterado é recusado', detAdult.status === 404, detAdult.status);
  const dec = await http('POST', '/v1/conector-ia/decidir', { token: dono.access, body: { pedido, aprovar: true } });
  const ret = new URL(dec.body.redirect ?? 'http://x');
  const code = ret.searchParams.get('code');
  rec('aprovar devolve ao app com code + state', dec.status === 200 && ret.origin + ret.pathname === REDIRECT && !!code && ret.searchParams.get('state') === 'estado-123', dec.body);

  // ---------- token ----------
  const pkceErrado = await http('POST', '/oauth/token', { form: { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CID, code_verifier: randomBytes(48).toString('base64url') } });
  rec('code_verifier errado → invalid_grant (e o código queima)', pkceErrado.status === 400 && pkceErrado.body.error === 'invalid_grant', pkceErrado.body);
  // novo código (o anterior foi consumido na tentativa errada — uso único)
  const auth2 = await http('GET', q({ response_type: 'code', client_id: CID, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'e2' }));
  const pedido2 = (auth2.headers.get('location') ?? '').split('/conectar-ia/')[1];
  const dec2 = await http('POST', '/v1/conector-ia/decidir', { token: dono.access, body: { pedido: pedido2, aprovar: true } });
  const code2 = new URL(dec2.body.redirect).searchParams.get('code');
  const tok = await http('POST', '/oauth/token', { form: { grant_type: 'authorization_code', code: code2, redirect_uri: REDIRECT, client_id: CID, code_verifier: verifier } });
  rec('troca do código com PKCE certo → access + refresh', tok.status === 200 && /^kha_/.test(tok.body.access_token) && /^khr_/.test(tok.body.refresh_token) && tok.body.expires_in === 3600 && tok.headers.get('cache-control') === 'no-store', tok.body);
  const reuso = await http('POST', '/oauth/token', { form: { grant_type: 'authorization_code', code: code2, redirect_uri: REDIRECT, client_id: CID, code_verifier: verifier } });
  rec('código reutilizado → invalid_grant', reuso.status === 400 && reuso.body.error === 'invalid_grant', reuso.body);
  const AT = tok.body.access_token;

  // ---------- MCP ----------
  const init = await mcp(AT, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'qa', version: '1' } });
  rec('initialize', init.status === 200 && init.body.result?.protocolVersion === '2025-06-18' && !!init.body.result?.capabilities?.tools, init.body);
  const notif = await http('POST', '/mcp', { token: AT, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  rec('notificação → 202 sem corpo', notif.status === 202);
  const lista = await mcp(AT, 'tools/list', {});
  const nomes = (lista.body.result?.tools ?? []).map((t) => t.name);
  rec(`tools/list (${nomes.length} ferramentas)`, nomes.length >= 50 && ['khub_visao_geral', 'listar_agentes', 'testar_agente', 'publicar_agente', 'buscar_contatos'].every((n) => nomes.includes(n)), nomes.join(','));

  const visao = await tool(AT, 'khub_visao_geral');
  rec('khub_visao_geral lê a conta certa', !visao.isError && String(visao.dados?.empresa?.nome ?? '').includes(`Studio dono ${RUN}`), visao.text);
  const conf = await tool(AT, 'ver_configuracoes');
  rec('ver_configuracoes não vaza credencial', !conf.isError && !/credentials|segredo|password/i.test(conf.text) && conf.dados?.membros?.[0]?.email === dono.email, conf.text.slice(0, 300));
  const argsRuins = await tool(AT, 'ver_agente', { agentId: 'nao-e-uuid' });
  rec('argumento inválido volta como erro legível (isError)', argsRuins.isError && argsRuins.text.includes('argumentos inválidos'), argsRuins.text);

  // agente: criar → editar rascunho → testar → publicar (aprovação)
  const criado = await tool(AT, 'criar_agente', { nome: 'Ritinha QA', instrucoes: 'Você é a Ritinha, recepcionista do Studio. Atenda com carinho, entenda o procedimento desejado e ofereça horário de avaliação.' });
  const agentId = criado.dados?.id;
  rec('criar_agente cria rascunho', !criado.isError && !!agentId && criado.dados?.status === 'rascunho', criado.text);
  const TOM = lista.body.result.tools.find((t) => t.name === 'editar_agente').inputSchema.properties.tom.enum.at(-1);
  const editado = await tool(AT, 'editar_agente', { agentId, tom: TOM, maxCaracteres: 400, config: { modo: 'bloqueado-pelo-mcp' } });
  rec('editar_agente edita o rascunho (seção "modo" ignorada)', !editado.isError && editado.dados?.tom === TOM, editado.text);
  const teste = await tool(AT, 'testar_agente', { agentId, mensagens: ['Oi! Quero saber de design de sobrancelha'] });
  rec('testar_agente responde no simulador (nada enviado)', !teste.isError && Array.isArray(teste.dados?.respostas) && teste.dados.respostas.length > 0 && !!teste.dados.simulacaoId, teste.text);
  const teste2 = await tool(AT, 'testar_agente', { agentId, simulacaoId: teste.dados?.simulacaoId, mensagens: ['quanto custa?'] });
  rec('testar_agente continua a MESMA simulação', !teste2.isError && teste2.dados?.simulacaoId === teste.dados?.simulacaoId, teste2.text);

  const pub = await tool(AT, 'publicar_agente', { agentId, notas: 'primeira versão via MCP' });
  const aprovacaoId = pub.structured?.aprovacaoId;
  rec('publicar_agente NÃO executa: vira aprovação pendente', !pub.isError && pub.structured?.pendente === true && !!aprovacaoId && pub.text.includes('AGUARDANDO APROVAÇÃO'), pub.text);
  const antes = await tool(AT, 'ver_agente', { agentId });
  rec('…e o agente continua sem versão publicada', !antes.isError && antes.dados?.versaoPublicada === null, antes.dados?.versaoPublicada);
  const pend = await http('GET', '/v1/nyro/acoes', { token: dono.access });
  rec('pedido aparece nas aprovações do KHUB com o nome do app', pend.status === 200 && pend.body.some((a) => a.id === aprovacaoId && a.resumo.startsWith('[Claude]')), pend.body);
  const aprova = await http('POST', `/v1/nyro/acoes/${aprovacaoId}`, { token: dono.access, body: { aprovar: true } });
  rec('humano aprova no KHUB → executa', aprova.status < 300 && aprova.body.status === 'executada', aprova.body);
  const depois = await tool(AT, 'ver_agente', { agentId });
  rec('agente publicado (versão 1)', depois.dados?.versaoPublicada?.numero === 1, depois.dados?.versaoPublicada);

  // isolamento: token de A nunca enxerga B
  const listaAg = await tool(AT, 'listar_agentes');
  rec('isolamento: só agentes da própria subconta', !listaAg.isError && listaAg.dados.every((a) => a.nome !== 'B'), listaAg.text.slice(0, 200));
  const outroTenant = await http('GET', `/v1/conector-ia/conexoes`, { token: outro.access });
  rec('isolamento: a outra subconta não vê a conexão', outroTenant.status === 200 && outroTenant.body.length === 0, outroTenant.body);

  // financeiro: as duas fontes separadas (auditoria 16/11)
  const fin = await tool(AT, 'resumo_financeiro');
  rec('resumo_financeiro separa livro-caixa e cobranças', !fin.isError && !!fin.dados?.caixa?.mesAtual && typeof fin.dados?.caixa?.lancamentosComDataFutura === 'number' && fin.dados?.cobrancas?.recebidoCentavos !== undefined, fin.text.slice(0, 300));

  // auditoria
  const aud = await tool(AT, 'ver_auditoria', { limite: 50 });
  rec('auditoria registra as ações do MCP', !aud.isError && aud.text.includes('mcp.') , aud.text.slice(0, 300));

  // ---------- refresh rotativo ----------
  const ref = await http('POST', '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: tok.body.refresh_token, client_id: CID } });
  rec('refresh → novo par', ref.status === 200 && ref.body.access_token !== AT, ref.body);
  const refReuso = await http('POST', '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: tok.body.refresh_token, client_id: CID } });
  rec('refresh reutilizado → invalid_grant (rotativo)', refReuso.status === 400, refReuso.body);
  const outroCliente = await http('POST', '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: ref.body.refresh_token, client_id: regSec.body.client_id, client_secret: regSec.body.client_secret } });
  rec('refresh de outro cliente → invalid_grant', outroCliente.status === 400, outroCliente.body);
  const AT2 = ref.body.access_token;
  const ping = await mcp(AT2, 'ping', {});
  rec('novo access token funciona', ping.status === 200 && ping.body.result !== undefined, ping.body);

  // ---------- revogação ----------
  const conx = await http('GET', '/v1/conector-ia/conexoes', { token: dono.access });
  rec('Integrações lista as conexões ativas', conx.status === 200 && conx.body.length === 2 && conx.body.every((c) => c.aplicativo === 'Claude'), conx.body);
  for (const c of conx.body) await http('DELETE', `/v1/conector-ia/conexoes/${c.id}`, { token: dono.access });
  const aposRevogar = await mcp(AT2, 'ping', {});
  rec('desconectar corta o acesso na hora (401)', aposRevogar.status === 401, aposRevogar.status);
  const refAposRevogar = await http('POST', '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: ref.body.refresh_token, client_id: CID } });
  rec('…e o refresh também morre', refAposRevogar.status === 400, refAposRevogar.body);

  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(`\n${resultados.length - falhas}/${resultados.length} PASS`);
  process.exitCode = falhas ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
