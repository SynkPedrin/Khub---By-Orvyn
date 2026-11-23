import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { ToolExecutorService } from '../../nyro/tool-executor.service';
import { GennaConexaoService } from './genna-conexao.service';
import { GENNA } from './genna-oauth';
import { GennaMcpError, SessaoGenna, dadosDoResultado, textoDoResultado, type FerramentaMcp, type ResultadoFerramenta } from './genna-mcp';

/**
 * O que cada ferramenta do Genna pode fazer, do ponto de vista do KHUB:
 * - leitura: só consulta (métricas, posts, radar, referências). Qualquer papel com acesso à tela.
 * - escrita: cria/edita no Genna sem sair para a rede social (rascunho, biblioteca). Dono/admin, com confirmação.
 * - publicacao: chega ao Instagram/LinkedIn (publicar, agendar). Vira pedido em NICO > Aprovações.
 *
 * Conservador de propósito: sem `readOnlyHint: true` não é leitura; nome de
 * publicar/agendar é publicação mesmo que a anotação diga outra coisa.
 */
export type ClasseFerramenta = 'leitura' | 'escrita' | 'publicacao';

const NOME_PUBLICACAO = /(publish|publicar|schedul|agendar|post_now|send_to_social)/i;

export function classificar(f: Pick<FerramentaMcp, 'name' | 'annotations'>): ClasseFerramenta {
  if (NOME_PUBLICACAO.test(f.name)) return 'publicacao';
  if (f.annotations?.readOnlyHint === true) return 'leitura';
  if (f.annotations?.destructiveHint === true) return 'publicacao';
  return 'escrita';
}

export interface FerramentaGenna {
  nome: string;
  titulo: string;
  descricao: string;
  classe: ClasseFerramenta;
  parametros: Record<string, unknown>;
}

export interface ResultadoGenna {
  ferramenta: string;
  classe: ClasseFerramenta;
  ok: boolean;
  /** Texto do Genna (markdown simples). */
  texto: string;
  /** JSON estruturado quando o Genna manda (structuredContent ou texto JSON). */
  dados: unknown;
  /** Imagens devolvidas (prévia de slide etc.), como data URL. */
  imagens: string[];
  links: string[];
}

export type RespostaExecucao = ResultadoGenna | { aprovacao: { id: string; resumo: string } };

const TTL_CATALOGO_MS = 5 * 60_000;
const LIMITE_ARGS = 50_000;
const LIMITE_IMAGENS = 4 * 1024 * 1024;
/** Nome da tool no executor da NICO: aprovar o pedido em NICO > Aprovações executa por aqui. */
export const TOOL_PUBLICAR_GENNA = 'genna_publicar';

const schemaPublicar = z.object({ ferramenta: z.string().min(1).max(120), argumentos: z.record(z.unknown()) });

@Injectable()
export class GennaService implements OnModuleInit {
  private readonly log = new Logger('Genna');
  private readonly catalogos = new Map<string, { em: number; lista: FerramentaMcp[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly conexao: GennaConexaoService,
    private readonly executor: ToolExecutorService,
  ) {}

  onModuleInit(): void {
    this.executor.registrarExtra(
      {
        nome: TOOL_PUBLICAR_GENNA,
        descricao: 'Publica ou agenda no Instagram (e demais redes conectadas no Genna) um conteúdo do Genna. Só roda depois de aprovação humana.',
        schema: schemaPublicar,
        sensibilidade: 'sensivel',
        resumir: (a) => resumoPublicacao((a as unknown as z.infer<typeof schemaPublicar>).ferramenta, (a as unknown as z.infer<typeof schemaPublicar>).argumentos),
      },
      async (args, ctx) => {
        const a = schemaPublicar.parse(args);
        const r = await this.rodar(ctx.tenantId, ctx.identityId, a.ferramenta, a.argumentos, 'aprovado');
        if (!r.ok) throw new Error(r.texto || 'O Genna recusou a publicação.');
        return r;
      },
    );
  }

  /** Sessão MCP com um token válido; 401 do Genna = renova o token e tenta uma vez mais. */
  private async comSessao<T>(tenantId: string, fn: (s: SessaoGenna) => Promise<T>): Promise<T> {
    const tentar = async (forcar: boolean) => fn(new SessaoGenna(GENNA.mcpUrl, await this.conexao.token(tenantId, forcar)));
    try {
      return await tentar(false);
    } catch (e) {
      if (e instanceof GennaMcpError && e.status === 401) {
        try {
          return await tentar(true);
        } catch (e2) {
          throw this.paraHttp(e2);
        }
      }
      throw this.paraHttp(e);
    }
  }

  private paraHttp(e: unknown): unknown {
    if (!(e instanceof GennaMcpError)) return e;
    if (e.status === 401) return new HttpException({ code: 'genna_nao_conectado', title: 'O Genna recusou o acesso desta conta. Conecte de novo.' }, 409);
    if (e.status === 403) return new HttpException({ code: 'genna_sem_permissao', title: `O Genna negou a ação: ${e.message}` }, 403);
    if (e.status === 429) return new HttpException({ code: 'genna_limite', title: 'O Genna pediu para esperar um pouco (limite de uso). Tente em instantes.' }, 429);
    return new HttpException({ code: 'genna_indisponivel', title: `O Genna não respondeu como esperado: ${e.message}` }, 502);
  }

  private async catalogo(tenantId: string, renovar = false): Promise<FerramentaMcp[]> {
    const c = this.catalogos.get(tenantId);
    if (!renovar && c && Date.now() - c.em < TTL_CATALOGO_MS) return c.lista;
    const lista = await this.comSessao(tenantId, (s) => s.listarFerramentas());
    this.catalogos.set(tenantId, { em: Date.now(), lista });
    return lista;
  }

  async ferramentas(tenantId: string, renovar = false): Promise<FerramentaGenna[]> {
    const lista = await this.catalogo(tenantId, renovar);
    return lista.map((f) => ({
      nome: f.name,
      titulo: f.title ?? f.annotations?.title ?? f.name,
      descricao: f.description ?? '',
      classe: classificar(f),
      parametros: f.inputSchema ?? { type: 'object', properties: {} },
    }));
  }

  /** Só ferramentas de leitura. Rota aberta a quem vê a tela. */
  async consultar(tenantId: string, identityId: string | null, nome: string, argumentos: Record<string, unknown>): Promise<ResultadoGenna> {
    const f = await this.achar(tenantId, nome);
    if (classificar(f) !== 'leitura') throw new ForbiddenException('Esta ferramenta do Genna altera conteúdo; use a ação com confirmação.');
    return this.rodar(tenantId, identityId, nome, argumentos, 'leitura', f);
  }

  /**
   * Escrita roda na hora (dono/admin, com confirmação na tela). Publicação
   * vira pedido de aprovação: ninguém publica no Instagram do cliente num clique só.
   */
  async executar(tenantId: string, identityId: string | null, nome: string, argumentos: Record<string, unknown>): Promise<RespostaExecucao> {
    const f = await this.achar(tenantId, nome);
    const classe = classificar(f);
    if (classe !== 'publicacao') return this.rodar(tenantId, identityId, nome, argumentos, classe, f);

    const resumo = resumoPublicacao(nome, argumentos);
    const a = await this.prisma.withTenant(tenantId, (tx) =>
      tx.nyroAction.create({
        data: {
          tenantId,
          conversationId: null,
          tool: TOOL_PUBLICAR_GENNA,
          argumentos: { ferramenta: nome, argumentos } as Prisma.InputJsonValue,
          resumo,
          expiraEm: new Date(Date.now() + 24 * 3600_000),
        },
        select: { id: true, resumo: true },
      }),
    );
    await this.conexao.auditar(tenantId, identityId, 'genna.aprovacao_pedida', { ferramenta: nome, acaoId: a.id });
    return { aprovacao: a };
  }

  private async achar(tenantId: string, nome: string): Promise<FerramentaMcp> {
    let f = (await this.catalogo(tenantId)).find((x) => x.name === nome);
    // O Genna pode ter publicado ferramenta nova depois do cache.
    if (!f) f = (await this.catalogo(tenantId, true)).find((x) => x.name === nome);
    if (!f) throw new NotFoundException(`O Genna não tem a ferramenta "${nome}".`);
    return f;
  }

  private async rodar(
    tenantId: string,
    identityId: string | null,
    nome: string,
    argumentos: Record<string, unknown>,
    modo: ClasseFerramenta | 'aprovado',
    f?: FerramentaMcp,
  ): Promise<ResultadoGenna> {
    if (JSON.stringify(argumentos ?? {}).length > LIMITE_ARGS) throw new BadRequestException('Argumentos grandes demais para o Genna.');
    const inicio = Date.now();
    const r = await this.comSessao(tenantId, (s) => s.chamar(nome, argumentos ?? {}));
    const classe = f ? classificar(f) : 'publicacao';
    if (modo !== 'leitura') {
      await this.conexao.auditar(tenantId, identityId, modo === 'aprovado' ? 'genna.publicar' : `genna.${modo}`, { ferramenta: nome, argumentos, ok: !r.isError, ms: Date.now() - inicio });
    }
    if (r.isError) this.log.warn(`tenant ${tenantId}: ${nome} devolveu erro do Genna`);
    return formatar(nome, classe, r);
  }
}

export function formatar(nome: string, classe: ClasseFerramenta, r: ResultadoFerramenta): ResultadoGenna {
  const imagens: string[] = [];
  let tamanho = 0;
  const links: string[] = [];
  for (const c of r.content ?? []) {
    if (c.type === 'image' && c.data && c.mimeType?.startsWith('image/')) {
      tamanho += c.data.length;
      if (tamanho <= LIMITE_IMAGENS) imagens.push(`data:${c.mimeType};base64,${c.data}`);
    } else if (c.type === 'resource_link' && c.uri && /^https:\/\//.test(c.uri)) {
      links.push(c.uri);
    }
  }
  return { ferramenta: nome, classe, ok: !r.isError, texto: textoDoResultado(r), dados: dadosDoResultado(r), imagens, links };
}

export function resumoPublicacao(nome: string, argumentos: Record<string, unknown>): string {
  const pedacos = Object.entries(argumentos ?? {})
    .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`);
  return `[Genna] ${nome}${pedacos.length ? ` (${pedacos.join(', ')})` : ''}`.slice(0, 500);
}
