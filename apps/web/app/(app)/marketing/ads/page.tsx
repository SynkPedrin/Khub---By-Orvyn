'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ConfigRequired } from '@/components/app/ConfigRequired';
import { BrandLogo, type BrandKey } from '@/components/brand/BrandLogo';
import { AdsSimulador } from '@/components/app/AdsSimulador';
import { brl } from '@/lib/crm';
import { ApiError } from '@/lib/api-error';
import { ads, type AdsOverview, type Campaign, type Creative } from '@/lib/ads';

const HEALTH: Record<string, 'green' | 'amber' | 'neutral'> = { ok: 'green', degraded: 'amber', down: 'amber', unknown: 'neutral' };
type SortKey = 'spend' | 'roas' | 'leads' | 'cpl';

export default function AdsPage() {
  const [ov, setOv] = useState<AdsOverview | null>(null);
  const [camps, setCamps] = useState<Campaign[]>([]);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [sort, setSort] = useState<SortKey>('spend');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [gated, setGated] = useState<{ provider: string; missing: string[] } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([ads.overview(), ads.campaigns(), ads.creatives()])
      .then(([o, c, cr]) => { setOv(o); setCamps(c); setCreatives(cr); })
      .catch(() => setMsg({ kind: 'err', text: 'Não consegui carregar os dados de anúncios.' }))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('connected')) setMsg({ kind: 'ok', text: `Conta ${q.get('connected')} conectada! Sincronizando…` });
    if (q.get('error')) setMsg({ kind: 'err', text: decodeURIComponent(q.get('error') || 'Falha ao conectar.') });
    load();
  }, []);

  const connect = async () => {
    try {
      const { url } = await ads.authUrl('meta');
      window.location.href = url;
    } catch (e) {
      const cr = e instanceof ApiError ? e.configRequired : null;
      if (cr) { setGated(cr); setMsg(null); }
      else setMsg({ kind: 'err', text: 'Não consegui iniciar a conexão com a Meta. Tente novamente.' });
    }
  };

  const sorted = useMemo(() => [...camps].sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0)), [camps, sort]);
  const connected = (ov?.connections?.length ?? 0) > 0;
  const kpis = ov?.totals;

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/marketing" className="mb-1 inline-flex items-center gap-1 text-xs text-muted hover:text-brand">
            <Icon name="chevronRight" size={13} className="rotate-180" /> Biblioteca
          </Link>
          <h1 className="t-display">Anúncios · cross-plataforma</h1>
          <p className="text-sm text-muted">Acompanhe campanhas, investimento e resultados das contas conectadas.</p>
        </div>
        <div className="flex items-center gap-2">
          {ov?.connections.map((c) => (
            <Badge key={c.id} tone={HEALTH[c.health] ?? 'neutral'}>
              <BrandLogo brand={(c.provider === 'meta' ? 'meta_ads' : c.provider) as BrandKey} size={16} className="mr-1 inline-block align-[-3px]" />
              {c.provider} · {c.health}
            </Badge>
          ))}
          <Button onClick={connect}><Icon name="plus" size={16} /> Conectar Meta</Button>
        </div>
      </div>

      {gated && <ConfigRequired provider={gated.provider} missing={gated.missing} />}

      {msg && (
        <div className={`rounded-xl px-4 py-2.5 text-sm ${msg.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
          {msg.text}
        </div>
      )}

      {/* Gerenciador funcional (simulação até a Meta conectar) */}
      <AdsSimulador />

      {!loading && !connected && !ov?.totals.spend ? (
        <Card className="border-dashed p-10 text-center">
          <div className="text-3xl">📣</div>
          <h2 className="mt-2 text-lg font-bold text-fg">Conecte suas contas de anúncios</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">Traga Meta (e em breve TikTok e Google) para a NICO analisar CPL, ROAS e destacar o melhor criativo.</p>
          <Button className="mt-4" onClick={connect}><Icon name="marketing" size={16} /> Conectar Meta Ads</Button>
        </Card>
      ) : (
        <>
          {/* KPIs agregados */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { l: 'Investido (30d)', v: kpis ? brl(kpis.spend) : '-', icon: 'finance' as const },
              { l: 'Leads', v: kpis ? String(kpis.leads) : '-', icon: 'contacts' as const },
              { l: 'CPL médio', v: kpis ? brl(kpis.cpl) : '-', icon: 'trend' as const },
              { l: 'ROAS', v: kpis ? `${kpis.roas.toFixed(2)}x` : '-', icon: 'pipeline' as const },
            ].map((k) => (
              <Card key={k.l} className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted">{k.l}</p>
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/12 text-brand"><Icon name={k.icon} size={17} /></span>
                </div>
                <p className="mt-2 text-2xl font-semibold text-fg">{k.v}</p>
              </Card>
            ))}
          </div>

          {/* Campanhas */}
          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="font-bold text-fg">Campanhas</h2>
              <div className="flex gap-1 text-xs">
                {(['spend', 'roas', 'leads', 'cpl'] as SortKey[]).map((k) => (
                  <button key={k} onClick={() => setSort(k)} className="rounded-lg px-2 py-1 font-semibold" style={{ background: sort === k ? 'color-mix(in srgb, var(--brand) 14%, transparent)' : 'transparent', color: sort === k ? 'var(--brand)' : 'var(--muted)' }}>
                    {k.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-5 py-2.5 font-semibold">Campanha</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Invest.</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Leads</th>
                    <th className="px-3 py-2.5 text-right font-semibold">CPL</th>
                    <th className="px-3 py-2.5 text-right font-semibold">CTR</th>
                    <th className="px-5 py-2.5 text-right font-semibold">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((c) => (
                    <tr key={c.id} className="border-b border-line last:border-0 hover:bg-surface2">
                      <td className="px-5 py-2.5">
                        <p className="font-semibold text-fg">{c.nome}</p>
                        <p className="text-[11px] text-muted">{c.objetivo ?? '-'} · {c.status}</p>
                      </td>
                      <td className="px-3 py-2.5 text-right text-fg">{brl(c.spend)}</td>
                      <td className="px-3 py-2.5 text-right text-fg">{c.leads}</td>
                      <td className="px-3 py-2.5 text-right text-fg">{brl(c.cpl)}</td>
                      <td className="px-3 py-2.5 text-right text-muted">{c.ctr.toFixed(1)}%</td>
                      <td className="px-5 py-2.5 text-right font-bold text-brand">{c.roas.toFixed(2)}x</td>
                    </tr>
                  ))}
                  {sorted.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-muted">Sem campanhas ainda.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Criativos */}
          {creatives.length > 0 && (
            <div>
              <h2 className="mb-3 font-bold text-fg">Criativos</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {creatives.map((cr) => (
                  <Card key={cr.externalId} className="overflow-hidden p-0">
                    <div className="relative aspect-[3/2] bg-surface3">
                      {cr.thumbnailUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cr.thumbnailUrl} alt={cr.nome ?? 'criativo'} className="h-full w-full object-cover" />
                      )}
                      <div className="absolute left-2 top-2 flex flex-col gap-1">
                        {cr.melhorCpl && (
                          <span className="rounded-full bg-brand px-2 py-0.5 text-2xs font-bold text-white shadow">★ Melhor CPL</span>
                        )}
                        {cr.maiorReceita && (
                          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-2xs font-bold text-white shadow">★ Maior receita atribuída</span>
                        )}
                      </div>
                    </div>
                    <div className="p-3">
                      <p className="truncate font-semibold text-fg">{cr.nome ?? cr.externalId}</p>
                      <p className="mt-0.5 text-xs text-muted">{cr.format ?? '-'}{cr.cta ? ` · ${cr.cta}` : ''}</p>
                      <div className="mt-2 grid grid-cols-3 gap-1.5 text-xs">
                        <div><p className="text-faint">Leads</p><p className="font-semibold text-fg">{cr.leads}</p></div>
                        <div><p className="text-faint">CPL</p><p className="font-semibold text-fg">{cr.leads > 0 ? `R$ ${cr.cpl.toFixed(0)}` : '-'}</p></div>
                        <div><p className="text-faint">Receita</p><p className="font-semibold text-brand">{cr.revenue > 0 ? `R$ ${cr.revenue.toLocaleString('pt-BR')}` : '-'}</p></div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
