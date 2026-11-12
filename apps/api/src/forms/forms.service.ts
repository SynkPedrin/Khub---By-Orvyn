import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis.service';
import { CrmService } from '../crm/crm.service';
import { LeadsService } from '../crm/leads.service';
import { CustomFieldsService } from '../crm/custom-fields.service';
import { avaliarAntiRobo, emitirCarimbo, hashIp, PublicRateLimiter } from '../common/public-request';
import { campoParaPublico, celulaCsv, extrairUtm, ListaCamposSchema, slugDe, validarRespostas, type CampoPublico, type ErroResposta } from '../common/public-fields';
import {
  AtualizarFormSchema,
  camposPadrao,
  CriarFormSchema,
  dadosDoContato,
  EnvioPublicoSchema,
  EstiloFormSchema,
  linhasCsv,
  problemasDosCampos,
  type EstiloForm,
} from './forms.schema';

/** Evento publicado no outbox a cada envio (consumido pelo gatilho `formulario_enviado`, Q3.2). */
export const EVENTO_FORM_ENVIADO = 'form.submitted';

export interface ContextoPublico {
  ip: string;
  userAgent: string | null;
}

export interface FormView {
  id: string;
  nome: string;
  slug: string;
  campos: CampoPublico[];
  estilo: EstiloForm;
  ativo: boolean;
  tag: string | null;
  stageId: string | null;
  totalRespostas: number;
  createdAt: Date;
  updatedAt: Date;
}

type FormRow = { id: string; nome: string; slug: string; campos: Prisma.JsonValue; estilo: Prisma.JsonValue; ativo: boolean; tag: string | null; stageId: string | null; createdAt: Date; updatedAt: Date };

/** jsonb gravado → campos tipados. Linha corrompida vira lista vazia (nunca 500 na página pública). */
export function camposDoBanco(v: Prisma.JsonValue): CampoPublico[] {
  const r = ListaCamposSchema.safeParse(v);
  return r.success ? r.data : [];
}
function estiloDoBanco(v: Prisma.JsonValue): EstiloForm {
  const r = EstiloFormSchema.safeParse(v);
  return r.success ? r.data : {};
}
function objeto(v: Prisma.JsonValue): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function erroZod(e: ZodError): BadRequestException {
  const problemas = e.issues.map((i) => i.message);
  return new BadRequestException({ message: problemas[0] ?? 'dados inválidos', code: 'formulario_invalido', problemas });
}

/** Referência cross-tenant/inexistente barrada pelo trigger `tenant_reference` (23503 → Prisma P2003). */
function ehErroReferencia(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') return true;
  return e instanceof Error && /related resource not found|23503/.test(e.message);
}

/**
 * Formulários (Q4.1). Duas superfícies:
 *  - autenticada (`/v1/forms`): CRUD, respostas e CSV, tudo sob `withTenant`;
 *  - pública (`/v1/public/forms/:slug`): tenant resolvido pelo slug na função
 *    SECURITY DEFINER da db/059. O cliente nunca informa tenant.
 * Contato, tag e negócio passam pela superfície pública do CRM (LeadsService,
 * CrmService): este módulo não escreve em `contacts`/`deals`.
 */
@Injectable()
export class FormsService {
  private readonly log = new Logger('Forms');

  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly crm: CrmService,
    private readonly camposCustom: CustomFieldsService,
    private readonly limite: PublicRateLimiter,
    private readonly redis: RedisService,
  ) {}

  private view(f: FormRow, total = 0): FormView {
    return { id: f.id, nome: f.nome, slug: f.slug, campos: camposDoBanco(f.campos), estilo: estiloDoBanco(f.estilo), ativo: f.ativo, tag: f.tag, stageId: f.stageId, totalRespostas: total, createdAt: f.createdAt, updatedAt: f.updatedAt };
  }

  private async validarMontagem(tenantId: string, campos: CampoPublico[], ativo: boolean): Promise<void> {
    const defs = (await this.camposCustom.list(tenantId, 'contact', false)).map((d) => ({ chave: d.chave, tipo: d.tipo, rotulo: d.rotulo }));
    const problemas = problemasDosCampos(campos, defs, ativo);
    if (problemas.length) throw new BadRequestException({ message: problemas[0], code: 'formulario_invalido', problemas });
  }

  async listar(tenantId: string): Promise<FormView[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.form.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { envios: true } } } });
      return rows.map((r) => this.view(r, r._count.envios));
    });
  }

  async obter(tenantId: string, id: string): Promise<FormView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const f = await tx.form.findUnique({ where: { id }, include: { _count: { select: { envios: true } } } });
      if (!f) throw new NotFoundException('formulário inexistente');
      return this.view(f, f._count.envios);
    });
  }

  async criar(tenantId: string, identityId: string, bruto: unknown): Promise<FormView> {
    const p = CriarFormSchema.safeParse(bruto);
    if (!p.success) throw erroZod(p.error);
    const input = p.data;
    const campos = input.campos ?? camposPadrao();
    const ativo = input.ativo ?? true;
    await this.validarMontagem(tenantId, campos, ativo);
    // Slug padrão com sufixo aleatório: o link é público e único entre contas.
    const slug = input.slug ?? `${slugDe(input.nome)}-${randomBytes(3).toString('hex')}`;
    try {
      const f = await this.prisma.withTenant(tenantId, (tx) =>
        tx.form.create({
          data: {
            tenantId, nome: input.nome, slug, campos: campos as unknown as Prisma.InputJsonValue,
            estilo: (input.estilo ?? {}) as Prisma.InputJsonValue, ativo, tag: input.tag ?? null, stageId: input.stageId ?? null, createdBy: identityId,
          },
        }),
      );
      return this.view(f);
    } catch (e) {
      throw this.traduzirErroGravacao(e);
    }
  }

  async atualizar(tenantId: string, id: string, bruto: unknown): Promise<FormView> {
    const p = AtualizarFormSchema.safeParse(bruto);
    if (!p.success) throw erroZod(p.error);
    const input = p.data;
    const atual = await this.obter(tenantId, id);
    const campos = input.campos ?? atual.campos;
    const ativo = input.ativo ?? atual.ativo;
    await this.validarMontagem(tenantId, campos, ativo);
    try {
      const f = await this.prisma.withTenant(tenantId, (tx) =>
        tx.form.update({
          where: { id },
          data: {
            ...(input.nome !== undefined ? { nome: input.nome } : {}),
            ...(input.slug !== undefined ? { slug: input.slug } : {}),
            ...(input.campos !== undefined ? { campos: input.campos as unknown as Prisma.InputJsonValue } : {}),
            ...(input.estilo !== undefined ? { estilo: input.estilo as Prisma.InputJsonValue } : {}),
            ...(input.ativo !== undefined ? { ativo: input.ativo } : {}),
            ...(input.tag !== undefined ? { tag: input.tag } : {}),
            ...(input.stageId !== undefined ? { stageId: input.stageId } : {}),
            updatedAt: new Date(),
          },
        }),
      );
      return this.view(f, atual.totalRespostas);
    } catch (e) {
      throw this.traduzirErroGravacao(e);
    }
  }

  private traduzirErroGravacao(e: unknown): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return new ConflictException({ message: 'esse link já está em uso: escolha outro', code: 'slug_em_uso' });
    if (ehErroReferencia(e)) return new BadRequestException('etapa do funil inexistente');
    return e;
  }

  async remover(tenantId: string, id: string): Promise<{ ok: true }> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const r = await tx.form.deleteMany({ where: { id } });
      if (!r.count) throw new NotFoundException('formulário inexistente');
      return { ok: true as const };
    });
  }

  async respostas(tenantId: string, id: string, opts: { cursor?: string; limite?: number } = {}) {
    const limite = Math.min(Math.max(opts.limite ?? 50, 1), 200);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const f = await tx.form.findUnique({ where: { id }, select: { id: true } });
      if (!f) throw new NotFoundException('formulário inexistente');
      const rows = await tx.formSubmission.findMany({
        where: { formId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limite + 1,
        ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
        select: { id: true, contactId: true, dealId: true, respostas: true, utm: true, createdAt: true },
      });
      const items = rows.slice(0, limite).map((r) => ({ ...r, respostas: objeto(r.respostas), utm: objeto(r.utm) }));
      return { items, nextCursor: rows.length > limite ? items[items.length - 1].id : null };
    });
  }

  /** CSV completo (até 10 mil envios por exportação). */
  async csv(tenantId: string, id: string): Promise<{ nome: string; conteudo: string }> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const f = await tx.form.findUnique({ where: { id }, select: { nome: true, campos: true } });
      if (!f) throw new NotFoundException('formulário inexistente');
      const envios = await tx.formSubmission.findMany({ where: { formId: id }, orderBy: { createdAt: 'desc' }, take: 10_000, select: { createdAt: true, respostas: true, utm: true } });
      const conteudo = linhasCsv(camposDoBanco(f.campos), envios.map((e) => ({ createdAt: e.createdAt, respostas: objeto(e.respostas), utm: objeto(e.utm) })), celulaCsv);
      return { nome: slugDe(f.nome), conteudo };
    });
  }

  // ------------------------------------------------------------------ público

  private async resolver(slug: string): Promise<{ tenantId: string; formId: string; tenantNome: string } | null> {
    if (!/^[a-z0-9-]{4,64}$/.test(slug)) return null;
    const rows = await this.prisma.$queryRaw<{ tenant_id: string; form_id: string; tenant_nome: string }[]>`SELECT * FROM resolve_form_by_slug(${slug})`;
    const r = rows[0];
    return r?.tenant_id ? { tenantId: r.tenant_id, formId: r.form_id, tenantNome: r.tenant_nome } : null;
  }

  /** Só o necessário para renderizar: sem mapeamento, tag, etapa ou ids internos. */
  async publico(slug: string, ctx: ContextoPublico) {
    await this.limite.consumir(`form-get:${ctx.ip}`, 120, 60);
    const rota = await this.resolver(slug);
    if (!rota) throw new NotFoundException('formulário não encontrado');
    const f = await this.prisma.withTenant(rota.tenantId, (tx) => tx.form.findUnique({ where: { id: rota.formId }, select: { nome: true, campos: true, estilo: true } }));
    if (!f) throw new NotFoundException('formulário não encontrado');
    return {
      nome: f.nome,
      campos: camposDoBanco(f.campos).map(campoParaPublico),
      estilo: estiloDoBanco(f.estilo),
      marca: { nome: rota.tenantNome },
      carimbo: emitirCarimbo(`form:${rota.formId}`),
    };
  }

  async enviar(slug: string, bruto: unknown, ctx: ContextoPublico) {
    const rota = await this.resolver(slug);
    if (!rota) throw new NotFoundException('formulário não encontrado');
    const { tenantId, formId } = rota;
    // Por formulário e no total do IP: um robô não troca de formulário para escapar.
    await this.limite.consumir(`form-post:${formId}:${ctx.ip}`, 5, 600);
    await this.limite.consumir(`form-post-ip:${ctx.ip}`, 20, 600);

    const p = EnvioPublicoSchema.safeParse(bruto);
    if (!p.success) throw new BadRequestException('envio inválido');
    const corpo = p.data;

    const f = await this.prisma.withTenant(tenantId, (tx) => tx.form.findUnique({ where: { id: formId }, select: { nome: true, campos: true, estilo: true, tag: true, stageId: true } }));
    if (!f) throw new NotFoundException('formulário não encontrado');
    const estilo = estiloDoBanco(f.estilo);
    const sucesso = { ok: true as const, mensagem: estilo.mensagemSucesso || 'Recebemos suas informações. Obrigado!', redirecionarUrl: estilo.redirecionarUrl ?? null };

    const robo = avaliarAntiRobo(`form:${formId}`, { isca: corpo.website, carimbo: corpo.carimbo });
    if (robo === 'isca') {
      // Resposta idêntica à de sucesso: o robô não aprende que foi barrado.
      this.log.warn(`envio do form ${formId} descartado: campo isca preenchido`);
      return sucesso;
    }
    if (robo === 'carimbo_invalido') throw new BadRequestException({ message: 'A página expirou. Recarregue e envie de novo.', code: 'carimbo_invalido' });
    if (robo === 'rapido') throw new BadRequestException({ message: 'Envio rápido demais. Confira os dados e envie de novo em alguns segundos.', code: 'envio_rapido' });

    const campos = camposDoBanco(f.campos);
    const v = validarRespostas(campos, corpo.respostas);
    if (!v.ok) throw new BadRequestException({ message: v.erros[0].erro === 'campo obrigatório' ? `Preencha "${v.erros[0].rotulo}"` : `${v.erros[0].rotulo}: ${v.erros[0].erro}`, code: 'respostas_invalidas', campos: v.erros });

    const dados = dadosDoContato(campos, v.valores);
    if (!dados.email && !dados.telefone) {
      const alvo = campos.find((c) => c.mapear?.tipo === 'nativo' && (c.mapear.campo === 'email' || c.mapear.campo === 'telefone'));
      throw new BadRequestException({ message: 'Informe seu e-mail ou telefone.', code: 'respostas_invalidas', campos: alvo ? [{ campo: alvo.id, rotulo: alvo.rotulo, erro: 'informe e-mail ou telefone' }] : [] });
    }

    // Duplo clique / reenvio da mesma abertura: o carimbo vale UMA gravação.
    const nonce = await this.redis.incrWithTtl(`form-nonce:${createHash('sha256').update(corpo.carimbo ?? '').digest('hex')}`, 86_400);
    if (nonce !== null && nonce > 1) return sucesso;

    const origem = `Formulário: ${f.nome}`.slice(0, 80);
    let contato: { contactId: string; criado: boolean };
    try {
      contato = await this.leads.capturar(tenantId, {
        origem,
        nome: dados.nome, email: dados.email, telefone: dados.telefone, empresa: dados.empresa,
        camposCustom: dados.camposCustom,
        tags: f.tag ? [f.tag] : [],
        consentimento: dados.consentimento ? { baseLegal: 'consentimento', origem: `formulario:${formId}`, texto: dados.consentimento.texto } : null,
      });
    } catch (e) {
      throw this.traduzirErroCampos(e, campos);
    }

    let dealId: string | null = null;
    if (f.stageId) {
      try {
        const d = await this.crm.createDeal(tenantId, { titulo: `${dados.nome ?? dados.email ?? dados.telefone} (${f.nome})`.slice(0, 200), contactId: contato.contactId, stageId: f.stageId, origem });
        dealId = d.id;
      } catch (e) {
        // Etapa apagada depois de configurar: o envio NÃO se perde por isso.
        this.log.warn(`form ${formId}: negócio não criado (${(e as Error).message})`);
      }
    }

    const submissionId = randomUUID();
    const utm = extrairUtm(corpo);
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.formSubmission.create({
        data: {
          id: submissionId, tenantId, formId, contactId: contato.contactId, dealId,
          respostas: v.valores as Prisma.InputJsonValue, utm: utm as Prisma.InputJsonValue,
          ipHash: hashIp(tenantId, ctx.ip), userAgent: ctx.userAgent,
        },
      });
      // Mesmo commit do envio: o gatilho `formulario_enviado` nunca vê envio sem evento nem evento sem envio.
      await tx.outboxEvent.create({
        data: {
          tenantId, kind: EVENTO_FORM_ENVIADO, dedupeKey: `${EVENTO_FORM_ENVIADO}:${submissionId}`,
          payload: { formId, formNome: f.nome, submissionId, contactId: contato.contactId, contatoCriado: contato.criado, dealId, respostas: v.valores, utm } as Prisma.InputJsonValue,
        },
      });
    });
    this.log.log(`form ${formId} enviado (tenant ${tenantId}, contato ${contato.contactId}${contato.criado ? ' novo' : ''})`);
    return sucesso;
  }

  /** 400 do validador de campos personalizados (chaves do CRM) → ids das perguntas. */
  private traduzirErroCampos(e: unknown, campos: CampoPublico[]): unknown {
    if (!(e instanceof HttpException) || e.getStatus() !== 400) return e;
    const corpo = e.getResponse() as { campos?: { chave: string; erro: string }[] };
    if (!Array.isArray(corpo?.campos)) return e;
    const erros: ErroResposta[] = corpo.campos.map((c) => {
      const campo = campos.find((x) => x.mapear?.tipo === 'custom' && x.mapear.chave === c.chave);
      return { campo: campo?.id ?? c.chave, rotulo: campo?.rotulo ?? c.chave, erro: c.erro };
    });
    return new BadRequestException({ message: erros[0] ? `${erros[0].rotulo}: ${erros[0].erro}` : 'respostas inválidas', code: 'respostas_invalidas', campos: erros });
  }
}
