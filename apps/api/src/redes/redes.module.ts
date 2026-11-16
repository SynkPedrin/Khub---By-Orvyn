import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { isWorker } from '../common/queue-connection';
import { CryptoService } from '../integrations/crypto.service';
import { RedesConexaoController, RedesController } from './redes.controller';
import { RedesConexaoService } from './redes-conexao.service';
import { RedesHttp } from './redes.http';
import { RedesPublicacaoService } from './redes-publicacao.service';
import { RedesService } from './redes.service';
import { RedesInstagramController, RedesInstagramService } from './redes-instagram.service';
import { FILA_REDES, RedesProcessor, RedesScheduler } from './redes.worker';

/**
 * Gestão de redes sociais por subconta (Instagram, TikTok, YouTube; db/068).
 * As contas são as de `channel_connections` (db/063), compartilhadas com
 * Conversas. Publicação: só o worker (RedesProcessor) executa.
 */
@Module({
  imports: [BullModule.registerQueue({ name: FILA_REDES })],
  controllers: [RedesController, RedesConexaoController, RedesInstagramController],
  providers: [CryptoService, RedesHttp, RedesConexaoService, RedesService, RedesInstagramService, RedesPublicacaoService, RedesScheduler, ...(isWorker() ? [RedesProcessor] : [])],
})
export class RedesModule {}
