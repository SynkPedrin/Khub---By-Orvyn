import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { GoogleConexaoService } from './google-conexao.service';
import { GoogleHttp, type Json } from './google-http';
import { viaGoogle } from './google-erros';
import { arr, obj, str } from './google-json';
import {
  comparar,
  oportunidades,
  parseInspecao,
  parseLinhas,
  periodos,
  totais,
  type Comparativo,
  type CriteriosOportunidade,
  type Linha,
  type Oportunidade,
  type Periodo,
  type ResultadoInspecao,
} from './search-console-analise';

/**
 * Google Search Console API.
 * Índice: https://developers.google.com/webmaster-tools/v1/api_reference_index
 *  GET  https://www.googleapis.com/webmasters/v3/sites                                  (sites.list → siteEntry[]: siteUrl, permissionLevel)
 *  POST https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query  (siteUrl codificado na URL)
 *  POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect             (inspectionUrl, siteUrl, languageCode)
 * Escopo: webmasters.readonly.
 */
const SITES = 'https://www.googleapis.com/webmasters/v3/sites';
const INSPECAO = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';

export interface SiteSc { siteUrl: string; permissao: string; verificado: boolean }
export interface AnaliseSc {
  site: string;
  periodo: { atual: Periodo; anterior: Periodo };
  comparativo: Comparativo;
  topConsultas: Linha[];
  topPaginas: Linha[];
  oportunidades: Oportunidade[];
  criterios: CriteriosOportunidade;
}

@Injectable()
export class SearchConsoleService {
  constructor(
    private readonly conexao: GoogleConexaoService,
    private readonly http: GoogleHttp,
  ) {}

  async sites(tenantId: string): Promise<SiteSc[]> {
    const { accessToken } = await this.conexao.token(tenantId);
    const j = await viaGoogle(() => this.http.get('search_console', SITES, accessToken));
    return arr(j.siteEntry)
      .map((v) => {
        const s = obj(v);
        const permissao = str(s.permissionLevel) ?? 'desconhecida';
        return { siteUrl: str(s.siteUrl) ?? '', permissao, verificado: permissao !== 'siteUnverifiedUser' };
      })
      .filter((s) => s.siteUrl);
  }

  /** O site precisa estar na lista da conta conectada: nunca consultamos URL arbitrária. */
  private async exigirSite(tenantId: string, site: string | undefined): Promise<string> {
    if (!site || site.length > 2048 || !(/^https?:\/\//.test(site) || /^sc-domain:[a-z0-9.-]+$/i.test(site))) throw new BadRequestException('site inválido');
    const lista = await this.sites(tenantId);
    const achado = lista.find((s) => s.siteUrl === site);
    if (!achado) throw new NotFoundException('Esse site não está na conta do Search Console conectada.');
    if (!achado.verificado) throw new BadRequestException('Esse site ainda não foi verificado no Search Console.');
    return site;
  }

  private consulta(token: string, site: string, corpo: Json): Promise<Json> {
    return this.http.enviar('search_console', 'POST', `${SITES}/${encodeURIComponent(site)}/searchAnalytics/query`, token, corpo);
  }

  async analise(tenantId: string, siteBruto: string | undefined): Promise<AnaliseSc> {
    const site = await this.exigirSite(tenantId, siteBruto);
    const { accessToken } = await this.conexao.token(tenantId);
    const p = periodos();
    const faixa = (x: Periodo) => ({ startDate: x.inicio, endDate: x.fim, type: 'web' });
    const [totAtual, totAnterior, consultas, paginas] = await viaGoogle(() =>
      Promise.all([
        this.consulta(accessToken, site, faixa(p.atual)),
        this.consulta(accessToken, site, faixa(p.anterior)),
        this.consulta(accessToken, site, { ...faixa(p.atual), dimensions: ['query'], rowLimit: 500 }),
        this.consulta(accessToken, site, { ...faixa(p.atual), dimensions: ['page'], rowLimit: 25 }),
      ]),
    );
    const linhasConsultas = parseLinhas(consultas);
    const op = oportunidades(linhasConsultas);
    return {
      site,
      periodo: p,
      comparativo: comparar(totais(totAtual), totais(totAnterior)),
      topConsultas: linhasConsultas.slice(0, 25),
      topPaginas: parseLinhas(paginas),
      oportunidades: op.itens,
      criterios: op.criterios,
    };
  }

  async inspecionar(tenantId: string, siteBruto: string | undefined, url: string | undefined): Promise<ResultadoInspecao> {
    const site = await this.exigirSite(tenantId, siteBruto);
    let alvo: URL;
    try {
      alvo = new URL(url ?? '');
    } catch {
      throw new BadRequestException('Informe a URL completa, começando com https://');
    }
    if (!/^https?:$/.test(alvo.protocol)) throw new BadRequestException('Informe a URL completa, começando com https://');
    // A doc exige que a URL esteja dentro da propriedade informada.
    if (site.startsWith('sc-domain:')) {
      const dominio = site.slice('sc-domain:'.length).toLowerCase();
      const host = alvo.hostname.toLowerCase();
      if (host !== dominio && !host.endsWith(`.${dominio}`)) throw new BadRequestException('Essa URL não pertence ao domínio selecionado.');
    } else if (!alvo.toString().startsWith(site)) {
      throw new BadRequestException('Essa URL não pertence à propriedade selecionada.');
    }
    const { accessToken } = await this.conexao.token(tenantId);
    const r = await viaGoogle(() =>
      this.http.enviar('search_console', 'POST', INSPECAO, accessToken, { inspectionUrl: alvo.toString(), siteUrl: site, languageCode: 'pt-BR' }),
    );
    return parseInspecao(r);
  }
}
