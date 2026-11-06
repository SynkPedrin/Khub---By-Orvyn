import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { CrmService } from './crm.service';
import { CrmController } from './crm.controller';
import { CrmF2Controller } from './crm-f2.controller';
import { CompaniesService } from './companies.service';
import { TasksService } from './tasks.service';
import { NotesService } from './notes.service';
import { LeadsService } from './leads.service';
import { AtendimentoService } from './messaging/atendimento.service';
import { MessagesService } from './messaging/messages.service';
import { StevoProvider } from './messaging/stevo.provider';
import { StevoWebhookController } from './messaging/stevo-webhook.controller';
import { EvolutionProvider } from './messaging/evolution.provider';
import { EvolutionWebhookController } from './messaging/evolution-webhook.controller';
import { WhatsAppConnectionService } from './messaging/whatsapp-connection.service';
import { WhatsAppController } from './messaging/whatsapp.controller';
import { CryptoService } from '../integrations/crypto.service';

@Module({
  imports: [RealtimeModule],
  controllers: [CrmController, CrmF2Controller, StevoWebhookController, EvolutionWebhookController, WhatsAppController],
  providers: [
    CrmService,
    CompaniesService,
    TasksService,
    NotesService,
    LeadsService,
    MessagesService,
    AtendimentoService,
    StevoProvider,
    EvolutionProvider,
    WhatsAppConnectionService,
    // Instância própria (stateless, só depende de ConfigService) — evita
    // ciclo de import com IntegrationsModule, que é quem importa CrmModule.
    CryptoService,
  ],
  // superfície pública do CRM: quem age em nome do usuário (automations,
  // integrations, e a Nyro em F) entra por aqui — nunca no banco direto.
  exports: [CrmService, MessagesService, AtendimentoService, LeadsService, TasksService, CompaniesService, NotesService],
})
export class CrmModule {}
