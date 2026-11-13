import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { RagEscopo } from '@khub/types';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { SkipAudit } from '../common/audit.interceptor';
import { AgentsService } from './agents.service';
import { AgentToolsService } from './agent-tools.service';
import { AgentAnalyticsService } from './analytics/agent-analytics.service';
import { DeliveryService } from './delivery/delivery.service';
import { EvaluationService } from './evaluation/evaluation.service';
import { FollowupService } from './followup/followup.service';
import { MemoryService } from './intelligence/memory.service';
import { ProfileService } from './intelligence/profile.service';
import { KnowledgeService } from './knowledge/knowledge.service';
import { TIPOS_FONTE, type TipoFonte } from './knowledge/text-extraction';
import { LearningService } from './learning/learning.service';
import { ProposalsService } from './learning/proposals.service';
import { SimulatorService } from './simulator/simulator.service';
import { VersioningService } from './versioning/versioning.service';
import { fragmentacaoSchema, resolverConfig } from './config/agent-config';
import { fragmentarMensagem } from './engines/message-chunker';
import { PrismaService } from '../prisma/prisma.service';

// ------------------------------------------------------------------ DTOs (forma; a regra é do serviço)

class AgenteDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) nome?: string;
  @IsOptional() @IsString() @MaxLength(300) descricao?: string;
  @IsOptional() @IsString() @MaxLength(80) modelo?: string;
  @IsOptional() @IsString() @MaxLength(8000) instrucoes?: string;
  @IsOptional() @IsString() @MaxLength(40) tom?: string;
  @IsOptional() @IsString() @MaxLength(1000) personalidade?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) ferramentas?: string[];
  @IsOptional() @IsBoolean() conhecimentoAtivo?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsString({ each: true }) conhecimentoEscopos?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(200) maxRespostasConversa?: number;
  @IsOptional() @IsInt() @Min(80) @Max(2000) maxCaracteres?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) canais?: string[];
  @IsOptional() @IsBoolean() padrao?: boolean;
  /** Seções da configuração estendida — validadas por Zod no serviço. */
  @IsOptional() @IsObject() config?: Record<string, unknown>;
}
class StatusDto {
  @IsIn(['ativo', 'pausado', 'arquivado']) status!: 'ativo' | 'pausado' | 'arquivado';
}
class DuplicarDto {
  @IsOptional() @IsString() @MaxLength(80) nome?: string;
}
class ExcluirDto {
  @IsString() @MinLength(1) @MaxLength(80) confirmacao!: string;
}
class IntencaoDto {
  @IsString() @Matches(/^[a-z][a-z0-9_]{1,39}$/) chave!: string;
  @IsString() @MinLength(1) @MaxLength(60) nome!: string;
  @IsOptional() @IsString() @MaxLength(400) descricao?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) exemplos?: string[];
  @IsOptional() @IsBoolean() ativo?: boolean;
}
class PerfilPersonalidadeDto {
  @IsString() @MinLength(1) @MaxLength(60) nome!: string;
  @IsObject() valores!: Record<string, number>;
}
class FonteDto {
  @IsIn(TIPOS_FONTE as unknown as string[]) tipo!: TipoFonte;
  @IsString() @MinLength(1) @MaxLength(200) titulo!: string;
  @IsOptional() @IsString() @MaxLength(60) categoria?: string;
  @IsOptional() @IsString() @MaxLength(600_000) texto?: string;
  @IsOptional() @IsString() @MaxLength(2000) url?: string;
  @IsOptional() @IsString() @MaxLength(21_000_000) arquivoBase64?: string;
  @IsOptional() @IsString() @MaxLength(255) nomeArquivo?: string;
}
class FonteUpdateDto {
  @IsOptional() @IsString() @MaxLength(60) categoria?: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
  @IsOptional() @IsString() @MaxLength(200) titulo?: string;
}
class VincularDto {
  @IsUUID() documentId!: string;
  @IsOptional() @IsString() @MaxLength(60) categoria?: string;
}
class TestarConhecimentoDto {
  @IsString() @MinLength(2) @MaxLength(500) pergunta!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) categorias?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsIn(['tenant', 'sub', 'nicho', 'global'], { each: true }) escopos?: RagEscopo[];
}
class MemoriaDto {
  @IsOptional() @IsUUID() contactId?: string;
  @IsIn(['curto', 'longo', 'operacional']) camada!: 'curto' | 'longo' | 'operacional';
  @IsIn(['fato', 'preferencia', 'evento', 'objetivo', 'tarefa', 'compromisso', 'proximo_passo']) tipo!: string;
  @IsString() @MinLength(1) @MaxLength(6000) conteudo!: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) importancia?: number;
}
class MemoriaUpdateDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(6000) conteudo?: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) importancia?: number;
}
class FatoDto {
  @IsIn(['confirmar', 'rejeitar', 'editar']) acao!: 'confirmar' | 'rejeitar' | 'editar';
  @IsOptional() @IsString() @MaxLength(400) valor?: string;
}
class ConversaoDto {
  @IsBoolean() convertido!: boolean;
  @IsOptional() @IsString() @MaxLength(300) motivoNaoConversao?: string;
}
class RegraFollowupDto {
  @IsOptional() @IsBoolean() ativo?: boolean;
  @IsOptional() @IsString() @MaxLength(80) nome?: string;
  @IsOptional() @IsInt() @Min(1) @Max(10) maxTentativas?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsInt({ each: true }) intervalosHoras?: number[];
  @IsOptional() @IsInt() @Min(0) @Max(23) horarioInicio?: number;
  @IsOptional() @IsInt() @Min(1) @Max(24) horarioFim?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) diasSemana?: number[];
  @IsOptional() @IsString() @MaxLength(60) fuso?: string;
  @IsOptional() @IsString() @MaxLength(500) objetivo?: string;
  @IsOptional() @IsString() @MaxLength(200) tom?: string;
  @IsOptional() @IsString() @MaxLength(2000) instrucoes?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) pararSe?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(5) maxMensagensDia?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10) prioridade?: number;
}
class ReagendarDto {
  @IsDateString() para!: string;
}
class IniciarFollowupDto {
  @IsUUID() contactId!: string;
  @IsString() @MaxLength(40) estrategia!: string;
}
class AprovarPropostaDto {
  @IsOptional() @IsString() @MaxLength(20000) conteudo?: string;
  @IsOptional() @IsBoolean() publicar?: boolean;
  @IsOptional() @IsBoolean() forcar?: boolean;
}
class FeedbackDto {
  @IsIn([1, -1]) nota!: 1 | -1;
  @IsOptional() @IsUUID() messageId?: string;
  @IsOptional() @IsUUID() conversationId?: string;
  @IsOptional() @IsString() @MaxLength(1000) comentario?: string;
  @IsOptional() @IsString() @MaxLength(2000) respostaSugerida?: string;
}
class MensagemCenarioDto {
  @IsIn(['contato', 'ia']) de!: 'contato' | 'ia';
  @IsString() @MinLength(1) @MaxLength(2000) texto!: string;
}
class CenarioDto {
  @IsString() @MinLength(1) @MaxLength(120) nome!: string;
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => MensagemCenarioDto) mensagens!: MensagemCenarioDto[];
  @IsOptional() @IsObject() expectativas?: Record<string, unknown>;
}
class CenarioUpdateDto {
  @IsOptional() @IsString() @MaxLength(120) nome?: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
  @IsOptional() @IsObject() expectativas?: Record<string, unknown>;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => MensagemCenarioDto) mensagens?: MensagemCenarioDto[];
}
class AvaliacaoDto {
  @IsIn(['rascunho', 'versao']) alvo!: 'rascunho' | 'versao';
  @IsOptional() @IsUUID() versionId?: string;
}
class PublicarDto {
  @IsOptional() @IsString() @MaxLength(2000) notas?: string;
  @IsOptional() @IsBoolean() forcar?: boolean;
}
class SimulacaoDto {
  @IsOptional() @IsString() @MaxLength(40) perfil?: string;
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsBoolean() usarRascunho?: boolean;
}
class TurnoDto {
  @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) @MaxLength(2000, { each: true }) mensagens!: string[];
}
class PreviaFragmentacaoDto {
  @IsString() @MinLength(1) @MaxLength(4000) texto!: string;
  @IsObject() fragmentacao!: Record<string, unknown>;
}
class CenarioDeSimulacaoDto {
  @IsString() @MinLength(1) @MaxLength(120) nome!: string;
  @IsOptional() @IsObject() expectativas?: Record<string, unknown>;
}

const dias = (v?: string) => Math.min(365, Math.max(1, Number(v) || 30));

/**
 * Rotas com 1º segmento FIXO (perfis/…, simulacoes/…, propostas/…) ficam nos
 * controllers abaixo; o AgentsController (com `:id`) é registrado por último
 * no módulo para não capturar esses caminhos.
 */

/** Knowledge Base Manager. */
@Controller('agents')
export class AgentKnowledgeController {
  constructor(private readonly conhecimento: KnowledgeService) {}

  @Get(':id/conhecimento')
  listar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.conhecimento.listar(t, id);
  }
  @SkipAudit()
  @Post(':id/conhecimento')
  adicionar(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FonteDto) {
    return this.conhecimento.adicionar(u.tenantId, id, u.identityId, dto);
  }
  @Get(':id/conhecimento-disponivel')
  disponiveis(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.conhecimento.disponiveis(t, id);
  }
  @Post(':id/conhecimento-vincular')
  vincular(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VincularDto) {
    return this.conhecimento.vincular(t, id, dto.documentId, dto.categoria);
  }
  @Post(':id/conhecimento-testar')
  testar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TestarConhecimentoDto) {
    return this.conhecimento.testar(t, id, dto.pergunta, { categorias: dto.categorias, escopos: dto.escopos });
  }
  @Patch(':id/conhecimento/:fonteId')
  atualizar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Param('fonteId', ParseUUIDPipe) fonteId: string, @Body() dto: FonteUpdateDto) {
    return this.conhecimento.atualizar(t, id, fonteId, dto);
  }
  @Post(':id/conhecimento/:fonteId/reprocessar')
  reprocessar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Param('fonteId', ParseUUIDPipe) fonteId: string) {
    return this.conhecimento.reprocessar(t, id, fonteId);
  }
  @Get(':id/conhecimento/:fonteId/conteudo')
  conteudo(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Param('fonteId', ParseUUIDPipe) fonteId: string) {
    return this.conhecimento.conteudo(t, id, fonteId);
  }
  @Delete(':id/conhecimento/:fonteId')
  remover(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Param('fonteId', ParseUUIDPipe) fonteId: string) {
    return this.conhecimento.remover(t, id, fonteId);
  }
}

/** Memória, Customer Intelligence, follow-up, entregas, ferramentas, analytics e logs. */
@Controller('agents')
export class AgentOperationsController {
  constructor(
    private readonly memoria: MemoryService,
    private readonly perfis: ProfileService,
    private readonly followups: FollowupService,
    private readonly entregas: DeliveryService,
    private readonly tools: AgentToolsService,
    private readonly analytics: AgentAnalyticsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('dashboard')
  dashboard(@TenantId() t: string, @Query('dias') d?: string) {
    return this.analytics.dashboard(t, dias(d));
  }
  @Get('aprovacoes')
  aprovacoes(@TenantId() t: string) {
    return this.prisma.withTenant(t, (tx) => tx.agentToolExecution.findMany({ where: { status: 'aguardando_aprovacao' }, orderBy: { createdAt: 'desc' }, take: 100 }));
  }
  @Post('ferramentas/:execId/aprovar')
  aprovar(@CurrentUser() u: AuthUser, @Param('execId', ParseUUIDPipe) execId: string) {
    return this.tools.aprovar(u.tenantId, execId, u.identityId);
  }
  @Post('ferramentas/:execId/rejeitar')
  rejeitar(@CurrentUser() u: AuthUser, @Param('execId', ParseUUIDPipe) execId: string) {
    return this.tools.rejeitar(u.tenantId, execId, u.identityId);
  }

  @Get('perfis/:contactId')
  perfil(@TenantId() t: string, @Param('contactId', ParseUUIDPipe) contactId: string) {
    return this.perfis.obter(t, contactId);
  }
  @Post('perfis/:contactId/fatos/:campo')
  fato(@CurrentUser() u: AuthUser, @Param('contactId', ParseUUIDPipe) contactId: string, @Param('campo') campo: string, @Body() dto: FatoDto) {
    return this.perfis.decidirFato(u.tenantId, contactId, campo, dto.acao, dto.valor, u.identityId);
  }
  @Post('perfis/:contactId/conversao')
  conversao(@TenantId() t: string, @Param('contactId', ParseUUIDPipe) contactId: string, @Body() dto: ConversaoDto) {
    return this.perfis.marcarConversao(t, contactId, dto.convertido, dto.motivoNaoConversao);
  }
  /** LGPD: apaga a inteligência derivada do contato. */
  @Delete('perfis/:contactId')
  excluirPerfil(@CurrentUser() u: AuthUser, @Param('contactId', ParseUUIDPipe) contactId: string) {
    return this.perfis.excluirDados(u.tenantId, contactId, u.identityId);
  }

  @Get(':id/memorias')
  memorias(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Query('contactId') contactId?: string, @Query('camada') camada?: string, @Query('cursor') cursor?: string) {
    return this.memoria.listar(t, { agentId: contactId ? undefined : id, contactId: contactId || undefined, camada: camada || undefined, cursor: cursor || undefined });
  }
  @Post(':id/memorias')
  async criarMemoria(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MemoriaDto) {
    const a = await this.prisma.withTenant(t, (tx) => tx.agent.findUnique({ where: { id }, select: { config: true } }));
    return this.memoria.criar(t, { contactId: dto.contactId ?? null, agentId: id, camada: dto.camada, tipo: dto.tipo, conteudo: dto.conteudo, importancia: dto.importancia, origem: 'humano' }, resolverConfig(a?.config).config.memoria.retencaoDias);
  }
  @Patch('memorias/:memId')
  atualizarMemoria(@TenantId() t: string, @Param('memId', ParseUUIDPipe) memId: string, @Body() dto: MemoriaUpdateDto) {
    return this.memoria.atualizar(t, memId, dto);
  }
  @Delete('memorias/:memId')
  removerMemoria(@TenantId() t: string, @Param('memId', ParseUUIDPipe) memId: string) {
    return this.memoria.remover(t, memId);
  }

  @Get(':id/followups/regras')
  regras(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.followups.regras(t, id);
  }
  @Patch(':id/followups/regras/:estrategia')
  salvarRegra(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Param('estrategia') estrategia: string, @Body() dto: RegraFollowupDto) {
    return this.followups.salvarRegra(t, id, estrategia, dto);
  }
  @Get(':id/followups')
  followupsLista(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Query('status') status?: string, @Query('contactId') contactId?: string) {
    return this.followups.listar(t, { agentId: id, status: status || undefined, contactId: contactId || undefined });
  }
  @Post(':id/followups/iniciar')
  iniciarFollowup(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: IniciarFollowupDto) {
    return this.followups.iniciarManual(t, id, dto.contactId, dto.estrategia);
  }
  @Post('followups/:fid/cancelar')
  cancelarFollowup(@CurrentUser() u: AuthUser, @Param('fid', ParseUUIDPipe) fid: string) {
    return this.followups.cancelar(u.tenantId, fid, u.identityId);
  }
  @Post('followups/:fid/reagendar')
  reagendar(@TenantId() t: string, @Param('fid', ParseUUIDPipe) fid: string, @Body() dto: ReagendarDto) {
    return this.followups.reagendar(t, fid, new Date(dto.para));
  }

  @Get(':id/entregas')
  entregasLista(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Query('status') status?: string) {
    return this.entregas.listar(t, { agentId: id, status: status || undefined });
  }
  @Get(':id/ferramentas')
  execucoes(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Query('status') status?: string) {
    return this.analytics.ferramentas(t, id, { status: status || undefined });
  }
  @Get(':id/analytics')
  analyticsAgente(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Query('dias') d?: string) {
    return this.analytics.agente(t, id, dias(d));
  }
  @Get(':id/logs')
  logs(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Query('status') status?: string, @Query('intencao') intencao?: string, @Query('cursor') cursor?: string) {
    return this.analytics.logs(t, id, { status: status || undefined, intencao: intencao || undefined, cursor: cursor || undefined });
  }
}

/** Learning Center, avaliações, versões e simulador. */
@Controller('agents')
export class AgentLearningController {
  constructor(
    private readonly aprendizado: LearningService,
    private readonly propostas: ProposalsService,
    private readonly avaliacoes: EvaluationService,
    private readonly versoes: VersioningService,
    private readonly simulador: SimulatorService,
  ) {}

  @Get('simulador/personas')
  personas() {
    return this.simulador.personas();
  }
  @Get('simulacoes/:sid')
  simulacao(@TenantId() t: string, @Param('sid', ParseUUIDPipe) sid: string) {
    return this.simulador.obter(t, sid);
  }
  @SkipAudit()
  @Post('simulacoes/:sid/turno')
  turno(@TenantId() t: string, @Param('sid', ParseUUIDPipe) sid: string, @Body() dto: TurnoDto) {
    return this.simulador.turno(t, sid, dto.mensagens);
  }
  @SkipAudit()
  @Post('simulacoes/:sid/cliente')
  cliente(@TenantId() t: string, @Param('sid', ParseUUIDPipe) sid: string) {
    return this.simulador.gerarMensagemCliente(t, sid);
  }
  @Post('simulacoes/:sid/cenario')
  async cenarioDaSimulacao(@TenantId() t: string, @Param('sid', ParseUUIDPipe) sid: string, @Body() dto: CenarioDeSimulacaoDto) {
    const sim = await this.simulador.obter(t, sid);
    return this.avaliacoes.criarCenario(t, sim.agentId, { nome: dto.nome, mensagens: this.simulador.mensagensParaCenario(sim), expectativas: dto.expectativas ?? {}, origem: 'conversa' });
  }
  @Delete('simulacoes/:sid')
  removerSimulacao(@TenantId() t: string, @Param('sid', ParseUUIDPipe) sid: string) {
    return this.simulador.remover(t, sid);
  }
  @Get(':id/simulacoes')
  simulacoes(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.simulador.listar(t, id);
  }
  @Post(':id/simulacoes')
  criarSimulacao(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SimulacaoDto) {
    return this.simulador.criar(u.tenantId, id, u.identityId, dto);
  }

  @Get(':id/aprendizado')
  resumo(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.aprendizado.resumo(t, id);
  }
  @Get(':id/aprendizado/eventos')
  eventos(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Query('tipo') tipo?: string, @Query('cursor') cursor?: string) {
    return this.aprendizado.eventos(t, id, { tipo: tipo || undefined, cursor: cursor || undefined });
  }
  @Post(':id/aprendizado/analisar')
  analisar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.aprendizado.analisar(t, id);
  }
  @Post(':id/feedback')
  feedback(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FeedbackDto) {
    return this.aprendizado.feedback(t, id, dto);
  }
  @Get(':id/propostas')
  listarPropostas(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Query('status') status?: string) {
    return this.aprendizado.listarPropostas(t, id, status || undefined);
  }
  @Post('propostas/:pid/aprovar')
  aprovarProposta(@CurrentUser() u: AuthUser, @Param('pid', ParseUUIDPipe) pid: string, @Body() dto: AprovarPropostaDto) {
    return this.propostas.aprovar(u.tenantId, u.identityId, pid, dto);
  }
  @Post('propostas/:pid/rejeitar')
  rejeitarProposta(@CurrentUser() u: AuthUser, @Param('pid', ParseUUIDPipe) pid: string) {
    return this.aprendizado.rejeitar(u.tenantId, pid, u.identityId);
  }

  @Get(':id/cenarios')
  cenarios(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.avaliacoes.cenarios(t, id);
  }
  @Post(':id/cenarios')
  criarCenario(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CenarioDto) {
    return this.avaliacoes.criarCenario(t, id, { nome: dto.nome, mensagens: dto.mensagens, expectativas: dto.expectativas ?? {} });
  }
  @Patch(':id/cenarios/:cid')
  atualizarCenario(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Param('cid', ParseUUIDPipe) cid: string, @Body() dto: CenarioUpdateDto) {
    return this.avaliacoes.atualizarCenario(t, id, cid, dto);
  }
  @Delete(':id/cenarios/:cid')
  removerCenario(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Param('cid', ParseUUIDPipe) cid: string) {
    return this.avaliacoes.removerCenario(t, id, cid);
  }
  @Get('avaliacoes/:aid')
  avaliacao(@TenantId() t: string, @Param('aid', ParseUUIDPipe) aid: string) {
    return this.avaliacoes.obter(t, aid);
  }
  @Get(':id/avaliacoes')
  listarAvaliacoes(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.avaliacoes.listar(t, id);
  }
  @Post(':id/avaliacoes')
  iniciarAvaliacao(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AvaliacaoDto) {
    return this.avaliacoes.iniciar(u.tenantId, id, u.identityId, dto);
  }

  @Get(':id/versoes')
  versoesLista(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.versoes.historico(t, id);
  }
  @Get(':id/versoes-diff')
  diff(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Query('versionId') versionId?: string) {
    return this.versoes.diffRascunho(t, id, versionId || undefined);
  }
  @Get(':id/versoes/:vid')
  versao(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string) {
    return this.versoes.obter(t, id, vid);
  }
  @SkipAudit()
  @Post(':id/publicar')
  publicar(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PublicarDto) {
    return this.versoes.publicar(u.tenantId, u, id, { notas: dto.notas, forcar: dto.forcar });
  }
  @SkipAudit()
  @Post(':id/versoes/:vid/restaurar')
  restaurar(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string) {
    return this.versoes.restaurar(u.tenantId, u, id, vid);
  }
}

/** Agent Manager (RV-03.2 · ADR-0030). Tenant SEMPRE do JWT. Registrado por último. */
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentes: AgentsService) {}

  @Get('catalogo')
  catalogo(@TenantId() t: string) {
    return this.agentes.catalogo(t);
  }
  @Get('arquivados')
  arquivados(@TenantId() t: string) {
    return this.agentes.arquivados(t);
  }
  @Get('intencoes')
  intencoes(@TenantId() t: string) {
    return this.agentes.intencoes(t);
  }
  @Post('intencoes')
  salvarIntencao(@CurrentUser() u: AuthUser, @Body() dto: IntencaoDto) {
    return this.agentes.salvarIntencao(u.tenantId, u, dto);
  }
  @Delete('intencoes/:iid')
  removerIntencao(@CurrentUser() u: AuthUser, @Param('iid', ParseUUIDPipe) iid: string) {
    return this.agentes.removerIntencao(u.tenantId, u, iid);
  }
  /** Prévia do Message Chunking Engine (mesmo código do atendimento). */
  @SkipAudit()
  @Post('fragmentar-previa')
  previa(@Body() dto: PreviaFragmentacaoDto) {
    const r = fragmentacaoSchema.safeParse(dto.fragmentacao);
    if (!r.success) throw new BadRequestException({ title: 'configuração de fragmentação inválida', problemas: r.error.issues.map((i) => ({ campo: i.path.join('.'), erro: i.message })) });
    return fragmentarMensagem(dto.texto, r.data);
  }
  @Post('personalidades')
  salvarPerfil(@CurrentUser() u: AuthUser, @Body() dto: PerfilPersonalidadeDto) {
    return this.agentes.salvarPerfilPersonalidade(u.tenantId, u, dto);
  }

  @Get()
  listar(@TenantId() t: string) {
    return this.agentes.listar(t);
  }
  @SkipAudit()
  @Post()
  criar(@CurrentUser() u: AuthUser, @Body() dto: AgenteDto) {
    return this.agentes.criar(u.tenantId, u, dto);
  }
  @Get(':id')
  obter(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.agentes.obter(t, id);
  }
  @SkipAudit()
  @Patch(':id')
  atualizar(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AgenteDto) {
    return this.agentes.atualizar(u.tenantId, u, id, dto);
  }
  @SkipAudit()
  @Post(':id/status')
  status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) {
    return this.agentes.mudarStatus(u.tenantId, u, id, dto.status);
  }
  @SkipAudit()
  @Post(':id/duplicar')
  duplicar(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DuplicarDto) {
    return this.agentes.duplicar(u.tenantId, u, id, dto.nome);
  }
  @SkipAudit()
  @Delete(':id')
  excluir(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ExcluirDto) {
    return this.agentes.excluir(u.tenantId, u, id, dto.confirmacao);
  }
}
