import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsGateway } from './events.gateway';
import { RealtimeService } from './realtime.service';

/**
 * Tempo real (D2). Exporta só o `RealtimeService`: os módulos de negócio
 * publicam eventos sem conhecer Socket.IO. Depende de `auth` (validação do
 * ticket) e de ninguém mais — nada aqui importa CRM, então não há ciclo.
 */
@Module({
  imports: [AuthModule],
  providers: [EventsGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
