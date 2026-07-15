import { Controller, Get } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantId } from '../auth/decorators';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('me')
  me(@TenantId() tenantId: string) {
    return this.tenants.myTenant(tenantId);
  }
}
