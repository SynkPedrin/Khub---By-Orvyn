import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { PublicRateLimiter } from '../common/public-request';
import { FormsController } from './forms.controller';
import { PublicFormsController } from './public-forms.controller';
import { FormsService } from './forms.service';

/**
 * Formulários (Q4.1). Depende só da superfície exportada do CRM (LeadsService,
 * CrmService, CustomFieldsService). Nada roda no boot: a API sobe mesmo sem as
 * tabelas da db/059 (as rotas respondem erro até a migração ser aplicada).
 */
@Module({
  imports: [CrmModule],
  controllers: [FormsController, PublicFormsController],
  providers: [FormsService, PublicRateLimiter],
})
export class FormsModule {}
