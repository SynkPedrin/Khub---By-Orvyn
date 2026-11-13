import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AutomationsModule } from '../automations/automations.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { CrmModule } from '../crm/crm.module';
import { AgendaModule } from '../agenda/agenda.module';
import { DisparosModule } from '../disparos/disparos.module';
import { OperationsService, OperationsProcessor } from './operations.service';
import { OperationsController } from './operations.controller';
import { isWorker } from '../common/queue-connection';
import { FILA_AGENTES } from '../agents/agent-runtime.service';
@Module({
 imports: [AutomationsModule, IntegrationsModule, CrmModule, AgendaModule, DisparosModule, BullModule.registerQueue({name:'khub-maintenance'}), BullModule.registerQueue({name:'automation-steps'}), BullModule.registerQueue({name:FILA_AGENTES})],
 providers: [OperationsService, ...(isWorker() ? [OperationsProcessor] : [])],
 controllers: [OperationsController],
})
export class OperationsModule {}
