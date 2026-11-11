import { Module } from '@nestjs/common';
import { AgendaModule } from '../agenda/agenda.module';
import { CrmModule } from '../crm/crm.module';
import { PublicRateLimiter } from '../common/public-request';
import { BookingController } from './booking.controller';
import { PublicBookingController, PublicReservasController } from './public-booking.controller';
import { BookingService } from './booking.service';

/**
 * Agendamento público (Q4.2). Usa só serviços exportados: AgendaService
 * (compromisso + anti-choque) e LeadsService (contato com dedupe). Nada roda
 * no boot: a API sobe sem as tabelas da db/060.
 */
@Module({
  imports: [AgendaModule, CrmModule],
  controllers: [BookingController, PublicBookingController, PublicReservasController],
  providers: [BookingService, PublicRateLimiter],
})
export class BookingModule {}
