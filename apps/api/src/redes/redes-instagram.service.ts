import { BadRequestException, Controller, Get, Injectable, Query } from '@nestjs/common';
import { TenantId } from '../auth/decorators';
import { secaoDeErro } from './redes.erros';
import { RedesHttp } from './redes.http';
import { RedesConexaoService } from './redes-conexao.service';
import { PERMISSOES_IG, type SecaoStatus } from './redes.tipos';
import { ordenarIdade, parseBreakdown, parseTotal, rotuloBotao, rotuloFormato, rotuloGenero, rotuloSegue, type Fatia } from './redes-instagram.parse';

/** A Meta limita since/until dos insights da conta (o painel geral usa o mesmo teto). */
const DIAS_MAX = 28;
const OK: SecaoStatus = { status: 'ok' };
const SEM_PUBLICO: SecaoStatus = { status: 'sem_dados', mensagem: 'A Meta só mostra o público a partir de 100 seguidores.' };

export interface FatiaRotulada extends Fatia {
  rotulo: string;
}
const rotular = (f: Fatia[], rotulo: (c: string) => string): FatiaRotulada[] => f.map((x) => ({ ...x, rotulo: rotulo(x.chave) }));

export interface PublicoInstagram {
  conectado: boolean;
  conexaoId: string | null;
  periodoDias: number;
  publico: { idade: FatiaRotulada[]; genero: FatiaRotulada[]; cidades: FatiaRotulada[]; paises: FatiaRotulada[]; status: SecaoStatus };
  seguidores: { ganhos: number | null; perdidos: number | null; status: SecaoStatus };
  cliquesPerfil: { total: number | null; botoes: FatiaRotulada[]; status: SecaoStatus };
  alcancePorFormato: { fatias: FatiaRotulada[]; status: SecaoStatus };
  alcancePorRelacao: { fatias: FatiaRotulada[]; status: SecaoStatus };
}

/**
 * Público e descoberta do Instagram para a tela "Gerenciar redes" (aba Público
 * e Visão geral). Cada seção falha sozinha: sem `instagram_manage_insights`,
 * a seção diz o que falta e as outras seguem.
 */
@Injectable()
export class RedesInstagramService {
  constructor(
    private readonly conexoes: RedesConexaoService,
    private readonly http: RedesHttp,
  ) {}

  async publico(tenantId: string, conexaoId: string | undefined, diasPedidos: number): Promise<PublicoInstagram> {
    const dias = Math.min(Math.max(Math.round(diasPedidos) || DIAS_MAX, 7), DIAS_MAX);
    const vazio: PublicoInstagram = {
      conectado: false,
      conexaoId: null,
      periodoDias: dias,
      publico: { idade: [], genero: [], cidades: [], paises: [], status: { status: 'sem_dados' } },
      seguidores: { ganhos: null, perdidos: null, status: { status: 'sem_dados' } },
      cliquesPerfil: { total: null, botoes: [], status: { status: 'sem_dados' } },
      alcancePorFormato: { fatias: [], status: { status: 'sem_dados' } },
      alcancePorRelacao: { fatias: [], status: { status: 'sem_dados' } },
    };
    const conectadas = (await this.conexoes.contas(tenantId, 'instagram')).filter((c) => c.status === 'conectado');
    if (!conectadas.length) return vazio;
    const escolhida = conectadas.find((c) => c.id === conexaoId) ?? conectadas[0];
    const out: PublicoInstagram = { ...vazio, conectado: true, conexaoId: escolhida.id };
    let c;
    try {
      c = await this.conexoes.ativa(tenantId, 'instagram', escolhida.id);
    } catch (err) {
      const s = secaoDeErro(err);
      return { ...out, publico: { ...out.publico, status: s }, seguidores: { ...out.seguidores, status: s }, cliquesPerfil: { ...out.cliquesPerfil, status: s }, alcancePorFormato: { fatias: [], status: s }, alcancePorRelacao: { fatias: [], status: s } };
    }

    const insights = (params: Record<string, unknown>) => this.http.metaGet(`${c.externalId}/insights`, params, c.token, PERMISSOES_IG.insights);
    const since = Math.floor((Date.now() - dias * 86_400_000) / 1000);
    const until = Math.floor(Date.now() / 1000);
    const demografia = (breakdown: string) => insights({ metric: 'follower_demographics', period: 'lifetime', metric_type: 'total_value', timeframe: 'this_month', breakdown });
    const doPeriodo = (metric: string, breakdown: string) => insights({ metric, period: 'day', metric_type: 'total_value', breakdown, since, until });

    const [idade, genero, cidade, pais, follows, taps, formato, relacao] = await Promise.allSettled([
      demografia('age'),
      demografia('gender'),
      demografia('city'),
      demografia('country'),
      doPeriodo('follows_and_unfollows', 'follow_type'),
      doPeriodo('profile_links_taps', 'contact_button_type'),
      doPeriodo('reach', 'media_product_type'),
      doPeriodo('reach', 'follow_type'),
    ]);

    // Público: as quatro chamadas são da mesma métrica; o 1º erro vale para a seção.
    const demos = [idade, genero, cidade, pais];
    const falhaDemo = demos.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (falhaDemo) out.publico.status = secaoDeErro(falhaDemo.reason);
    else {
      const v = demos.map((r) => (r as PromiseFulfilledResult<unknown>).value);
      out.publico = {
        idade: rotular(ordenarIdade(parseBreakdown(v[0], 'age')), (x) => x),
        genero: rotular(parseBreakdown(v[1], 'gender'), rotuloGenero),
        cidades: rotular(parseBreakdown(v[2], 'city').slice(0, 10), (x) => x),
        paises: rotular(parseBreakdown(v[3], 'country').slice(0, 10), (x) => x),
        status: OK,
      };
      if (!out.publico.idade.length && !out.publico.genero.length && !out.publico.cidades.length) out.publico.status = SEM_PUBLICO;
    }

    // follows_and_unfollows: FOLLOWER = começou a seguir; NON_FOLLOWER = deixou de seguir (ou saiu do Instagram).
    if (follows.status === 'rejected') out.seguidores.status = secaoDeErro(follows.reason);
    else {
      const f = parseBreakdown(follows.value, 'follow_type');
      const achar = (k: string) => f.find((x) => x.chave === k)?.valor ?? null;
      out.seguidores = { ganhos: achar('FOLLOWER'), perdidos: achar('NON_FOLLOWER'), status: f.length ? OK : { status: 'sem_dados', mensagem: 'A Meta só informa quem seguiu e deixou de seguir a partir de 100 seguidores.' } };
    }

    if (taps.status === 'rejected') out.cliquesPerfil.status = secaoDeErro(taps.reason);
    else {
      const botoes = rotular(parseBreakdown(taps.value, 'contact_button_type'), rotuloBotao);
      out.cliquesPerfil = { total: parseTotal(taps.value, 'contact_button_type'), botoes, status: OK };
    }

    if (formato.status === 'rejected') out.alcancePorFormato.status = secaoDeErro(formato.reason);
    else out.alcancePorFormato = { fatias: rotular(parseBreakdown(formato.value, 'media_product_type'), rotuloFormato), status: OK };

    if (relacao.status === 'rejected') out.alcancePorRelacao.status = secaoDeErro(relacao.reason);
    else out.alcancePorRelacao = { fatias: rotular(parseBreakdown(relacao.value, 'follow_type'), rotuloSegue), status: OK };

    return out;
  }
}

/**
 * `/v1/redes/instagram/*`: leitura (permissions.guard: controller `redes`,
 * leitura = `contacts.read`).
 */
@Controller('redes/instagram')
export class RedesInstagramController {
  constructor(private readonly ig: RedesInstagramService) {}

  @Get('publico')
  publico(@TenantId() tenantId: string, @Query('conexaoId') conexaoId?: string, @Query('dias') dias?: string) {
    if (conexaoId && !/^[0-9a-f-]{36}$/i.test(conexaoId)) throw new BadRequestException('conexaoId inválido');
    return this.ig.publico(tenantId, conexaoId, Number(dias ?? DIAS_MAX));
  }
}
