import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceiroService } from '../financeiro/financeiro.service';
import { NicoAnalisesService } from './analises.service';

export interface Insight {
  id: string;
  gravidade: 'alta' | 'media' | 'info';
  titulo: string;
  detalhe: string;
  /** Mensagem pronta: um clique e a NICO já começa a resolver. */
  pergunta: string;
}

const brl = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const TTL_MS = 5 * 60_000;

/**
 * A NICO "nota" coisas sem ninguém perguntar: regras determinísticas sobre
 * campanhas, cobranças, automações e conversas paradas. Zero chamada de LLM
 * (custo zero, instantâneo, auditável). Quem resolve é a NICO, ao clicar.
 */
@Injectable()
export class NicoInsightsService {
  private readonly log = new Logger('NicoInsights');
  private readonly cache = new Map<string, { em: number; dados: Insight[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly analises: NicoAnalisesService,
    private readonly financeiro: FinanceiroService,
  ) {}

  async listar(tenantId: string): Promise<Insight[]> {
    const c = this.cache.get(tenantId);
    if (c && Date.now() - c.em < TTL_MS) return c.dados;
    const partes = await Promise.all([this.campanhas(tenantId), this.cobrancas(tenantId), this.automacoes(tenantId), this.conversasParadas(tenantId)]);
    const ordem = { alta: 0, media: 1, info: 2 } as const;
    const dados = partes.flat().sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade]).slice(0, 6);
    this.cache.set(tenantId, { em: Date.now(), dados });
    return dados;
  }

  /** Cada fonte falha sozinha: um insight quebrado não derruba os outros. */
  private async seguro(nome: string, f: () => Promise<Insight[]>): Promise<Insight[]> {
    try {
      return await f();
    } catch (e) {
      this.log.warn(`insight "${nome}" falhou: ${(e as Error).message}`);
      return [];
    }
  }

  private campanhas(tenantId: string) {
    return this.seguro('campanhas', async () => {
      const r = await this.analises.analisarCampanhas(tenantId, 7);
      if ('vazio' in r) return [];
      const alertas = r.campanhas.filter((c) => c.alertas.length);
      return alertas.slice(0, 2).map((c, i) => ({
        id: `campanha-${i}-${c.campanha}`.slice(0, 80),
        gravidade: 'alta' as const,
        titulo: `Campanha "${c.campanha}" pede atenção`,
        detalhe: c.alertas[0],
        pergunta: `Analise a campanha "${c.campanha}" dos últimos 7 dias, explique o que está acontecendo e o que fazer hoje.`,
      }));
    });
  }

  private cobrancas(tenantId: string) {
    return this.seguro('cobrancas', async () => {
      const r = await this.financeiro.resumo(tenantId);
      if (r.vencidas <= 0) return [];
      return [{
        id: 'financeiro-vencidas',
        gravidade: 'alta' as const,
        titulo: `${r.vencidas} cobrança${r.vencidas > 1 ? 's' : ''} vencida${r.vencidas > 1 ? 's' : ''} (${brl(r.vencidoCentavos)})`,
        detalhe: `Já entraram ${brl(r.recebidoCentavos)}; ainda faltam ${brl(r.aReceberCentavos + r.vencidoCentavos)}.`,
        pergunta: 'Liste minhas cobranças vencidas e sugira como cobrar cada uma, com a mensagem pronta.',
      }];
    });
  }

  private automacoes(tenantId: string) {
    return this.seguro('automacoes', async () => {
      const r = await this.analises.diagnosticarAutomacoes(tenantId);
      const problemas = r.achados.filter((a) => !a.startsWith('✅'));
      if (!problemas.length) return [];
      return [{
        id: 'automacoes-saude',
        gravidade: problemas.some((p) => p.startsWith('🚨') || p.startsWith('🧊')) ? ('alta' as const) : ('media' as const),
        titulo: `${problemas.length} problema${problemas.length > 1 ? 's' : ''} nas automações`,
        detalhe: problemas[0].replace(/^\S+\s/, ''),
        pergunta: 'Diagnostique minhas automações, me diga o que está quebrado e como consertar.',
      }];
    });
  }

  private conversasParadas(tenantId: string) {
    return this.seguro('conversas', async () => {
      const limite = new Date(Date.now() - 24 * 3_600_000);
      const n = await this.prisma.withTenant(tenantId, (tx) => tx.conversation.count({ where: { naoLidas: { gt: 0 }, status: 'aberta', updatedAt: { lt: limite } } }));
      if (!n) return [];
      return [{
        id: 'conversas-paradas',
        gravidade: 'media' as const,
        titulo: `${n} conversa${n > 1 ? 's' : ''} sem resposta há mais de 24h`,
        detalhe: 'Lead esfria rápido: responder no mesmo dia muda a conversão.',
        pergunta: 'Quais conversas estão sem resposta há mais de 24h? Priorize por valor e sugira a resposta de cada uma.',
      }];
    });
  }
}
