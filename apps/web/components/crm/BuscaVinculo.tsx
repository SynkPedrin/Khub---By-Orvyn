'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { crm, type SearchResult } from '@/lib/crm';

export interface Vinculo { tipo: 'contato' | 'negocio'; id: string; titulo: string; subtitulo?: string }

/**
 * Busca um contato ou negócio do CRM para vincular (proposta, etc.). Usa a
 * busca global (`/crm/search`), já isolada por tenant na API.
 */
export function BuscaVinculo({ valor, onChange, tipos = ['contato', 'negocio'], placeholder = 'Buscar contato ou negócio…' }: {
  valor: Vinculo | null;
  onChange: (v: Vinculo | null) => void;
  tipos?: ('contato' | 'negocio')[];
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResult[]>([]);
  const [aberto, setAberto] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setRes([]); return; }
    timer.current = setTimeout(() => {
      crm.search(q.trim()).then((r) => setRes(r.filter((x) => (tipos as string[]).includes(x.tipo)))).catch(() => setRes([]));
    }, 200);
    return () => clearTimeout(timer.current);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  if (valor) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface2 px-3 py-2 text-sm">
        <Icon name={valor.tipo === 'contato' ? 'user' : 'briefcase'} size={15} className="text-brand" />
        <span className="min-w-0 flex-1 truncate"><span className="font-semibold text-fg">{valor.titulo}</span>{valor.subtitulo && <span className="text-muted"> · {valor.subtitulo}</span>}</span>
        <button type="button" onClick={() => onChange(null)} className="rounded p-1 text-muted hover:text-fg" aria-label="Remover vínculo"><Icon name="close" size={13} /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input className="input w-full" value={q} onChange={(e) => { setQ(e.target.value); setAberto(true); }} onFocus={() => setAberto(true)} onBlur={() => setTimeout(() => setAberto(false), 150)} placeholder={placeholder} aria-label={placeholder} />
      {aberto && res.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-line bg-surface p-1 shadow-lg" role="listbox">
          {res.map((r) => (
            <li key={`${r.tipo}:${r.id}`}>
              <button type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange({ tipo: r.tipo as Vinculo['tipo'], id: r.id, titulo: r.titulo, subtitulo: r.subtitulo }); setQ(''); setAberto(false); }}
                className={cx('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface2')}>
                <Icon name={r.tipo === 'contato' ? 'user' : 'briefcase'} size={14} className="text-muted" />
                <span className="min-w-0 flex-1 truncate"><span className="font-medium text-fg">{r.titulo}</span> <span className="text-xs text-muted">{r.tipo === 'contato' ? 'contato' : 'negócio'}{r.subtitulo ? ` · ${r.subtitulo}` : ''}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
