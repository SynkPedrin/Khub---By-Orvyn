import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CrmModule } from '../crm/crm.module';
import { isWorker } from '../common/queue-connection';
import { DisparosController } from './disparos.controller';
import { DisparosService } from './disparos.service';
import { DisparosProcessor, FILA_DISPAROS } from './disparos.processor';

/**
 * Disparo em massa (Q4.3). Envia pela superfície pública do CRM
 * (`MessagesService`) e pelo `MailerService`; nada fala com provedor direto.
 * O processor só sobe no worker: a API não consulta tabela nenhuma no boot.
 */
@Module({
  imports: [CrmModule, BullModule.registerQueue({ name: FILA_DISPAROS })],
  controllers: [DisparosController],
  providers: [DisparosService, ...(isWorker() ? [DisparosProcessor] : [])],
  exports: [DisparosService],
})
export class DisparosModule {}
