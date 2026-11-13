/**
 * CONTRATO DE PROVEDOR DE MENSAGERIA
 * ==================================
 *
 * O domínio da KHUB fala "enviar mensagem para este contato". Ele não sabe
 * — e não pode saber — se por trás está Evolution/Stevo, Meta Cloud API,
 * Instagram ou e-mail.
 *
 * Antes desta camada, `MessagesService` injetava `StevoProvider` direto.
 * Trocar de gateway de WhatsApp (ou adicionar um segundo canal) exigiria
 * mexer na regra de negócio de envio, que é justamente a parte que não pode
 * mudar quando o fornecedor muda.
 *
 * A interface mínima anterior (`configured`/`missing`/`sendText`) continua
 * válida e é estendida aqui — `StevoProvider` segue atendendo os dois.
 */

/** Canais que o produto reconhece. */
export type CanalMensagem = 'whatsapp' | 'instagram' | 'email' | 'webchat';

export interface DestinoMensagem {
  /** Telefone E.164 (WhatsApp), e-mail, ou id de conversa do canal. */
  endereco: string;
  /** Instância/conta do tenant no provedor, quando ele for multi-instância. */
  instancia?: string;
}

export interface MensagemSaida {
  texto: string;
  /** Chave de idempotência: o mesmo valor NUNCA deve gerar dois envios. */
  idempotencyKey?: string;
  anexos?: { url: string; tipo: string; nome?: string }[];
}

/**
 * Mídia de saída (Q2.5). Exatamente UM transporte: `url` (o provedor baixa —
 * vem do storage, assinada) ou `base64` (sem prefixo `data:`; só para quem
 * declara `aceitaBase64`). O provedor nunca recebe os dois.
 */
export type TipoMidia = 'imagem' | 'documento' | 'audio';
export interface MidiaSaida {
  tipo: TipoMidia;
  mime: string;
  nome: string;
  legenda?: string;
  url?: string;
  base64?: string;
}

export interface ResultadoEnvio {
  /** Id do provedor, usado para casar callbacks de entrega. */
  providerId?: string;
  /**
   * `pendente` quando o provedor aceitou mas ainda não confirmou. Estado
   * separado de `enviado` de propósito: o inbox não deve mostrar "entregue"
   * para algo que talvez não tenha saído.
   */
  estado: 'enviado' | 'pendente';
}

/** Mensagem recebida, já normalizada a partir do payload do provedor. */
export interface MensagemEntrada {
  canal: CanalMensagem;
  /** Remetente no formato do canal (telefone, handle, e-mail). */
  de: string;
  texto: string;
  providerId?: string;
  recebidaEm: Date;
  /** Payload bruto, preservado para depuração de integração. */
  bruto?: unknown;
}

export interface ResultadoWebhook {
  /** `false` quando o evento não é uma mensagem (ack de entrega, presença…). */
  ehMensagem: boolean;
  mensagem?: MensagemEntrada;
  /** Atualização de status de uma mensagem já enviada. */
  statusEntrega?: { providerId: string; estado: 'entregue' | 'lida' | 'falhou'; erro?: string };
}

/**
 * Contrato que todo provedor de mensageria implementa.
 *
 * `validateWebhook` é obrigatório e separado de `receiveWebhook` por uma
 * razão de segurança: o endpoint de webhook é PÚBLICO. Validar a origem
 * antes de interpretar o corpo é o que impede qualquer um na internet de
 * injetar mensagens no inbox de um tenant.
 */
export interface MessagingProviderV2 {
  readonly nome: string;
  readonly canal: CanalMensagem;

  configured(): boolean;
  missing(): string[];

  sendMessage(destino: DestinoMensagem, mensagem: MensagemSaida): Promise<ResultadoEnvio>;

  /**
   * Valida a autenticidade do webhook ANTES de qualquer interpretação.
   * Retorna false → a requisição é descartada sem tocar no banco.
   */
  validateWebhook(input: { headers: Record<string, string | undefined>; query: Record<string, string | undefined>; corpoBruto?: string }): boolean;

  /** Traduz o payload do provedor para o formato do domínio. */
  receiveWebhook(corpo: unknown): ResultadoWebhook;

  /**
   * Envia mídia. Opcional: só implementa quem tem o endpoint DOCUMENTADO
   * (Evolution: `POST /message/sendMedia/{instância}`; Stevo API:
   * `POST /v1/instances/{id}/messages` com `media_url`). Ausente = o canal
   * não envia mídia e o domínio recusa antes de gravar.
   */
  sendMedia?(destino: DestinoMensagem, midia: MidiaSaida, idempotencyKey?: string): Promise<ResultadoEnvio>;

  /** Marca como lida no provedor. Opcional: nem todo canal suporta. */
  markAsRead?(destino: DestinoMensagem, providerId: string): Promise<void>;
}

/** Token de injeção — o domínio injeta isto, não uma classe concreta. */
export const MESSAGING_PROVIDER = Symbol('MESSAGING_PROVIDER');

/**
 * Erro de entrega com semântica de retry.
 *
 * `incerto` é o estado mais importante e o mais fácil de errar: timeout não
 * significa "não enviou", significa "não sabemos". Reenviar nesse caso pode
 * duplicar a mensagem para o cliente final — por isso ele é tratado à parte
 * de `retentavel`.
 */
export class ErroEntrega extends Error {
  constructor(
    message: string,
    readonly retentavel: boolean,
    readonly incerto: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ErroEntrega';
  }
}
