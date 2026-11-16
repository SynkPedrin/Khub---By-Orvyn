import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RunsService } from './runs.service';
import { grafoSchema, validarConfig, type Grafo, type No } from './catalogo';
import { contatoDoRegistro } from './contexto';
import { diasNoMes, fusoOuPadrao, isoData, janelaUnica, partesNoFuso, proximaJanela, somarDias, type Recorrencia } from './tempo';

/** Gatilhos por TEMPO (Q3.2): têm linha em `workflow_schedules` (db/057). */
export const GATILHOS_AGENDADOS = ['gatilho.agendado', 'gatilho.data_contato'] as const;
type TipoAgendado = (typeof GATILHOS_AGENDADOS)[number];
const TIPO_LINHA: Record<TipoAgendado, 'agendado' | 'data_contato'> = { 'gatilho.agendado': 'agendado', 'gatilho.data_contato': 'data_contato' };

/** Teto de contatos por janela/varredura: segmento grande deve passar pelo nó "Liberar em lotes". */
export const MAX_CONTATOS_POR_JANELA = 2000;
/** Janela perdida (worker parado) há mais que isso não dispara: "Bom dia" às 23h é pior que nada. */
const TOLERANCIA_MS: Record<'agendado' | 'data_contato', number> = { agendado: 6 * 3_600_000, data_contato: 20 * 3_600_000 };
/** Lease da linha durante o disparo: outro worker não pega a mesma janela. */
const LEASE_MS = 5 * 60_000;

export interface CfgAgendado extends Recorrencia {
  fuso?: string;
  alvo: 'sem_contato' | 'segmento';
  tags: string[];
  stageId?: string;
}
export interface CfgDataContato {
  campo: string;
  quando: 'antes' | 'no_dia' | 'depois';
  dias: number;
  hora: string;
  anual: boolean;
  fuso?: string;
}

/**
 * Próximo disparo do nó estritamente depois de `depois`. data_contato =
 * varredura diária na hora configurada. `null` = não há próximo (agendado
 * `uma_vez` que já passou ou já disparou): a linha da agenda sai.
 */
export function proximoDoNo(tipo: TipoAgendado, cfg: CfgAgendado | CfgDataContato, fuso: string, depois: Date): Date | null {
  if (tipo === 'gatilho.agendado') {
    const c = cfg as CfgAgendado;
    return c.frequencia === 'uma_vez' ? janelaUnica(c, fuso, depois) : proximaJanela(c, fuso, depois);
  }
  return proximaJanela({ frequencia: 'diario', hora: (cfg as CfgDataContato).hora, diasSemana: [], diaMes: 1 }, fuso, depois);
}

/**
 * Data que o campo do contato precisa ter para disparar HOJE (no fuso):
 * "3 dias antes" do aniversário = aniversário daqui a 3 dias.
 */
export function dataAlvo(cfg: Pick<CfgDataContato, 'quando' | 'dias'>, janela: Date, fuso: string): { ano: number; mes: number; dia: number } {
  const hoje = partesNoFuso(janela, fuso);
  const n = cfg.quando === 'antes' ? cfg.dias : cfg.quando === 'depois' ? -cfg.dias : 0;
  return somarDias(hoje.ano, hoje.mes, hoje.dia, n);
}

/** "MM-DD" que casam com o alvo. Nascido em 29/02 faz aniversário em 28/02 quando o ano não é bissexto. */
export function diasMesQueCasam(alvo: { ano: number; mes: number; dia: number }): string[] {
  const mmdd = `${String(alvo.mes).padStart(2, '0')}-${String(alvo.dia).padStart(2, '0')}`;
  return alvo.mes === 2 && alvo.dia === 28 && diasNoMes(alvo.ano, 2) === 28 ? [mmdd, '02-29'] : [mmdd];
}

/**
 * Regrava a agenda do fluxo a partir da versão ATIVA (chamado na mesma
 * transação de publicar, rollback, pausar/ativar). Pausado, sem versão ou sem
 * gatilho por tempo = nenhuma linha: despublicar remove o agendamento.
 */
export async function sincronizarAgendas(tx: Prisma.TransactionClient, tenantId: string, workflowId: string, agora = new Date()): Promise<number> {
  await tx.workflowSchedule.deleteMany({ where: { workflowId } });
  const wf = await tx.workflow.findUnique({ where: { id: workflowId }, select: { status: true, timezone: true, versaoAtiva: { select: { id: true, grafo: true } } } });
  if (!wf || wf.status !== 'ativo' || !wf.versaoAtiva) return 0;
  const g = grafoSchema.safeParse(wf.versaoAtiva.grafo);
  if (!g.success) return 0;
  let n = 0;
  for (const no of g.data.nos) {
    if (!(GATILHOS_AGENDADOS as readonly string[]).includes(no.tipo)) continue;
    const tipo = no.tipo as TipoAgendado;
    const v = validarConfig(tipo, no.config);
    if (!v.ok) continue; // a publicação já recusa config inválida; rollback para versão antiga não derruba a transação
    const cfg = v.dados as CfgAgendado | CfgDataContato;
    const fuso = fusoOuPadrao(cfg.fuso || wf.timezone);
    const proximoEm = proximoDoNo(tipo, cfg, fuso, agora);
    if (!proximoEm) continue; // "uma vez" com data que já passou: nada a agendar
    await tx.workflowSchedule.create({
      data: { tenantId, workflowId, versionId: wf.versaoAtiva.id, nodeId: no.id, tipo: TIPO_LINHA[tipo], proximoEm },
    });
    n++;
  }
  return n;
}

interface LinhaAgenda {
  workflow_id: string;
  version_id: string;
  node_id: string;
  tipo: 'agendado' | 'data_contato';
  proximo_em: Date;
}

/**
 * Varredura dos gatilhos por tempo (Q3.2). Chamada pelo reconcile do worker
 * (1x/min por tenant). Idempotente em três camadas: lease na linha (dois
 * workers não pegam a mesma janela), `dedupe_key` por fluxo+nó+janela(+contato)
 * no run, e `proximo_em` só avança depois do disparo — se cair no meio, a
 * próxima varredura refaz a MESMA janela sem duplicar ninguém.
 */
@Injectable()
export class AgendadorService {
  private readonly log = new Logger('Automations');

  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: RunsService,
  ) {}

  async varrer(tenantId: string, agora = new Date()): Promise<{ janelas: number; runs: number }> {
    const linhas = await this.prisma.withTenant(tenantId, (tx) => tx.$queryRaw<LinhaAgenda[]>`
      UPDATE workflow_schedules SET lease_until = ${new Date(agora.getTime() + LEASE_MS)}, updated_at = now()
       WHERE proximo_em <= ${agora} AND (lease_until IS NULL OR lease_until < ${agora})
       RETURNING workflow_id, version_id, node_id, tipo, proximo_em`);
    let runs = 0;
    for (const l of linhas) {
      try {
        runs += await this.processarLinha(tenantId, l, agora);
      } catch (e) {
        // devolve a linha: a próxima varredura tenta a mesma janela (dedupe protege)
        await this.prisma.withTenant(tenantId, (tx) => tx.workflowSchedule.updateMany({ where: { workflowId: l.workflow_id, nodeId: l.node_id }, data: { leaseUntil: null } }));
        this.log.error(`agenda do fluxo ${l.workflow_id} (nó ${l.node_id}) falhou: ${(e as Error).message}`);
      }
    }
    return { janelas: linhas.length, runs };
  }

  private async processarLinha(tenantId: string, l: LinhaAgenda, agora: Date): Promise<number> {
    const onde = { workflowId: l.workflow_id, nodeId: l.node_id };
    const wf = await this.prisma.withTenant(tenantId, (tx) =>
      tx.workflow.findUnique({ where: { id: l.workflow_id }, select: { status: true, timezone: true, versaoAtivaId: true, versaoAtiva: { select: { id: true, grafo: true } } } }),
    );
    const grafo = wf?.versaoAtiva ? grafoSchema.safeParse(wf.versaoAtiva.grafo) : null;
    const no = grafo?.success ? grafo.data.nos.find((n) => n.id === l.node_id) : undefined;
    const tipo = no?.tipo as TipoAgendado | undefined;
    const v = no && tipo && (GATILHOS_AGENDADOS as readonly string[]).includes(tipo) ? validarConfig(tipo, no.config) : null;
    // linha órfã (fluxo pausado/republicado por fora, nó removido): sai da agenda
    if (!wf || wf.status !== 'ativo' || wf.versaoAtivaId !== l.version_id || !no || !tipo || !v?.ok || !grafo?.success) {
      await this.prisma.withTenant(tenantId, (tx) => tx.workflowSchedule.deleteMany({ where: onde }));
      return 0;
    }
    const cfg = v.dados as CfgAgendado | CfgDataContato;
    const fuso = fusoOuPadrao(cfg.fuso || wf.timezone);
    const janela = l.proximo_em;

    let abertos = 0;
    if (agora.getTime() - janela.getTime() <= TOLERANCIA_MS[l.tipo]) {
      abertos = tipo === 'gatilho.agendado'
        ? await this.dispararAgendado(tenantId, l, grafo.data, no, cfg as CfgAgendado, janela)
        : await this.dispararDataContato(tenantId, l, grafo.data, no, cfg as CfgDataContato, janela, fuso);
    } else {
      this.log.warn(`agenda do fluxo ${l.workflow_id}: janela ${janela.toISOString()} perdida (worker parado), pulando para a próxima`);
    }

    const depois = new Date(Math.max(agora.getTime(), janela.getTime()));
    const proximoEm = proximoDoNo(tipo, cfg, fuso, depois);
    await this.prisma.withTenant(tenantId, (tx) => proximoEm
      ? tx.workflowSchedule.updateMany({ where: onde, data: { proximoEm, ultimaJanela: janela, leaseUntil: null, updatedAt: new Date() } })
      // "uma vez": já disparou (ou perdeu a janela), não volta mais
      : tx.workflowSchedule.deleteMany({ where: onde }));
    return abertos;
  }

  private async dispararAgendado(tenantId: string, l: LinhaAgenda, grafo: Grafo, no: No, cfg: CfgAgendado, janela: Date): Promise<number> {
    const iso = janela.toISOString();
    const base = { tenantId, workflowId: l.workflow_id, versionId: l.version_id, gatilho: 'gatilho.agendado', grafo, noInicial: no.id };
    if (cfg.alvo === 'sem_contato') {
      const r = await this.runs.iniciar({ ...base, contexto: { gatilho: { janela: iso } }, dedupeKey: `agendado:${no.id}:${iso}` });
      return 'runId' in r ? 1 : 0;
    }
    const tags = cfg.tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
    const contatos = await this.prisma.withTenant(tenantId, async (tx) => {
      const ids = await tx.$queryRaw<{ id: string }[]>`
        SELECT c.id FROM contacts c
         WHERE (cardinality(${tags}::text[]) = 0 OR EXISTS (SELECT 1 FROM unnest(c.tags) t WHERE lower(t) = ANY(${tags}::text[])))
           AND (${cfg.stageId ?? null}::uuid IS NULL OR EXISTS (
                SELECT 1 FROM deals d WHERE d.contact_id = c.id AND d.stage_id = ${cfg.stageId ?? null}::uuid AND d.status = 'aberto'))
         ORDER BY c.id
         LIMIT ${MAX_CONTATOS_POR_JANELA + 1}`;
      if (ids.length > MAX_CONTATOS_POR_JANELA) this.log.warn(`fluxo ${l.workflow_id}: segmento acima de ${MAX_CONTATOS_POR_JANELA} contatos, excedente fica para a próxima janela`);
      return tx.contact.findMany({ where: { id: { in: ids.slice(0, MAX_CONTATOS_POR_JANELA).map((x) => x.id) } } });
    });
    let n = 0;
    for (const c of contatos) {
      const r = await this.runs.iniciar({ ...base, contexto: { contato: contatoDoRegistro(c), gatilho: { janela: iso } }, dedupeKey: `agendado:${no.id}:${iso}:${c.id}` });
      if ('runId' in r) n++;
    }
    return n;
  }

  private async dispararDataContato(tenantId: string, l: LinhaAgenda, grafo: Grafo, no: No, cfg: CfgDataContato, janela: Date, fuso: string): Promise<number> {
    const alvo = dataAlvo(cfg, janela, fuso);
    const isoAlvo = isoData(alvo.ano, alvo.mes, alvo.dia);
    const mmdds = diasMesQueCasam(alvo);
    let condicao: Prisma.Sql;
    if (cfg.campo === 'contato.criadoEm') {
      condicao = cfg.anual
        ? Prisma.sql`to_char(c.created_at AT TIME ZONE ${fuso}, 'MM-DD') = ANY(${mmdds}::text[]) AND extract(year FROM c.created_at AT TIME ZONE ${fuso}) < ${alvo.ano}`
        : Prisma.sql`to_char(c.created_at AT TIME ZONE ${fuso}, 'YYYY-MM-DD') = ${isoAlvo}`;
    } else {
      const chave = cfg.campo.slice('contato.campos.'.length);
      const valor = Prisma.sql`(c.campos_custom->>${chave})`;
      condicao = cfg.anual
        ? Prisma.sql`${valor} ~ '^\\d{4}-\\d{2}-\\d{2}$' AND substr(${valor}, 6, 5) = ANY(${mmdds}::text[])`
        : Prisma.sql`${valor} = ${isoAlvo}`;
    }
    const contatos = await this.prisma.withTenant(tenantId, async (tx) => {
      const ids = await tx.$queryRaw<{ id: string }[]>`SELECT c.id FROM contacts c WHERE ${condicao} ORDER BY c.id LIMIT ${MAX_CONTATOS_POR_JANELA}`;
      return ids.length ? tx.contact.findMany({ where: { id: { in: ids.map((x) => x.id) } } }) : [];
    });
    const chaveData = cfg.anual ? String(alvo.ano) : isoAlvo;
    let n = 0;
    for (const c of contatos) {
      const r = await this.runs.iniciar({
        tenantId, workflowId: l.workflow_id, versionId: l.version_id, gatilho: 'gatilho.data_contato', grafo, noInicial: no.id,
        contexto: { contato: contatoDoRegistro(c), gatilho: { campo: cfg.campo, data: isoAlvo } },
        // "não dispara 2x no mesmo ano/data": a chave é do contato + ano (anual) ou + data
        dedupeKey: `data_contato:${no.id}:${c.id}:${chaveData}`,
      });
      if ('runId' in r) n++;
    }
    return n;
  }
}
