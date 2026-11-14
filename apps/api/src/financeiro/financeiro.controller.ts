import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { SkipAudit } from '../common/audit.interceptor';
import { FinanceiroService } from './financeiro.service';
import { CaixaService, ORIGENS, type LinhaFinanceiro } from './caixa.service';
import { ComissoesService } from './comissoes.service';

class CriarCobrancaDto {
  @IsString() @MaxLength(200) descricao!: string;
  @IsInt() @Min(0) valorCentavos!: number;
  @IsOptional() @IsString() contactId?: string;
  @IsOptional() @IsString() dealId?: string;
  @IsOptional() @IsString() vencimento?: string;
  @IsOptional() @IsString() @MaxLength(3) moeda?: string;
  @IsOptional() @IsBoolean() enviar?: boolean;
}
class StatusDto {
  @IsIn(['enviada', 'paga', 'cancelada']) status!: 'enviada' | 'paga' | 'cancelada';
}
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const nulo = (_o: unknown, v: unknown) => v !== null;

class CategoriaDto {
  @IsString() @MaxLength(60) nome!: string;
  @IsIn(['entrada', 'saida']) tipo!: 'entrada' | 'saida';
  @IsOptional() @ValidateIf(nulo) @IsString() @MaxLength(20) cor?: string | null;
}
class CategoriaPatchDto {
  @IsOptional() @IsString() @MaxLength(60) nome?: string;
  @IsOptional() @ValidateIf(nulo) @IsString() @MaxLength(20) cor?: string | null;
}
class TransacaoPatchDto {
  @IsOptional() @IsString() @MaxLength(200) descricao?: string;
  @IsOptional() @IsInt() @Min(1) @Max(2_147_483_647) valorCentavos?: number;
  @IsOptional() @ValidateIf(nulo) @IsUUID() categoriaId?: string | null;
  @IsOptional() @ValidateIf(nulo) @Matches(DATA, { message: 'data inválida (use AAAA-MM-DD)' }) dataCompetencia?: string | null;
  @IsOptional() @IsIn(['pago', 'pendente']) status?: 'pago' | 'pendente';
  @IsOptional() @ValidateIf(nulo) @IsUUID() contactId?: string | null;
  @IsOptional() @ValidateIf(nulo) @IsUUID() responsavelId?: string | null;
  @IsOptional() @ValidateIf(nulo) @IsString() @MaxLength(500) observacao?: string | null;
}
class TransacaoDto extends TransacaoPatchDto {
  @IsIn(['entrada', 'saida']) tipo!: 'entrada' | 'saida';
  @IsString() @MaxLength(200) declare descricao: string;
  @IsInt() @Min(1) @Max(2_147_483_647) declare valorCentavos: number;
}
class FiltroTransacaoDto {
  @IsOptional() @Matches(DATA) de?: string;
  @IsOptional() @Matches(DATA) ate?: string;
  @IsOptional() @IsIn(['entrada', 'saida']) tipo?: string;
  @IsOptional() @IsUUID() categoriaId?: string;
  @IsOptional() @IsUUID() responsavelId?: string;
  @IsOptional() @IsIn(['pago', 'pendente']) status?: string;
  @IsOptional() @IsIn([...ORIGENS]) origem?: string;
}
class StatusTransacaoDto {
  @IsIn(['pago', 'pendente']) status!: 'pago' | 'pendente';
}
class ComissaoEquipeDto {
  @IsOptional() @ValidateIf(nulo) @IsString() @MaxLength(80) cargo?: string | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }) @Min(0) @Max(100) comissaoPercent?: number;
}
class OpcoesImportacaoFinDto {
  @IsOptional() @IsBoolean() gerarComissoes?: boolean;
}
class ImportarDto {
  /** Linhas já mapeadas pelo front (texto); validadas linha a linha no serviço. */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsObject({ each: true }) linhas!: LinhaFinanceiro[];
  @IsOptional() @ValidateNested() @Type(() => OpcoesImportacaoFinDto) opcoes?: OpcoesImportacaoFinDto;
  /** Número da 1ª linha deste lote no arquivo (para o relatório de erros). */
  @IsOptional() @IsInt() @Min(1) linhaInicial?: number;
}

@SkipAudit()
@Controller('financeiro')
export class FinanceiroController {
  constructor(
    private readonly financeiro: FinanceiroService,
    private readonly caixa: CaixaService,
    private readonly comissoes: ComissoesService,
  ) {}

  // --------------------- cobranças (existente) ---------------------
  @Get('cobrancas')
  listar(@TenantId() t: string, @Query('status') status?: string) {
    return this.financeiro.listar(t, status ? { status } : undefined);
  }
  @Get('resumo')
  resumo(@TenantId() t: string) {
    return this.financeiro.resumo(t);
  }
  @Post('cobrancas')
  criar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: CriarCobrancaDto) {
    return this.financeiro.criar(t, u.identityId, dto);
  }
  @Post('cobrancas/:id/status')
  status(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: StatusDto) {
    return this.financeiro.atualizarStatus(t, u.identityId, id, dto.status);
  }
  @Post('cobrancas/:id/link-pagamento')
  link(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.financeiro.gerarLinkPagamento(t, u.identityId, id);
  }
  @Delete('cobrancas/:id')
  @HttpCode(200)
  remover(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.financeiro.remover(t, u.identityId, id);
  }

  // --------------------- categorias ---------------------
  @Get('categorias')
  categorias(@TenantId() t: string) {
    return this.caixa.listarCategorias(t);
  }
  @Post('categorias')
  criarCategoria(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: CategoriaDto) {
    return this.caixa.criarCategoria(t, u.identityId, dto);
  }
  @Patch('categorias/:id')
  atualizarCategoria(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CategoriaPatchDto) {
    return this.caixa.atualizarCategoria(t, u.identityId, id, dto);
  }
  @Delete('categorias/:id')
  @HttpCode(200)
  removerCategoria(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.caixa.removerCategoria(t, u.identityId, id);
  }

  // --------------------- fluxo de caixa ---------------------
  @Get('transacoes')
  transacoes(@TenantId() t: string, @Query() q: FiltroTransacaoDto) {
    return this.caixa.listarTransacoes(t, q);
  }
  @Post('transacoes')
  criarTransacao(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: TransacaoDto) {
    return this.caixa.criarTransacao(t, u.identityId, dto);
  }
  @Patch('transacoes/:id')
  atualizarTransacao(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TransacaoPatchDto) {
    return this.caixa.atualizarTransacao(t, u.identityId, id, dto);
  }
  @Post('transacoes/:id/status')
  statusTransacao(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusTransacaoDto) {
    return this.caixa.statusTransacao(t, u.identityId, id, dto.status);
  }
  @Delete('transacoes/:id')
  @HttpCode(200)
  removerTransacao(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.caixa.removerTransacao(t, u.identityId, id);
  }
  @Get('fluxo')
  fluxo(@TenantId() t: string, @Query() q: FiltroTransacaoDto) {
    return this.caixa.fluxo(t, { de: q.de, ate: q.ate });
  }
  @Post('importar')
  importar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: ImportarDto) {
    return this.caixa.importar(t, u.identityId, dto.linhas, dto.opcoes ?? {}, dto.linhaInicial ?? 1);
  }

  // --------------------- comissões ---------------------
  @Get('comissoes/equipe')
  equipe(@TenantId() t: string) {
    return this.comissoes.equipe(t);
  }
  @Put('comissoes/equipe/:identityId')
  definirComissao(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('identityId', ParseUUIDPipe) identityId: string, @Body() dto: ComissaoEquipeDto) {
    return this.comissoes.definir(t, u.identityId, identityId, dto);
  }
  @Get('comissoes/geradas')
  geradas(@TenantId() t: string, @Query('competencia') competencia?: string) {
    return this.comissoes.geradas(t, competencia || undefined);
  }
  @Post('comissoes/geradas/:id/pagar')
  pagar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.comissoes.pagar(t, u.identityId, id);
  }
  @Post('comissoes/geradas/:id/estornar')
  estornar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.comissoes.estornar(t, u.identityId, id);
  }
}
