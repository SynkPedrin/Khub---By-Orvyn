import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { CrmService } from './crm.service';
import { CrmController } from './crm.controller';
import { ContatosController } from './contatos.controller';
import { ContatosMassaService } from './contatos-massa.service';
import { ContatosMesclaService } from './contatos-mescla.service';
import { ContatosViewsService } from './contatos-views.service';
import { CrmF2Controller } from './crm-f2.controller';
import { PipelinesController } from './pipelines.controller';
import { ComercialController } from './comercial.controller';
import { PipelinesService } from './pipelines.service';
import { ProposalsService } from './proposals.service';
import { CarteiraService } from './carteira.service';
import { ImportacaoService } from './importacao.service';
import { CompaniesService } from './companies.service';
import { CustomFieldsService } from './custom-fields.service';
import { CustomFieldsController } from './custom-fields.controller';
import { LostReasonsService } from './lost-reasons.service';
import { LostReasonsController } from './lost-reasons.controller';
import { NegociosMassaService } from './negocios-massa.service';
import { NegociosController } from './negocios.controller';
import { TasksService } from './tasks.service';
import { NotesService } from './notes.service';
import { LeadsService } from './leads.service';
import { AtendimentoService } from './messaging/atendimento.service';
import { StevoApiProvider } from './messaging/stevo-api.provider';
import { StevoApiEventosService } from './messaging/stevo-api-eventos.service';
import { StevoApiVinculoService } from './messaging/stevo-api-vinculo.service';
import { StevoApiWebhookController } from './messaging/stevo-api-webhook.controller';
import { MessagesService } from './messaging/messages.service';
import { StevoProvider } from './messaging/stevo.provider';
import { StevoWebhookController } from './messaging/stevo-webhook.controller';
import { EvolutionProvider } from './messaging/evolution.provider';
import { EvolutionWebhookController } from './messaging/evolution-webhook.controller';
import { WhatsAppConnectionService } from './messaging/whatsapp-connection.service';
import { WhatsAppController } from './messaging/whatsapp.controller';
import { AvatarContatoService } from './messaging/avatar-contato.service';
import { CryptoService } from '../integrations/crypto.service';
import { InboxService } from './messaging/inbox.service';
import { InboxController } from './messaging/inbox.controller';

@Module({
  imports: [RealtimeModule],
  controllers: [ContatosController, NegociosController, LostReasonsController, CrmController, CrmF2Controller, CustomFieldsController, PipelinesController, ComercialController, StevoWebhookController, StevoApiWebhookController, EvolutionWebhookController, WhatsAppController, InboxController],
  providers: [
    CrmService,
    ContatosMassaService,
    ContatosMesclaService,
    ContatosViewsService,
    PipelinesService,
    ProposalsService,
    CarteiraService,
    ImportacaoService,
    CompaniesService,
    CustomFieldsService,
    LostReasonsService,
    NegociosMassaService,
    TasksService,
    NotesService,
    LeadsService,
    MessagesService,
    AtendimentoService,
    StevoApiProvider,
    StevoApiEventosService,
    StevoApiVinculoService,
    StevoProvider,
    EvolutionProvider,
    WhatsAppConnectionService,
    AvatarContatoService,
    InboxService,
    // Instância própria (stateless, só depende de ConfigService) — evita
    // ciclo de import com IntegrationsModule, que é quem importa CrmModule.
    CryptoService,
  ],
  // superfície pública do CRM: quem age em nome do usuário (automations,
  // integrations, e a Nyro em F) entra por aqui — nunca no banco direto.
  exports: [CrmService, MessagesService, AtendimentoService, StevoApiProvider, StevoApiEventosService, StevoApiVinculoService, LeadsService, TasksService, CompaniesService, NotesService, CustomFieldsService],
})
export class CrmModule {}
