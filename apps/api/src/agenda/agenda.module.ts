import { Module } from '@nestjs/common';
import { AgendaService } from './agenda.service';
import { AgendaController } from './agenda.controller';
import { FinanceiroModule } from '../financeiro/financeiro.module';

@Module({
  // FinanceiroModule: concluir um atendimento com valor gera a entrada no
  // caixa e a comissão do responsável na mesma transação (db/070).
  imports: [FinanceiroModule],
  controllers: [AgendaController],
  providers: [AgendaService],
  // Exportado para o Action Engine dos agentes (consultar/solicitar agendamento).
  exports: [AgendaService],
})
export class AgendaModule {}
