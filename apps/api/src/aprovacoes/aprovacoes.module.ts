import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { AprovacoesController } from './aprovacoes.controller';
import { AprovacoesService } from './aprovacoes.service';

/** Aprovações do cliente: artes e roteiros (db/085). Push vem do PushModule (global). */
@Module({
  imports: [RealtimeModule],
  controllers: [AprovacoesController],
  providers: [AprovacoesService],
})
export class AprovacoesModule {}
