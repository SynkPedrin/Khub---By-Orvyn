'use client';

import { clienteApi } from './session-fetch';
import type { MensagemConversa } from './crm';

/**
 * Inbox no nível do GHL (Q2.5): thread com anexos e notas internas, mídia,
 * respostas rápidas, iniciar conversa e painel de contexto. Mesma rota de
 * proxy do CRM (`/api/crm/*` → `/v1/crm/*`).
 */
const req = clienteApi('/api/crm/');
const json = { 'content-type': 'application/json' };

export type TipoMidia = 'imagem' | 'documento' | 'audio';

export interface AnexoMensagem {
  tipo: TipoMidia;
  mime: string;
  nome: string;
  tamanho: number;
  legenda?: string;
  /** URL assinada (1 h). `null` = o arquivo foi direto ao WhatsApp, sem cópia guardada. */
  url: string | null;
  /** Figurinha recebida pelo WhatsApp: exibida pequena e sem recorte. */
  figurinha?: boolean;
}

/** Item da thread: mensagem (com anexo opcional) ou nota interna (`de: 'nota'`). */
export type ItemThread = MensagemConversa & {
  anexo?: AnexoMensagem | null;
  interna?: boolean;
  mencoes?: string[];
};

export interface ResultadoMidia {
  id: string;
  hora: string;
  status: string;
  erro: string | null;
  missing: string[];
  provider?: string;
  anexo: AnexoMensagem;
}

export interface RespostaRapida {
  id: string;
  atalho: string;
  titulo: string;
  corpo: string;
  criadoPor: string | null;
  updatedAt: string;
}

export interface ContextoConversa {
  conversationId: string;
  responsavel: { identityId: string; nome: string | null } | null;
  contato: {
    id: string;
    nome: string;
    telefone: string | null;
    email: string | null;
    empresa: string | null;
    tags: string[];
    origem: string | null;
    dono: { identityId: string; nome: string | null } | null;
    criadoEm: string;
  } | null;
  negocios: { id: string; titulo: string; valor: number; etapa: string; cor: string | null; funil: string }[];
  tarefas: { id: string; titulo: string; dueAt: string | null; prioridade: string }[];
  /** Notas do contato (painel "Dados do Lead"). */
  observacoes?: { id: string; corpo: string; autor: string | null; criadaEm: string }[];
  /** Atividades recentes do contato. */
  atividades?: { id: string; acao: string; ator: string; tom: string; criadaEm: string }[];
}

/** Contagens leves da coluna Canais/Status/Etiquetas (db/063). */
export interface ContagensConversas {
  total: number;
  canais: Record<string, number>;
  status: { todas: number; nao_lidas: number; em_atendimento: number; aguardando: number; resolvidas: number };
  etiquetas: { nome: string; cor: string | null; total: number }[];
  /** Canais com conta conectada (WhatsApp, Instagram, Messenger…). */
  conectados: string[];
}

export interface SugestaoIA {
  titulo: string;
  texto: string;
}

export const inbox = {
  contagens: () => req<ContagensConversas>('conversations/contagens'),
  marcar: (conversationId: string, acao: 'resolvida' | 'aberta' | 'nao_lida') =>
    req<{ id: string; status: string; naoLidas: number }>(`conversations/${conversationId}/status`, { method: 'PATCH', headers: json, body: JSON.stringify({ acao }) }),
  sugestoes: (conversationId: string) => req<{ sugestoes: SugestaoIA[]; modelo: string }>(`conversations/${conversationId}/sugestoes`, { method: 'POST' }),
  thread: (conversationId: string) => req<{ id: string; total: number; mensagens: ItemThread[] }>(`conversations/${conversationId}/thread`),
  contexto: (conversationId: string) => req<ContextoConversa>(`conversations/${conversationId}/contexto`),
  enviarMidia: (conversationId: string, corpo: { tipo: TipoMidia; mime: string; nome: string; base64: string; legenda?: string }, key: string = crypto.randomUUID()) =>
    req<ResultadoMidia>(`conversations/${conversationId}/midia`, { method: 'POST', headers: { ...json, 'idempotency-key': key }, body: JSON.stringify(corpo) }),
  criarNota: (conversationId: string, corpo: string, mencoes: string[]) =>
    req<ItemThread>(`conversations/${conversationId}/notas`, { method: 'POST', headers: json, body: JSON.stringify({ corpo, mencoes }) }),
  iniciarConversa: (entrada: string | { contactId?: string; telefone?: string; nome?: string }) =>
    req<{ id: string; criada: boolean }>('conversations', {
      method: 'POST',
      headers: json,
      body: JSON.stringify(typeof entrada === 'string' ? { contactId: entrada, canal: 'WhatsApp' } : { ...entrada, canal: 'WhatsApp' }),
    }),
  respostas: () => req<RespostaRapida[]>('quick-replies'),
  criarResposta: (d: { atalho: string; titulo: string; corpo: string }) => req<RespostaRapida>('quick-replies', { method: 'POST', headers: json, body: JSON.stringify(d) }),
  atualizarResposta: (id: string, d: Partial<{ atalho: string; titulo: string; corpo: string }>) =>
    req<RespostaRapida>(`quick-replies/${id}`, { method: 'PATCH', headers: json, body: JSON.stringify(d) }),
  removerResposta: (id: string) => req<{ ok: boolean }>(`quick-replies/${id}`, { method: 'DELETE' }),
};

/** Tipo do anexo a partir do MIME do arquivo escolhido (o servidor revalida). */
export function tipoDoArquivo(mime: string): TipoMidia {
  if (mime.startsWith('image/')) return 'imagem';
  if (mime.startsWith('audio/')) return 'audio';
  return 'documento';
}

/** Lê o arquivo como base64 puro (sem o prefixo `data:`). */
export function lerBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error('falha ao ler o arquivo'));
    r.onload = () => {
      const s = String(r.result ?? '');
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.readAsDataURL(arquivo);
  });
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

export interface DadosVariaveis {
  contato?: { nome?: string | null; telefone?: string | null; email?: string | null; empresa?: string | null } | null;
  atendente?: { nome?: string | null } | null;
  negocio?: { titulo?: string | null } | null;
}

/**
 * Resolve `{{contato.nome}}` & cia. com os dados da conversa aberta. Variável
 * sem valor vira vazio (nunca o marcador cru na mensagem do cliente).
 */
export function resolverVariaveis(corpo: string, d: DadosVariaveis): string {
  const nome = d.contato?.nome?.trim() ?? '';
  const valores: Record<string, string> = {
    'contato.nome': nome,
    'contato.primeiro_nome': nome.split(/\s+/)[0] ?? '',
    'contato.telefone': d.contato?.telefone ?? '',
    'contato.email': d.contato?.email ?? '',
    'contato.empresa': d.contato?.empresa ?? '',
    'atendente.nome': d.atendente?.nome?.trim() ?? '',
    'negocio.titulo': d.negocio?.titulo ?? '',
  };
  return corpo.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m, chave: string) => valores[chave] ?? '').replace(/[ \t]+([,.!?])/g, '$1');
}

/** Filtro do menu "/": atalho começa com a busca, ou título/corpo contém. */
export function filtrarRespostas(lista: RespostaRapida[], busca: string): RespostaRapida[] {
  const q = busca.trim().toLowerCase();
  if (!q) return lista;
  const comeca = lista.filter((r) => r.atalho.startsWith(q));
  const contem = lista.filter((r) => !r.atalho.startsWith(q) && (r.titulo.toLowerCase().includes(q) || r.corpo.toLowerCase().includes(q)));
  return [...comeca, ...contem];
}

/**
 * Gatilho ("/" resposta rápida, "@" menção) imediatamente antes do cursor:
 * começo do texto ou após espaço. "/" não aceita espaço na busca; "@" aceita
 * (nomes compostos) até 30 caracteres, sem quebra de linha.
 */
export function tokenNoCursor(texto: string, cursor: number, gatilho: '/' | '@'): { inicio: number; busca: string } | null {
  const antes = texto.slice(0, cursor);
  const i = antes.lastIndexOf(gatilho);
  if (i < 0) return null;
  if (i > 0 && !/\s/.test(antes[i - 1])) return null;
  const busca = antes.slice(i + 1);
  if (gatilho === '/' && /\s/.test(busca)) return null;
  if (gatilho === '@' && (/\n/.test(busca) || busca.length > 30)) return null;
  return { inicio: i, busca };
}

/** Limites aceitos pelo servidor (validação final é lá). */
export const LIMITE_ARQUIVO: Record<TipoMidia, number> = { imagem: 5 * 1024 * 1024, audio: 15 * 1024 * 1024, documento: 15 * 1024 * 1024 };

/** Mesmo texto que o servidor grava em `messages.corpo` (casa o envio otimista). */
export function corpoDaMidia(tipo: TipoMidia, nome: string, legenda?: string): string {
  const rotulo = tipo === 'imagem' ? 'Imagem' : tipo === 'audio' ? 'Áudio' : 'Documento';
  return legenda?.trim() ? `📎 ${rotulo}: ${nome}\n${legenda.trim()}` : `📎 ${rotulo}: ${nome}`;
}
