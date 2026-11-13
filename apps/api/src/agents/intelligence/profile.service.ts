import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CrmService } from '../../crm/crm.service';
import { CAMPOS_PERFIL, type AgentConfig, type CampoPerfil } from '../config/agent-config';
import { decidirExtracao, valorTexto, type Decisao, type FatoAtual } from '../engines/profile-policy';
import type { Analise } from '../engines/analysis';

export interface FatoPerfil extends FatoAtual {
  campo: string;
  atualizadoEm: Date;
}

/** O que o Intelligence Core sabe do contato (memória operacional + longo prazo estruturado). */
export interface PerfilContexto {
  contactId: string | null;
  resumo: string;
  etapa: string | null;
  temperatura: string | null;
  intencao: string | null;
  proximaAcao: string | null;
  convertido: boolean;
  fatos: Map<string, FatoPerfil>;
}

export interface DecisaoExtracao {
  campo: string;
  valor: string;
  origem: 'declarado' | 'inferido';
  confianca: number;
  decisao: Decisao | 'sincronizado_crm';
  motivo: string;
}

export function perfilVazio(contactId: string | null = null): PerfilContexto {
  return { contactId, resumo: '', etapa: null, temperatura: null, intencao: null, proximaAcao: null, convertido: false, fatos: new Map() };
}

/** Mapa campo → texto, para regras e prompt. */
export function fatosComoTexto(p: PerfilContexto): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [campo, f] of p.fatos) if (f.status !== 'rejeitado') out[campo] = valorTexto(f.valor);
  return out;
}

const RE_SO_TELEFONE = /^[\d\s()+-]{6,}$/;

/**
 * CUSTOMER INTELLIGENCE PROFILE (docs/AI_AGENT_ARCHITECTURE.md §8)
 *
 * Um perfil por contato (compartilhado pelos agentes do tenant) com fatos que
 * guardam valor, origem, confiança e status de confirmação. Toda extração —
 * aplicada ou não — vai para `agent_extractions` (auditoria/aprendizado).
 *
 * Sincronização com o CRM: só fato DECLARADO e confirmado, só nos campos
 * liberados em `crm.sincronizarContato`, e nunca por cima de valor que um
 * humano já preencheu (exceto nome que ainda é só o telefone).
 */
@Injectable()
export class ProfileService {
  private readonly log = new Logger('AgentProfile');

  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmService,
  ) {}

  async carregar(tenantId: string, contactId: string | null): Promise<PerfilContexto> {
    if (!contactId) return perfilVazio();
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [perfil, fatos, deal] = await Promise.all([
        tx.agentCustomerProfile.findUnique({ where: { tenantId_contactId: { tenantId, contactId } } }),
        tx.agentProfileFact.findMany({ where: { contactId } }),
        tx.deal.findFirst({ where: { contactId }, orderBy: { updatedAt: 'desc' }, select: { status: true, stage: { select: { nome: true } } } }),
      ]);
      const mapa = new Map<string, FatoPerfil>();
      for (const f of fatos) {
        mapa.set(f.campo, { campo: f.campo, valor: f.valor, origem: f.origem as FatoAtual['origem'], confianca: Number(f.confianca), status: f.status as FatoAtual['status'], atualizadoEm: f.atualizadoEm });
      }
      return {
        contactId,
        resumo: perfil?.resumo ?? '',
        etapa: deal?.stage.nome ?? perfil?.etapa ?? null,
        temperatura: perfil?.temperatura ?? null,
        intencao: perfil?.intencao ?? null,
        proximaAcao: perfil?.proximaAcao ?? null,
        convertido: !!perfil?.convertidoEm || deal?.status === 'ganho',
        fatos: mapa,
      };
    });
  }

  /**
   * Aplica a análise de uma mensagem ao perfil. Em simulação, decide e devolve
   * as decisões SEM gravar — e atualiza o perfil em memória (para o turno
   * seguinte do simulador enxergar o que foi "aprendido").
   */
  async aplicarAnalise(
    i: { tenantId: string; contactId: string | null; agentId: string | null; conversationId: string | null; messageId: string | null; runId: string | null; simulacao: boolean },
    analise: Analise,
    perfil: PerfilContexto,
    cfg: AgentConfig['crm'],
  ): Promise<DecisaoExtracao[]> {
    const decisoes: DecisaoExtracao[] = [];
    const politica = { camposAutomaticos: cfg.camposAutomaticos as readonly string[], limiarConfianca: cfg.limiarConfiancaAuto };
    const aplicar: { campo: CampoPerfil; valor: unknown; origem: string; confianca: number; status: string }[] = [];

    for (const e of analise.extracoes) {
      const atual = perfil.fatos.get(e.campo) ?? null;
      const r = decidirExtracao(e, atual, politica);
      decisoes.push({ campo: e.campo, valor: e.valor, origem: e.origem, confianca: e.confianca, decisao: r.decisao, motivo: r.motivo });
      if ((r.decisao === 'aplicado' || r.decisao === 'pendente_revisao') && r.valorFinal !== undefined) {
        // Pendente de revisão não substitui fato confirmado no perfil vivo: fica
        // registrado no histórico de extrações para a equipe decidir.
        if (r.decisao === 'pendente_revisao' && atual?.status === 'confirmado') continue;
        aplicar.push({ campo: e.campo, valor: r.valorFinal, origem: e.origem, confianca: e.confianca, status: r.statusFinal ?? 'pendente' });
        perfil.fatos.set(e.campo, { campo: e.campo, valor: r.valorFinal, origem: e.origem, confianca: e.confianca, status: (r.statusFinal ?? 'pendente') as FatoAtual['status'], atualizadoEm: new Date() });
      }
    }
    perfil.intencao = analise.intencao;
    perfil.temperatura = (perfil.fatos.get('temperatura')?.status === 'confirmado' ? valorTexto(perfil.fatos.get('temperatura')!.valor) : null) ?? analise.temperatura;
    if (analise.proximoPasso) perfil.proximaAcao = analise.proximoPasso;

    if (i.simulacao || !i.contactId) return decisoes;
    const contactId = i.contactId;

    await this.prisma.withTenant(i.tenantId, async (tx) => {
      for (const f of aplicar) {
        const dados = {
          valor: f.valor as Prisma.InputJsonValue,
          origem: f.origem,
          confianca: new Prisma.Decimal(f.confianca.toFixed(3)),
          status: f.status,
          agentId: i.agentId,
          conversationId: i.conversationId,
          messageId: i.messageId,
          atualizadoEm: new Date(),
        };
        await tx.agentProfileFact.upsert({
          where: { tenantId_contactId_campo: { tenantId: i.tenantId, contactId, campo: f.campo } },
          create: { tenantId: i.tenantId, contactId, campo: f.campo, ...dados },
          update: dados,
        });
      }
      if (decisoes.length) {
        await tx.agentExtraction.createMany({
          data: decisoes.map((d) => ({
            tenantId: i.tenantId,
            contactId,
            agentId: i.agentId,
            runId: i.runId,
            messageId: i.messageId,
            campo: d.campo,
            valor: d.valor as Prisma.InputJsonValue,
            origem: d.origem,
            confianca: new Prisma.Decimal(d.confianca.toFixed(3)),
            decisao: d.decisao,
            motivo: d.motivo.slice(0, 300),
          })),
        });
      }
      const dadosPerfil = {
        intencao: analise.intencao,
        sentimento: analise.sentimento,
        urgencia: analise.urgencia,
        temperatura: perfil.temperatura,
        ...(analise.proximoPasso ? { proximaAcao: analise.proximoPasso.slice(0, 300) } : {}),
        ultimaInteracaoAt: new Date(),
        ultimoAgentId: i.agentId,
        updatedAt: new Date(),
      };
      await tx.agentCustomerProfile.upsert({
        where: { tenantId_contactId: { tenantId: i.tenantId, contactId } },
        create: { tenantId: i.tenantId, contactId, ...dadosPerfil },
        update: dadosPerfil,
      });
    });

    const sincronizados = await this.sincronizarCrm(i.tenantId, contactId, perfil, cfg).catch((e: Error) => {
      this.log.warn(`falha ao sincronizar perfil com o CRM (tenant ${i.tenantId}): ${e.message}`);
      return [] as string[];
    });
    for (const campo of sincronizados) {
      const f = perfil.fatos.get(campo)!;
      decisoes.push({ campo, valor: valorTexto(f.valor), origem: 'declarado', confianca: f.confianca, decisao: 'sincronizado_crm', motivo: 'gravado no contato do CRM' });
    }
    return decisoes;
  }

  /** Grava no contato (via CrmService — mesmas regras e eventos) o que é fato declarado e confirmado. */
  private async sincronizarCrm(tenantId: string, contactId: string, perfil: PerfilContexto, cfg: AgentConfig['crm']): Promise<string[]> {
    const c = await this.prisma.withTenant(tenantId, (tx) => tx.contact.findUnique({ where: { id: contactId }, select: { nome: true, email: true, empresa: true, telefone: true, camposCustom: true } }));
    if (!c) return [];
    const patch: { nome?: string; email?: string; empresa?: string; camposCustom?: Record<string, unknown> } = {};
    const feitos: string[] = [];
    const confirmado = (campo: string) => {
      const f = perfil.fatos.get(campo);
      return f && f.status === 'confirmado' && (f.origem === 'declarado' || f.origem === 'humano') ? valorTexto(f.valor) : null;
    };
    for (const campo of cfg.sincronizarContato) {
      const v = confirmado(campo);
      if (!v) continue;
      if (campo === 'nome' && (RE_SO_TELEFONE.test(c.nome) || c.nome === c.telefone)) {
        patch.nome = v.slice(0, 120);
        feitos.push('nome');
      } else if (campo === 'email' && !c.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        patch.email = v;
        feitos.push('email');
      } else if (campo === 'empresa' && !c.empresa) {
        patch.empresa = v.slice(0, 120);
        feitos.push('empresa');
      }
    }
    const custom = { ...((c.camposCustom ?? {}) as Record<string, unknown>) };
    let mudouCustom = false;
    for (const [campoPerfil, chave] of Object.entries(cfg.mapaCamposCustom)) {
      const f = perfil.fatos.get(campoPerfil);
      if (!f || f.status === 'rejeitado') continue;
      const v = valorTexto(f.valor);
      if (v && custom[chave] !== v) {
        custom[chave] = v;
        mudouCustom = true;
        feitos.push(campoPerfil);
      }
    }
    if (mudouCustom) patch.camposCustom = custom;
    if (Object.keys(patch).length) await this.crm.updateContact(tenantId, contactId, patch);
    return feitos;
  }

  // ------------------------------------------------------------------ painel

  async obter(tenantId: string, contactId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const contato = await tx.contact.findUnique({ where: { id: contactId }, select: { id: true, nome: true, telefone: true, email: true, empresa: true, tags: true, optedOutAt: true } });
      if (!contato) throw new NotFoundException('contato inexistente');
      const [perfil, fatos, extracoes, followups, memorias] = await Promise.all([
        tx.agentCustomerProfile.findUnique({ where: { tenantId_contactId: { tenantId, contactId } } }),
        tx.agentProfileFact.findMany({ where: { contactId }, orderBy: { campo: 'asc' } }),
        tx.agentExtraction.findMany({ where: { contactId }, orderBy: { createdAt: 'desc' }, take: 50 }),
        tx.agentFollowup.findMany({ where: { contactId }, orderBy: { createdAt: 'desc' }, take: 30 }),
        tx.agentMemory.findMany({ where: { contactId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      ]);
      return {
        contato,
        perfil,
        fatos: fatos.map((f) => ({ ...f, confianca: Number(f.confianca) })),
        extracoes: extracoes.map((e) => ({ ...e, confianca: Number(e.confianca) })),
        followups,
        memorias,
      };
    });
  }

  /** Humano confirma, corrige ou rejeita um fato. Origem passa a `humano`. */
  async decidirFato(tenantId: string, contactId: string, campo: string, acao: 'confirmar' | 'rejeitar' | 'editar', valor: string | undefined, identityId: string) {
    if (!(CAMPOS_PERFIL as readonly string[]).includes(campo)) throw new NotFoundException('campo de perfil inexistente');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.agentProfileFact.findUnique({ where: { tenantId_contactId_campo: { tenantId, contactId, campo } } });
      if (!atual && acao !== 'editar') throw new NotFoundException('fato inexistente');
      const novoValor = acao === 'editar' ? (valor ?? '').trim() : undefined;
      const dados = {
        status: acao === 'rejeitar' ? 'rejeitado' : 'confirmado',
        origem: acao === 'rejeitar' ? atual!.origem : 'humano',
        confianca: new Prisma.Decimal(acao === 'rejeitar' ? Number(atual!.confianca).toFixed(3) : '1'),
        ...(novoValor !== undefined ? { valor: novoValor as Prisma.InputJsonValue } : {}),
        atualizadoEm: new Date(),
      };
      const f = atual
        ? await tx.agentProfileFact.update({ where: { id: atual.id }, data: dados })
        : await tx.agentProfileFact.create({ data: { tenantId, contactId, campo, valor: (novoValor ?? '') as Prisma.InputJsonValue, ...dados } });
      await tx.agentExtraction.create({ data: { tenantId, contactId, campo, valor: f.valor as Prisma.InputJsonValue, origem: 'humano', confianca: new Prisma.Decimal('1'), decisao: acao === 'rejeitar' ? 'ignorado_politica' : 'aplicado', motivo: `${acao} por humano` } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, ${`perfil.fato.${acao}`}, 'contact', ${contactId}, ${JSON.stringify({ campo })}::jsonb)`;
      return { ...f, confianca: Number(f.confianca) };
    });
  }

  /** Marca conversão (para follow-up parar e analytics contar). */
  async marcarConversao(tenantId: string, contactId: string, convertido: boolean, motivoNaoConversao?: string) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.agentCustomerProfile.upsert({
        where: { tenantId_contactId: { tenantId, contactId } },
        create: { tenantId, contactId, convertidoEm: convertido ? new Date() : null, motivoNaoConversao: motivoNaoConversao ?? null },
        update: { convertidoEm: convertido ? new Date() : null, motivoNaoConversao: motivoNaoConversao ?? null, updatedAt: new Date() },
      }),
    );
  }

  /** LGPD: apaga inteligência derivada do contato (perfil, fatos, extrações, memórias). */
  async excluirDados(tenantId: string, contactId: string, identityId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const r = {
        fatos: (await tx.agentProfileFact.deleteMany({ where: { contactId } })).count,
        extracoes: (await tx.agentExtraction.deleteMany({ where: { contactId } })).count,
        memorias: (await tx.agentMemory.deleteMany({ where: { contactId } })).count,
        perfil: (await tx.agentCustomerProfile.deleteMany({ where: { contactId } })).count,
        followups: (await tx.agentFollowup.updateMany({ where: { contactId, status: { in: ['agendado', 'gerando'] } }, data: { status: 'cancelado', motivo: 'dados excluídos (LGPD)' } })).count,
      };
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'perfil.excluido', 'contact', ${contactId}, ${JSON.stringify(r)}::jsonb)`;
      return r;
    });
  }
}
