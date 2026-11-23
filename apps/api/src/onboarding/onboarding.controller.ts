import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/decorators';
import { SkipAudit } from '../common/audit.interceptor';
import { OnboardingService } from './onboarding.service';

/**
 * Onboarding KROMA (db/078): `/v1/agency/onboarding/*`. Escopo = agência da
 * identidade logada; o corpo é validado com Zod no service (mesmo padrão do
 * Daily). O prefixo global `v1` vem de main.ts.
 *
 * `@SkipAudit`: dado da agência, não de um tenant — o interceptor global
 * gravaria no tenant atual da sessão. A auditoria é manual no service.
 */
@SkipAudit()
@Controller('agency/onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  /** Visão executiva: lista com contagens + contadores por status (filtros via query). */
  @Get()
  visaoExecutiva(@CurrentUser() u: AuthUser, @Query() q: Record<string, unknown>) {
    return this.onboarding.visaoExecutiva(u.identityId, q);
  }

  @Post()
  iniciar(@CurrentUser() u: AuthUser, @Body() body: Record<string, unknown>) {
    return this.onboarding.iniciar(u.identityId, body);
  }

  @Get(':id')
  detalhe(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.detalhe(u.identityId, id);
  }

  /** Status/etapa/responsável/escopo. Mudança de escopo por member vira aprovação pendente. */
  @Patch(':id')
  atualizar(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.onboarding.atualizar(u.identityId, id, body);
  }

  @Put(':id/conhecimento/:secao')
  atualizarConhecimento(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('secao') secao: string, @Body() body: Record<string, unknown>) {
    return this.onboarding.atualizarConhecimento(u.identityId, id, secao, body);
  }

  @Get(':id/conhecimento/:secao/historico')
  historicoConhecimento(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('secao') secao: string) {
    return this.onboarding.historicoConhecimento(u.identityId, id, secao);
  }

  @Post(':id/reunioes')
  registrarReuniao(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.onboarding.registrarReuniao(u.identityId, id, body);
  }

  @Patch(':id/reunioes/:mid')
  atualizarReuniao(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('mid', ParseUUIDPipe) mid: string, @Body() body: Record<string, unknown>) {
    return this.onboarding.atualizarReuniao(u.identityId, id, mid, body);
  }

  /** Cria as tarefas do template no Daily (dedupe por título). */
  @Post(':id/tarefas/gerar')
  gerarTarefas(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body?: Record<string, unknown>) {
    return this.onboarding.gerarTarefas(u.identityId, id, body ?? {});
  }

  /** Roda ferramenta de LEITURA do Genna na subconta e salva o relatório. */
  @Post(':id/relatorios/genna')
  @HttpCode(200)
  relatorioGenna(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.onboarding.salvarRelatorioGenna(u.identityId, id, body);
  }

  @Get(':id/relatorios')
  relatorios(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.listarRelatorios(u.identityId, id);
  }

  @Put(':id/agente')
  salvarSpecAgente(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.onboarding.salvarSpecAgente(u.identityId, id, body);
  }

  @Post(':id/agente/testes')
  registrarTesteAgente(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.onboarding.registrarResultadoTesteAgente(u.identityId, id, body);
  }

  /** Painel de conferência: seções agregadas com deep-links. */
  @Get(':id/conferencia')
  conferencia(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.conferencia(u.identityId, id);
  }

  @Post(':id/verificacoes/:chave')
  verificar(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('chave') chave: string, @Body() body: Record<string, unknown>) {
    return this.onboarding.verificar(u.identityId, id, chave, body);
  }

  @Post(':id/aprovacoes')
  solicitarAprovacao(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.onboarding.solicitarAprovacao(u.identityId, id, body);
  }

  /** Decidir exige owner/admin da agência (o service confere). */
  @Post(':id/aprovacoes/:aid/decisao')
  decidirAprovacao(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('aid', ParseUUIDPipe) aid: string, @Body() body: Record<string, unknown>) {
    return this.onboarding.decidirAprovacao(u.identityId, aid, body);
  }

  /** Finalização com revalidação server-side da homologação. Só owner/admin. */
  @Post(':id/finalizar')
  @HttpCode(200)
  finalizar(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.finalizar(u.identityId, id);
  }
}
