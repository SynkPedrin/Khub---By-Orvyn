import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cliente Prisma + injeção de contexto de tenant (RLS).
 * ADR-0003 / R0.3. Corrige o padrão do BUG-001: o tenantId é validado como
 * UUID e passado por parâmetro a set_config (nunca interpolado em string).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PrismaService.name);
  private connected = false;

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.connected = true;
    } catch (e) {
      // Não derruba o boot: em dev sem banco a API sobe e /v1/health reporta db:false.
      this.log.warn(`Banco indisponível no boot: ${(e as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Executa `work` dentro de uma transação com `app.current_tenant_id` setado,
   * de forma que TODA query respeite a RLS do tenant. Isolamento é do banco.
   */
  async withTenant<T>(
    tenantId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (!UUID_RE.test(tenantId)) {
      throw new Error('tenantId inválido: esperado UUID');
    }
    return this.$transaction(async (tx) => {
      // Parametrizado — sem interpolação de string (defesa contra SQL injection).
      await tx.$queryRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      return work(tx);
    });
  }
}
