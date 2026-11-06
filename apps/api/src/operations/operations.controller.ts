import { Controller, Get } from '@nestjs/common';
import { TenantId } from '../auth/decorators';
import { OperationsService } from './operations.service';
@Controller('operations')
export class OperationsController {
 constructor(private readonly operations:OperationsService) {}
 @Get() snapshot(@TenantId() tenantId:string){return this.operations.snapshot(tenantId);}
}
