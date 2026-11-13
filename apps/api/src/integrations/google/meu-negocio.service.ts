import { BadRequestException, Injectable } from '@nestjs/common';
import { GoogleConexaoService } from './google-conexao.service';
import { GoogleHttp, type Json } from './google-http';
import { viaGoogle } from './google-erros';
import { arr, str } from './google-json';
import {
  METRICAS_DIARIAS,
  READ_MASK_LOCAL,
  RE_AVALIACAO_GBP,
  RE_CONTA_GBP,
  RE_LOCAL_GBP,
  parseConta,
  parseListaAvaliacoes,
  parseLocal,
  somarDesempenho,
  type AvaliacaoGbp,
  type ContaGbp,
  type DesempenhoGbp,
  type LocalGbp,
} from './meu-negocio-parse';

/**
 * Perfil da Empresa (Google Meu Negócio). Escopo único: business.manage.
 * Acesso exige aprovação do Google (https://developers.google.com/my-business/content/prereqs):
 * sem ela as chamadas voltam 403/429 e a UI mostra MENSAGEM_MEU_NEGOCIO_SEM_ACESSO.
 *  GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts                      (pageSize máx. 20)
 *  GET https://mybusinessbusinessinformation.googleapis.com/v1/{accounts/*}/locations      (readMask obrigatório, pageSize máx. 100)
 *  GET https://mybusiness.googleapis.com/v4/{accounts/*\/locations/*}/reviews             (pageSize máx. 50, orderBy updateTime desc)
 *  PUT https://mybusiness.googleapis.com/v4/{accounts/*\/locations/*\/reviews/*}/reply    (corpo ReviewReply: comment, máx. 4096 bytes)
 *  GET https://businessprofileperformance.googleapis.com/v1/{locations/*}:fetchMultiDailyMetricsTimeSeries
 */
const CONTAS = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts';
const INFO = 'https://mybusinessbusinessinformation.googleapis.com/v1/';
const V4 = 'https://mybusiness.googleapis.com/v4/';
const PERF = 'https://businessprofileperformance.googleapis.com/v1/';
const MAX_PAGINAS = 10;
const LIMITE_RESPOSTA_BYTES = 4096;

function exigir(valor: string | undefined, re: RegExp, rotulo: string): string {
  if (!valor || !re.test(valor)) throw new BadRequestException(`${rotulo} inválido`);
  return valor;
}

@Injectable()
export class MeuNegocioService {
  constructor(
    private readonly conexao: GoogleConexaoService,
    private readonly http: GoogleHttp,
  ) {}

  private async paginar(token: string, base: string, campo: string): Promise<unknown[]> {
    const itens: unknown[] = [];
    let pageToken: string | null = null;
    for (let i = 0; i < MAX_PAGINAS; i++) {
      const u = new URL(base);
      if (pageToken) u.searchParams.set('pageToken', pageToken);
      const j: Json = await this.http.get('meu_negocio', u.toString(), token);
      itens.push(...arr(j[campo]));
      pageToken = str(j.nextPageToken);
      if (!pageToken) break;
    }
    return itens;
  }

  async contas(tenantId: string): Promise<ContaGbp[]> {
    const { accessToken } = await this.conexao.token(tenantId);
    const itens = await viaGoogle(() => this.paginar(accessToken, `${CONTAS}?pageSize=20`, 'accounts'));
    return itens.map(parseConta).filter((c) => c.name);
  }

  async locais(tenantId: string, conta: string | undefined): Promise<LocalGbp[]> {
    const c = exigir(conta, RE_CONTA_GBP, 'conta');
    const { accessToken } = await this.conexao.token(tenantId);
    const u = new URL(`${INFO}${c}/locations`);
    u.searchParams.set('readMask', READ_MASK_LOCAL);
    u.searchParams.set('pageSize', '100');
    const itens = await viaGoogle(() => this.paginar(accessToken, u.toString(), 'locations'));
    return itens.map(parseLocal).filter((l) => l.name);
  }

  async avaliacoes(
    tenantId: string,
    conta: string | undefined,
    local: string | undefined,
    pageToken: string | undefined,
  ): Promise<{ avaliacoes: AvaliacaoGbp[]; media: number | null; total: number; proximaPagina: string | null }> {
    const c = exigir(conta, RE_CONTA_GBP, 'conta');
    const l = exigir(local, RE_LOCAL_GBP, 'local');
    if (pageToken !== undefined && (pageToken.length > 2048 || /\s/.test(pageToken))) throw new BadRequestException('página inválida');
    const { accessToken } = await this.conexao.token(tenantId);
    const u = new URL(`${V4}${c}/${l}/reviews`);
    u.searchParams.set('pageSize', '50');
    u.searchParams.set('orderBy', 'updateTime desc');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const j = await viaGoogle(() => this.http.get('meu_negocio', u.toString(), accessToken));
    return parseListaAvaliacoes(j);
  }

  async responder(tenantId: string, identityId: string | null, avaliacao: string, comentario: string): Promise<{ comentario: string; atualizadaEm: string | null; estado: string | null }> {
    const nome = exigir(avaliacao, RE_AVALIACAO_GBP, 'avaliação');
    const texto = comentario.trim();
    if (!texto) throw new BadRequestException('Escreva a resposta.');
    if (Buffer.byteLength(texto, 'utf8') > LIMITE_RESPOSTA_BYTES) throw new BadRequestException('Resposta longa demais (limite do Google: 4096 bytes).');
    const { accessToken } = await this.conexao.token(tenantId);
    const r = await viaGoogle(() => this.http.enviar('meu_negocio', 'PUT', `${V4}${nome}/reply`, accessToken, { comment: texto }));
    const resultado = { comentario: str(r.comment) ?? texto, atualizadaEm: str(r.updateTime), estado: str(r.reviewReplyState) };
    await this.conexao.auditar(tenantId, identityId, 'google.meu_negocio.avaliacao_respondida', 'gbp_review', nome, { tamanho: texto.length, estado: resultado.estado });
    return resultado;
  }

  /** Últimos 28 dias completos (até ontem, UTC). */
  async desempenho(tenantId: string, local: string | undefined, agora: Date = new Date()): Promise<DesempenhoGbp & { inicio: string; fim: string }> {
    const l = exigir(local, RE_LOCAL_GBP, 'local');
    const { accessToken } = await this.conexao.token(tenantId);
    const fim = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() - 1));
    const inicio = new Date(fim.getTime() - 27 * 86_400_000);
    const u = new URL(`${PERF}${l}:fetchMultiDailyMetricsTimeSeries`);
    for (const m of METRICAS_DIARIAS) u.searchParams.append('dailyMetrics', m);
    const partes = (prefixo: string, d: Date) => {
      u.searchParams.set(`dailyRange.${prefixo}.year`, String(d.getUTCFullYear()));
      u.searchParams.set(`dailyRange.${prefixo}.month`, String(d.getUTCMonth() + 1));
      u.searchParams.set(`dailyRange.${prefixo}.day`, String(d.getUTCDate()));
    };
    partes('start_date', inicio);
    partes('end_date', fim);
    const j = await viaGoogle(() => this.http.get('meu_negocio', u.toString(), accessToken));
    return { ...somarDesempenho(j), inicio: inicio.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) };
  }
}
