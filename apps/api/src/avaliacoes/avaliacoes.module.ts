import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { PublicRateLimiter } from '../common/public-request';
import { AvaliacoesController, AvaliacoesPublicoController } from './avaliacoes.controller';
import { AvaliacoesService } from './avaliacoes.service';

/**
 * Pedido de avaliação (Q4.4). Envia pela superfície pública do CRM. Exportado
 * para o nó de automação `acao.pedir_avaliacao`. Nada roda no boot.
 */
@Module({
  imports: [CrmModule],
  controllers: [AvaliacoesController, AvaliacoesPublicoController],
  providers: [AvaliacoesService, PublicRateLimiter],
  exports: [AvaliacoesService],
})
export class AvaliacoesModule {}
