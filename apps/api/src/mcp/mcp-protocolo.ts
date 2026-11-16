/**
 * Núcleo do protocolo MCP (Streamable HTTP, sem sessão), puro e testável
 * (mcp-protocolo.spec.ts). Recebe uma mensagem JSON-RPC 2.0 e devolve a
 * resposta — ou `null` para notificações, que o transporte responde com 202.
 *
 * Só o que um servidor de tools precisa: initialize, ping, tools/list,
 * tools/call; resources/prompts respondem listas vazias (alguns clientes
 * perguntam mesmo sem a capacidade anunciada).
 */

export const VERSOES_PROTOCOLO = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;

export const INSTRUCOES_SERVIDOR = [
  'Você está conectado ao KHUB, plataforma de CRM, atendimento por IA no WhatsApp/Instagram e automações de uma empresa brasileira. Responda em português do Brasil.',
  'Comece por khub_visao_geral para entender a conta. Agentes: listar_agentes → ver_agente → editar_agente (só rascunho) → testar_agente (simulador, não envia nada) → publicar_agente.',
  'Ações sensíveis (publicar/ativar/pausar agente, canais do agente, publicar/ativar/pausar automação, enviar mensagem, mover etapa, instalar automação/blueprint) NÃO executam na hora: viram pedido de aprovação no KHUB. Diga ao usuário que está aguardando aprovação em KHUB > NICO > Aprovações; nunca diga que foi feito.',
  'Nunca invente preço, prazo ou protocolo: use buscar_conhecimento. Valores financeiros vêm em centavos.',
].join('\n');

export interface MensagemRpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface ResultadoChamada {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface Servidor {
  nome: string;
  versao: string;
  listarTools(): unknown[];
  chamarTool(nome: string, args: Record<string, unknown>): Promise<ResultadoChamada>;
}

const erro = (id: MensagemRpc['id'], code: number, message: string) => ({ jsonrpc: '2.0' as const, id: id ?? null, error: { code, message } });
const ok = (id: MensagemRpc['id'], result: unknown) => ({ jsonrpc: '2.0' as const, id: id ?? null, result });

export function negociarVersao(pedida: unknown): string {
  return typeof pedida === 'string' && (VERSOES_PROTOCOLO as readonly string[]).includes(pedida) ? pedida : VERSOES_PROTOCOLO[0];
}

export async function tratarMensagem(msg: MensagemRpc, srv: Servidor): Promise<object | null> {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return erro(msg?.id, -32600, 'requisição JSON-RPC inválida');
  // Sem método = resposta do cliente a algo nosso (não pedimos nada): ignora.
  if (typeof msg.method !== 'string') return null;
  const notificacao = msg.id === undefined;
  if (notificacao) return null; // notifications/initialized, cancelled… nada a responder

  switch (msg.method) {
    case 'initialize':
      return ok(msg.id, {
        protocolVersion: negociarVersao(msg.params?.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: srv.nome, title: 'KHUB', version: srv.versao },
        instructions: INSTRUCOES_SERVIDOR,
      });
    case 'ping':
      return ok(msg.id, {});
    case 'tools/list':
      return ok(msg.id, { tools: srv.listarTools() });
    case 'tools/call': {
      const nome = msg.params?.name;
      if (typeof nome !== 'string' || !nome) return erro(msg.id, -32602, 'params.name obrigatório');
      const args = msg.params?.arguments;
      if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) return erro(msg.id, -32602, 'params.arguments precisa ser objeto');
      try {
        return ok(msg.id, await srv.chamarTool(nome, (args as Record<string, unknown>) ?? {}));
      } catch (e) {
        // Falha da tool é resultado (o modelo lê e corrige), não erro de protocolo.
        return ok(msg.id, { content: [{ type: 'text', text: `Erro: ${(e as Error).message}` }], isError: true });
      }
    }
    case 'resources/list':
      return ok(msg.id, { resources: [] });
    case 'resources/templates/list':
      return ok(msg.id, { resourceTemplates: [] });
    case 'prompts/list':
      return ok(msg.id, { prompts: [] });
    default:
      return erro(msg.id, -32601, `método não suportado: ${msg.method}`);
  }
}

/** Corpo do POST: uma mensagem ou um lote (versões antigas do protocolo). */
export async function tratarCorpo(corpo: unknown, srv: Servidor): Promise<object | object[] | null> {
  if (Array.isArray(corpo)) {
    if (!corpo.length) return erro(null, -32600, 'lote vazio');
    const r = (await Promise.all(corpo.map((m) => tratarMensagem(m as MensagemRpc, srv)))).filter((x): x is object => x !== null);
    return r.length ? r : null;
  }
  if (!corpo || typeof corpo !== 'object') return erro(null, -32700, 'corpo precisa ser JSON');
  return tratarMensagem(corpo as MensagemRpc, srv);
}
