import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations.module';
import { GoogleController } from './google.controller';
import { GoogleConexaoService } from './google-conexao.service';
import { GoogleHttp } from './google-http';
import { TagManagerService } from './tag-manager.service';
import { SearchConsoleService } from './search-console.service';
import { MeuNegocioService } from './meu-negocio.service';

/**
 * Presença Google por subconta: Tag Manager, Search Console e Perfil da
 * Empresa. CryptoService vem da superfície pública do IntegrationsModule
 * (mesma chave INTEGRATIONS_ENCRYPTION_KEY dos demais conectores).
 */
@Module({
  imports: [IntegrationsModule],
  controllers: [GoogleController],
  providers: [GoogleHttp, GoogleConexaoService, TagManagerService, SearchConsoleService, MeuNegocioService],
})
export class GooglePresencaModule {}
