import { BadRequestException, HttpException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { GoogleConexaoService } from './google-conexao.service';
import { GoogleHttp, type Json } from './google-http';
import { GoogleApiError, viaGoogle } from './google-erros';
import { ESCOPO } from './google-escopos';
import { arr, obj, str } from './google-json';
import {
  RE_CONTA_GTM,
  RE_CONTAINER_GTM,
  RE_ID_GA4,
  RE_WORKSPACE_GTM,
  diagnosticarGtm,
  parseAcionador,
  parseAlteracao,
  parseTag,
  type AcionadorGtm,
  type AlteracaoGtm,
  type DiagnosticoGtm,
  type TagGtm,
} from './gtm-diagnostico';

/**
 * Google Tag Manager API v2.
 * Referência: https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2
 *  GET  /tagmanager/v2/accounts                                (accounts.list → account[], nextPageToken)
 *  GET  /tagmanager/v2/{accounts/*}/containers                 (containers.list → container[])
 *  GET  /tagmanager/v2/{container}:snippet                     (→ snippet | containerConfig)
 *  GET  /tagmanager/v2/{container}/versions:live               (→ ContainerVersion)
 *  GET  /tagmanager/v2/{container}/workspaces                  (workspaces.list → workspace[])
 *  GET  /tagmanager/v2/{workspace}/status                      (getStatus → workspaceChange[], mergeConflict[])
 *  GET  /tagmanager/v2/{workspace}/tags | /triggers            (tag[] | trigger[])
 *  POST /tagmanager/v2/{workspace}/tags | /triggers            (escopo tagmanager.edit.containers)
 *  POST /tagmanager/v2/{workspace}:create_version              (escopo tagmanager.edit.containerversions)
 *  POST /tagmanager/v2/{version}:publish                       (escopo tagmanager.publish)
 */
const BASE = 'https://tagmanager.googleapis.com/tagmanager/v2/';
const MAX_PAGINAS = 10;

export interface ContaGtm { path: string; accountId: string; nome: string; url: string | null }
export interface ContainerGtm { path: string; containerId: string; nome: string; publicId: string | null; contextos: string[]; dominios: string[]; url: string | null }
export interface WorkspaceGtm { path: string; workspaceId: string; nome: string; descricao: string | null; url: string | null }
export interface DetalheWorkspace { tags: TagGtm[]; acionadores: AcionadorGtm[]; alteracoes: AlteracaoGtm[]; conflitos: number; publicado: boolean | null; diagnostico: DiagnosticoGtm }

function exigirCaminho(valor: string | undefined, re: RegExp, rotulo: string): string {
  if (!valor || !re.test(valor)) throw new BadRequestException(`${rotulo} inválido`);
  return valor;
}

@Injectable()
export class TagManagerService {
  constructor(
    private readonly conexao: GoogleConexaoService,
    private readonly http: GoogleHttp,
  ) {}

  private async listarPaginado(token: string, caminho: string, campo: string): Promise<unknown[]> {
    const itens: unknown[] = [];
    let pageToken: string | null = null;
    for (let i = 0; i < MAX_PAGINAS; i++) {
      const url: string = `${BASE}${caminho}${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const j: Json = await this.http.get('tag_manager', url, token);
      itens.push(...arr(j[campo]));
      pageToken = str(j.nextPageToken);
      if (!pageToken) break;
    }
    return itens;
  }

  async contas(tenantId: string): Promise<ContaGtm[]> {
    const { accessToken } = await this.conexao.token(tenantId);
    const itens = await viaGoogle(() => this.listarPaginado(accessToken, 'accounts', 'account'));
    return itens.map((v) => {
      const a = obj(v);
      return { path: str(a.path) ?? '', accountId: str(a.accountId) ?? '', nome: str(a.name) ?? '(sem nome)', url: str(a.tagManagerUrl) };
    });
  }

  async containers(tenantId: string, conta: string | undefined): Promise<ContainerGtm[]> {
    const caminho = exigirCaminho(conta, RE_CONTA_GTM, 'conta');
    const { accessToken } = await this.conexao.token(tenantId);
    const itens = await viaGoogle(() => this.listarPaginado(accessToken, `${caminho}/containers`, 'container'));
    return itens.map((v) => {
      const c = obj(v);
      return {
        path: str(c.path) ?? '',
        containerId: str(c.containerId) ?? '',
        nome: str(c.name) ?? '(sem nome)',
        publicId: str(c.publicId),
        contextos: arr(c.usageContext).filter((x): x is string => typeof x === 'string'),
        dominios: arr(c.domainName).filter((x): x is string => typeof x === 'string'),
        url: str(c.tagManagerUrl),
      };
    });
  }

  async workspaces(tenantId: string, container: string | undefined): Promise<WorkspaceGtm[]> {
    const caminho = exigirCaminho(container, RE_CONTAINER_GTM, 'contêiner');
    const { accessToken } = await this.conexao.token(tenantId);
    const itens = await viaGoogle(() => this.listarPaginado(accessToken, `${caminho}/workspaces`, 'workspace'));
    return itens.map((v) => {
      const w = obj(v);
      return { path: str(w.path) ?? '', workspaceId: str(w.workspaceId) ?? '', nome: str(w.name) ?? '(sem nome)', descricao: str(w.description), url: str(w.tagManagerUrl) };
    });
  }

  async snippet(tenantId: string, container: string | undefined): Promise<{ snippet: string | null; containerConfig: string | null }> {
    const caminho = exigirCaminho(container, RE_CONTAINER_GTM, 'contêiner');
    const { accessToken } = await this.conexao.token(tenantId);
    const j = await viaGoogle(() => this.http.get('tag_manager', `${BASE}${caminho}:snippet`, accessToken));
    return { snippet: str(j.snippet), containerConfig: str(j.containerConfig) };
  }

  async workspace(tenantId: string, workspace: string | undefined): Promise<DetalheWorkspace> {
    const caminho = exigirCaminho(workspace, RE_WORKSPACE_GTM, 'espaço de trabalho');
    const container = caminho.replace(/\/workspaces\/\d+$/, '');
    const { accessToken } = await this.conexao.token(tenantId);
    const [tagsRaw, acionadoresRaw, status, publicado] = await viaGoogle(() =>
      Promise.all([
        this.listarPaginado(accessToken, `${caminho}/tags`, 'tag'),
        this.listarPaginado(accessToken, `${caminho}/triggers`, 'trigger'),
        this.http.get('tag_manager', `${BASE}${caminho}/status`, accessToken),
        this.publicado(accessToken, container),
      ]),
    );
    const tags = tagsRaw.map(parseTag);
    const alteracoes = arr(status.workspaceChange).map(parseAlteracao);
    return {
      tags,
      acionadores: acionadoresRaw.map(parseAcionador),
      alteracoes,
      conflitos: arr(status.mergeConflict).length,
      publicado,
      diagnostico: diagnosticarGtm({ tags, alteracoes, publicado }),
    };
  }

  /** versions:live: 404 significa que o contêiner nunca foi publicado. */
  private async publicado(token: string, container: string): Promise<boolean | null> {
    try {
      const v = await this.http.get('tag_manager', `${BASE}${container}/versions:live`, token);
      return !!str(v.containerVersionId) || !!str(v.path);
    } catch (e) {
      if (e instanceof GoogleApiError && e.httpStatus === 404) return false;
      return null;
    }
  }

  private exigirEscopos(escopos: string[], necessarios: string[]): void {
    if (necessarios.every((s) => escopos.includes(s))) return;
    throw new HttpException(
      { code: 'google_escopo_insuficiente', capacidade: 'gtm_escrita', title: 'Para criar tags ou publicar, autorize a edição do Tag Manager (botão "Permitir edição no Tag Manager").' },
      409,
    );
  }

  /**
   * Cria a Google tag do GA4 (tipo e parâmetro `tagId` exatamente como no guia
   * oficial da API). Sem acionador escolhido, cria um acionador de visualização
   * de página (Trigger.type = pageview, sem filtro = todas as páginas).
   * Não publica: a tag fica no espaço de trabalho até a publicação explícita.
   */
  async criarGoogleTag(
    tenantId: string,
    identityId: string | null,
    dados: { workspace: string; idMedicao: string; nome?: string; acionadorId?: string },
  ): Promise<{ tag: TagGtm; acionadorCriado: AcionadorGtm | null }> {
    const caminho = exigirCaminho(dados.workspace, RE_WORKSPACE_GTM, 'espaço de trabalho');
    const idMedicao = dados.idMedicao.trim().toUpperCase();
    if (!RE_ID_GA4.test(idMedicao)) throw new BadRequestException('ID de medição inválido: use o formato G-XXXXXXX.');
    if (dados.acionadorId !== undefined && !/^\d+$/.test(dados.acionadorId)) throw new BadRequestException('acionador inválido');
    const { accessToken, escopos } = await this.conexao.token(tenantId);
    this.exigirEscopos(escopos, [ESCOPO.gtmEditar]);

    let acionadorCriado: AcionadorGtm | null = null;
    let acionadorId = dados.acionadorId;
    if (!acionadorId) {
      const t = await viaGoogle(() => this.http.enviar('tag_manager', 'POST', `${BASE}${caminho}/triggers`, accessToken, { name: 'Todas as páginas (KHUB)', type: 'pageview' }));
      acionadorCriado = parseAcionador(t);
      acionadorId = acionadorCriado.triggerId;
    }
    const corpo = {
      name: (dados.nome?.trim() || `Google tag ${idMedicao}`).slice(0, 200),
      type: 'googtag',
      parameter: [{ key: 'tagId', type: 'template', value: idMedicao }],
      firingTriggerId: [acionadorId],
    };
    const criada = parseTag(await viaGoogle(() => this.http.enviar('tag_manager', 'POST', `${BASE}${caminho}/tags`, accessToken, corpo)));
    await this.conexao.auditar(tenantId, identityId, 'google.gtm.tag_criada', 'gtm_tag', criada.path || null, {
      workspace: caminho,
      tipo: 'googtag',
      idMedicao,
      acionadorId,
      acionadorCriado: acionadorCriado?.path ?? null,
    });
    return { tag: criada, acionadorCriado };
  }

  /** create_version + publish. Erro de compilação interrompe antes de publicar. */
  async publicar(
    tenantId: string,
    identityId: string | null,
    dados: { workspace: string; nome?: string; notas?: string },
  ): Promise<{ versaoId: string | null; versaoPath: string; novoWorkspace: string | null }> {
    const caminho = exigirCaminho(dados.workspace, RE_WORKSPACE_GTM, 'espaço de trabalho');
    const { accessToken, escopos } = await this.conexao.token(tenantId);
    this.exigirEscopos(escopos, [ESCOPO.gtmVersoes, ESCOPO.gtmPublicar]);

    const corpo: Json = { name: (dados.nome?.trim() || `Publicado pelo KHUB em ${new Date().toISOString().slice(0, 10)}`).slice(0, 200) };
    if (dados.notas?.trim()) corpo.notes = dados.notas.trim().slice(0, 2000);
    const r = await viaGoogle(() => this.http.enviar('tag_manager', 'POST', `${BASE}${caminho}:create_version`, accessToken, corpo));
    if (r.compilerError === true) {
      await this.conexao.auditar(tenantId, identityId, 'google.gtm.publicacao_falhou', 'gtm_workspace', caminho, { motivo: 'compilerError' });
      throw new UnprocessableEntityException('O Tag Manager encontrou erros de compilação no espaço de trabalho. Corrija no Tag Manager antes de publicar.');
    }
    const versao = obj(r.containerVersion);
    const versaoPath = str(versao.path);
    if (!versaoPath) throw new UnprocessableEntityException('O Tag Manager não criou a versão (o espaço de trabalho pode estar sem alterações ou com conflitos).');
    const pub = await viaGoogle(() => this.http.enviar('tag_manager', 'POST', `${BASE}${versaoPath}:publish`, accessToken));
    if (pub.compilerError === true) throw new UnprocessableEntityException('O Tag Manager recusou a publicação por erro de compilação.');
    const resultado = { versaoId: str(versao.containerVersionId), versaoPath, novoWorkspace: str(r.newWorkspacePath) };
    await this.conexao.auditar(tenantId, identityId, 'google.gtm.publicado', 'gtm_version', versaoPath, { workspace: caminho, nome: corpo.name, ...resultado });
    return resultado;
  }
}
