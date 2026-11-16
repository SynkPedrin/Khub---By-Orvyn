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
  /** Vídeo recebido: chega como arquivo para baixar; a leitura dele é uma transcrição. */
  video?: boolean;
  /** Leitura da mídia pela IA (transcrição, descrição da imagem, texto do documento). */
  leitura?: LeituraMidia;
}

export type StatusLeitura = 'pendente' | 'pronta' | 'falhou' | 'nao_suportado' | 'config_required';

/** O que a IA leu da mídia — é este texto que a agente de atendimento enxerga no lugar do arquivo. */
export interface LeituraMidia {
  status: StatusLeitura;
  texto?: string;
  /** O servidor cortou o texto para a tela (a IA recebeu o conteúdo original). */
  truncado?: boolean;
  por?: string;
  motivo?: string;
  /** Variáveis de ambiente que faltam no servidor (config_required). */
  faltando?: string[];
  /** ISO 8601: quando a leitura começou. */
  desde?: string;
}

/** Item da thread: mensagem (com anexo opcional) ou nota interna (`de: 'nota'`). */
export type ItemThread = MensagemConversa & {
  anexo?: AnexoMensagem | null;
  interna?: boolean;
  mencoes?: string[];
  /** Escrita pela equipe no WhatsApp do celular, fora do KHUB (por isso sem nome de atendente). */
  peloCelular?: boolean;
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

/* ------------------------------------------------------------------ */
/* Leitura da mídia pela IA                                             */
/* ------------------------------------------------------------------ */

/** Acima disto a leitura aparece recolhida (com "Ver tudo"). */
export const LIMITE_LEITURA_RECOLHIDA = 280;
const LINHAS_LEITURA_RECOLHIDA = 4;

/**
 * Depois deste tempo um "lendo…" não é mais crível: quem lia caiu no caminho
 * (o servidor reinicia) e a agente já seguiu sem a leitura (ela espera 90 s).
 * A tela para de consultar e mostra a falha discreta.
 */
export const LIMITE_LEITURA_PENDENTE_MS = 3 * 60_000;

export type EstadoLeitura = 'lendo' | 'pronta' | 'falhou' | 'nao_lida' | 'sem_configuracao';

export interface VisaoLeitura {
  estado: EstadoLeitura;
  /** Áudio e vídeo são transcritos; imagem e documento são lidos. */
  transcricao: boolean;
  /** Título do bloco quando há texto: "Transcrição" ou "Lido pela IA". */
  rotulo: string;
  /** Frase curta do estado (vazia em `pronta`). */
  aviso: string;
  texto: string;
  /** Detalhe para o `title` (motivo da falha, variável que falta). */
  detalhe?: string;
  truncado: boolean;
}

/**
 * O que a bolha mostra abaixo da mídia. `null` = nada a mostrar: sem leitura,
 * leitura pronta vazia, ou figurinha que a IA não lê (não merece aviso).
 */
export function visaoDaLeitura(anexo: AnexoMensagem | null | undefined, criadaEm: string | undefined, agora: number): VisaoLeitura | null {
  const l = anexo?.leitura;
  if (!anexo || !l) return null;
  const transcricao = anexo.tipo === 'audio' || !!anexo.video;
  const base = { transcricao, rotulo: transcricao ? 'Transcrição' : 'Lido pela IA', texto: '', truncado: false };
  const falha = { ...base, estado: 'falhou' as const, aviso: transcricao ? 'Não foi possível transcrever' : 'Não foi possível ler' };
  switch (l.status) {
    case 'pronta': {
      const texto = (l.texto ?? '').trim();
      return texto ? { ...base, estado: 'pronta', aviso: '', texto, truncado: !!l.truncado } : null;
    }
    case 'pendente': {
      const inicio = Date.parse(l.desde ?? criadaEm ?? '');
      if (!Number.isNaN(inicio) && agora - inicio > LIMITE_LEITURA_PENDENTE_MS) return falha;
      return { ...base, estado: 'lendo', aviso: transcricao ? 'Transcrevendo…' : 'Lendo…' };
    }
    case 'falhou':
      return { ...falha, detalhe: l.motivo };
    case 'nao_suportado':
      if (anexo.figurinha) return null;
      return { ...base, estado: 'nao_lida', aviso: 'A IA não lê este tipo de arquivo', detalhe: l.motivo };
    case 'config_required':
      return { ...base, estado: 'sem_configuracao', aviso: 'Leitura pela IA não configurada', detalhe: l.faltando?.length ? `Falta configurar no servidor: ${l.faltando.join(', ')}` : undefined };
    default:
      return null;
  }
}

/** Leitura longa (muitos caracteres ou muitas linhas) nasce recolhida. */
export function leituraLonga(texto: string): boolean {
  return texto.length > LIMITE_LEITURA_RECOLHIDA || texto.split('\n').length > LINHAS_LEITURA_RECOLHIDA;
}

/** Começo da leitura para o estado recolhido: corta em palavra inteira e termina em "…". */
export function resumoDaLeitura(texto: string): string {
  if (!leituraLonga(texto)) return texto;
  let corte = texto.split('\n').slice(0, LINHAS_LEITURA_RECOLHIDA).join('\n');
  if (corte.length > LIMITE_LEITURA_RECOLHIDA) {
    corte = corte.slice(0, LIMITE_LEITURA_RECOLHIDA);
    const espaco = corte.search(/\s\S*$/);
    if (espaco > LIMITE_LEITURA_RECOLHIDA * 0.6) corte = corte.slice(0, espaco);
  }
  return `${corte.replace(/[\s.,;:!?…-]+$/, '')}…`;
}

/** Há mídia sendo lida agora nesta thread? (liga a consulta periódica) */
export function temLeituraPendente(itens: readonly ItemThread[], agora: number): boolean {
  return itens.some((m) => visaoDaLeitura(m.anexo, m.criadaEm, agora)?.estado === 'lendo');
}

/** Espera entre consultas enquanto há "lendo…": começa em 4 s e alarga até 20 s. */
export function esperaDaLeitura(volta: number): number {
  return Math.min(20_000, Math.round(4000 * 1.5 ** Math.max(0, volta)));
}

/** O que muda na bolha quando o anexo muda (a URL assinada troca a cada resposta e não conta). */
function assinaturaDoAnexo(a: AnexoMensagem | null | undefined): string {
  if (!a) return '';
  return [a.tipo, a.url ? 'com-arquivo' : 'sem-arquivo', a.leitura?.status ?? '', a.leitura?.texto ?? ''].join('\u0001');
}

/**
 * Atualiza, nas mensagens já na tela, o anexo que mudou no servidor: a mídia
 * é anexada e lida DEPOIS que a mensagem aparece. Nada mais é tocado (envios
 * otimistas e a ordem ficam como estão). Sem mudança, devolve a mesma lista.
 */
export function mesclarAnexos<T extends ItemThread>(atual: T[], servidor: readonly ItemThread[]): T[] {
  const novos = new Map(servidor.map((m) => [m.id, m]));
  let mudou = false;
  const lista = atual.map((m) => {
    const s = novos.get(m.id);
    if (!s || assinaturaDoAnexo(s.anexo) === assinaturaDoAnexo(m.anexo)) return m;
    mudou = true;
    return { ...m, anexo: s.anexo ?? null };
  });
  return mudou ? lista : atual;
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
