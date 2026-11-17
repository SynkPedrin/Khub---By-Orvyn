import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { SkipAudit } from '../common/audit.interceptor';
import { FinanceiroService } from './financeiro.service';
import { CaixaService, FORMAS_PAGAMENTO, ORIGENS, type FormaPagamento, type LinhaFinanceiro } from './caixa.service';
import { CABECALHO_SENHA, FinanceiroSenhaService } from './senha.service';
import { ProdutosService } from './produtos.service';
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
  @IsOptional() @ValidateIf(nulo) @IsIn([...FORMAS_PAGAMENTO]) formaPagamento?: FormaPagamento | null;
  @IsOptional() @ValidateIf(nulo) @IsInt() @Min(1) @Max(24) parcelas?: number | null;
  @IsOptional() @ValidateIf(nulo) @IsUUID() produtoId?: string | null;
  @IsOptional() @ValidateIf(nulo) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(100000) quantidade?: number | null;
  @IsOptional() @ValidateIf(nulo) @IsUUID() profissionalId?: string | null;
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
  @IsOptional() @IsIn(['pago', 'pendente', 'cancelada']) status?: string;
  @IsOptional() @IsIn([...ORIGENS]) origem?: string;
}
class StatusTransacaoDto {
  @IsIn(['pago', 'pendente']) status!: 'pago' | 'pendente';
}
class CancelarDto {
  @IsOptional() @ValidateIf(nulo) @IsString() @MaxLength(300) motivo?: string | null;
}
class SenhaDto {
  @IsString() @MaxLength(64) senha!: string;
}
class DefinirSenhaDto {
  @IsOptional() @IsString() @MaxLength(64) senhaAtual?: string;
  @IsString() @MaxLength(64) novaSenha!: string;
}
class ProdutoDto {
  @IsString() @MaxLength(160) nome!: string;
  @IsOptional() @ValidateIf(nulo) @IsString() @MaxLength(80) categoria?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) precoCentavos?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) custoCentavos?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) estoqueMinimo?: number;
}
class ProdutoPatchDto {
  @IsOptional() @IsString() @MaxLength(160) nome?: string;
  @IsOptional() @ValidateIf(nulo) @IsString() @MaxLength(80) categoria?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) precoCentavos?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) custoCentavos?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) estoqueMinimo?: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
}
class EstoqueDto {
  @IsIn(['entrada', 'ajuste']) tipo!: 'entrada' | 'ajuste';
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(1_000_000) quantidade!: number;
  @IsOptional() @ValidateIf(nulo) @IsString() @MaxLength(200) motivo?: string | null;
}
class ItemImportacaoProdutoDto {
  @IsString() @MaxLength(160) nome!: string;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) precoCentavos?: number;
  @IsOptional() @ValidateIf(nulo) @IsString() @MaxLength(80) categoria?: string | null;
}
class ImportarProdutosDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => ItemImportacaoProdutoDto) itens!: ItemImportacaoProdutoDto[];
}
class FiltroProdutoDto {
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(2000) limite?: number;
  @IsOptional() @IsIn(['1', '0']) inativos?: string;
}
class ColaboradorDto {
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }) @Min(0) @Max(100) comissaoPercent!: number;
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
    private readonly senha: FinanceiroSenhaService,
    private readonly produtos: ProdutosService,
  ) {}

  /** Barreira da senha do financeiro (Visão geral, Comissões, editar/cancelar venda). */
  private exigirSenha(t: string, u: AuthUser, token: string | undefined) {
    return this.senha.exigir(t, u.identityId, token);
  }

  // --------------------- senha do financeiro ---------------------
  @Get('senha')
  async senhaEstado(@TenantId() t: string) {
    return { configurada: await this.senha.configurada(t) };
  }
  @Post('senha/verificar')
  @HttpCode(200)
  verificarSenha(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: SenhaDto) {
    return this.senha.verificar(t, u.identityId, dto.senha);
  }
  @Post('senha')
  @HttpCode(200)
  definirSenha(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: DefinirSenhaDto) {
    return this.senha.definir(t, { identityId: u.identityId, role: u.role }, dto);
  }

  // --------------------- produtos e estoque ---------------------
  @Get('produtos')
  listarProdutos(@TenantId() t: string, @Query() q: FiltroProdutoDto) {
    return this.produtos.listar(t, { q: q.q, limite: q.limite, incluirInativos: q.inativos === '1' });
  }
  @Post('produtos')
  criarProduto(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: ProdutoDto) {
    return this.produtos.criar(t, u.identityId, dto);
  }
  @Patch('produtos/:id')
  atualizarProduto(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProdutoPatchDto) {
    return this.produtos.atualizar(t, u.identityId, id, dto);
  }
  @Post('produtos/:id/estoque')
  @HttpCode(200)
  movimentarEstoque(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EstoqueDto) {
    return this.produtos.movimentar(t, u.identityId, id, dto);
  }
  @Post('produtos/importar')
  @HttpCode(200)
  importarProdutos(@TenantId() t: string, @Body() dto: ImportarProdutosDto) {
    return this.produtos.importar(t, dto.itens);
  }

  // --------------------- colaboradoras (comissão) ---------------------
  /** `comComissao=1`: só quem tem % > 0 (o campo "Profissional" do caixa, sem senha). */
  @Get('colaboradores')
  async colaboradores(@TenantId() t: string, @CurrentUser() u: AuthUser, @Query('comComissao') comComissao?: string, @Headers(CABECALHO_SENHA) token?: string) {
    if (comComissao !== '1') await this.exigirSenha(t, u, token);
    return this.comissoes.colaboradores(t, comComissao === '1');
  }
  @Patch('colaboradores/:id')
  async definirColaborador(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ColaboradorDto, @Headers(CABECALHO_SENHA) token?: string) {
    await this.exigirSenha(t, u, token);
    return this.comissoes.definirColaborador(t, u.identityId, id, dto.comissaoPercent);
  }

  // --------------------- caixa atual (Visão geral) ---------------------
  @Get('caixa-atual')
  async caixaAtual(@TenantId() t: string, @CurrentUser() u: AuthUser, @Headers(CABECALHO_SENHA) token?: string) {
    await this.exigirSenha(t, u, token);
    return this.caixa.caixaAtual(t);
  }

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
  async atualizarTransacao(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TransacaoPatchDto, @Headers(CABECALHO_SENHA) token?: string) {
    await this.exigirSenha(t, u, token);
    return this.caixa.atualizarTransacao(t, u.identityId, id, dto);
  }
  @Post('transacoes/:id/cancelar')
  @HttpCode(200)
  async cancelarTransacao(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelarDto, @Headers(CABECALHO_SENHA) token?: string) {
    await this.exigirSenha(t, u, token);
    return this.caixa.cancelarTransacao(t, u.identityId, id, dto.motivo);
  }
  @Post('transacoes/:id/status')
  async statusTransacao(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusTransacaoDto, @Headers(CABECALHO_SENHA) token?: string) {
    // Pendente → recebido é rotina do caixa; voltar um recebido para pendente é editar a venda.
    if (dto.status === 'pendente') await this.exigirSenha(t, u, token);
    return this.caixa.statusTransacao(t, u.identityId, id, dto.status);
  }
  @Delete('transacoes/:id')
  @HttpCode(200)
  async removerTransacao(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers(CABECALHO_SENHA) token?: string) {
    await this.exigirSenha(t, u, token);
    return this.caixa.removerTransacao(t, u.identityId, id);
  }
  @Get('fluxo')
  async fluxo(@TenantId() t: string, @CurrentUser() u: AuthUser, @Query() q: FiltroTransacaoDto, @Headers(CABECALHO_SENHA) token?: string) {
    await this.exigirSenha(t, u, token);
    return this.caixa.fluxo(t, { de: q.de, ate: q.ate });
  }
  @Post('importar')
  importar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: ImportarDto) {
    return this.caixa.importar(t, u.identityId, dto.linhas, dto.opcoes ?? {}, dto.linhaInicial ?? 1);
  }

  // --------------------- comissões ---------------------
  @Get('comissoes/equipe')
  async equipe(@TenantId() t: string, @CurrentUser() u: AuthUser, @Headers(CABECALHO_SENHA) token?: string) {
    await this.exigirSenha(t, u, token);
    return this.comissoes.equipe(t);
  }
  @Put('comissoes/equipe/:identityId')
  async definirComissao(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('identityId', ParseUUIDPipe) identityId: string, @Body() dto: ComissaoEquipeDto, @Headers(CABECALHO_SENHA) token?: string) {
    await this.exigirSenha(t, u, token);
    return this.comissoes.definir(t, u.identityId, identityId, dto);
  }
  @Get('comissoes/geradas')
  async geradas(@TenantId() t: string, @CurrentUser() u: AuthUser, @Query('competencia') competencia?: string, @Headers(CABECALHO_SENHA) token?: string) {
    await this.exigirSenha(t, u, token);
    return this.comissoes.geradas(t, competencia || undefined);
  }
  @Post('comissoes/geradas/:id/pagar')
  async pagar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers(CABECALHO_SENHA) token?: string) {
    await this.exigirSenha(t, u, token);
    return this.comissoes.pagar(t, u.identityId, id);
  }
  @Post('comissoes/geradas/:id/estornar')
  async estornar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers(CABECALHO_SENHA) token?: string) {
    await this.exigirSenha(t, u, token);
    return this.comissoes.estornar(t, u.identityId, id);
  }
}
