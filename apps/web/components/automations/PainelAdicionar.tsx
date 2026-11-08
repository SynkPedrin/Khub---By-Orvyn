'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/icons';
import type { MetaNo } from '@/lib/automations';

interface Props {
  catalogo: MetaNo[];
  /** 'gatilho' abre a lista de gatilhos; 'passo' abre controle + ações. */
  modo: 'gatilho' | 'passo';
  onEscolher: (tipo: string) => void;
  onFechar: () => void;
}

const ICONE_GRUPO: Record<string, IconName> = {
  Contato: 'contacts',
  Negócios: 'pipeline',
  Comunicação: 'inbox',
  Dados: 'marketing',
  Fluxo: 'filter',
  'Ferramentas internas': 'check',
};

/**
 * Painel "Adicionar". Com 21 nós, o que faz a diferença de UX
 * não é a lista — é **a busca vir focada**: quem já sabe o que quer digita
 * "sms" e dá Enter, sem caçar categoria.
 */
export function PainelAdicionar({ catalogo, modo, onEscolher, onFechar }: Props) {
  const [q, setQ] = useState('');
  const [ativo, setAtivo] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 30); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onFechar]);

  const disponiveis = useMemo(
    () => catalogo.filter((c) => (modo === 'gatilho' ? c.categoria === 'gatilho' : c.categoria !== 'gatilho')),
    [catalogo, modo],
  );

  // busca também nos sinônimos (`busca`): quem digita "whatsapp" acha "Enviar SMS"
  const filtrados = useMemo(() => {
    const termo = q.trim().toLowerCase();
    if (!termo) return disponiveis;
    return disponiveis.filter((c) =>
      [c.nome, c.descricao, c.grupo, ...(c.busca ?? [])].join(' ').toLowerCase().includes(termo),
    );
  }, [disponiveis, q]);

  const grupos = useMemo(() => {
    const mapa = new Map<string, MetaNo[]>();
    for (const c of filtrados) {
      if (!mapa.has(c.grupo)) mapa.set(c.grupo, []);
      mapa.get(c.grupo)!.push(c);
    }
    return [...mapa.entries()];
  }, [filtrados]);

  useEffect(() => { setAtivo(0); }, [q]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo((i) => Math.min(i + 1, filtrados.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && filtrados[ativo]) { e.preventDefault(); onEscolher(filtrados[ativo].tipo); }
  };

  let indice = -1;

  return (
    <div className="lg-backdrop fixed inset-0 z-[70] flex items-start justify-center pt-[10vh]" onClick={onFechar}>
      <div className="lg-sheet w-full max-w-lg animate-scale-in overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Icon name="search" size={16} className="text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={modo === 'gatilho' ? 'Buscar gatilho… (ex.: lead, whatsapp)' : 'Buscar ação… (ex.: sms, tag, esperar)'}
            className="w-full bg-transparent py-3.5 text-sm text-fg outline-none placeholder:text-muted"
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">esc</kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2 scrollbar-thin">
          {grupos.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted">
              Nada com “{q}”. O KHUB hoje automatiza contato, negócios, WhatsApp, tarefas e webhooks.
            </p>
          )}
          {grupos.map(([grupo, itens]) => (
            <div key={grupo} className="mb-2">
              <p className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-muted">
                <Icon name={ICONE_GRUPO[grupo] ?? 'sparkles'} size={11} /> {grupo}
              </p>
              {itens.map((c) => {
                indice++;
                const i = indice;
                return (
                  <button
                    key={c.tipo}
                    onMouseEnter={() => setAtivo(i)}
                    onClick={() => onEscolher(c.tipo)}
                    className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${i === ativo ? 'bg-brand/12' : 'hover:bg-white/5'}`}
                  >
                    <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white ${
                      c.categoria === 'gatilho' ? 'bg-emerald-500' : c.categoria === 'controle' ? 'bg-violet-500' : 'bg-blue-500'
                    }`}>
                      <Icon name={ICONE_GRUPO[c.grupo] ?? 'sparkles'} size={13} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-fg">{c.nome}</span>
                        {c.provider && <span className="shrink-0 rounded bg-amber-400/20 px-1 text-[9px] font-bold text-amber-700 dark:text-amber-400">{c.provider}</span>}
                      </span>
                      <span className="block text-[11px] leading-snug text-muted">{c.descricao}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-muted">
          <span><kbd className="font-mono">↑↓</kbd> navegar</span>
          <span><kbd className="font-mono">↵</kbd> adicionar</span>
          <span className="ml-auto">{filtrados.length} de {disponiveis.length}</span>
        </div>
      </div>
    </div>
  );
}
