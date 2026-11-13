import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { ZodError } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AgendaService } from '../agenda/agenda.service';
import { AtribuicaoService } from '../crm/atribuicao.service';
import { toqueDeUtm } from '../crm/atribuicao';
import { LeadsService } from '../crm/leads.service';
import { avaliarAntiRobo, emitirCarimbo, hashToken, novoTokenOpaco, PublicRateLimiter, TOKEN_OPACO_RE } from '../common/public-request';
import { campoParaPublico, extrairUtm, ListaCamposSchema, normalizarTelefoneBR, slugDe, validarRespostas, type CampoPublico } from '../common/public-fields';
import {
  AtualizarPaginaSchema,
  calcularSlots,
  CriarPaginaSchema,
  DATA_RE,
  dataNoFuso,
  gerarIcs,
  HorariosSchema,
  horariosPadrao,
  instanteLocal,
  janelaReservavel,
  MinhaPaginaSchema,
  ordemDeTentativa,
  RemarcarSchema,
  ReservaPublicaSchema,
  somarDias,
  type ConfigSlots,
  type Horarios,
  type Ocupado,
  type Slot,
} from './booking.schema';

const ATIVOS = ['agendado', 'confirmado'] as const;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

export interface ContextoPublico {
  ip: string;
  userAgent: string | null;
}

type PaginaRow = Prisma.BookingPageGetPayload<Record<string, never>>;

export interface PaginaView {
  id: string;
  slug: string;
  titulo: string;
  descricao: string | null;
  duracaoMin: number;
  intervaloMin: number;
  antecedenciaMinHoras: number;
  janelaDias: number;
  horarios: Horarios;
  fuso: string;
  responsaveis: string[];
  distribuicao: 'round_robin' | 'fixo';
  local: string | null;
  tipo: string;
  perguntas: CampoPublico[];
  confirmacaoAutomatica: boolean;
  estilo: { cor?: string };
  ativo: boolean;
  /** Página pessoal (db/069): identity do dono. `null` = página da equipe. */
  ownerId: string | null;
  totalReservas: number;
  createdAt: Date;
  updatedAt: Date;
}

function horariosDoBanco(v: Prisma.JsonValue): Horarios {
  const r = HorariosSchema.safeParse(v);
  return r.success ? r.data : {};
}
function perguntasDoBanco(v: Prisma.JsonValue): CampoPublico[] {
  const r = ListaCamposSchema.safeParse(v);
  return r.success ? r.data : [];
}
function estiloDoBanco(v: Prisma.JsonValue): { cor?: string } {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return typeof o.cor === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.cor) ? { cor: o.cor } : {};
}

export function viewPagina(p: PaginaRow, total = 0): PaginaView {
  return {
    id: p.id, slug: p.slug, titulo: p.titulo, descricao: p.descricao, duracaoMin: p.duracaoMin, intervaloMin: p.intervaloMin,
    antecedenciaMinHoras: p.antecedenciaMinHoras, janelaDias: p.janelaDias, horarios: horariosDoBanco(p.horarios), fuso: p.fuso,
    responsaveis: p.responsaveis, distribuicao: p.distribuicao === 'fixo' ? 'fixo' : 'round_robin', local: p.local, tipo: p.tipo,
    perguntas: perguntasDoBanco(p.perguntas), confirmacaoAutomatica: p.confirmacaoAutomatica, estilo: estiloDoBanco(p.estilo),
    ativo: p.ativo, ownerId: p.ownerId ?? null, totalReservas: total, createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

function configSlots(p: PaginaView): ConfigSlots {
  return { duracaoMin: p.duracaoMin, intervaloMin: p.intervaloMin, antecedenciaMinHoras: p.antecedenciaMinHoras, janelaDias: p.janelaDias, horarios: p.horarios, fuso: p.fuso, responsaveis: p.responsaveis };
}

function erroZod(e: ZodError): BadRequestException {
  const problemas = e.issues.map((i) => i.message);
  return new BadRequestException({ message: problemas[0] ?? 'dados inválidos', code: 'pagina_invalida', problemas });
}

function formatarNotas(perguntas: CampoPublico[], valores: Record<string, unknown>, slug: string): string {
  const linhas = perguntas
    .filter((c) => valores[c.id] !== undefined && valores[c.id] !== '' && c.tipo !== 'consentimento')
    .map((c) => {
      const v = valores[c.id];
      return `${c.rotulo}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : String(v)}`;
    });
  return [...linhas, `Agendado pela página pública /b/${slug}`].join('\n').slice(0, 1000);
}

/**
 * Agendamento público (Q4.2). O compromisso nasce SEMPRE pela AgendaService
 * (prevenção de choque com lock de transação por tenant, eventos da agenda
 * pelo trigger da 054); o contato, pela LeadsService (dedupe do CRM). Este
 * módulo só guarda a configuração da página e o vínculo da reserva.
 */
@Injectable()
export class BookingService {
  private readonly log = new Logger('Booking');

  constructor(
    private readonly prisma: PrismaService,
    private readonly agenda: AgendaService,
    private readonly leads: LeadsService,
    private readonly limite: PublicRateLimiter,
    private readonly atribuicao?: AtribuicaoService,
  ) {}

  // ------------------------------------------------------------------ autenticado

  async listar(tenantId: string): Promise<PaginaView[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.bookingPage.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { reservas: true } } } });
      return rows.map((r) => viewPagina(r, r._count.reservas));
    });
  }

  async obter(tenantId: string, id: string): Promise<PaginaView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const p = await tx.bookingPage.findUnique({ where: { id }, include: { _count: { select: { reservas: true } } } });
      if (!p) throw new NotFoundException('página de agendamento inexistente');
      return viewPagina(p, p._count.reservas);
    });
  }

  async criar(tenantId: string, identityId: string, bruto: unknown): Promise<PaginaView> {
    const r = CriarPaginaSchema.safeParse(bruto);
    if (!r.success) throw erroZod(r.error);
    const i = r.data;
    const slug = i.slug ?? `${slugDe(i.titulo)}-${randomBytes(3).toString('hex')}`;
    try {
      const p = await this.prisma.withTenant(tenantId, (tx) =>
        tx.bookingPage.create({
          data: {
            tenantId, slug, titulo: i.titulo, descricao: i.descricao ?? null,
            ...(i.duracaoMin !== undefined ? { duracaoMin: i.duracaoMin } : {}),
            ...(i.intervaloMin !== undefined ? { intervaloMin: i.intervaloMin } : {}),
            ...(i.antecedenciaMinHoras !== undefined ? { antecedenciaMinHoras: i.antecedenciaMinHoras } : {}),
            ...(i.janelaDias !== undefined ? { janelaDias: i.janelaDias } : {}),
            horarios: (i.horarios ?? horariosPadrao()) as Prisma.InputJsonValue,
            ...(i.fuso !== undefined ? { fuso: i.fuso } : {}),
            responsaveis: i.responsaveis ?? [],
            ...(i.distribuicao !== undefined ? { distribuicao: i.distribuicao } : {}),
            local: i.local ?? null,
            ...(i.tipo !== undefined ? { tipo: i.tipo } : {}),
            perguntas: (i.perguntas ?? []) as unknown as Prisma.InputJsonValue,
            ...(i.confirmacaoAutomatica !== undefined ? { confirmacaoAutomatica: i.confirmacaoAutomatica } : {}),
            estilo: (i.estilo ?? {}) as Prisma.InputJsonValue,
            ...(i.ativo !== undefined ? { ativo: i.ativo } : {}),
            createdBy: identityId,
          },
        }),
      );
      return viewPagina(p);
    } catch (e) {
      throw this.traduzirErroGravacao(e);
    }
  }

  async atualizar(tenantId: string, id: string, bruto: unknown): Promise<PaginaView> {
    const r = AtualizarPaginaSchema.safeParse(bruto);
    if (!r.success) throw erroZod(r.error);
    const i = r.data;
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const existe = await tx.bookingPage.findUnique({ where: { id }, select: { id: true, ownerId: true } });
        if (!existe) throw new NotFoundException('página de agendamento inexistente');
        // Página pessoal (db/069): nem o admin tira o dono da própria fila —
        // senão a reserva pública cairia na agenda de outra pessoa.
        if (existe.ownerId && i.responsaveis && !i.responsaveis.includes(existe.ownerId)) {
          throw new BadRequestException({ message: 'Esta é a página pessoal de um membro: o dono precisa continuar entre os responsáveis.', code: 'dono_fora_da_fila' });
        }
        const p = await tx.bookingPage.update({
          where: { id },
          data: {
            ...(i.slug !== undefined ? { slug: i.slug } : {}),
            ...(i.titulo !== undefined ? { titulo: i.titulo } : {}),
            ...(i.descricao !== undefined ? { descricao: i.descricao } : {}),
            ...(i.duracaoMin !== undefined ? { duracaoMin: i.duracaoMin } : {}),
            ...(i.intervaloMin !== undefined ? { intervaloMin: i.intervaloMin } : {}),
            ...(i.antecedenciaMinHoras !== undefined ? { antecedenciaMinHoras: i.antecedenciaMinHoras } : {}),
            ...(i.janelaDias !== undefined ? { janelaDias: i.janelaDias } : {}),
            ...(i.horarios !== undefined ? { horarios: i.horarios as Prisma.InputJsonValue } : {}),
            ...(i.fuso !== undefined ? { fuso: i.fuso } : {}),
            ...(i.responsaveis !== undefined ? { responsaveis: i.responsaveis } : {}),
            ...(i.distribuicao !== undefined ? { distribuicao: i.distribuicao } : {}),
            ...(i.local !== undefined ? { local: i.local } : {}),
            ...(i.tipo !== undefined ? { tipo: i.tipo } : {}),
            ...(i.perguntas !== undefined ? { perguntas: i.perguntas as unknown as Prisma.InputJsonValue } : {}),
            ...(i.confirmacaoAutomatica !== undefined ? { confirmacaoAutomatica: i.confirmacaoAutomatica } : {}),
            ...(i.estilo !== undefined ? { estilo: i.estilo as Prisma.InputJsonValue } : {}),
            ...(i.ativo !== undefined ? { ativo: i.ativo } : {}),
            updatedAt: new Date(),
          },
          include: { _count: { select: { reservas: true } } },
        });
        return viewPagina(p, p._count.reservas);
      });
    } catch (e) {
      throw this.traduzirErroGravacao(e);
    }
  }

  private traduzirErroGravacao(e: unknown): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return new ConflictException({ message: 'esse link já está em uso: escolha outro', code: 'slug_em_uso' });
    // O trigger da db/060/069 levanta 23503/23514 (o Prisma traduz para P2003/P2004 e esconde a mensagem).
    const fk = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003';
    if (fk || (e instanceof Error && /não é membro desta conta/.test(e.message))) return new BadRequestException('um dos responsáveis não é membro desta conta');
    // 23514: os CHECKs de formato já foram validados pelo Zod — só o trigger do dono resta.
    const chk = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2004';
    if (chk || (e instanceof Error && /dono precisa estar entre os responsáveis/.test(e.message))) {
      return new BadRequestException({ message: 'Esta é a página pessoal de um membro: o dono precisa continuar entre os responsáveis.', code: 'dono_fora_da_fila' });
    }
    return e;
  }

  async remover(tenantId: string, id: string): Promise<{ ok: true }> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      // Os compromissos já marcados ficam na agenda; só o link de gerenciamento deixa de existir.
      const r = await tx.bookingPage.deleteMany({ where: { id } });
      if (!r.count) throw new NotFoundException('página de agendamento inexistente');
      return { ok: true as const };
    });
  }

  // ------------------------------------------------------------------ página pessoal (CAL-PESSOAL)

  /** A página pessoal do colaborador logado (`null` = ainda não criou). */
  async minha(tenantId: string, identityId: string): Promise<PaginaView | null> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const p = await tx.bookingPage.findUnique({ where: { tenantId_ownerId: { tenantId, ownerId: identityId } }, include: { _count: { select: { reservas: true } } } });
      return p ? viewPagina(p, p._count.reservas) : null;
    });
  }

  /**
   * Cria (1ª vez) ou atualiza a página pessoal do colaborador. A fila é
   * imposta pelo servidor: `responsaveis=[ele]`, `distribuicao=fixo`,
   * `owner_id=ele` — o banco (db/069) é o backstop das duas invariantes.
   */
  async salvarMinha(tenantId: string, identityId: string, bruto: unknown): Promise<PaginaView> {
    const r = MinhaPaginaSchema.safeParse(bruto);
    if (!r.success) throw erroZod(r.error);
    const i = r.data;
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const existe = await tx.bookingPage.findUnique({ where: { tenantId_ownerId: { tenantId, ownerId: identityId } }, select: { id: true } });
        if (existe) {
          const p = await tx.bookingPage.update({
            where: { id: existe.id },
            data: {
              ...(i.slug !== undefined ? { slug: i.slug } : {}),
              ...(i.titulo !== undefined ? { titulo: i.titulo } : {}),
              ...(i.descricao !== undefined ? { descricao: i.descricao } : {}),
              ...(i.duracaoMin !== undefined ? { duracaoMin: i.duracaoMin } : {}),
              ...(i.intervaloMin !== undefined ? { intervaloMin: i.intervaloMin } : {}),
              ...(i.antecedenciaMinHoras !== undefined ? { antecedenciaMinHoras: i.antecedenciaMinHoras } : {}),
              ...(i.janelaDias !== undefined ? { janelaDias: i.janelaDias } : {}),
              ...(i.horarios !== undefined ? { horarios: i.horarios as Prisma.InputJsonValue } : {}),
              ...(i.fuso !== undefined ? { fuso: i.fuso } : {}),
              ...(i.local !== undefined ? { local: i.local } : {}),
              ...(i.tipo !== undefined ? { tipo: i.tipo } : {}),
              ...(i.perguntas !== undefined ? { perguntas: i.perguntas as unknown as Prisma.InputJsonValue } : {}),
              ...(i.confirmacaoAutomatica !== undefined ? { confirmacaoAutomatica: i.confirmacaoAutomatica } : {}),
              ...(i.estilo !== undefined ? { estilo: i.estilo as Prisma.InputJsonValue } : {}),
              ...(i.ativo !== undefined ? { ativo: i.ativo } : {}),
              updatedAt: new Date(),
            },
            include: { _count: { select: { reservas: true } } },
          });
          return viewPagina(p, p._count.reservas);
        }
        const usuario = await tx.user.findFirst({ where: { tenantId, identityId }, select: { nome: true } });
        const nome = (usuario?.nome ?? '').trim() || 'mim';
        const titulo = i.titulo ?? `Agendar com ${nome}`.slice(0, 120);
        const slug = i.slug ?? `${slugDe(nome)}-${randomBytes(3).toString('hex')}`;
        const p = await tx.bookingPage.create({
          data: {
            tenantId, slug, titulo, descricao: i.descricao ?? null,
            ...(i.duracaoMin !== undefined ? { duracaoMin: i.duracaoMin } : {}),
            ...(i.intervaloMin !== undefined ? { intervaloMin: i.intervaloMin } : {}),
            ...(i.antecedenciaMinHoras !== undefined ? { antecedenciaMinHoras: i.antecedenciaMinHoras } : {}),
            ...(i.janelaDias !== undefined ? { janelaDias: i.janelaDias } : {}),
            horarios: (i.horarios ?? horariosPadrao()) as Prisma.InputJsonValue,
            ...(i.fuso !== undefined ? { fuso: i.fuso } : {}),
            responsaveis: [identityId], distribuicao: 'fixo', ownerId: identityId,
            local: i.local ?? null,
            ...(i.tipo !== undefined ? { tipo: i.tipo } : {}),
            perguntas: (i.perguntas ?? []) as unknown as Prisma.InputJsonValue,
            ...(i.confirmacaoAutomatica !== undefined ? { confirmacaoAutomatica: i.confirmacaoAutomatica } : {}),
            estilo: (i.estilo ?? {}) as Prisma.InputJsonValue,
            ...(i.ativo !== undefined ? { ativo: i.ativo } : {}),
            createdBy: identityId,
          },
        });
        this.log.log(`página pessoal criada: ${p.id} (tenant ${tenantId}, dono ${identityId})`);
        return viewPagina(p);
      });
    } catch (e) {
      throw this.traduzirErroGravacao(e);
    }
  }

  // ------------------------------------------------------------------ público

  private async resolver(slug: string): Promise<{ tenantId: string; pageId: string; tenantNome: string } | null> {
    if (!/^[a-z0-9-]{4,64}$/.test(slug)) return null;
    const rows = await this.prisma.$queryRaw<{ tenant_id: string; page_id: string; tenant_nome: string }[]>`SELECT * FROM resolve_booking_page_by_slug(${slug})`;
    const r = rows[0];
    return r?.tenant_id ? { tenantId: r.tenant_id, pageId: r.page_id, tenantNome: r.tenant_nome } : null;
  }

  private async carregar(slug: string) {
    const rota = await this.resolver(slug);
    if (!rota) throw new NotFoundException('página de agendamento não encontrada');
    const p = await this.prisma.withTenant(rota.tenantId, (tx) => tx.bookingPage.findUnique({ where: { id: rota.pageId } }));
    if (!p) throw new NotFoundException('página de agendamento não encontrada');
    return { ...rota, pagina: viewPagina(p) };
  }

  /** Compromissos ativos que podem bloquear horários entre `de` e `ate` (com 1 dia de folga por causa do fuso). */
  private async ocupados(tenantId: string, de: string, ate: string, fuso: string): Promise<Ocupado[]> {
    const ini = instanteLocal(somarDias(de, -1), 0, fuso);
    const fim = instanteLocal(somarDias(ate, 2), 0, fuso);
    const lista = await this.agenda.listar(tenantId, { de: new Date(ini).toISOString(), ate: new Date(fim).toISOString(), status: [...ATIVOS] });
    return lista.map((c) => ({ id: c.id, inicio: +c.inicio, fim: +c.fim, responsavelId: c.responsavelId }));
  }

  async publico(slug: string, ctx: ContextoPublico) {
    await this.limite.consumir(`booking-get:${ctx.ip}`, 120, 60);
    const { pageId, tenantId, tenantNome, pagina } = await this.carregar(slug);
    const agora = Date.now();
    const { primeiro, ultimo } = janelaReservavel(pagina, agora);
    const ocupados = await this.ocupados(tenantId, primeiro, ultimo, pagina.fuso);
    const dias: { data: string; horarios: number }[] = [];
    for (let d = primeiro; d <= ultimo; d = somarDias(d, 1)) {
      const n = calcularSlots(configSlots(pagina), d, ocupados, agora).length;
      if (n) dias.push({ data: d, horarios: n });
    }
    // Página pessoal: o visitante vê com quem vai falar ("Agendar com a Ana").
    let responsavel: { nome: string } | null = null;
    if (pagina.ownerId) {
      const u = await this.prisma.withTenant(tenantId, (tx) => tx.user.findFirst({ where: { tenantId, identityId: pagina.ownerId! }, select: { nome: true } }));
      if (u?.nome.trim()) responsavel = { nome: u.nome.trim() };
    }
    return {
      titulo: pagina.titulo, descricao: pagina.descricao, duracaoMin: pagina.duracaoMin, fuso: pagina.fuso, local: pagina.local,
      janela: { primeiro, ultimo }, dias,
      perguntas: pagina.perguntas.map(campoParaPublico),
      estilo: pagina.estilo,
      marca: { nome: tenantNome },
      responsavel,
      carimbo: emitirCarimbo(`booking:${pageId}`),
    };
  }

  async slots(slug: string, data: string, ctx: ContextoPublico): Promise<{ data: string; fuso: string; horarios: { inicio: string; fim: string }[] }> {
    await this.limite.consumir(`booking-get:${ctx.ip}`, 120, 60);
    if (!DATA_RE.test(data)) throw new BadRequestException('data deve ser YYYY-MM-DD');
    const { tenantId, pagina } = await this.carregar(slug);
    const ocupados = await this.ocupados(tenantId, data, data, pagina.fuso);
    const horarios = calcularSlots(configSlots(pagina), data, ocupados, Date.now()).map((s) => ({ inicio: s.inicio, fim: s.fim }));
    return { data, fuso: pagina.fuso, horarios };
  }

  private async slotLivre(tenantId: string, pagina: PaginaView, inicio: Date, ignorarId?: string): Promise<Slot | null> {
    const data = dataNoFuso(+inicio, pagina.fuso);
    const ocupados = await this.ocupados(tenantId, data, data, pagina.fuso);
    return calcularSlots(configSlots(pagina), data, ocupados, Date.now(), ignorarId).find((s) => +new Date(s.inicio) === +inicio) ?? null;
  }

  async reservar(slug: string, bruto: unknown, ctx: ContextoPublico) {
    const { tenantId, pageId, tenantNome, pagina } = await this.carregar(slug);
    await this.limite.consumir(`booking-post:${pageId}:${ctx.ip}`, 5, 600);
    await this.limite.consumir(`booking-post-ip:${ctx.ip}`, 15, 600);

    const r = ReservaPublicaSchema.safeParse(bruto);
    if (!r.success) {
      const i = r.error.issues[0];
      throw new BadRequestException({ message: i?.message ?? 'dados inválidos', code: 'reserva_invalida', campos: r.error.issues.map((x) => ({ campo: String(x.path[0] ?? ''), erro: x.message })) });
    }
    const corpo = r.data;
    const robo = avaliarAntiRobo(`booking:${pageId}`, { isca: corpo.website, carimbo: corpo.carimbo });
    if (robo === 'isca') {
      this.log.warn(`reserva na página ${pageId} descartada: campo isca preenchido`);
      return { ok: true as const, reserva: null, token: null };
    }
    if (robo === 'carimbo_invalido') throw new BadRequestException({ message: 'A página expirou. Recarregue e escolha o horário de novo.', code: 'carimbo_invalido' });
    if (robo === 'rapido') throw new BadRequestException({ message: 'Envio rápido demais. Confira os dados e tente de novo em alguns segundos.', code: 'envio_rapido' });

    const telefone = normalizarTelefoneBR(corpo.telefone);
    if (!telefone) throw new BadRequestException({ message: 'Informe um telefone com DDD.', code: 'reserva_invalida', campos: [{ campo: 'telefone', erro: 'informe um telefone com DDD' }] });
    const email = corpo.email ? corpo.email.toLowerCase() : null;
    if (email && !EMAIL_RE.test(email)) throw new BadRequestException({ message: 'Informe um e-mail válido.', code: 'reserva_invalida', campos: [{ campo: 'email', erro: 'informe um e-mail válido' }] });
    const v = validarRespostas(pagina.perguntas, corpo.respostas);
    if (!v.ok) throw new BadRequestException({ message: `${v.erros[0].rotulo}: ${v.erros[0].erro}`, code: 'respostas_invalidas', campos: v.erros });

    const inicio = new Date(corpo.inicio);
    const slot = await this.slotLivre(tenantId, pagina, inicio);
    if (!slot) throw new ConflictException({ message: 'Esse horário acabou de ficar indisponível. Escolha outro.', code: 'horario_indisponivel' });

    const contato = await this.leads.capturar(tenantId, {
      origem: `Agendamento: ${pagina.titulo}`.slice(0, 80),
      nome: corpo.nome, email, telefone,
      consentimento: corpo.consentimento ? { baseLegal: 'consentimento', origem: `agendamento:${pageId}`, texto: 'Aceite registrado na página de agendamento.' } : null,
    });

    // Round-robin/fixo entre quem está livre; cada tentativa é uma transação
    // própria com lock na AgendaService, então duas reservas simultâneas no
    // mesmo horário nunca passam juntas: a segunda recebe 409 e tenta o próximo.
    const candidatos: (string | null)[] = pagina.responsaveis.length ? ordemDeTentativa(pagina.responsaveis, slot.livres, pagina.distribuicao, await this.cursor(tenantId, pageId)) : [null];
    const fim = new Date(slot.fim);
    let compromisso: { id: string; status: string; responsavelId: string | null } | null = null;
    for (const responsavelId of candidatos) {
      try {
        compromisso = await this.agenda.criar(tenantId, contato.contactId, {
          titulo: `${pagina.titulo}: ${corpo.nome}`.slice(0, 200), inicio: inicio.toISOString(), fim: fim.toISOString(), contactId: contato.contactId,
          local: pagina.local, notas: formatarNotas(pagina.perguntas, v.valores, slug), tipo: pagina.tipo as 'reuniao', responsavelId,
          status: pagina.confirmacaoAutomatica ? 'confirmado' : 'agendado',
        }, 'sistema');
        break;
      } catch (e) {
        if (e instanceof ConflictException) continue;
        throw e;
      }
    }
    if (!compromisso) throw new ConflictException({ message: 'Esse horário acabou de ficar indisponível. Escolha outro.', code: 'horario_indisponivel' });

    const { token, hash } = novoTokenOpaco();
    const criado = compromisso;
    const utm = extrairUtm(corpo);
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.bookingReserva.create({
        data: { tenantId, bookingPageId: pageId, compromissoId: criado.id, contactId: contato.contactId, tokenHash: hash, respostas: v.valores as Prisma.InputJsonValue, utm: utm as Prisma.InputJsonValue },
      });
      if (pagina.distribuicao === 'round_robin' && criado.responsavelId) {
        const idx = pagina.responsaveis.indexOf(criado.responsavelId);
        if (idx >= 0) await tx.bookingPage.update({ where: { id: pageId }, data: { rrCursor: (idx + 1) % pagina.responsaveis.length } });
      }
    });
    // Rastreio (db/066): o UTM/gclid/fbclid do link de agendamento vira a
    // ficha de origem do contato — mesma lógica dos formulários públicos.
    void this.atribuicao?.registrar(tenantId, contato.contactId, toqueDeUtm(utm));
    this.log.log(`reserva na página ${pageId} (tenant ${tenantId}, compromisso ${criado.id})`);
    return {
      ok: true as const,
      token,
      reserva: { titulo: pagina.titulo, inicio: slot.inicio, fim: slot.fim, local: pagina.local, status: criado.status, fuso: pagina.fuso, marca: tenantNome },
    };
  }

  private async cursor(tenantId: string, pageId: string): Promise<number> {
    const p = await this.prisma.withTenant(tenantId, (tx) => tx.bookingPage.findUnique({ where: { id: pageId }, select: { rrCursor: true } }));
    return p?.rrCursor ?? 0;
  }

  // ------------------------------------------------------------------ gerenciar (token)

  private async porToken(token: string) {
    if (!TOKEN_OPACO_RE.test(token)) throw new NotFoundException('reserva não encontrada');
    const rows = await this.prisma.$queryRaw<{ tenant_id: string; reserva_id: string; tenant_nome: string }[]>`SELECT * FROM resolve_booking_reserva_by_token(${hashToken(token)})`;
    const rota = rows[0];
    if (!rota?.tenant_id) throw new NotFoundException('reserva não encontrada');
    const tenantId = rota.tenant_id;
    const reserva = await this.prisma.withTenant(tenantId, (tx) => tx.bookingReserva.findUnique({ where: { id: rota.reserva_id }, include: { pagina: true } }));
    if (!reserva) throw new NotFoundException('reserva não encontrada');
    const compromisso = await this.agenda.obter(tenantId, reserva.compromissoId);
    return { tenantId, tenantNome: rota.tenant_nome, reserva, pagina: viewPagina(reserva.pagina), compromisso };
  }

  async reserva(token: string, ctx: ContextoPublico) {
    await this.limite.consumir(`booking-token:${ctx.ip}`, 60, 600);
    const { tenantNome, pagina, compromisso } = await this.porToken(token);
    const ativo = (ATIVOS as readonly string[]).includes(compromisso.status) && +compromisso.inicio > Date.now();
    return {
      titulo: pagina.titulo, slug: pagina.slug, paginaAtiva: pagina.ativo, inicio: compromisso.inicio.toISOString(), fim: compromisso.fim.toISOString(),
      status: compromisso.status, local: compromisso.local, fuso: pagina.fuso, duracaoMin: pagina.duracaoMin, marca: { nome: tenantNome }, estilo: pagina.estilo,
      podeAlterar: ativo,
    };
  }

  async cancelar(token: string, ctx: ContextoPublico) {
    await this.limite.consumir(`booking-token:${ctx.ip}`, 60, 600);
    const { tenantId, reserva, compromisso } = await this.porToken(token);
    if (!(ATIVOS as readonly string[]).includes(compromisso.status) || +compromisso.inicio <= Date.now()) {
      throw new ConflictException({ message: 'Este agendamento não pode mais ser cancelado por aqui.', code: 'reserva_encerrada' });
    }
    await this.agenda.atualizarStatus(tenantId, reserva.contactId ?? 'pagina_publica', compromisso.id, 'cancelado', 'sistema');
    return { ok: true as const };
  }

  async remarcar(token: string, bruto: unknown, ctx: ContextoPublico) {
    await this.limite.consumir(`booking-token:${ctx.ip}`, 60, 600);
    const r = RemarcarSchema.safeParse(bruto);
    if (!r.success) throw new BadRequestException('horário inválido');
    const { tenantId, reserva, pagina, compromisso } = await this.porToken(token);
    if (!(ATIVOS as readonly string[]).includes(compromisso.status) || +compromisso.inicio <= Date.now()) {
      throw new ConflictException({ message: 'Este agendamento não pode mais ser remarcado por aqui.', code: 'reserva_encerrada' });
    }
    if (!pagina.ativo) throw new ConflictException({ message: 'A página de agendamento foi desativada. Fale com a empresa para remarcar.', code: 'pagina_inativa' });
    const inicio = new Date(r.data.inicio);
    const slot = await this.slotLivre(tenantId, pagina, inicio, compromisso.id);
    // Remarcação mantém o mesmo responsável (a agenda geral, se não houver).
    const responsavelOk = slot && (compromisso.responsavelId === null ? pagina.responsaveis.length === 0 || slot.livres.length === pagina.responsaveis.length : slot.livres.includes(compromisso.responsavelId));
    if (!slot || !responsavelOk) throw new ConflictException({ message: 'Esse horário não está disponível. Escolha outro.', code: 'horario_indisponivel' });
    await this.agenda.atualizar(tenantId, reserva.contactId ?? 'pagina_publica', compromisso.id, { inicio: slot.inicio, fim: slot.fim }, 'sistema');
    return { ok: true as const, inicio: slot.inicio, fim: slot.fim };
  }

  async ics(token: string, ctx: ContextoPublico): Promise<string> {
    await this.limite.consumir(`booking-token:${ctx.ip}`, 60, 600);
    const { tenantNome, pagina, compromisso } = await this.porToken(token);
    return gerarIcs({
      uid: compromisso.id, inicio: compromisso.inicio, fim: compromisso.fim, titulo: `${pagina.titulo} (${tenantNome})`,
      descricao: pagina.descricao, local: compromisso.local, cancelado: compromisso.status === 'cancelado',
    });
  }
}
