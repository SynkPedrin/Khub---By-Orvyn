import { UnrecoverableError } from 'bullmq';
import { HttpException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { CrmService, UpdateContactInput } from '../crm/crm.service';
import { camposDe, validarCamposNaTransacao, type CustomFieldsService } from '../crm/custom-fields.service';
import { resolverMotivoPerda } from '../crm/lost-reasons.service';
import type { FiltroEvento, No } from './catalogo';
import type { Contexto, ResultadoNo } from './executor.service';
import { contatoDoRegistro, negocioDoRegistro } from './contexto';
import { alvoComDeslocamento, fusoOuPadrao, hhmm, instanteNoFuso, lerData } from './tempo';

type Interpolar = (texto: string, ctx: Contexto) => string;
type LerCampo = (campo: string, ctx: Contexto) => unknown;

/** "Meta" com `seNaoAtingida: esperar` re-arma a espera a cada 30 dias (sem timer na memória). */
export const ESPERA_META_MS = 30 * 86_400_000;

const STATUS_ATIVOS = ['rodando', 'esperando'];

/**
 * Erro de dado/configuração (campo personalizado de tipo errado, usuário que
 * saiu da conta, negócio inexistente) não melhora com retry: vai direto à DLQ
 * com a causa legível, em vez de repetir 4 vezes.
 */
function semRetry(e: unknown): never {
  if (e instanceof HttpException) {
    const r = e.getResponse();
    const msg = typeof r === 'string' ? r : (r as { message?: unknown }).message;
    const campos = typeof r === 'object' && r && Array.isArray((r as { campos?: unknown }).campos)
      ? ((r as { campos: { chave: string; erro: string }[] }).campos).map((c) => `${c.chave}: ${c.erro}`).join('; ')
      : '';
    throw new UnrecoverableError([Array.isArray(msg) ? msg.join('; ') : String(msg ?? e.message), campos].filter(Boolean).join(' · '));
  }
  throw e;
}

/** Texto (com {{...}} já resolvido) → valor no formato que o validador do tipo aceita (db/053). */
export function converterValorCampo(tipo: string | undefined, texto: string): unknown {
  const t = texto.trim();
  if (t === '') return '';
  switch (tipo) {
    case 'multiselect':
      return t.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    case 'boolean': {
      const n = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      if (['sim', 'true', '1', 'yes', 's'].includes(n)) return true;
      if (['nao', 'false', '0', 'no', 'n'].includes(n)) return false;
      return t;
    }
    case 'date': {
      const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
      if (br) return `${br[3]}-${br[2]}-${br[1]}`;
      if (/^\d{4}-\d{2}-\d{2}T/.test(t)) return t.slice(0, 10);
      return t;
    }
    default:
      return t;
  }
}

/** "R$ 1.234,56" / "1234.56" / "1500" → número. null se não for número. */
export function lerNumero(v: string): number | null {
  let t = v.replace(/[R$\s]/g, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (t.includes(',')) t = t.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Nós da Q3.1 (+W4). Separados do ExecutorService para ele não virar um
 * arquivo de mil linhas; mesma regra: um nó por chamada, sem fila nem
 * próximo passo — quem orquestra é o RunsService.
 */
export class NosMotor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmService,
    private readonly camposCustom: CustomFieldsService,
    private readonly interpolar: Interpolar,
    private readonly lerCampo: LerCampo,
  ) {}

  // ------------------------------------------------------------- controle

  /**
   * "Esperar até". Data/campo: calcula o instante no fuso do fluxo e devolve a
   * espera (persistida no run como qualquer outra). Evento: roda duas vezes,
   * como o "Esperar resposta" — marca `aguardandoEvento`, e o RunsService
   * acorda o nó quando o evento chega (ramo `aconteceu`) ou o prazo vence
   * (`expirou`).
   */
  esperarAte(no: No, ctx: Contexto, agora = new Date()): ResultadoNo {
    const cfg = no.config as Record<string, unknown> & { modo: 'data' | 'campo' | 'evento' };
    const fuso = fusoOuPadrao(ctx.fuso);

    if (cfg.modo === 'evento') {
      if (ctx.aguardandoEvento === no.id && ctx.eventoOcorreu) {
        return { ramo: 'aconteceu', saida: { aconteceu: true, evento: cfg.evento }, contexto: { aguardandoEvento: null, eventoOcorreu: false } };
      }
      if (ctx.aguardandoEvento === no.id) {
        return { ramo: 'expirou', saida: { aconteceu: false, evento: cfg.evento }, contexto: { aguardandoEvento: null } };
      }
      const fator = { minutos: 60_000, horas: 3_600_000, dias: 86_400_000 }[cfg.unidade as 'minutos' | 'horas' | 'dias'] ?? 60_000;
      return {
        esperarMs: Number(cfg.duracao) * fator,
        mesmoNo: true,
        saida: { aguardandoEvento: cfg.evento, prazo: `${cfg.duracao} ${cfg.unidade}` },
        contexto: { aguardandoEvento: no.id, eventoOcorreu: false },
      };
    }

    const seJaPassou = (cfg.seJaPassou as 'seguir' | 'encerrar' | undefined) ?? 'seguir';
    if (cfg.modo === 'data') {
      const [ano, mes, dia] = String(cfg.data).split('-').map(Number);
      const { hora, minuto } = hhmm(String(cfg.hora ?? '09:00'));
      return this.ateInstante(instanteNoFuso(ano, mes, dia, hora, minuto, fuso), seJaPassou, agora);
    }

    const campo = String(cfg.campo) === 'agendamento.data' ? 'agendamento.inicio' : String(cfg.campo);
    const base = lerData(this.lerCampo(campo, ctx), fuso);
    if (!base) {
      // contato sem a data (ex.: aniversário em branco): não há o que esperar
      return seJaPassou === 'encerrar'
        ? { encerrar: true, saida: { semData: true, campo } }
        : { saida: { semData: true, campo } };
    }
    const alvo = alvoComDeslocamento(base, {
      deslocamento: Number(cfg.deslocamento ?? 0),
      unidade: (cfg.unidade as 'minutos' | 'horas' | 'dias') ?? 'dias',
      direcao: (cfg.direcao as 'antes' | 'depois') ?? 'antes',
      hora: cfg.hora as string | undefined,
    }, fuso);
    return this.ateInstante(alvo, seJaPassou, agora);
  }

  private ateInstante(alvo: Date, seJaPassou: 'seguir' | 'encerrar', agora: Date): ResultadoNo {
    const ms = alvo.getTime() - agora.getTime();
    if (ms > 1000) return { esperarMs: ms, saida: { ate: alvo.toISOString() } };
    return seJaPassou === 'encerrar'
      ? { encerrar: true, saida: { ate: alvo.toISOString(), jaPassou: true } }
      : { saida: { ate: alvo.toISOString(), jaPassou: true } };
  }

  /**
   * Meta (goal). O salto para cá acontece no RunsService (avisarEvento), que
   * grava o id em `metasAtingidas`. Chegando aqui pelo caminho normal: se a
   * meta já foi atingida, segue; senão aplica `seNaoAtingida`.
   */
  meta(no: No, ctx: Contexto): ResultadoNo {
    const cfg = no.config as unknown as FiltroEvento & { seNaoAtingida: 'seguir' | 'esperar' | 'encerrar' };
    if ((ctx.metasAtingidas ?? []).includes(no.id)) {
      return { saida: { atingida: true, evento: cfg.evento }, contexto: { aguardandoMeta: null } };
    }
    if (cfg.seNaoAtingida === 'encerrar') return { encerrar: true, saida: { atingida: false, motivo: 'meta não atingida' } };
    if (cfg.seNaoAtingida === 'esperar') {
      return { esperarMs: ESPERA_META_MS, mesmoNo: true, saida: { atingida: false, aguardando: cfg.evento }, contexto: { aguardandoMeta: no.id } };
    }
    return { saida: { atingida: false, seguiu: true } };
  }

  // ---------------------------------------------------------------- ações

  /** Cancela as execuções ativas do contato (este fluxo, fluxos escolhidos ou todos os outros). */
  async removerDeFluxo(tenantId: string, no: No, ctx: Contexto): Promise<ResultadoNo> {
    const cfg = no.config as { alvo: 'este' | 'outros' | 'todos'; workflowIds: string[] };
    if (!ctx.contato) throw new UnrecoverableError('nó "remover de fluxo" sem contato no contexto');
    const where: Prisma.WorkflowRunWhereInput = {
      contactId: ctx.contato.id,
      status: { in: STATUS_ATIVOS },
      ...(ctx.runId ? { id: { not: ctx.runId } } : {}),
      ...(cfg.alvo === 'este' ? { workflowId: ctx.workflowId } : cfg.alvo === 'outros' ? { workflowId: { in: cfg.workflowIds } } : {}),
    };
    const r = await this.prisma.withTenant(tenantId, (tx) =>
      tx.workflowRun.updateMany({ where, data: { status: 'cancelado', erro: 'removido do fluxo pela automação', finishedAt: new Date() } }),
    );
    if (cfg.alvo === 'este') return { encerrar: true, saida: { removido: 'este', cancelados: r.count } };
    return { saida: { removido: cfg.alvo, cancelados: r.count } };
  }

  /**
   * Dono do contato: fixo ou rodízio. Contador, checagem de membro e gravação
   * na MESMA transação — se a gravação falhar, o contador volta e o retry não
   * pula ninguém. Só membros que ainda estão na conta entram no rodízio.
   */
  async atribuirUsuario(tenantId: string, no: No, ctx: Contexto): Promise<ResultadoNo> {
    const cfg = no.config as { modo: 'fixo' | 'rodizio'; usuarioId?: string; usuarios: string[]; soSemDono: boolean; negocio: boolean };
    const contato = ctx.contato;
    if (!contato) throw new UnrecoverableError('nó "atribuir responsável" sem contato no contexto');

    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.contact.findUnique({ where: { id: contato.id }, select: { id: true, ownerId: true } });
      if (!atual) throw new UnrecoverableError('contato inexistente');
      if (cfg.soSemDono && atual.ownerId) return { pulado: true as const, ownerId: atual.ownerId };

      const candidatos = cfg.modo === 'fixo' ? [cfg.usuarioId!] : cfg.usuarios;
      const membros = await tx.membership.findMany({ where: { tenantId, identityId: { in: candidatos } }, select: { identityId: true } });
      const naConta = new Set(membros.map((m) => m.identityId));
      const ativos = candidatos.filter((id) => naConta.has(id));
      if (!ativos.length) throw new UnrecoverableError('nenhum dos usuários escolhidos é membro ativo da conta');

      let escolhido = ativos[0];
      let posicao: number | undefined;
      if (cfg.modo === 'rodizio') {
        if (!ctx.workflowId) throw new UnrecoverableError('rodízio sem fluxo no contexto');
        const rows = await tx.$queryRaw<{ contador: bigint }[]>`
          INSERT INTO workflow_round_robin (tenant_id, workflow_id, node_id, contador)
          VALUES (${tenantId}::uuid, ${ctx.workflowId}::uuid, ${no.id}, 1)
          ON CONFLICT (tenant_id, workflow_id, node_id)
          DO UPDATE SET contador = workflow_round_robin.contador + 1, updated_at = now()
          RETURNING contador`;
        posicao = Number(rows[0]?.contador ?? 1);
        escolhido = ativos[(posicao - 1) % ativos.length];
      }

      await tx.contact.update({ where: { id: contato.id }, data: { ownerId: escolhido, updatedAt: new Date() } });
      let dealId: string | null = null;
      if (cfg.negocio) {
        const aberto = (ctx.negocio
          ? await tx.deal.findFirst({ where: { id: ctx.negocio.id, status: 'aberto' }, select: { id: true } })
          : null) ?? await tx.deal.findFirst({ where: { contactId: contato.id, status: 'aberto' }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
        if (aberto) {
          await tx.deal.update({ where: { id: aberto.id }, data: { ownerId: escolhido, updatedAt: new Date() } });
          dealId = aberto.id;
        }
      }
      const user = await tx.user.findFirst({ where: { tenantId, identityId: escolhido }, select: { nome: true } });
      await tx.activity.create({
        data: { tenantId, actor: 'Automação', acao: `atribuiu o contato a ${user?.nome ?? 'um membro da equipe'}`, tone: 'neutral', contactId: contato.id },
      });
      return { pulado: false as const, ownerId: escolhido, dealId, posicao };
    });

    if (r.pulado) return { saida: { pulado: true, motivo: 'contato já tem responsável', ownerId: r.ownerId } };
    return {
      saida: { ownerId: r.ownerId, dealId: r.dealId, ...(r.posicao ? { posicaoRodizio: r.posicao } : {}) },
      contexto: {
        contato: { ...contato, ownerId: r.ownerId },
        ...(ctx.negocio && r.dealId === ctx.negocio.id ? { negocio: { ...ctx.negocio, ownerId: r.ownerId } } : {}),
      },
    };
  }

  /** Liga/desliga o "não perturbe" pelo serviço do CRM (mesma regra da tela e da ação em massa). */
  async naoPerturbe(tenantId: string, no: No, ctx: Contexto): Promise<ResultadoNo> {
    const { ativar } = no.config as { ativar: boolean };
    if (!ctx.contato) throw new UnrecoverableError('nó "não perturbe" sem contato no contexto');
    await this.crm.updateContact(tenantId, ctx.contato.id, { naoPerturbe: ativar }).catch(semRetry);
    return { saida: { naoPerturbe: ativar }, contexto: { contato: { ...ctx.contato, naoPerturbe: ativar } } };
  }

  /** Campo fixo + campos personalizados (validados pelo tipo) + tags. */
  async atualizarContato(tenantId: string, no: No, ctx: Contexto): Promise<ResultadoNo> {
    const cfg = no.config as {
      campo?: 'nome' | 'email' | 'telefone' | 'empresa' | 'tag' | 'valorEstimado';
      valor?: string;
      campos: { chave: string; valor: string }[];
      tagsAdicionar: string[];
      tagsRemover: string[];
    };
    const contato = ctx.contato;
    if (!contato) throw new UnrecoverableError('nó de atualização sem contato no contexto');

    const patch: UpdateContactInput = {};
    const saida: Record<string, unknown> = {};
    let novoContato: NonNullable<Contexto['contato']> = { ...contato };

    if (cfg.campo) {
      const v = this.interpolar(cfg.valor ?? '', ctx);
      if (cfg.campo === 'valorEstimado') {
        patch.valorEstimado = lerNumero(v) ?? 0;
        novoContato = { ...novoContato, valor: patch.valorEstimado };
      } else {
        patch[cfg.campo] = v;
        novoContato = { ...novoContato, [cfg.campo]: v };
      }
      saida.campo = cfg.campo;
      saida.valor = v;
    }

    if (cfg.tagsAdicionar.length || cfg.tagsRemover.length) {
      const atual = await this.prisma.withTenant(tenantId, (tx) => tx.contact.findUnique({ where: { id: contato.id }, select: { tags: true } }));
      const remover = new Set(cfg.tagsRemover.map((t) => this.interpolar(t, ctx).trim().toLowerCase()));
      const base = (atual?.tags ?? contato.tags ?? []).filter((t) => !remover.has(t.toLowerCase()));
      const tags = [...base];
      for (const t of cfg.tagsAdicionar.map((x) => this.interpolar(x, ctx).trim()).filter(Boolean)) {
        if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t);
      }
      patch.tags = tags;
      novoContato = { ...novoContato, tags };
      saida.tags = tags;
    }

    if (Object.keys(patch).length) await this.crm.updateContact(tenantId, contato.id, patch).catch(semRetry);

    if (cfg.campos.length) {
      const valores = await this.valoresDosCampos(tenantId, 'contact', cfg.campos, ctx);
      const r = await this.camposCustom.atualizarCamposContato(tenantId, contato.id, valores).catch(semRetry);
      saida.camposAlterados = r.alterados;
      novoContato = { ...novoContato, campos: { ...(novoContato.campos ?? {}), ...valores } };
    }
    return { saida, contexto: { contato: novoContato } };
  }

  /** Valor, status (+ motivo de perda), etapa, dono e campos do negócio do contexto, numa transação. */
  async atualizarNegocio(tenantId: string, no: No, ctx: Contexto): Promise<ResultadoNo> {
    const cfg = no.config as {
      valor?: string; status?: 'aberto' | 'ganho' | 'perdido'; motivoPerdaId?: string; stageId?: string;
      dono: 'manter' | 'usuario' | 'contato' | 'nenhum'; ownerId?: string; campos: { chave: string; valor: string }[];
    };
    const negocio = ctx.negocio;
    if (!negocio) throw new UnrecoverableError('nó "atualizar negócio" sem negócio no contexto');

    let valor: number | undefined;
    if (cfg.valor !== undefined && cfg.valor.trim() !== '') {
      const texto = this.interpolar(cfg.valor, ctx);
      const n = lerNumero(texto);
      if (n === null || n < 0) throw new UnrecoverableError(`valor do negócio inválido: "${texto}"`);
      valor = n;
    }
    const valoresCampos = cfg.campos.length ? await this.valoresDosCampos(tenantId, 'deal', cfg.campos, ctx) : null;

    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.deal.findUnique({ where: { id: negocio.id }, select: { id: true, titulo: true, status: true, stageId: true, contactId: true, camposCustom: true, ownerId: true } });
      if (!atual) throw new UnrecoverableError('negócio inexistente');
      const data: Prisma.DealUncheckedUpdateInput = { updatedAt: new Date() };
      if (valor !== undefined) data.valor = valor;
      if (cfg.status) {
        data.status = cfg.status;
        // automação é "sistema": não exige motivo (regra da db/051), mas o informado precisa existir e estar ativo
        data.motivoPerdaId = cfg.status === 'perdido' ? await resolverMotivoPerda(tx, tenantId, cfg.motivoPerdaId, false).catch(semRetry) : null;
      }
      if (cfg.stageId) {
        const stage = await tx.stage.findUnique({ where: { id: cfg.stageId }, select: { id: true, pipelineId: true } });
        if (!stage) throw new UnrecoverableError('etapa inexistente');
        data.stageId = stage.id;
        data.pipelineId = stage.pipelineId;
      }
      if (cfg.dono === 'nenhum') data.ownerId = null;
      if (cfg.dono === 'usuario') {
        const m = await tx.membership.findUnique({ where: { identityId_tenantId: { identityId: cfg.ownerId!, tenantId } }, select: { id: true } });
        if (!m) throw new UnrecoverableError('o novo dono não é membro ativo da conta');
        data.ownerId = cfg.ownerId!;
      }
      if (cfg.dono === 'contato') {
        const c = atual.contactId ? await tx.contact.findUnique({ where: { id: atual.contactId }, select: { ownerId: true } }) : null;
        data.ownerId = c?.ownerId ?? null;
      }
      if (valoresCampos) {
        data.camposCustom = (await validarCamposNaTransacao(tx, 'deal', valoresCampos, { atuais: camposDe(atual.camposCustom) }).catch(semRetry)) as Prisma.InputJsonValue;
      }
      const d = await tx.deal.update({ where: { id: negocio.id }, data });
      await tx.activity.create({ data: { tenantId, actor: 'Automação', acao: `atualizou o negócio "${atual.titulo}"`, tone: 'neutral', dealId: negocio.id } });
      return d;
    });

    const novo = negocioDoRegistro(r);
    return {
      saida: { dealId: r.id, valor: novo.valor, status: novo.status, stageId: novo.stageId, ownerId: novo.ownerId },
      contexto: { negocio: novo },
    };
  }

  /** `{chave, valor}` da config → valores tipados pela definição (multiselect, sim/não, data BR). */
  private async valoresDosCampos(tenantId: string, entidade: 'contact' | 'deal', campos: { chave: string; valor: string }[], ctx: Contexto): Promise<Record<string, unknown>> {
    const defs = await this.camposCustom.list(tenantId, entidade, false);
    const tipo = new Map(defs.map((d) => [d.chave, d.tipo]));
    const out: Record<string, unknown> = {};
    for (const c of campos) out[c.chave] = converterValorCampo(tipo.get(c.chave), this.interpolar(c.valor, ctx));
    return out;
  }

  /**
   * Condição lê o estado ATUAL do contato/negócio (tags, dono, não perturbe,
   * campos) — depois de uma espera de 3 dias, o contexto do gatilho já mentiu.
   */
  async contextoAtual(tenantId: string, ctx: Contexto): Promise<Contexto> {
    if (!ctx.contato?.id && !ctx.negocio?.id) return ctx;
    return this.prisma.withTenant(tenantId, async (tx) => {
      const c = ctx.contato?.id ? await tx.contact.findUnique({ where: { id: ctx.contato.id } }) : null;
      const d = ctx.negocio?.id ? await tx.deal.findUnique({ where: { id: ctx.negocio.id } }) : null;
      return {
        ...ctx,
        ...(c?.id ? { contato: contatoDoRegistro(c) } : {}),
        ...(d?.id ? { negocio: negocioDoRegistro(d) } : {}),
      };
    });
  }
}
