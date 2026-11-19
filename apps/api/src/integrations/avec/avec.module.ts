import { Module } from '@nestjs/common';
import { CryptoService } from '../crypto.service';
import { AvecAgendaService } from './avec-agenda.service';
import { AvecController } from './avec.controller';

/**
 * Avec (agenda do salão, ADR-0052). Módulo próprio para a agenda dos agentes
 * (SalaoAgendaService) usar a leitura ao vivo sem importar o IntegrationsModule
 * inteiro. O agendador periódico vive na fila 'ads-sync' (IntegrationsModule).
 */
@Module({
  controllers: [AvecController],
  providers: [AvecAgendaService, CryptoService],
  exports: [AvecAgendaService],
})
export class AvecModule {}
