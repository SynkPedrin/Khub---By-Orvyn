import { Controller, Get, Query } from '@nestjs/common';
import { TenantId } from '../auth/decorators';
import { AtribuicaoService } from './atribuicao.service';

/**
 * Métricas de atribuição (db/066). Leitura segue a régua padrão do módulo
 * (contacts.read). `de`/`ate` são dias civis 'YYYY-MM-DD'; ausentes = últimos
 * 30 dias terminando hoje.
 */
@Controller('crm/atribuicao')
export class AtribuicaoController {
  constructor(private readonly atribuicao: AtribuicaoService) {}

  @Get('campanhas')
  campanhas(@TenantId() t: string, @Query('de') de?: string, @Query('ate') ate?: string) {
    return this.atribuicao.campanhas(t, de, ate);
  }
}
