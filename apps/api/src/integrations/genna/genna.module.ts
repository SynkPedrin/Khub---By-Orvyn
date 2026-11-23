import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations.module';
import { NyroModule } from '../../nyro/nyro.module';
import { GennaController } from './genna.controller';
import { GennaConexaoService } from './genna-conexao.service';
import { GennaService } from './genna.service';

/**
 * Genna por subconta (ADR-0053): cliente MCP do servidor remoto do Genna.
 * CryptoService vem do IntegrationsModule; ToolExecutorService do NyroModule
 * (a publicação aprovada em NICO > Aprovações executa pelo executor).
 */
@Module({
  imports: [IntegrationsModule, NyroModule],
  controllers: [GennaController],
  providers: [GennaConexaoService, GennaService],
  // O onboarding da agência (db/078) consulta ferramentas de leitura do Genna.
  exports: [GennaService],
})
export class GennaModule {}
