import { Module } from '@nestjs/common';
import { NyroModule } from '../nyro/nyro.module';
import { AgentsModule } from '../agents/agents.module';
import { AutomationsModule } from '../automations/automations.module';
import { SettingsModule } from '../settings/settings.module';
import { McpOAuthService } from './oauth.service';
import { McpFerramentasService } from './mcp-ferramentas.service';
import { ConectorIaController, McpController, McpOAuthController } from './mcp.controller';

/**
 * Conector MCP para Claude e ChatGPT (ADR-0049): servidor de autorização
 * OAuth 2.1 + endpoint MCP. Consumidor da superfície pública de nyro, agents,
 * automations e settings — nenhum deles depende deste módulo.
 */
@Module({
  imports: [NyroModule, AgentsModule, AutomationsModule, SettingsModule],
  controllers: [McpOAuthController, McpController, ConectorIaController],
  providers: [McpOAuthService, McpFerramentasService],
})
export class McpModule {}
