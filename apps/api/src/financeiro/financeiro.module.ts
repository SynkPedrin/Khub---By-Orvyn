import { Module } from '@nestjs/common';
import { FinanceiroService } from './financeiro.service';
import { FinanceiroController } from './financeiro.controller';

@Module({
  controllers: [FinanceiroController],
  providers: [FinanceiroService],
})
export class FinanceiroModule {}
