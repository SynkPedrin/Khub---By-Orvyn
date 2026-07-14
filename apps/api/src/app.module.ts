import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { RagModule } from './rag/rag.module';
import { CrmModule } from './crm/crm.module';

@Module({
  imports: [PrismaModule, RagModule, CrmModule],
  controllers: [HealthController],
})
export class AppModule {}
