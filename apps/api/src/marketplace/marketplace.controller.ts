import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsObject, IsOptional } from 'class-validator';
import { MarketplaceService } from './marketplace.service';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';

const bool = (v?: string): boolean | undefined => (v === undefined ? undefined : v === 'true' || v === '1');

class InstalarDto {
  @IsOptional() @IsObject() valores?: Record<string, string>;
}

@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get('templates')
  listar(
    @TenantId() t: string,
    @Query('categoria') categoria?: string,
    @Query('q') q?: string,
    @Query('oficial') oficial?: string,
    @Query('premium') premium?: string,
    @Query('featured') featured?: string,
  ) {
    return this.marketplace.listar(t, { categoria, q, oficial: bool(oficial), premium: bool(premium), featured: bool(featured) });
  }

  @Get('categorias')
  categorias(@TenantId() t: string) {
    return this.marketplace.categorias(t);
  }

  @Get('templates/:id')
  obter(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.marketplace.obter(t, id);
  }

  @Post('templates/:id/instalar')
  @HttpCode(200)
  instalar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: InstalarDto) {
    return this.marketplace.instalar(t, u.identityId, id, dto?.valores);
  }
}
