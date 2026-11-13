import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { RagEscopo, RagHit } from '@khub/types';
import { PrismaService } from '../../prisma/prisma.service';
import { IngestionService } from '../../rag/ingestion/ingestion.service';
import { RetrievalService } from '../../rag/retrieval.service';
import { resolverConfig } from '../config/agent-config';
import { baixarPagina, ErroExtracao, extrairConteudo, TIPOS_FONTE, type TipoFonte } from './text-extraction';

const MIME: Record<TipoFonte, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  markdown: 'text/markdown',
  csv: 'text/csv',
  url: 'text/html',
  texto: 'text/markdown',
  faq: 'text/markdown',
  catalogo: 'text/markdown',
  comercial: 'text/markdown',
};

export interface NovaFonte {
  tipo: TipoFonte;
  titulo: string;
  categoria?: string;
  texto?: string;
  url?: string;
  /** Arquivo em base64 (PDF/DOCX/TXT/CSV/MD). */
  arquivoBase64?: string;
  nomeArquivo?: string;
}

export interface ConfiancaBusca {
  nivel: 'alta' | 'media' | 'baixa' | 'nenhuma';
  motivo: string;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'e', 'em', 'um', 'uma', 'para', 'pra', 'com', 'que', 'qual', 'quais', 'como', 'por', 'no', 'na', 'nos', 'nas', 'se', 'eu', 'voce', 'vcs', 'tem', 'ter', 'e', 'é']);

/**
 * Confiança da recuperação (o reranker de base, RRF, não é calibrado, então
 * não dá para comparar score com limiar absoluto): cobertura dos termos da
 * pergunta no melhor trecho + quantidade de trechos.
 */
export function avaliarConfianca(pergunta: string, hits: Pick<RagHit, 'conteudo' | 'titulo'>[]): ConfiancaBusca {
  if (!hits.length) return { nivel: 'nenhuma', motivo: 'nenhum trecho encontrado' };
  const termos = [...new Set(norm(pergunta).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2 && !STOP.has(t)))];
  if (!termos.length) return { nivel: 'media', motivo: 'pergunta sem termos significativos' };
  const cobertura = Math.max(...hits.slice(0, 3).map((h) => {
    const alvo = norm(`${h.titulo} ${h.conteudo}`);
    return termos.filter((t) => alvo.includes(t)).length / termos.length;
  }));
  if (cobertura >= 0.6 && hits.length >= 1) return { nivel: 'alta', motivo: `${Math.round(cobertura * 100)}% dos termos no melhor trecho` };
  if (cobertura >= 0.3) return { nivel: 'media', motivo: `${Math.round(cobertura * 100)}% dos termos no melhor trecho` };
  return { nivel: 'baixa', motivo: `só ${Math.round(cobertura * 100)}% dos termos aparecem nos trechos` };
}

const RE_VALOR = /r\$\s?([\d.]+(?:,\d{1,2})?)/gi;

/**
 * Informação conflitante: documentos DIFERENTES entre os melhores trechos que
 * citam o mesmo assunto com valores monetários diferentes. O agente é avisado
 * para não escolher um e confirmar com a equipe.
 */
export function detectarConflitos(hits: Pick<RagHit, 'documentId' | 'titulo' | 'conteudo'>[]): string[] {
  const porDoc = new Map<string, { titulo: string; valores: Set<string> }>();
  for (const h of hits.slice(0, 5)) {
    const vals = [...h.conteudo.matchAll(RE_VALOR)].map((m) => m[1].replace(/\./g, '').replace(',', '.'));
    if (!vals.length) continue;
    const atual = porDoc.get(h.documentId) ?? { titulo: h.titulo, valores: new Set<string>() };
    vals.forEach((v) => atual.valores.add(String(Number(v))));
    porDoc.set(h.documentId, atual);
  }
  if (porDoc.size < 2) return [];
  const docs = [...porDoc.values()];
  const conflitos: string[] = [];
  for (let i = 0; i < docs.length; i++) for (let j = i + 1; j < docs.length; j++) {
    const a = docs[i];
    const b = docs[j];
    const comuns = [...a.valores].filter((v) => b.valores.has(v));
    if (!comuns.length) conflitos.push(`"${a.titulo}" e "${b.titulo}" citam valores diferentes (${[...a.valores].join(', ')} × ${[...b.valores].join(', ')})`);
  }
  return conflitos;
}

/**
 * KNOWLEDGE ENGINE (docs/AI_AGENT_ARCHITECTURE.md §7)
 *
 * Reaproveita o RAG existente (rag_documents/rag_chunks, chunking estrutural,
 * embeddings Voyage, busca híbrida RRF, RLS). Este serviço adiciona o que
 * faltava para o produto: fontes por agente, extração de PDF/DOCX/CSV/URL,
 * categorias, ativação, reprocessamento, visualização e testador.
 * Sem chave de embedding, o documento é indexado só para busca lexical e
 * pode ser reindexado depois — nunca fica inutilizável.
 */
@Injectable()
export class KnowledgeService {
  private readonly log = new Logger('AgentKnowledge');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: IngestionService,
    private readonly retrieval: RetrievalService,
  ) {}

  async listar(tenantId: string, agentId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.exigirAgente(tx, agentId);
      const fontes = await tx.agentKnowledgeSource.findMany({ where: { agentId }, orderBy: { createdAt: 'desc' } });
      const docs = await tx.ragDocument.findMany({
        where: { id: { in: fontes.map((f) => f.documentId) } },
        select: { id: true, titulo: true, fonte: true, uri: true, mime: true, status: true, erro: true, metadados: true, versao: true, createdAt: true, updatedAt: true, publishedAt: true },
      });
      const contagem = await tx.ragChunk.groupBy({ by: ['documentId'], where: { documentId: { in: fontes.map((f) => f.documentId) } }, _count: { _all: true } });
      const porId = new Map(docs.map((d) => [d.id, d]));
      const chunks = new Map(contagem.map((c) => [c.documentId, c._count._all]));
      const itens = fontes
        .filter((f) => porId.has(f.documentId))
        .map((f) => {
          const d = porId.get(f.documentId)!;
          const meta = (d.metadados ?? {}) as Record<string, unknown>;
          return {
            id: f.id,
            documentId: d.id,
            titulo: d.titulo,
            tipo: d.fonte,
            uri: d.uri,
            mime: d.mime,
            status: d.status,
            erro: d.erro,
            indexacao: (meta.indexacao as string | undefined) ?? null,
            tamanhoBytes: (meta.tamanhoBytes as number | undefined) ?? null,
            caracteres: (meta.caracteres as number | undefined) ?? null,
            chunks: chunks.get(d.id) ?? 0,
            categoria: f.categoria,
            ativo: f.ativo,
            versao: d.versao,
            createdAt: f.createdAt,
            atualizadoEm: d.updatedAt,
            processadoEm: d.publishedAt,
          };
        });
      const categorias = [...new Set(itens.map((i) => i.categoria))].sort();
      return {
        itens,
        resumo: {
          total: itens.length,
          ativos: itens.filter((i) => i.ativo).length,
          processando: itens.filter((i) => i.status === 'pending' || i.status === 'processing').length,
          falhas: itens.filter((i) => i.status === 'failed').length,
          chunks: itens.reduce((t, i) => t + i.chunks, 0),
          categorias,
        },
      };
    });
  }

  async adicionar(tenantId: string, agentId: string, identityId: string, f: NovaFonte) {
    if (!(TIPOS_FONTE as readonly string[]).includes(f.tipo)) throw new BadRequestException('tipo de fonte inválido');
    const titulo = f.titulo.trim();
    if (!titulo) throw new BadRequestException('título é obrigatório');
    const agente = await this.prisma.withTenant(tenantId, async (tx) => {
      const a = await this.exigirAgente(tx, agentId);
      const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { nicho: true, subespecialidade: true } });
      return { a, t };
    });

    let markdown: string;
    let uri: string | null = null;
    let tamanhoBytes: number | null = null;
    try {
      if (f.tipo === 'url') {
        if (!f.url) throw new ErroExtracao('URL é obrigatória');
        const pagina = await baixarPagina(f.url);
        markdown = `# ${pagina.titulo ?? titulo}\n\n${pagina.markdown}`;
        uri = pagina.urlFinal;
      } else {
        const arquivo = f.arquivoBase64 ? Buffer.from(f.arquivoBase64, 'base64') : undefined;
        tamanhoBytes = arquivo?.length ?? (f.texto ? Buffer.byteLength(f.texto) : null);
        if (!arquivo && !f.texto?.trim()) throw new ErroExtracao('envie um arquivo ou o texto');
        markdown = await extrairConteudo({ tipo: f.tipo, titulo, texto: f.texto, arquivo });
        uri = f.nomeArquivo ?? null;
      }
    } catch (e) {
      if (e instanceof ErroExtracao) throw new BadRequestException(e.message);
      throw e;
    }

    const r = await this.ingestion.register({
      tenantId,
      escopo: 'tenant',
      nicho: agente.t?.nicho ?? null,
      subespecialidade: agente.t?.subespecialidade ?? null,
      titulo: titulo.slice(0, 200),
      fonte: f.tipo,
      mime: MIME[f.tipo],
      content: markdown,
      criadoPor: identityId || null,
    });
    const fonte = await this.prisma.withTenant(tenantId, async (tx) => {
      // Merge atômico no JSONB: o processador da fila pode estar gravando
      // `indexacao` neste mesmo instante — `||` não apaga a chave dele.
      await tx.$executeRaw`UPDATE rag_documents
        SET texto_fonte = ${markdown}, uri = ${uri},
            metadados = metadados || ${JSON.stringify({ tamanhoBytes, caracteres: markdown.length, agenteOrigem: agentId })}::jsonb
        WHERE id = ${r.id}::uuid`;
      return tx.agentKnowledgeSource.upsert({
        where: { agentId_documentId: { agentId, documentId: r.id } },
        create: { tenantId, agentId, documentId: r.id, categoria: (f.categoria ?? 'geral').trim().slice(0, 60) || 'geral', createdBy: identityId || null },
        update: { ativo: true, categoria: (f.categoria ?? 'geral').trim().slice(0, 60) || 'geral', updatedAt: new Date() },
      });
    });
    return { id: fonte.id, documentId: r.id, status: r.status, duplicado: r.deduped, caracteres: markdown.length };
  }

  async atualizar(tenantId: string, agentId: string, fonteId: string, dados: { categoria?: string; ativo?: boolean; titulo?: string }) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const f = await tx.agentKnowledgeSource.findFirst({ where: { id: fonteId, agentId } });
      if (!f) throw new NotFoundException('fonte inexistente');
      if (dados.titulo?.trim()) await tx.ragDocument.update({ where: { id: f.documentId }, data: { titulo: dados.titulo.trim().slice(0, 200), updatedAt: new Date() } });
      return tx.agentKnowledgeSource.update({
        where: { id: fonteId },
        data: { ...(dados.categoria !== undefined ? { categoria: dados.categoria.trim().slice(0, 60) || 'geral' } : {}), ...(dados.ativo !== undefined ? { ativo: dados.ativo } : {}), updatedAt: new Date() },
      });
    });
  }

  async reprocessar(tenantId: string, agentId: string, fonteId: string) {
    const f = await this.prisma.withTenant(tenantId, (tx) => tx.agentKnowledgeSource.findFirst({ where: { id: fonteId, agentId } }));
    if (!f) throw new NotFoundException('fonte inexistente');
    try {
      return await this.ingestion.reprocessar(tenantId, f.documentId);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** Remove a fonte do agente; o documento só é apagado se nenhum outro agente o usa. */
  async remover(tenantId: string, agentId: string, fonteId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const f = await tx.agentKnowledgeSource.findFirst({ where: { id: fonteId, agentId } });
      if (!f) throw new NotFoundException('fonte inexistente');
      await tx.agentKnowledgeSource.delete({ where: { id: fonteId } });
      const outros = await tx.agentKnowledgeSource.count({ where: { documentId: f.documentId } });
      let documentoApagado = false;
      if (!outros) {
        await tx.ragDocument.deleteMany({ where: { id: f.documentId, tenantId } });
        documentoApagado = true;
      }
      return { ok: true, documentoApagado };
    });
  }

  async conteudo(tenantId: string, agentId: string, fonteId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const f = await tx.agentKnowledgeSource.findFirst({ where: { id: fonteId, agentId } });
      if (!f) throw new NotFoundException('fonte inexistente');
      const [doc, chunks] = await Promise.all([
        tx.ragDocument.findUnique({ where: { id: f.documentId }, select: { titulo: true, fonte: true, uri: true, textoFonte: true, status: true, erro: true } }),
        tx.ragChunk.findMany({ where: { documentId: f.documentId }, orderBy: { ordem: 'asc' }, take: 200, select: { id: true, ordem: true, breadcrumb: true, conteudo: true, tokens: true } }),
      ]);
      return { ...doc, textoFonte: doc?.textoFonte?.slice(0, 200_000) ?? null, chunks };
    });
  }

  /** Vincula um documento já existente do tenant (de outro agente) a este agente. */
  async vincular(tenantId: string, agentId: string, documentId: string, categoria?: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.exigirAgente(tx, agentId);
      const doc = await tx.ragDocument.findFirst({ where: { id: documentId, tenantId } });
      if (!doc) throw new NotFoundException('documento inexistente');
      return tx.agentKnowledgeSource.upsert({
        where: { agentId_documentId: { agentId, documentId } },
        create: { tenantId, agentId, documentId, categoria: categoria?.trim() || 'geral' },
        update: { ativo: true },
      });
    });
  }

  /** Documentos do tenant que ainda não estão neste agente (para reaproveitar). */
  async disponiveis(tenantId: string, agentId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const ja = await tx.agentKnowledgeSource.findMany({ where: { agentId }, select: { documentId: true } });
      return tx.ragDocument.findMany({
        where: { tenantId, escopo: 'tenant', id: { notIn: ja.map((j) => j.documentId) } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, titulo: true, fonte: true, status: true, createdAt: true },
      });
    });
  }

  /**
   * Documentos que o agente consulta. `somenteFontesDoAgente` → só as fontes
   * ativas (e filtradas por categoria); senão null = todos os do tenant.
   */
  async documentosDoAgente(tenantId: string, agentId: string, cfg: { somenteFontesDoAgente: boolean; categorias: string[] }, filtroCategorias?: string[]): Promise<string[] | null> {
    const categorias = filtroCategorias?.length ? filtroCategorias : cfg.categorias;
    if (!cfg.somenteFontesDoAgente && !categorias.length) return null;
    const fontes = await this.prisma.withTenant(tenantId, (tx) =>
      tx.agentKnowledgeSource.findMany({ where: { agentId, ativo: true, ...(categorias.length ? { categoria: { in: categorias } } : {}) }, select: { documentId: true } }),
    );
    return fontes.map((f) => f.documentId);
  }

  /** Busca com confiança e conflito — usada pelo Intelligence Core e pelo testador da UI. */
  async buscar(
    tenantId: string,
    i: { agentId: string; nicho: string | null; subespecialidade: string | null; escopos: RagEscopo[]; documentIds: string[] | null; k: number },
    pergunta: string,
  ) {
    const t0 = Date.now();
    const hits = await this.retrieval.searchAgente({ tenantId, nicho: i.nicho ?? 'geral', subespecialidade: i.subespecialidade }, pergunta, i.escopos, i.documentIds, i.k);
    return { hits, confianca: avaliarConfianca(pergunta, hits), conflitos: detectarConflitos(hits), latenciaMs: Date.now() - t0 };
  }

  async testar(tenantId: string, agentId: string, pergunta: string, filtros: { categorias?: string[]; escopos?: RagEscopo[] }) {
    const ag = await this.prisma.withTenant(tenantId, async (tx) => ({
      a: await this.exigirAgente(tx, agentId),
      t: await tx.tenant.findUnique({ where: { id: tenantId }, select: { nicho: true, subespecialidade: true } }),
    }));
    const cfg = resolverConfig(ag.a.config).config;
    const documentIds = await this.documentosDoAgente(tenantId, agentId, cfg.conhecimento, filtros.categorias);
    const escopos = (filtros.escopos?.length ? filtros.escopos : (ag.a.conhecimentoEscopos as RagEscopo[]));
    const r = await this.buscar(tenantId, { agentId, nicho: ag.t?.nicho ?? null, subespecialidade: ag.t?.subespecialidade ?? null, escopos, documentIds, k: cfg.conhecimento.maxTrechos }, pergunta);
    return {
      ...r,
      hits: r.hits.map((h) => ({ chunkId: h.chunkId, documentId: h.documentId, titulo: h.titulo, escopo: h.escopo, breadcrumb: h.breadcrumb, conteudo: h.conteudo.slice(0, 1500), score: h.score })),
      escopos,
      filtradoPorFontes: documentIds !== null,
    };
  }

  private async exigirAgente(tx: Parameters<Parameters<PrismaService['withTenant']>[1]>[0], agentId: string) {
    const a = await tx.agent.findUnique({ where: { id: agentId } });
    if (!a || a.status === 'arquivado') throw new NotFoundException('agente inexistente');
    return a;
  }
}
