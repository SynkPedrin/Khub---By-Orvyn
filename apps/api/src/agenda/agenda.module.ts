import { Module } from '@nestjs/common';
import { AgendaService } from './agenda.service';
import { AgendaController } from './agenda.controller';

@Module({
  controllers: [AgendaController],
  providers: [AgendaService],
  // Exportado para o Action Engine dos agentes (consultar/solicitar agendamento).
  exports: [AgendaService],
})
export class AgendaModule {}
