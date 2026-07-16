import { Module } from '@nestjs/common';
import { CrmService } from './crm.service';
import { CrmController } from './crm.controller';
import { MessagesService } from './messaging/messages.service';
import { StevoProvider } from './messaging/stevo.provider';
import { StevoWebhookController } from './messaging/stevo-webhook.controller';

@Module({
  controllers: [CrmController, StevoWebhookController],
  providers: [CrmService, MessagesService, StevoProvider],
  exports: [CrmService, MessagesService],
})
export class CrmModule {}
