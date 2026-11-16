'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Field, Input } from '@/components/ui';
import { Button, Select, SkeletonCards, SkeletonRows } from '@/components/kit';
import { googleApi, mensagemErroGoogle, type AnaliseSc, type InspecaoSc, type LinhaSc, type SiteSc } from '@/lib/google';
import { AvisoErro, AvisoInfo, Kpi, Secao, dataBr, numero, pct, posicao } from './comum';

/** Rótulos dos enums da inspeção (UrlInspectionResult). */
const VEREDITO: Record<string, { rotulo: string; tom: 'green' | 'amber' | 'neutral' }> = {
  PASS: { rotulo: 'Indexada', tom: 'green' },
  FAIL: { rotulo: 'Com erro', tom: 'amber' },
  NEUTRAL: { rotulo: 'Fora do índice', tom: 'neutral' },
  PARTIAL: { rotulo: 'Parcial', tom: 'amber' },
};
const BUSCA: Record<string, string> = {
  SUCCESSFUL: 'Página buscada com sucesso',
  SOFT_404: 'Soft 404 (página vazia ou "não encontrada")',
  BLOCKED_ROBOTS_TXT: 'Bloqueada pelo robots.txt',
  NOT_FOUND: 'Não encontrada (404)',
  ACCESS_DENIED: 'Acesso negado (401)',
  SERVER_ERROR: 'Erro do servidor (5xx)',
  REDIRECT_ERROR: 'Erro de redirecionamento',
  ACCESS_FORBIDDEN: 'Acesso proibido (403)',
  BLOCKED_4XX: 'Bloqueada por erro 4xx',
  INTERNAL_CRAWL_ERROR: 'Erro interno de rastreamento',
  INVALID_URL: 'URL inválida',
};
const INDEXACAO: Record<string, string> = {
  INDEXING_ALLOWED: 'Indexação permitida',
  BLOCKED_BY_META_TAG: 'Bloqueada por meta tag noindex',
  BLOCKED_BY_HTTP_HEADER: 'Bloqueada pelo cabeçalho X-Robots-Tag',
  BLOCKED_BY_ROBOTS_TXT: 'Bloqueada pelo robots.txt',
};

function Delta({ v, inverso }: { v: number | null; inverso?: boolean }) {
  if (v === null) return <>sem base no período anterior</>;
  const sinal = v > 0 ? '+' : '';
  return <>{`${sinal}${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs. 28 dias anteriores${inverso ? ' (menor é melhor)' : ''}`}</>;
}
const tomDelta = (v: number | null, inverso = false): 'bom' | 'ruim' | null => (v === null || v === 0 ? null : (v > 0) !== inverso ? 'bom' : 'ruim');

function Tabela({ linhas, rotulo }: { linhas: LinhaSc[]; rotulo: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
            <th className="px-5 py-2 font-semibold">{rotulo}</th>
            <th className="px-3 py-2 text-right font-semibold">Cliques</th>
            <th className="px-3 py-2 text-right font-semibold">Impressões</th>
            <th className="px-3 py-2 text-right font-semibold">CTR</th>
            <th className="px-5 py-2 text-right font-semibold">Posição</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {linhas.map((l) => (
            <tr key={l.chave}>
              <td className="max-w-[22rem] truncate px-5 py-2 text-fg" title={l.chave}>{l.chave}</td>
              <td className="px-3 py-2 text-right tabular">{numero(l.cliques)}</td>
              <td className="px-3 py-2 text-right tabular">{numero(l.impressoes)}</td>
              <td className="px-3 py-2 text-right tabular">{pct(l.ctr)}</td>
              <td className="px-5 py-2 text-right tabular">{posicao(l.posicao)}</td>
            </tr>
          ))}
          {!linhas.length && (
            <tr><td colSpan={5} className="px-5 py-8 text-center text-muted">Sem dados no período.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function AbaSearchConsole({ habilitado }: { habilitado: boolean }) {
  const [sites, setSites] = useState<SiteSc[] | null>(null);
  const [site, setSite] = useState('');
  const [analise, setAnalise] = useState<AnaliseSc | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [url, setUrl] = useState('');
  const [inspecao, setInspecao] = useState<InspecaoSc | null>(null);
  const [inspecionando, setInspecionando] = useState(false);
  const [erroInspecao, setErroInspecao] = useState<string | null>(null);

  const carregarSites = useCallback(() => {
    setErro(null); setSites(null);
    googleApi.sc.sites().then((s) => {
      setSites(s);
      const verificados = s.filter((x) => x.verificado);
      if (verificados.length === 1) setSite(verificados[0]!.siteUrl);
    }).catch((e) => { setSites([]); setErro(mensagemErroGoogle(e, 'Não consegui listar os sites do Search Console.')); });
  }, []);

  useEffect(() => { if (habilitado) carregarSites(); }, [habilitado, carregarSites]);

  const carregarAnalise = useCallback(() => {
    if (!site) return;
    setCarregando(true); setErro(null); setInspecao(null); setErroInspecao(null);
    googleApi.sc.analise(site).then(setAnalise).catch((e) => { setAnalise(null); setErro(mensagemErroGoogle(e, 'Não consegui ler o desempenho do site.')); }).finally(() => setCarregando(false));
  }, [site]);

  useEffect(() => { setAnalise(null); carregarAnalise(); }, [carregarAnalise]);

  const inspecionar = async () => {
    setInspecionando(true); setErroInspecao(null); setInspecao(null);
    try {
      setInspecao(await googleApi.sc.inspecionar(site, url.trim()));
    } catch (e) {
      setErroInspecao(mensagemErroGoogle(e, 'Não consegui inspecionar a URL.'));
    } finally {
      setInspecionando(false);
    }
  };

  if (!habilitado) {
    return <AvisoInfo>A conta Google conectada não autorizou o Search Console. Reconecte em Integrações e marque a permissão do Search Console.</AvisoInfo>;
  }

  const c = analise?.comparativo;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Site (propriedade verificada)">
          <Select
            value={site}
            onChange={setSite}
            placeholder={sites === null ? 'Carregando…' : sites.length ? 'Escolha o site' : 'Nenhum site'}
            disabled={!sites?.length}
            options={(sites ?? []).map((s) => ({ value: s.siteUrl, label: `${s.siteUrl.replace(/^sc-domain:/, 'Domínio: ')}${s.verificado ? '' : ' (não verificado)'}`, disabled: !s.verificado }))}
          />
        </Field>
        {analise && (
          <p className="self-end pb-2 text-xs text-muted">
            Últimos 28 dias com dados consolidados: {dataBr(analise.periodo.atual.inicio)} a {dataBr(analise.periodo.atual.fim)}, comparados com {dataBr(analise.periodo.anterior.inicio)} a {dataBr(analise.periodo.anterior.fim)}.
          </p>
        )}
      </div>

      {erro && <AvisoErro mensagem={erro} onTentar={site ? carregarAnalise : carregarSites} />}
      {sites?.length === 0 && !erro && <AvisoInfo>A conta Google conectada não tem nenhum site no Search Console.</AvisoInfo>}

      {site && carregando && !analise && <SkeletonCards count={4} label="Lendo o Search Console" />}

      {analise && c && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi rotulo="Cliques" icone="target" valor={numero(c.atual.cliques)} detalhe={<Delta v={c.variacao.cliques} />} tom={tomDelta(c.variacao.cliques)} />
            <Kpi rotulo="Impressões" icone="eye" valor={numero(c.atual.impressoes)} detalhe={<Delta v={c.variacao.impressoes} />} tom={tomDelta(c.variacao.impressoes)} />
            <Kpi rotulo="CTR médio" icone="trend" valor={pct(c.atual.ctr)} detalhe={<Delta v={c.variacao.ctr} />} tom={tomDelta(c.variacao.ctr)} />
            <Kpi rotulo="Posição média" icone="chart" valor={posicao(c.atual.posicao)} detalhe={<Delta v={c.variacao.posicao} inverso />} tom={tomDelta(c.variacao.posicao, true)} />
          </div>

          <Secao titulo={`Oportunidades (${analise.oportunidades.length})`}>
            <p className="px-5 pt-3 text-xs text-muted">
              Consultas nas posições {analise.criterios.posicaoMin} a {analise.criterios.posicaoMax}, com pelo menos {numero(analise.criterios.impressoesMin)} impressões e CTR abaixo do CTR médio do site ({pct(analise.criterios.ctrReferencia)}). Melhorar título e descrição dessas páginas costuma render cliques rápido.
            </p>
            <div className="divide-y divide-line">
              {analise.oportunidades.map((o) => (
                <div key={o.chave} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                  <p className="min-w-0 flex-1 truncate font-medium text-fg" title={o.chave}>{o.chave}</p>
                  <span className="text-[11px] text-muted">{numero(o.impressoes)} impr. · CTR {pct(o.ctr)} · posição {posicao(o.posicao)}</span>
                  <Badge tone="brand">+{numero(o.cliquesPotenciais)} cliques possíveis</Badge>
                </div>
              ))}
              {!analise.oportunidades.length && <p className="px-5 py-6 text-center text-sm text-muted">Nenhuma consulta nesse perfil no período.</p>}
            </div>
          </Secao>

          <div className="grid gap-5 xl:grid-cols-2">
            <Secao titulo="Principais consultas"><Tabela linhas={analise.topConsultas} rotulo="Consulta" /></Secao>
            <Secao titulo="Principais páginas"><Tabela linhas={analise.topPaginas} rotulo="Página" /></Secao>
          </div>
        </>
      )}

      {site && (
        <Secao titulo="Inspecionar URL">
          <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={site.startsWith('sc-domain:') ? `https://${site.slice(10)}/pagina` : `${site}pagina`} className="flex-1" aria-label="URL para inspecionar" />
            <Button variant="primary" loading={inspecionando} disabled={!url.trim()} onClick={inspecionar}>Inspecionar</Button>
          </div>
          {erroInspecao && <div className="px-5 pb-4"><AvisoErro mensagem={erroInspecao} /></div>}
          {inspecionando && <SkeletonRows rows={3} className="px-5 pb-4" label="Inspecionando" />}
          {inspecao && (
            <div className="space-y-3 px-5 pb-5">
              <div className="flex flex-wrap items-center gap-2">
                {inspecao.veredito && <Badge tone={VEREDITO[inspecao.veredito]?.tom ?? 'neutral'}>{VEREDITO[inspecao.veredito]?.rotulo ?? inspecao.veredito}</Badge>}
                {inspecao.cobertura && <span className="text-sm text-fg">{inspecao.cobertura}</span>}
                {inspecao.link && <a href={inspecao.link} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs font-semibold text-brand hover:underline">Abrir no Search Console</a>}
              </div>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div><dt className="text-[11px] text-muted">Busca da página</dt><dd className="text-fg">{inspecao.busca ? BUSCA[inspecao.busca] ?? inspecao.busca : 'sem informação'}</dd></div>
                <div><dt className="text-[11px] text-muted">Indexação</dt><dd className="text-fg">{inspecao.indexacao ? INDEXACAO[inspecao.indexacao] ?? inspecao.indexacao : 'sem informação'}</dd></div>
                <div><dt className="text-[11px] text-muted">robots.txt</dt><dd className="text-fg">{inspecao.robots === 'ALLOWED' ? 'Permitido' : inspecao.robots === 'DISALLOWED' ? 'Bloqueado' : 'sem informação'}</dd></div>
                <div><dt className="text-[11px] text-muted">Último rastreamento</dt><dd className="text-fg">{inspecao.ultimoRastreio ? new Date(inspecao.ultimoRastreio).toLocaleString('pt-BR') : 'nunca rastreada'}{inspecao.rastreadoComo ? ` (${inspecao.rastreadoComo === 'MOBILE' ? 'celular' : 'computador'})` : ''}</dd></div>
                <div className="sm:col-span-2"><dt className="text-[11px] text-muted">Canônica escolhida pelo Google</dt><dd className="break-all text-fg">{inspecao.canonicoGoogle ?? 'sem informação'}{inspecao.canonicoUsuario && inspecao.canonicoGoogle && inspecao.canonicoUsuario !== inspecao.canonicoGoogle ? ` (a página declara ${inspecao.canonicoUsuario})` : ''}</dd></div>
                {inspecao.sitemaps.length > 0 && <div className="sm:col-span-2"><dt className="text-[11px] text-muted">Sitemaps</dt><dd className="break-all text-fg">{inspecao.sitemaps.join(', ')}</dd></div>}
              </dl>
              {inspecao.resultadosAvancados && (
                <div className="rounded-xl border border-line p-3">
                  <p className="text-xs font-semibold text-fg">Resultados avançados: {VEREDITO[inspecao.resultadosAvancados.veredito ?? '']?.rotulo ?? inspecao.resultadosAvancados.veredito ?? 'sem veredito'}</p>
                  <ul className="mt-1 space-y-1 text-xs text-muted">
                    {inspecao.resultadosAvancados.tipos.map((t) => (
                      <li key={t.tipo}><span className="font-medium text-fg">{t.tipo}</span>{t.problemas.length ? `: ${t.problemas.map((p) => p.mensagem).join('; ')}` : ': sem problemas'}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Secao>
      )}
    </div>
  );
}
