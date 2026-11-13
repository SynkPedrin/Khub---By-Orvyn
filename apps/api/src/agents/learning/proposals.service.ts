import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AGENT_LLM, type AgentLlm } from '../../ai/provider.contract';
import { EvaluationService } from '../evaluation/evaluation.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { VersioningService } from '../versioning/versioning.service';
import { aplicarPropostaNoRascunho } from '../workers';
import { LearningService } from './learning.service';

/**
 * Decisão humana sobre uma proposta de melhoria (Learning §12.2, passos 9–12):
 *  - conhecimento → o humano escreve a resposta oficial; vira fonte do agente;
 *  - prompt/comportamento com patch → avaliação de regressão do rascunho+patch
 *    (assíncrona); sem regressão o patch entra no rascunho (e publica, se pedido);
 *    `forcar` aplica sem avaliação (registrado);
 *  - ferramenta → marcada como tratada (ação é humana: permissões/config).
 */
@Injectable()
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AGENT_LLM) private readonly llm: AgentLlm,
    private readonly aprendizado: LearningService,
    private readonly avaliacoes: EvaluationService,
    private readonly conhecimento: KnowledgeService,
    private readonly versoes: VersioningService,
  ) {}

  async aprovar(tenantId: string, identityId: string, propostaId: string, i: { conteudo?: string; publicar?: boolean; forcar?: boolean }) {
    const p = await this.aprendizado.obterProposta(tenantId, propostaId);
    if (!['aberta', 'aprovada'].includes(p.status)) throw new BadRequestException(`proposta está ${p.status}`);

    if (p.tipo === 'conhecimento' && !p.patch) {
      const conteudo = i.conteudo?.trim();
      if (!conteudo || conteudo.length < 20) throw new BadRequestException('escreva a resposta oficial (mínimo 20 caracteres) — a base só recebe conteúdo validado pela empresa');
      const fonte = await this.conhecimento.adicionar(tenantId, p.agentId, identityId, { tipo: 'faq', titulo: p.titulo.replace(/^Base sem resposta para /, 'FAQ: ').slice(0, 200), categoria: 'aprendizado', texto: conteudo });
      await this.aprendizado.marcar(tenantId, propostaId, { status: 'aplicada', decididoPor: identityId });
      return { status: 'aplicada', fonte };
    }
    if (!p.patch) {
      await this.aprendizado.marcar(tenantId, propostaId, { status: 'aprovada', decididoPor: identityId });
      return { status: 'aprovada' };
    }
    if (i.forcar || !this.llm.configured()) {
      if (!i.forcar) throw new BadRequestException('sem IA configurada a proposta não pode ser avaliada; use "aplicar sem avaliação" se tiver certeza');
      await aplicarPropostaNoRascunho(this.prisma, tenantId, p.agentId, p.patch);
      await this.aprendizado.marcar(tenantId, propostaId, { status: 'aplicada', decididoPor: identityId });
      const publicacao = i.publicar ? await this.versoes.publicar(tenantId, { identityId }, p.agentId, { notas: `Proposta aplicada sem avaliação: ${p.titulo}`, origem: 'proposta', propostaId, forcar: true }) : null;
      return { status: 'aplicada', avaliada: false, publicacao };
    }
    const av = await this.avaliacoes.iniciar(tenantId, p.agentId, identityId, { alvo: 'proposta', propostaId, publicarSeAprovada: !!i.publicar });
    await this.aprendizado.marcar(tenantId, propostaId, { status: 'em_avaliacao', avaliacaoId: av.id, decididoPor: identityId });
    return { status: 'em_avaliacao', avaliacaoId: av.id };
  }
}
