import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { CrmService } from './crm.service';
import { CrmController } from './crm.controller';
import { CrmF2Controller } from './crm-f2.controller';
import { CompaniesService } from './companies.service';
import { TasksService } from './tasks.service';
import { NotesService } from './notes.service';
import { LeadsService } from './leads.service';
import { MessagesService } from './messaging/messages.service';
import { StevoProvider } from './messaging/stevo.provider';
import { StevoWebhookController } from './messaging/stevo-webhook.controller';

@Module({
  imports: [RealtimeModule],
  controllers: [CrmController, CrmF2Controller, StevoWebhookController],
  providers: [CrmService, CompaniesService, TasksService, NotesService, LeadsService, MessagesService, StevoProvider],
  // superfície pública do CRM: quem age em nome do usuário (automations,
  // integrations, e a Nyro em F) entra por aqui — nunca no banco direto.
  exports: [CrmService, MessagesService, LeadsService, TasksService, CompaniesService, NotesService],
})
export class CrmModule {}
