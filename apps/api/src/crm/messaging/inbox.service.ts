import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventsService } from '../../events/domain-events.service';
import { StorageService, StorageError, nomeSeguro, VALIDADE_PROVEDOR_S, VALIDADE_TELA_S } from '../../common/storage.service';
import { NotificationsService } from '../../common/notifications.service';
import { ConfigRequiredException } from '../../config/config.service';
import { CrmService } from '../crm.service';
import { MessagesService, type AutorEnvio, type MidiaEnvio } from './messages.service';
import type { TipoMidia } from './provider.contract';
import {
  LIMITE_BASE64_SEM_STORAGE,
  MENSAGEM_ERRO_MIDIA,
  corpoDaMidia,
  limiteDoTipo,
  normalizarAtalho,
  validarMidia,
  variaveisDesconhecidas,
  VARIAVEIS_RESPOSTA,
} from './midia';

/** Papéis que podem ser mencionados / receber conversa (viewer só lê). */
const PAPEIS_EQUIPE = ['owner', 'admin', 'manager', 'member'];
/** Quem pode editar resposta rápida de outra pessoa. */
const PAPEIS_GESTAO = ['owner', 'admin', 'manager'];

export interface AnexoMensagem {
  tipo: TipoMidia;
  mime: string;
  nome: string;
  tamanho: number;
  legenda?: string;
  /** URL de leitura gerada agora (assinada, 1 h). `null` = arquivo não guardado (foi em base64). */
  url: string | null;
  /** Figurinha do WhatsApp (mídia recebida): exibida pequena e sem recorte. */
  figurinha?: boolean;
}

export interface EntradaMidia {
  tipo: TipoMidia;
  mime: string;
  nome: string;
  /** Conteúdo em base64 (sem prefixo `data:`). */
  base64: string;
  legenda?: string;
}

interface AnexoGravado {
  tipo: TipoMidia;
  mime: string;
  nome: string;
  tamanho: number;
  legenda?: string;
  storageKey?: string;
  /** Mídia RECEBIDA pequena guardada na própria mensagem quando não há S3 (stevo-api-eventos). */
  dataUrl?: string;
  figurinha?: boolean;
}

function anexoGravado(v: Prisma.JsonValue | null): AnexoGravado | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  // Mídia recebida: figurinha é uma imagem; vídeo vira arquivo para baixar.
  const tipo = o.tipo === 'figurinha' ? 'imagem' : o.tipo === 'video' ? 'documento' : o.tipo;
  if (tipo !== 'imagem' && tipo !== 'documento' && tipo !== 'audio') return null;
  return {
    tipo,
    dataUrl: typeof o.dataUrl === 'string' && o.dataUrl.startsWith('data:') ? o.dataUrl : undefined,
    figurinha: o.tipo === 'figurinha' || undefined,
    mime: String(o.mime ?? ''),
    nome: String(o.nome ?? 'arquivo'),
    tamanho: Number(o.tamanho ?? 0),
    legenda: typeof o.legenda === 'string' ? o.legenda : undefined,
    storageKey: typeof o.storageKey === 'string' ? o.storageKey : undefined,
  };
}

/**
 * Inbox de atendimento no nível do GHL (Q2.5): mídia, notas internas com
 * @menção, respostas rápidas, iniciar conversa e painel de contexto.
 *
 * Fronteira: envio continua no `MessagesService` (dono do provedor, da
 * idempotência e das travas); aqui só se PREPARA a mídia e se lê/grava o que
 * é do Inbox. Agenda (compromissos) não é lida aqui — é de outro módulo; a
 * tela consulta a API da agenda.
 */
@Injectable()
export class InboxService {
  private readonly log = new Logger('Inbox');

  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmService,
    private readonly messages: MessagesService,
    private readonly storage: StorageService,
    private readonly notificacoes: NotificationsService,
    private readonly eventos: DomainEventsService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Thread: mensagens + anexos + notas internas, em ordem cronológica     */
  /* ------------------------------------------------------------------ */

  async thread(tenantId: string, conversationId: string) {
    const base = await this.crm.mensagensDaConversa(tenantId, conversationId);
    const ids = base.mensagens.map((m) => m.id);
    const { anexos, notas } = await this.prisma.withTenant(tenantId, async (tx) => {
      const [comAnexo, notas] = await Promise.all([
        ids.length ? tx.message.findMany({ where: { id: { in: ids }, NOT: { anexo: { equals: Prisma.DbNull } } }, select: { id: true, anexo: true } }) : Promise.resolve([]),
        tx.conversationNote.findMany({ where: { conversationId }, orderBy: { createdAt: 'desc' }, take: 300 }),
      ]);
      const autores = [...new Set(notas.map((n) => n.autorId).filter((v): v is string => !!v))];
      const usuarios = autores.length ? await tx.user.findMany({ where: { identityId: { in: autores } }, select: { identityId: true, nome: true } }) : [];
      const nome = new Map(usuarios.map((u) => [u.identityId, u.nome]));
      return {
        anexos: new Map(comAnexo.map((m) => [m.id, anexoGravado(m.anexo)])),
        notas: notas.map((n) => ({
          id: n.id,
          de: 'nota' as const,
          interna: true as const,
          texto: n.corpo,
          hora: n.createdAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          criadaEm: n.createdAt.toISOString(),
          enviadoPorId: n.autorId,
          enviadoPorNome: n.autorId ? nome.get(n.autorId) ?? null : null,
          mencoes: n.mencoes,
        })),
      };
    });
    const mensagens = base.mensagens.map((m) => {
      const a = anexos.get(m.id);
      return { ...m, anexo: a ? this.anexoParaTela(a) : null };
    });
    const tudo = [...mensagens, ...notas].sort((x, y) => (x.criadaEm < y.criadaEm ? -1 : x.criadaEm > y.criadaEm ? 1 : 0));
    return { id: base.id, total: base.total + notas.length, mensagens: tudo };
  }

  private anexoParaTela(a: AnexoGravado): AnexoMensagem {
    return {
      tipo: a.tipo,
      mime: a.mime,
      nome: a.nome,
      tamanho: a.tamanho,
      legenda: a.legenda,
      url: a.storageKey ? this.storage.urlLeitura(a.storageKey, VALIDADE_TELA_S) : a.dataUrl ?? null,
      ...(a.figurinha ? { figurinha: true } : {}),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Mídia de saída                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Valida, guarda (storage) ou prepara base64, e entrega ao `MessagesService`.
   * Com storage: o arquivo vai para `inbox/<tenant>/<conversa>/<chave>-<nome>`
   * — a chave de idempotência no caminho faz o retry sobrescrever o mesmo
   * objeto em vez de duplicar. Sem storage: só ≤ 5 MB, em base64, e só se o
   * provedor aceitar (decidido no envio — gated `storage` caso contrário).
   */
  async enviarMidia(tenantId: string, conversationId: string, entrada: EntradaMidia, idempotencyKey: string, autor: AutorEnvio) {
    if (!/^[A-Za-z0-9+/=\s]+$/.test(entrada.base64)) throw new BadRequestException('conteúdo do arquivo inválido (base64)');
    const conteudo = Buffer.from(entrada.base64, 'base64');
    const erro = validarMidia(entrada.tipo, entrada.mime, conteudo);
    if (erro) {
      const limite = Math.round(limiteDoTipo(entrada.tipo) / 1024 / 1024);
      throw new UnprocessableEntityException(erro === 'arquivo_grande' ? `${MENSAGEM_ERRO_MIDIA[erro]} (máximo ${limite} MB)` : MENSAGEM_ERRO_MIDIA[erro]);
    }
    const nome = entrada.nome.trim().slice(0, 160) || 'arquivo';
    const legenda = entrada.legenda?.trim() || undefined;
    const mime = entrada.mime.split(';')[0].trim().toLowerCase();
    const midia: MidiaEnvio = { tipo: entrada.tipo, mime, nome, legenda, tamanho: conteudo.length };

    if (this.storage.configurado()) {
      // A conversa existe e é deste tenant ANTES de gravar qualquer byte.
      await this.exigirConversa(tenantId, conversationId);
      const chave = `inbox/${tenantId}/${conversationId}/${idempotencyKey}-${nomeSeguro(nome)}`;
      try {
        await this.storage.enviar(chave, conteudo, mime);
      } catch (e) {
        if (e instanceof StorageError) throw new ConflictException('não consegui guardar o arquivo agora; tente de novo');
        throw e;
      }
      midia.storageKey = chave;
      midia.url = this.storage.urlLeitura(chave, VALIDADE_PROVEDOR_S) ?? undefined;
    } else if (conteudo.length <= LIMITE_BASE64_SEM_STORAGE) {
      midia.base64 = conteudo.toString('base64');
      midia.storageFaltando = this.storage.faltando();
    } else {
      // Nada a fazer sem storage: recusa ANTES de gravar (não há o que persistir).
      throw new ConfigRequiredException('storage', this.storage.faltando());
    }

    const r = await this.messages.send(tenantId, conversationId, corpoDaMidia(entrada.tipo, nome, legenda), idempotencyKey, undefined, autor, midia);
    const anexo: AnexoMensagem = { tipo: midia.tipo, mime, nome, tamanho: midia.tamanho, legenda, url: midia.storageKey ? this.storage.urlLeitura(midia.storageKey, VALIDADE_TELA_S) : null };
    return { ...r, anexo };
  }

  /* ------------------------------------------------------------------ */
  /* Notas internas                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Nota interna: nunca vai ao provedor, nem à prévia da conversa, nem ao
   * histórico do agente de IA (tabela própria — db/055). @menção gera
   * notificação para cada membro citado (menos o próprio autor).
   */
  async criarNota(tenantId: string, conversationId: string, autorId: string, corpo: string, mencoes: string[] = []) {
    const texto = corpo.trim();
    if (!texto) throw new BadRequestException('a nota está vazia');
    const unicos = [...new Set(mencoes)].filter((m) => m !== autorId);
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      const conv = await tx.conversation.findUnique({ where: { id: conversationId }, select: { id: true, nome: true } });
      if (!conv) throw new NotFoundException('conversa inexistente');
      const membros = unicos.length
        ? await tx.user.findMany({ where: { identityId: { in: unicos }, role: { in: PAPEIS_EQUIPE } }, select: { identityId: true } })
        : [];
      if (membros.length !== unicos.length) throw new BadRequestException('menção a alguém que não é da equipe desta conta');
      const autor = await tx.user.findFirst({ where: { identityId: autorId }, select: { nome: true } });
      const nota = await tx.conversationNote.create({ data: { tenantId, conversationId, autorId, corpo: texto, mencoes: unicos } });
      const notificadas: { id: string; identityId: string }[] = [];
      for (const destino of unicos) {
        notificadas.push(
          await this.notificacoes.criar(tx, tenantId, {
            identityId: destino,
            tipo: 'mencao',
            titulo: `${autor?.nome ?? 'Alguém da equipe'} mencionou você em ${conv.nome}`,
            detalhe: texto.slice(0, 140),
            url: `/conversas?c=${conversationId}`,
            entidade: 'conversation',
            entidadeId: conversationId,
          }),
        );
      }
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${autorId}, 'conversa.nota_interna', 'conversation', ${conversationId}, ${JSON.stringify({ notaId: nota.id, mencoes: unicos.length })}::jsonb)`;
      return {
        nota: {
          id: nota.id,
          de: 'nota' as const,
          interna: true as const,
          texto: nota.corpo,
          hora: nota.createdAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          criadaEm: nota.createdAt.toISOString(),
          enviadoPorId: autorId,
          enviadoPorNome: autor?.nome ?? null,
          mencoes: nota.mencoes,
        },
        notificadas,
      };
    });
    this.eventos.publicar(tenantId, 'conversation.note_created', { conversationId, id: r.nota.id });
    for (const n of r.notificadas) this.eventos.publicar(tenantId, 'notification.created', { id: n.id, paraIdentityId: n.identityId });
    return r.nota;
  }

  /* ------------------------------------------------------------------ */
  /* Iniciar conversa                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Conversa nova pelo WhatsApp a partir de um contato com telefone. Se já
   * existe conversa de WhatsApp com ele, devolve a mesma (nunca duplica: lock
   * no contato, a mesma ordem de lock da entrada por webhook). Quem inicia
   * fica como responsável, com atendimento humano.
   */
  async iniciarConversa(tenantId: string, contactId: string, identityId: string) {
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM contacts WHERE id = ${contactId}::uuid FOR UPDATE`;
      const contato = await tx.contact.findUnique({ where: { id: contactId }, select: { id: true, nome: true, telefone: true } });
      if (!contato) throw new NotFoundException('contato inexistente');
      if (!contato.telefone?.replace(/\D/g, '')) throw new UnprocessableEntityException('este contato não tem telefone; cadastre um para iniciar pelo WhatsApp');
      const existente = await tx.conversation.findFirst({ where: { contactId, canal: 'WhatsApp' }, select: { id: true } });
      if (existente) return { id: existente.id, criada: false };
      const conv = await tx.conversation.create({
        data: { tenantId, contactId, nome: contato.nome, canal: 'WhatsApp', atendimento: 'humano', assigneeId: identityId, naoLidas: 0 },
        select: { id: true },
      });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'conversa.iniciada', 'conversation', ${conv.id})`;
      return { id: conv.id, criada: true };
    });
    if (r.criada) this.eventos.publicar(tenantId, 'conversation.updated', { id: r.id, atendimento: 'humano', assigneeId: identityId, naoLidas: 0 });
    return r;
  }

  /* ------------------------------------------------------------------ */
  /* Painel de contexto                                                   */
  /* ------------------------------------------------------------------ */

  async contexto(tenantId: string, conversationId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const conv = await tx.conversation.findUnique({ where: { id: conversationId }, select: { id: true, contactId: true, assigneeId: true } });
      if (!conv) throw new NotFoundException('conversa inexistente');
      const c = conv.contactId
        ? await tx.contact.findUnique({
            where: { id: conv.contactId },
            select: { id: true, nome: true, telefone: true, email: true, empresa: true, tag: true, tags: true, origem: true, ownerId: true, createdAt: true },
          })
        : null;
      const [negocios, tarefas] = c
        ? await Promise.all([
            tx.deal.findMany({
              where: { contactId: c.id, status: 'aberto' },
              orderBy: { updatedAt: 'desc' },
              take: 3,
              select: { id: true, titulo: true, valor: true, stage: { select: { nome: true, cor: true } }, pipeline: { select: { nome: true } } },
            }),
            tx.task.findMany({
              where: { contactId: c.id, status: { not: 'concluida' } },
              orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }],
              take: 3,
              select: { id: true, titulo: true, dueAt: true, prioridade: true },
            }),
          ])
        : [[], []];
      const pessoas = [c?.ownerId, conv.assigneeId].filter((v): v is string => !!v);
      const usuarios = pessoas.length ? await tx.user.findMany({ where: { identityId: { in: pessoas } }, select: { identityId: true, nome: true } }) : [];
      const nome = new Map(usuarios.map((u) => [u.identityId, u.nome]));
      return {
        conversationId,
        responsavel: conv.assigneeId ? { identityId: conv.assigneeId, nome: nome.get(conv.assigneeId) ?? null } : null,
        contato: c
          ? {
              id: c.id,
              nome: c.nome,
              telefone: c.telefone,
              email: c.email,
              empresa: c.empresa,
              tags: [...new Set([c.tag, ...c.tags].filter(Boolean))],
              origem: c.origem,
              dono: c.ownerId ? { identityId: c.ownerId, nome: nome.get(c.ownerId) ?? null } : null,
              criadoEm: c.createdAt.toISOString(),
            }
          : null,
        negocios: negocios.map((d) => ({ id: d.id, titulo: d.titulo, valor: Number(d.valor), etapa: d.stage?.nome ?? '', cor: d.stage?.cor ?? null, funil: d.pipeline?.nome ?? '' })),
        tarefas: tarefas.map((t) => ({ id: t.id, titulo: t.titulo, dueAt: t.dueAt?.toISOString() ?? null, prioridade: t.prioridade })),
      };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Respostas rápidas                                                    */
  /* ------------------------------------------------------------------ */

  async listarRespostas(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.quickReply.findMany({ orderBy: { atalho: 'asc' }, select: { id: true, atalho: true, titulo: true, corpo: true, criadoPor: true, updatedAt: true } }),
    );
  }

  async criarResposta(tenantId: string, identityId: string, dto: { atalho: string; titulo: string; corpo: string }) {
    const dados = this.validarResposta(dto);
    try {
      return await this.prisma.withTenant(tenantId, (tx) =>
        tx.quickReply.create({ data: { tenantId, ...dados, criadoPor: identityId }, select: { id: true, atalho: true, titulo: true, corpo: true, criadoPor: true, updatedAt: true } }),
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`já existe uma resposta com o atalho /${dados.atalho}`);
      throw e;
    }
  }

  async atualizarResposta(tenantId: string, user: { identityId: string; role: string }, id: string, dto: { atalho?: string; titulo?: string; corpo?: string }) {
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const atual = await tx.quickReply.findUnique({ where: { id } });
        if (!atual) throw new NotFoundException('resposta rápida inexistente');
        this.exigirDono(atual.criadoPor, user);
        const dados = this.validarResposta({ atalho: dto.atalho ?? atual.atalho, titulo: dto.titulo ?? atual.titulo, corpo: dto.corpo ?? atual.corpo });
        return tx.quickReply.update({ where: { id }, data: { ...dados, updatedAt: new Date() }, select: { id: true, atalho: true, titulo: true, corpo: true, criadoPor: true, updatedAt: true } });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('já existe uma resposta com esse atalho');
      throw e;
    }
  }

  async removerResposta(tenantId: string, user: { identityId: string; role: string }, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.quickReply.findUnique({ where: { id }, select: { criadoPor: true } });
      if (!atual) throw new NotFoundException('resposta rápida inexistente');
      this.exigirDono(atual.criadoPor, user);
      await tx.quickReply.delete({ where: { id } });
      return { ok: true };
    });
  }

  /** Quem criou edita; gestão (owner/admin/manager) edita qualquer uma. */
  private exigirDono(criadoPor: string | null, user: { identityId: string; role: string }) {
    if (criadoPor !== user.identityId && !PAPEIS_GESTAO.includes(user.role)) throw new ForbiddenException('só quem criou ou a gestão pode alterar esta resposta');
  }

  private validarResposta(dto: { atalho: string; titulo: string; corpo: string }) {
    const atalho = normalizarAtalho(dto.atalho);
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(atalho)) throw new BadRequestException('atalho deve ter de 1 a 32 letras, números, "-" ou "_"');
    const titulo = dto.titulo.trim();
    const corpo = dto.corpo.trim();
    if (!titulo || !corpo) throw new BadRequestException('título e texto são obrigatórios');
    const desconhecidas = variaveisDesconhecidas(corpo);
    if (desconhecidas.length) {
      throw new BadRequestException(`variável desconhecida: ${desconhecidas.map((v) => `{{${v}}}`).join(', ')}. Aceitas: ${VARIAVEIS_RESPOSTA.map((v) => `{{${v}}}`).join(', ')}`);
    }
    return { atalho, titulo, corpo };
  }

  private async exigirConversa(tenantId: string, conversationId: string) {
    const ok = await this.prisma.withTenant(tenantId, (tx) => tx.conversation.findUnique({ where: { id: conversationId }, select: { id: true } }));
    if (!ok) throw new NotFoundException('conversa inexistente');
  }
}
