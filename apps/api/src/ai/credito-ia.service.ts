import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ErroProvedorIA } from './provider.contract';

/**
 * Teto de crédito da Anthropic (deploy com crédito promocional).
 *
 * A Anthropic não tem opção "usar só crédito promocional": o promocional é
 * consumido antes do saldo pago, e com saldo pago zero e recarga automática
 * desligada a API passa a recusar quando ele acaba. Este serviço para ANTES
 * disso, de forma previsível: quando o gasto desde `ANTHROPIC_CREDITO_DESDE`
 * chega a `ANTHROPIC_CREDITO_USD - ANTHROPIC_CREDITO_RESERVA_USD`, toda chamada
 * à Anthropic é recusada com `ErroProvedorIA` causa `credito` (não retentável).
 * O runtime dos agentes já transfere a conversa para a equipe em qualquer erro.
 *
 * Gasto = soma de `ai_usage_events.custo_usd` de todos os tenants ativos desde
 * a data (fonte durável, lida a cada 60 s) + o custo das chamadas feitas neste
 * processo desde a última leitura (ponte até a próxima leitura). Chamadas que
 * não registram uso ficam cobertas pela reserva.
 *
 * Sem `ANTHROPIC_CREDITO_USD` o teto fica desligado (comportamento anterior).
 */
export interface ConfigCredito {
  limiteUsd: number;
  reservaUsd: number;
  desde: Date;
}

export function lerConfigCredito(env: NodeJS.ProcessEnv = process.env): ConfigCredito | null {
  const limite = Number((env.ANTHROPIC_CREDITO_USD || '').trim().replace(',', '.'));
  if (!Number.isFinite(limite) || limite <= 0) return null;
  const reservaBruta = (env.ANTHROPIC_CREDITO_RESERVA_USD || '').trim().replace(',', '.');
  const reserva = reservaBruta === '' ? 5 : Number(reservaBruta);
  const desdeBruto = (env.ANTHROPIC_CREDITO_DESDE || '').trim();
  const desde = desdeBruto ? new Date(desdeBruto) : new Date(0);
  if (Number.isNaN(desde.getTime())) return null;
  return { limiteUsd: limite, reservaUsd: Number.isFinite(reserva) && reserva >= 0 ? reserva : 5, desde };
}

export interface StatusCredito {
  ativo: boolean;
  limiteUsd?: number;
  reservaUsd?: number;
  desde?: string;
  gastoUsd?: number;
  restanteUsd?: number;
  bloqueado: boolean;
}

const VALIDADE_LEITURA_MS = 60_000;

@Injectable()
export class CreditoIaService {
  private readonly log = new Logger('CreditoIA');
  private leitura: { gasto: number; em: number } | null = null;
  private lendo: Promise<number> | null = null;
  private gastoLocal = 0;
  private avisouBloqueio = false;

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /** Soma o custo registrado de todos os tenants ativos desde a data do crédito. */
  private async lerGastoRegistrado(desde: Date): Promise<number> {
    if (!this.prisma) return 0;
    const tenants = await this.prisma.tenant.findMany({ where: { status: 'active' }, select: { id: true } });
    let total = 0;
    for (const t of tenants) {
      const r = await this.prisma.withTenant(t.id, (tx) =>
        tx.aiUsageEvent.aggregate({ where: { createdAt: { gte: desde } }, _sum: { custoUsd: true } }),
      );
      total += Number(r._sum.custoUsd ?? 0);
    }
    return total;
  }

  /** Gasto atual (leitura do banco com cache de 60 s + chamadas locais desde a leitura). */
  async gastoAtual(cfg: ConfigCredito): Promise<number> {
    const agora = Date.now();
    if (!this.leitura || agora - this.leitura.em > VALIDADE_LEITURA_MS) {
      this.lendo ??= this.lerGastoRegistrado(cfg.desde)
        .then((gasto) => {
          this.leitura = { gasto, em: Date.now() };
          this.gastoLocal = 0;
          return gasto;
        })
        .catch((e: Error) => {
          // Falha de leitura não derruba a IA: segue com a última leitura conhecida.
          this.log.warn(`não consegui ler o gasto de IA: ${e.message}`);
          return this.leitura?.gasto ?? 0;
        })
        .finally(() => {
          this.lendo = null;
        });
      await this.lendo;
    }
    return (this.leitura?.gasto ?? 0) + this.gastoLocal;
  }

  /** Soma o custo de uma chamada feita por este processo. */
  registrar(custoUsd: number): void {
    if (Number.isFinite(custoUsd) && custoUsd > 0) this.gastoLocal += custoUsd;
  }

  /** Recusa a chamada quando o teto (limite menos reserva) foi atingido. */
  async verificar(env: NodeJS.ProcessEnv = process.env): Promise<void> {
    const cfg = lerConfigCredito(env);
    if (!cfg) return;
    const gasto = await this.gastoAtual(cfg);
    const teto = cfg.limiteUsd - cfg.reservaUsd;
    if (gasto < teto) {
      this.avisouBloqueio = false;
      return;
    }
    if (!this.avisouBloqueio) {
      this.log.error(`crédito de IA no teto: gasto US$ ${gasto.toFixed(4)} de US$ ${cfg.limiteUsd} (reserva US$ ${cfg.reservaUsd}); chamadas à Anthropic bloqueadas`);
      this.avisouBloqueio = true;
    }
    throw new ErroProvedorIA(
      `Crédito de IA no teto (US$ ${gasto.toFixed(2)} de US$ ${cfg.limiteUsd}, reserva US$ ${cfg.reservaUsd})`,
      'credito',
      'anthropic',
      402,
    );
  }

  async status(env: NodeJS.ProcessEnv = process.env): Promise<StatusCredito> {
    const cfg = lerConfigCredito(env);
    if (!cfg) return { ativo: false, bloqueado: false };
    const gasto = await this.gastoAtual(cfg);
    return {
      ativo: true,
      limiteUsd: cfg.limiteUsd,
      reservaUsd: cfg.reservaUsd,
      desde: cfg.desde.toISOString(),
      gastoUsd: Number(gasto.toFixed(6)),
      restanteUsd: Number(Math.max(0, cfg.limiteUsd - gasto).toFixed(6)),
      bloqueado: gasto >= cfg.limiteUsd - cfg.reservaUsd,
    };
  }
}
