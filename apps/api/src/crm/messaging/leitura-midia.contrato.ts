import type { TipoEntrada } from './midia-entrada';

/**
 * LEITURA DE MÍDIA PELA IA (áudio, imagem, PDF, documento, vídeo).
 *
 * A IA de atendimento só enxerga texto. Toda mídia recebida vira um texto
 * ("leitura") guardado em `message.anexo.leitura`: transcrição do áudio,
 * descrição + texto visível da imagem, conteúdo do PDF/documento. O runtime
 * do agente monta o histórico com esse texto no lugar do rótulo "🎤 Áudio".
 *
 * Este arquivo é só o CONTRATO entre quem recebe a mídia (ingestão da Stevo,
 * em crm/messaging) e quem a lê (LeituraMidiaService). Nada de IO aqui.
 */
export const LEITOR_DE_MIDIA = Symbol('LEITOR_DE_MIDIA');

/**
 * - `pendente`: mídia chegou, leitura em andamento (o agente ESPERA antes de responder);
 * - `pronta`: `texto` tem o conteúdo para a IA;
 * - `falhou`: tentou e não conseguiu (download, provedor fora, arquivo corrompido);
 * - `nao_suportado`: tipo/tamanho que não lemos;
 * - `config_required`: falta credencial do provedor (gating por credencial — `faltando`).
 */
export type StatusLeitura = 'pendente' | 'pronta' | 'falhou' | 'nao_suportado' | 'config_required';

export interface LeituraMidia {
  status: StatusLeitura;
  /** Conteúdo para a IA (transcrição, descrição, texto extraído). Só em `pronta`. */
  texto?: string;
  /** Quem leu: 'groq-whisper', 'claude-visao', 'claude-pdf', 'texto-local'… (auditoria). */
  por?: string;
  /** Motivo curto e sem dado pessoal (falhou / nao_suportado). */
  motivo?: string;
  /** Variáveis de ambiente que faltam (config_required). */
  faltando?: string[];
  /** ISO 8601: quando entrou em `pendente` (o runtime desiste de esperar depois de um limite). */
  desde?: string;
  /** ISO 8601: quando terminou. */
  em?: string;
}

export interface EntradaLeitura {
  tenantId: string;
  tipo: TipoEntrada;
  mime: string;
  nome: string | null;
  legenda: string | null;
  bytes: Buffer;
  /** Duração em segundos (áudio/vídeo), quando o WhatsApp informa. */
  segundos?: number | null;
}

export interface LeitorDeMidia {
  /** Nunca lança: qualquer falha volta como `falhou` / `config_required` / `nao_suportado`. */
  ler(entrada: EntradaLeitura): Promise<LeituraMidia>;
}

/** Forma do `message.anexo` de uma mídia recebida (campos já existentes + `leitura`). */
export interface AnexoRecebido {
  tipo: TipoEntrada;
  mime?: string;
  nome?: string;
  tamanho?: number;
  legenda?: string;
  storageKey?: string;
  dataUrl?: string;
  leitura?: LeituraMidia;
}

/** Quanto o agente espera uma leitura `pendente` antes de seguir sem ela. */
export const ESPERA_MAXIMA_LEITURA_MS = 90_000;
