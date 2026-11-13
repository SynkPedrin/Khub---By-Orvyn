import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type ReviewRequest, type ReviewSettings } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { MailerService } from '../common/mailer.service';
import { NotificationsService } from '../common/notifications.service';
import { MessagesService, type AutorEnvio } from '../crm/messaging/messages.service';
import { htmlDeTexto, interpolarContato, VARIAVEIS_CONTATO } from '../common/variaveis-contato';
import { soDigitos } from '../crm/telefone';

type Tx = Prisma.TransactionClient;

export const MENSAGEM_PADRAO = 'Oi, {{contato.primeiroNome}}! Obrigado pela confiança. Pode nos contar como foi sua experiência? Leva menos de um minuto: {{link}}';

export const configSchema = z
  .object({
    plataforma: z.enum(['google', 'outro']).default('google'),
    link: z.string().trim().max(500).url().refine((u) => u.startsWith('https://'), 'o link precisa começar com https://'),
    mensagemPadrao: z.string().trim().min(1).max(1000),
    assuntoEmail: z.string().trim().min(1).max(200).default('Como foi sua experiência?'),
    filtroSatisfacao: z.boolean().default(false),
    notaMinima: z.number().int().min(2).max(5).default(4),
  })
  .strict();

export const pedirSchema = z
  .object({
    contactId: z.string().uuid(),
    canal: z.enum(['whatsapp', 'email']).default('whatsapp'),
    mensagem: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export type PedidoAvaliacao = z.infer<typeof pedirSchema>;

export const notaSchema = z.object({ nota: z.number().int().min(1).max(5) }).strict();
export const feedbackSchema = z.object({ nota: z.number().int().min(1).max(5), comentario: z.string().trim().min(1).max(2000) }).strict();

export function validar<S extends z.ZodTypeAny>(schema: S, bruto: unknown): z.infer<S> {
  const r = schema.safeParse(bruto ?? {});
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join('.') || 'corpo'}: ${i.message}`).join('; '));
  return r.data;
}

/** Origem do pedido: alguém clicou no perfil, ou um nó de automação rodou. */
export type OrigemPedido =
  | { tipo: 'manual'; identityId: string }
  | { tipo: 'automacao'; workflowId?: string; idempotencyKey: string };

export interface ResultadoPedido {
  pedido: { id: string; status: string; canal: string; enviadoEm: Date | null; linkCurto: string };
  status: 'enviado' | 'config_required' | 'falhou' | 'adiar';
  provider?: string;
  missing?: string[];
  erro?: string | null;
  reaproveitado?: boolean;
}

/** Token do link curto: 16 bytes aleatórios em base64url (22 caracteres). */
export function novoToken(): string {
  return randomBytes(16).toString('base64url');
}
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Robôs de pré-visualização (WhatsApp, redes) não contam como clique. */
export function ehRobo(ua: string | null | undefined): boolean {
  return !ua || /bot|crawler|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|linkedin|twitter|curl|wget|python-requests|headless/i.test(ua);
}

/**
 * Filtro de satisfação: nota >= mínima segue para o link público; abaixo abre
 * o feedback interno. Puro (testado).
 */
export function destinoDaNota(nota: number, notaMinima: number): 'publico' | 'feedback' {
  return nota >= notaMinima ? 'publico' : 'feedback';
}

/** Mensagem final: variáveis do contato + `{{link}}`; sem `{{link}}`, o link vai no fim. */
export function montarMensagem(modelo: string, contato: Parameters<typeof interpolarContato>[1], linkCurto: string): string {
  const temLink = /\{\{\s*(link|avaliacao\.link)\s*\}\}/.test(modelo);
  const texto = interpolarContato(modelo, contato, { link: linkCurto, 'avaliacao.link': linkCurto });
  return temLink ? texto : `${texto.trimEnd()}\n\n${linkCurto}`;
}

/**
 * Pedido de avaliação (Q4.4). Envia pela superfície pública do CRM
 * (`MessagesService`) ou pelo `MailerService`. O link enviado é o curto
 * (`/r/:token`), que registra o clique e leva ao link público configurado.
 */
@Injectable()
export class AvaliacoesService {
  private readonly log = new Logger('Avaliacoes');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mensagens: MessagesService,
    private readonly mailer: MailerService,
    private readonly notificacoes: NotificationsService,
  ) {}

  linkCurto(token: string): string {
    const base = (this.config.get('WEB_URL') ?? 'http://localhost:3210').replace(/\/+$/, '');
    return `${base}/r/${token}`;
  }

  // ------------------------------------------------------------ configuração

  async obterConfig(tenantId: string) {
    const s = await this.prisma.withTenant(tenantId, (tx) => tx.reviewSettings.findUnique({ where: { tenantId } }));
    return { configurado: !!s, config: s ? this.configDto(s) : null, sugestao: { mensagemPadrao: MENSAGEM_PADRAO, assuntoEmail: 'Como foi sua experiência?' }, variaveis: [...VARIAVEIS_CONTATO, { chave: 'link', rotulo: 'Link da avaliação' }] };
  }

  async salvarConfig(tenantId: string, identityId: string, bruto: unknown) {
    const d = validar(configSchema, bruto);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const s = await tx.reviewSettings.upsert({
        where: { tenantId },
        create: { tenantId, ...d, updatedBy: identityId },
        update: { ...d, updatedBy: identityId, updatedAt: new Date() },
      });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'avaliacao.config_salva', 'review_settings', ${tenantId})`;
      return this.configDto(s);
    });
  }

  // ------------------------------------------------------------ pedir

  async pedir(tenantId: string, entrada: PedidoAvaliacao, origem: OrigemPedido): Promise<ResultadoPedido> {
    const preparo = await this.prisma.withTenant(tenantId, async (tx) => {
      const s = await tx.reviewSettings.findUnique({ where: { tenantId } });
      const modelo = entrada.mensagem ?? s?.mensagemPadrao ?? MENSAGEM_PADRAO;
      const assunto = s?.assuntoEmail ?? 'Como foi sua experiência?';
      if (origem.tipo === 'automacao') {
        // Retry do nó: o pedido já existe. Resolvido = devolve; pendente (caiu
        // antes de mandar) = manda de novo com a MESMA chave de idempotência.
        const existente = await tx.reviewRequest.findFirst({ where: { idempotencyKey: origem.idempotencyKey } });
        if (existente && existente.status !== 'pendente') return { tipo: 'existente' as const, pedido: existente };
        if (existente) return { tipo: 'novo' as const, pedido: existente, modelo, assunto, ...(await this.contexto(tx, tenantId, existente.contactId, existente.canal as 'whatsapp' | 'email')) };
      }
      if (!s) throw new BadRequestException('configure o link de avaliação em Configurações > Avaliações');
      const ctx = await this.contexto(tx, tenantId, entrada.contactId, entrada.canal);
      const pedido = await tx.reviewRequest.create({
        data: {
          tenantId, contactId: entrada.contactId, canal: entrada.canal, link: s.link, token: novoToken(),
          origem: origem.tipo, idempotencyKey: origem.tipo === 'automacao' ? origem.idempotencyKey : null,
          filtroSatisfacao: s.filtroSatisfacao, notaMinima: s.notaMinima,
          criadoPor: origem.tipo === 'manual' ? origem.identityId : null,
        },
      });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
        VALUES (${tenantId}::uuid, ${origem.tipo === 'manual' ? 'humano' : 'sistema'}, ${origem.tipo === 'manual' ? origem.identityId : origem.workflowId ?? 'automacao'}, 'avaliacao.pedida', 'review_request', ${pedido.id})`;
      return { tipo: 'novo' as const, pedido, modelo, assunto, ...ctx };
    });
    if (preparo.tipo === 'existente') {
      const p = preparo.pedido;
      return this.resultado(p, p.status === 'enviado' ? 'enviado' : p.status === 'config_required' ? 'config_required' : 'falhou', { reaproveitado: true, erro: p.erro });
    }

    const { pedido, contato, conversationId, destino, modelo, assunto: assuntoModelo } = preparo;
    const curto = this.linkCurto(pedido.token);
    const texto = montarMensagem(modelo, contato, curto);

    if (pedido.canal === 'whatsapp') {
      const autor: AutorEnvio = origem.tipo === 'automacao' && origem.workflowId ? { tipo: 'automacao', workflowId: origem.workflowId } : { tipo: 'humano' };
      const r = await this.mensagens.send(tenantId, conversationId!, texto, `avaliacao:${pedido.id}`, undefined, autor);
      if (r.status === 'sent') return this.gravar(tenantId, pedido, { status: 'enviado', messageId: r.id }, 'enviado');
      if (r.status === 'pending') return this.resultado(pedido, 'adiar', { erro: 'o provedor de WhatsApp limitou a taxa; tente de novo em instantes' });
      if (r.status === 'config_required') return this.gravar(tenantId, pedido, { status: 'config_required', erro: 'canal não configurado' }, 'config_required', { provider: r.provider, missing: r.missing });
      const erro = r.status === 'cancelled' ? 'contato optou por não receber mensagens'
        : r.status === 'canal_desconectado' ? 'WhatsApp desconectado'
        : r.status === 'bloqueado_dev' ? 'envio bloqueado fora de produção (defina STEVO_TEST_NUMBER)'
        : r.status === 'unknown' ? 'entrega não confirmada pelo provedor'
        : r.erro ?? `falha no envio (${r.status})`;
      return this.gravar(tenantId, pedido, { status: 'falhou', erro, messageId: r.id }, 'falhou');
    }

    if (!this.mailer.configured()) return this.gravar(tenantId, pedido, { status: 'config_required', erro: 'e-mail não configurado' }, 'config_required', { provider: 'email', missing: this.mailer.missing() });
    const assunto = interpolarContato(assuntoModelo, contato);
    const m = await this.mailer.send({ to: destino, subject: assunto, text: texto, html: htmlDeTexto(texto), idempotencyKey: `avaliacao:${pedido.id}` });
    if (m.sent) return this.gravar(tenantId, pedido, { status: 'enviado' }, 'enviado');
    if (m.missing?.length) return this.gravar(tenantId, pedido, { status: 'config_required', erro: 'e-mail não configurado' }, 'config_required', { provider: 'email', missing: m.missing });
    return this.gravar(tenantId, pedido, { status: 'falhou', erro: m.erro ?? 'falha no envio do e-mail' }, 'falhou');
  }

  /** Contato, destino e (WhatsApp) conversa. Opt-out e sem canal são 400 explícitos. */
  private async contexto(tx: Tx, tenantId: string, contactId: string, canal: 'whatsapp' | 'email') {
    const c = await tx.contact.findUnique({ where: { id: contactId }, select: { id: true, nome: true, email: true, telefone: true, empresa: true, camposCustom: true, optedOutAt: true } });
    if (!c) throw new NotFoundException('contato não encontrado');
    if (c.optedOutAt) throw new BadRequestException('o contato pediu para não receber mensagens (opt-out)');
    const destino = canal === 'whatsapp' ? soDigitos(c.telefone) : (c.email ?? '').trim();
    if (canal === 'whatsapp' && (destino.length < 10 || destino.length > 15)) throw new BadRequestException('o contato não tem telefone válido para WhatsApp');
    if (canal === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destino)) throw new BadRequestException('o contato não tem e-mail válido');
    let conversationId: string | null = null;
    if (canal === 'whatsapp') {
      const conv = await tx.conversation.findFirst({ where: { contactId: c.id, canal: 'WhatsApp' }, select: { id: true } });
      conversationId = conv?.id ?? (await tx.conversation.create({ data: { tenantId, contactId: c.id, nome: c.nome, canal: 'WhatsApp' }, select: { id: true } })).id;
    }
    return { contato: c, conversationId, destino };
  }

  private async gravar(tenantId: string, pedido: ReviewRequest, d: { status: string; erro?: string; messageId?: string }, status: ResultadoPedido['status'], extra: { provider?: string; missing?: string[] } = {}): Promise<ResultadoPedido> {
    const novo = await this.prisma.withTenant(tenantId, (tx) =>
      tx.reviewRequest.update({ where: { id: pedido.id }, data: { status: d.status, erro: d.erro ?? null, messageId: d.messageId ?? null, ...(d.status === 'enviado' ? { enviadoEm: new Date() } : {}) } }),
    );
    return this.resultado(novo, status, { ...extra, erro: d.erro ?? null });
  }

  private resultado(p: ReviewRequest, status: ResultadoPedido['status'], extra: Partial<ResultadoPedido> = {}): ResultadoPedido {
    return { pedido: { id: p.id, status: p.status, canal: p.canal, enviadoEm: p.enviadoEm, linkCurto: this.linkCurto(p.token) }, status, ...extra };
  }

  // ------------------------------------------------------------ leitura

  async listar(tenantId: string, q: { contactId?: string; limit?: number }) {
    if (q.contactId && !/^[0-9a-f-]{36}$/i.test(q.contactId)) throw new BadRequestException('contactId inválido');
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.reviewRequest.findMany({ where: q.contactId ? { contactId: q.contactId } : undefined, orderBy: { createdAt: 'desc' }, take: limit });
      const nomes = new Map((await tx.contact.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.contactId))] } }, select: { id: true, nome: true } })).map((c) => [c.id, c.nome]));
      return rows.map((r) => ({
        id: r.id, contactId: r.contactId, contatoNome: nomes.get(r.contactId) ?? '', canal: r.canal, status: r.status, origem: r.origem, erro: r.erro,
        enviadoEm: r.enviadoEm, clicadoEm: r.clicadoEm, cliques: r.cliques, avaliacaoInterna: r.avaliacaoInterna, comentario: r.comentario,
        redirecionado: r.redirecionado, createdAt: r.createdAt, linkCurto: this.linkCurto(r.token),
      }));
    });
  }

  /** Relatório simples (Configurações > Avaliações). */
  async resumo(tenantId: string, dias = 90) {
    const desde = new Date(Date.now() - Math.min(Math.max(dias, 1), 365) * 86_400_000);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.reviewRequest.findMany({ where: { createdAt: { gte: desde } }, select: { status: true, clicadoEm: true, avaliacaoInterna: true, redirecionado: true } });
      const enviados = rows.filter((r) => r.status === 'enviado').length;
      const clicados = rows.filter((r) => r.clicadoEm).length;
      const notas = rows.map((r) => r.avaliacaoInterna).filter((n): n is number => typeof n === 'number');
      const distribuicao = [1, 2, 3, 4, 5].map((n) => ({ nota: n, total: notas.filter((x) => x === n).length }));
      return {
        dias: Math.round((Date.now() - desde.getTime()) / 86_400_000),
        pedidos: rows.length,
        enviados,
        falhas: rows.filter((r) => r.status === 'falhou').length,
        clicados,
        taxaClique: enviados ? clicados / enviados : 0,
        avaliacoesInternas: notas.length,
        mediaInterna: notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : null,
        distribuicao,
        encaminhadosAoPublico: rows.filter((r) => r.redirecionado).length,
      };
    });
  }

  // ------------------------------------------------------------ público (/r/:token)

  private async resolver(token: string): Promise<{ tenantId: string; id: string } | null> {
    if (!TOKEN_RE.test(token)) return null;
    const rows = await this.prisma.$queryRaw<{ tenant_id: string; review_request_id: string }[]>`SELECT * FROM resolve_review_request_by_token(${token})`;
    return rows[0]?.tenant_id ? { tenantId: rows[0].tenant_id, id: rows[0].review_request_id } : null;
  }

  /**
   * Abertura do link curto. Conta o clique (robô de pré-visualização não
   * conta). Sem filtro de satisfação, devolve o destino e a página redireciona.
   * Nunca devolve dado do contato: só o nome da empresa e o que a página precisa.
   */
  async abrir(token: string, userAgent: string | null) {
    const rota = await this.resolver(token);
    if (!rota) throw new NotFoundException('link inválido ou expirado');
    return this.prisma.withTenant(rota.tenantId, async (tx) => {
      const robo = ehRobo(userAgent);
      const p = robo
        ? await tx.reviewRequest.findUnique({ where: { id: rota.id } })
        : await tx.reviewRequest.update({ where: { id: rota.id }, data: { cliques: { increment: 1 } } });
      if (!p) throw new NotFoundException('link inválido ou expirado');
      if (!robo && !p.clicadoEm) await tx.reviewRequest.update({ where: { id: p.id }, data: { clicadoEm: new Date() } });
      const empresa = (await tx.tenant.findUnique({ where: { id: rota.tenantId }, select: { nome: true } }))?.nome ?? '';
      if (!p.filtroSatisfacao) {
        if (!robo && !p.redirecionado) await tx.reviewRequest.update({ where: { id: p.id }, data: { redirecionado: true } });
        return { empresa, filtroSatisfacao: false, destino: p.link, jaAvaliou: false };
      }
      return { empresa, filtroSatisfacao: true, destino: null, jaAvaliou: p.avaliacaoInterna !== null, notaMinima: p.notaMinima };
    });
  }

  /** Nota do filtro de satisfação: alta segue para o link público, baixa abre o feedback. */
  async avaliar(token: string, bruto: unknown) {
    const { nota } = validar(notaSchema, bruto);
    const rota = await this.resolver(token);
    if (!rota) throw new NotFoundException('link inválido ou expirado');
    return this.prisma.withTenant(rota.tenantId, async (tx) => {
      const p = await tx.reviewRequest.findUnique({ where: { id: rota.id } });
      if (!p) throw new NotFoundException('link inválido ou expirado');
      if (!p.filtroSatisfacao) return { destino: p.link, proximo: 'publico' as const };
      const proximo = destinoDaNota(nota, p.notaMinima);
      await tx.reviewRequest.update({ where: { id: p.id }, data: { avaliacaoInterna: nota, avaliadoEm: new Date(), ...(proximo === 'publico' ? { redirecionado: true } : {}) } });
      return proximo === 'publico' ? { destino: p.link, proximo } : { destino: null, proximo };
    });
  }

  /** Feedback interno (nota baixa): grava e avisa owner/admin uma única vez. */
  async feedback(token: string, bruto: unknown) {
    const { nota, comentario } = validar(feedbackSchema, bruto);
    const rota = await this.resolver(token);
    if (!rota) throw new NotFoundException('link inválido ou expirado');
    await this.prisma.withTenant(rota.tenantId, async (tx) => {
      const p = await tx.reviewRequest.findUnique({ where: { id: rota.id } });
      if (!p) throw new NotFoundException('link inválido ou expirado');
      const primeiro = !p.comentario;
      await tx.reviewRequest.update({ where: { id: p.id }, data: { avaliacaoInterna: nota, avaliadoEm: p.avaliadoEm ?? new Date(), comentario } });
      if (!primeiro) return;
      const contato = await tx.contact.findUnique({ where: { id: p.contactId }, select: { nome: true } });
      const equipe = await tx.membership.findMany({ where: { tenantId: rota.tenantId, role: { in: ['owner', 'admin'] } }, select: { identityId: true } });
      for (const m of equipe) {
        await this.notificacoes.criar(tx, rota.tenantId, {
          identityId: m.identityId, tipo: 'avaliacao_negativa',
          titulo: `Avaliação ${nota} de 5${contato?.nome ? ` de ${contato.nome}` : ''}`.slice(0, 200),
          detalhe: comentario.slice(0, 500),
          url: `/contatos/${p.contactId}`, entidade: 'contact', entidadeId: p.contactId,
        });
      }
    });
    return { ok: true };
  }

  private configDto(s: ReviewSettings) {
    return { plataforma: s.plataforma, link: s.link, mensagemPadrao: s.mensagemPadrao, assuntoEmail: s.assuntoEmail, filtroSatisfacao: s.filtroSatisfacao, notaMinima: s.notaMinima, updatedAt: s.updatedAt };
  }
}
