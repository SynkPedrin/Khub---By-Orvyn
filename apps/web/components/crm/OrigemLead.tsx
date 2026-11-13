'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { clienteApi } from '@/lib/session-fetch';

const req = clienteApi('/api/v1/crm/');

interface Toque {
  fonte: string; canal: string; confianca: 'confirmada' | 'provavel' | 'desconhecida'; em: string;
  adId?: string; anuncio?: string; campanha?: string; conjunto?: string; criativo?: string; criativoThumb?: string;
  cliqueId?: string; utm?: Record<string, string>; sinal?: string; ref?: string;
}
interface Origem {
  atribuicao: (Toque & { primeiroToqueEm: string; ultimoToque?: Toque; toques?: number }) | null;
  rotulo: string;
  campanha: { name: string; status: string | null } | null;
  criativo: { name: string | null; thumbnailUrl: string | null; body: string | null } | null;
}

const ICONE: Record<string, { logo?: string; icone: 'send' | 'whatsapp' | 'instagram' | 'globe' | 'user' | 'file' }> = {
  meta_ads: { logo: '/logos/meta.webp', icone: 'send' },
  google_ads: { logo: '/logos/google-ads.webp', icone: 'globe' },
  tiktok_ads: { logo: '/logos/tiktok.webp', icone: 'send' },
  whatsapp_direto: { logo: '/logos/whatsapp.webp', icone: 'whatsapp' },
  instagram_direto: { logo: '/logos/instagram.webp', icone: 'instagram' },
  messenger_direto: { icone: 'send' },
  formulario: { icone: 'file' },
};
const CONFIANCA: Record<Toque['confianca'], { texto: string; cor: string; dica: string }> = {
  confirmada: { texto: 'Confirmada', cor: 'text-emerald-600 dark:text-emerald-400', dica: 'O próprio evento trouxe o anúncio ou o id do clique.' },
  provavel: { texto: 'Provável', cor: 'text-amber-600 dark:text-amber-400', dica: 'Inferida de sinal indireto (tag importada, UTM sem id de clique).' },
  desconhecida: { texto: 'Sem anúncio', cor: 'text-muted', dica: 'Chegou direto, sem sinal de anúncio.' },
};
const data = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Origem do lead (db/066): fonte, campanha, conjunto, criativo, id do clique
 * e o grau de certeza. Nada de dado de demonstração: sem registro, diz isso.
 */
export function OrigemLead({ contactId, compacto = false }: { contactId: string; compacto?: boolean }) {
  const [o, setO] = useState<Origem | null>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    setO(null); setErro(false);
    req<Origem>(`contacts/${contactId}/origem`).then(setO).catch(() => setErro(true));
  }, [contactId]);

  if (erro) return <p className="text-xs text-muted">Origem indisponível agora.</p>;
  if (!o) return <p className="text-xs text-muted" role="status">Carregando origem…</p>;
  const a = o.atribuicao;
  if (!a) return <p className="text-xs text-muted">{o.rotulo !== 'Desconhecida' ? o.rotulo : 'Origem ainda não registrada.'}</p>;
  const ic = ICONE[a.fonte] ?? { icone: 'user' as const };
  const conf = CONFIANCA[a.confianca];
  const campanha = o.campanha?.name ?? a.campanha;
  const criativo = o.criativo?.name ?? a.criativo;
  const thumb = o.criativo?.thumbnailUrl ?? a.criativoThumb;

  return (
    <div className="space-y-2 text-[13px]">
      <div className="flex items-center gap-2">
        {ic.logo
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={ic.logo} alt="" width={18} height={18} className="h-[18px] w-[18px] rounded" />
          : <Icon name={ic.icone} size={16} className="text-brand" />}
        <span className="font-semibold text-fg">{o.rotulo}</span>
        <span className="text-muted">· {a.canal}</span>
        <span className={cx('ml-auto text-[11px] font-semibold', conf.cor)} title={conf.dica}>{conf.texto}</span>
      </div>
      {(campanha || criativo || a.anuncio) && (
        <div className="flex gap-2.5 rounded-xl border border-line p-2">
          {thumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="Criativo" className="h-14 w-14 shrink-0 rounded-lg object-cover" referrerPolicy="no-referrer" />
          )}
          <dl className="min-w-0 space-y-0.5">
            {campanha && <div className="truncate"><dt className="inline text-muted">Campanha: </dt><dd className="inline text-fg">{campanha}</dd></div>}
            {a.conjunto && !compacto && <div className="truncate"><dt className="inline text-muted">Conjunto: </dt><dd className="inline text-fg">{a.conjunto}</dd></div>}
            {(criativo || a.anuncio) && <div className="truncate"><dt className="inline text-muted">Criativo: </dt><dd className="inline text-fg">{criativo ?? a.anuncio}</dd></div>}
          </dl>
        </div>
      )}
      {!compacto && (
        <dl className="space-y-0.5 text-[12px] text-muted">
          <div>Primeiro contato: <span className="text-fg">{data(a.primeiroToqueEm)}</span></div>
          {a.ultimoToque && <div>Último toque: <span className="text-fg">{a.ultimoToque.campanha ?? a.ultimoToque.anuncio ?? a.ultimoToque.fonte}</span> em {data(a.ultimoToque.em)}</div>}
          {a.cliqueId && <div className="truncate">Id do clique: <span className="font-mono text-fg">{a.cliqueId}</span></div>}
          {a.utm && Object.keys(a.utm).length > 0 && <div className="truncate">UTM: <span className="text-fg">{Object.entries(a.utm).map(([k, v]) => `${k}=${v}`).join(' · ')}</span></div>}
          {a.sinal && <div>Sinal: {a.sinal}</div>}
        </dl>
      )}
    </div>
  );
}
