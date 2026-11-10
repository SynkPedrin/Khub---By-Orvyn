import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { ProposalsService, type AcaoProposta } from './proposals.service';
import { CarteiraService } from './carteira.service';
import { ImportacaoService, MAX_LINHAS_POR_LOTE, type LinhaImportacao } from './importacao.service';

class PropostaDto {
  @IsOptional() @IsString() @MaxLength(160) titulo?: string;
  @IsOptional() @IsUUID() contactId?: string | null;
  @IsOptional() @IsUUID() dealId?: string | null;
  /** [{descricao, quantidade, valorUnitario}] — validado por Zod no serviço. */
  @IsOptional() @IsArray() @ArrayMaxSize(50) itens?: unknown[];
  @IsOptional() @IsNumber() @Min(0) desconto?: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) validade?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) observacoes?: string | null;
  @IsOptional() @IsUUID() ownerId?: string | null;
}
class CriarPropostaDto extends PropostaDto {
  @IsString() @MaxLength(160) declare titulo: string;
}
class AcaoPropostaDto {
  @IsIn(['enviar', 'aceitar', 'recusar', 'cancelar', 'reabrir']) acao!: AcaoProposta;
  @IsOptional() @IsString() @MaxLength(500) motivo?: string;
  @IsOptional() @IsBoolean() marcarNegocioPerdido?: boolean;
  @IsOptional() @IsInt() @Min(1) followupEmDias?: number;
}
class MarcarCarteiraDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('4', { each: true }) contactIds!: string[];
  @IsString() @MaxLength(40) tag!: string;
}
class OpcoesImportacaoDto {
  @IsOptional() @IsBoolean() atualizarExistentes?: boolean;
  @IsOptional() @IsString() @MaxLength(40) tagExtra?: string;
  @IsOptional() @IsString() @MaxLength(80) origem?: string;
  @IsOptional() @IsBoolean() dispararAutomacoes?: boolean;
  @IsOptional() @IsUUID() stageId?: string;
}
class ImportarContatosDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_LINHAS_POR_LOTE) @IsObject({ each: true }) linhas!: LinhaImportacao[];
  @IsOptional() @IsObject() opcoes?: OpcoesImportacaoDto;
  /** Número da 1ª linha deste lote no arquivo (para o relatório de erros). */
  @IsOptional() @IsInt() @Min(1) linhaInicial?: number;
}

/**
 * Comercial (ADR-0042): propostas, carteira de clientes e importação por
 * planilha. Rotas sob `crm/` para herdar a matriz de permissões do CRM.
 */
@Controller('crm')
export class ComercialController {
  constructor(
    private readonly propostas: ProposalsService,
    private readonly carteira: CarteiraService,
    private readonly importacao: ImportacaoService,
  ) {}

  // ---------------- Propostas ----------------
  @Get('proposals')
  listar(@TenantId() t: string, @Query('status') status?: string, @Query('contactId') contactId?: string, @Query('dealId') dealId?: string, @Query('q') q?: string) {
    return this.propostas.listar(t, { status, contactId: uuid(contactId), dealId: uuid(dealId), q });
  }
  @Get('proposals/:id')
  obter(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.propostas.obter(t, id);
  }
  @Post('proposals')
  criar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: CriarPropostaDto) {
    return this.propostas.criar(t, u.identityId, dto);
  }
  @Patch('proposals/:id')
  atualizar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PropostaDto) {
    return this.propostas.atualizar(t, id, dto);
  }
  @Post('proposals/:id/acao')
  @HttpCode(200)
  acao(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AcaoPropostaDto) {
    return this.propostas.transicionar(t, id, dto.acao, dto);
  }
  @Delete('proposals/:id')
  apagar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.propostas.apagar(t, id);
  }

  // ---------------- Carteira ----------------
  @Get('carteira')
  verCarteira(@TenantId() t: string, @Query('ativoDias') ativoDias?: string, @Query('riscoDias') riscoDias?: string) {
    return this.carteira.listar(t, { ativoDias: ativoDias ? Number(ativoDias) : undefined, riscoDias: riscoDias ? Number(riscoDias) : undefined });
  }
  @Post('carteira/marcar')
  @HttpCode(200)
  marcar(@TenantId() t: string, @Body() dto: MarcarCarteiraDto) {
    return this.carteira.marcar(t, dto.contactIds, dto.tag);
  }

  // ---------------- Importação ----------------
  @Post('import/contacts')
  @HttpCode(200)
  importar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: ImportarContatosDto) {
    return this.importacao.importarContatos(t, u.identityId, dto.linhas, dto.opcoes ?? {}, dto.linhaInicial ?? 1);
  }
}

function uuid(v?: string): string | undefined {
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined;
}
