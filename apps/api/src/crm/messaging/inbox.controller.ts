import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, TenantId, type AuthUser } from '../../auth/decorators';
import { SkipAudit } from '../../common/audit.interceptor';
import { InboxService } from './inbox.service';
import { ConversasService } from './conversas.service';
import { SugestoesService } from './sugestoes.service';

class MidiaDto {
  @IsIn(['imagem', 'documento', 'audio']) tipo!: 'imagem' | 'documento' | 'audio';
  @IsString() @MaxLength(120) mime!: string;
  @IsString() @MinLength(1) @MaxLength(200) nome!: string;
  /** ≤ 15 MB de arquivo ≈ 20,5 M caracteres em base64 (o parser da rota aceita 22 MB). */
  @IsString() @MinLength(4) @MaxLength(21_000_000) base64!: string;
  @IsOptional() @IsString() @MaxLength(1000) legenda?: string;
}
class NotaDto {
  @IsString() @MinLength(1) @MaxLength(4000) corpo!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) mencoes?: string[];
}
class IniciarConversaDto {
  @IsOptional() @IsUUID() contactId?: string;
  @IsIn(['WhatsApp']) canal!: 'WhatsApp';
  /** Número direto, sem contato cadastrado: a conversa cria o contato. */
  @IsOptional() @IsString() @MinLength(8) @MaxLength(20) telefone?: string;
  @IsOptional() @IsString() @MaxLength(120) nome?: string;
}
class MarcarDto {
  @IsIn(['resolvida', 'aberta', 'nao_lida']) acao!: 'resolvida' | 'aberta' | 'nao_lida';
}
class RespostaDto {
  @IsString() @MinLength(1) @MaxLength(33) atalho!: string;
  @IsString() @MinLength(1) @MaxLength(80) titulo!: string;
  @IsString() @MinLength(1) @MaxLength(4000) corpo!: string;
}
class RespostaParcialDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(33) atalho?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) titulo?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(4000) corpo?: string;
}

const CHAVE = /^[a-zA-Z0-9_-]{16,128}$/;

/**
 * Inbox (Q2.5). Mesmo prefixo `crm` do CrmController: o PermissionsGuard
 * mapeia `conversations/*` → conversations.read/reply e `quick-replies` →
 * contacts.read/write. Tenant SEMPRE do JWT.
 */
@Controller('crm')
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly conversas: ConversasService,
    private readonly sugestoes: SugestoesService,
  ) {}

  /** Contagens leves da coluna Canais/Status/Etiquetas (+ redes conectadas). */
  @Get('conversations/contagens')
  contagens(@TenantId() tenantId: string) {
    return this.conversas.contagens(tenantId);
  }

  /** "Marcar como": resolvida, aberta ou não lida. O serviço audita (`conversa.marcada`). */
  @SkipAudit()
  @Patch('conversations/:id/status')
  marcar(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MarcarDto) {
    if (user.role === 'viewer') throw new ForbiddenException('perfil somente leitura');
    return this.conversas.marcar(user.tenantId, id, dto.acao, user.identityId);
  }

  /** Sugestões da IA: rascunhos para o atendente revisar (nada é enviado nem gravado). */
  @SkipAudit()
  @HttpCode(200)
  @Post('conversations/:id/sugestoes')
  sugerir(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.sugestoes.sugerir(tenantId, id);
  }

  /** Mensagens + anexos (URL assinada na hora) + notas internas, em ordem. */
  @Get('conversations/:id/thread')
  thread(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.thread(tenantId, id);
  }

  @Get('conversations/:id/contexto')
  contexto(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.contexto(tenantId, id);
  }

  /** MessagesService audita o envio com o id da mensagem — sem linha genérica. */
  @SkipAudit()
  @Post('conversations/:id/midia')
  midia(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MidiaDto, @Headers('idempotency-key') key?: string) {
    if (!key || !CHAVE.test(key)) throw new BadRequestException('Idempotency-Key obrigatório (16–128 caracteres)');
    return this.inbox.enviarMidia(user.tenantId, id, dto, key, { tipo: 'humano', identityId: user.identityId });
  }

  /** O serviço audita (`conversa.nota_interna`). */
  @SkipAudit()
  @Post('conversations/:id/notas')
  nota(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NotaDto) {
    return this.inbox.criarNota(user.tenantId, id, user.identityId, dto.corpo, dto.mencoes ?? []);
  }

  /** O serviço audita (`conversa.iniciada`). */
  @SkipAudit()
  @Post('conversations')
  iniciar(@CurrentUser() user: AuthUser, @Body() dto: IniciarConversaDto) {
    if (user.role === 'viewer') throw new ForbiddenException('perfil somente leitura');
    return this.inbox.iniciarConversa(user.tenantId, { contactId: dto.contactId, telefone: dto.telefone, nome: dto.nome }, user.identityId);
  }

  @Get('quick-replies')
  respostas(@TenantId() tenantId: string) {
    return this.inbox.listarRespostas(tenantId);
  }

  @Post('quick-replies')
  criarResposta(@CurrentUser() user: AuthUser, @Body() dto: RespostaDto) {
    return this.inbox.criarResposta(user.tenantId, user.identityId, dto);
  }

  @Patch('quick-replies/:id')
  atualizarResposta(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespostaParcialDto) {
    return this.inbox.atualizarResposta(user.tenantId, user, id, dto);
  }

  @Delete('quick-replies/:id')
  removerResposta(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.removerResposta(user.tenantId, user, id);
  }
}
