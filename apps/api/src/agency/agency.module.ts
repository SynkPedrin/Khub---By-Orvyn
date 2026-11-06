import { Module } from '@nestjs/common';
import { AgencyAdminService } from './agency-admin.service';
import { AgencyAdminController } from './agency-admin.controller';
import { TenantsModule } from '../tenants/tenants.module';
import { CrmModule } from '../crm/crm.module';
import { AuthModule } from '../auth/auth.module';
import { AgencyService } from './agency.service';
import { AgencyController } from './agency.controller';

@Module({
  imports: [TenantsModule, CrmModule, AuthModule],
  controllers: [AgencyController, AgencyAdminController],
  providers: [AgencyService, AgencyAdminService],
  exports: [AgencyService],
})
export class AgencyModule {}
