'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from '@/components/icons';
import { ApiError } from '@/lib/api-error';
import { simulador, type AnuncioBiblioteca, type BibliotecaResp } from '@/lib/ads-simulador';

const dataBr = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : null);

/**
 * Busca na Biblioteca de Anúncios da Meta (ads_archive) com o token da
 * subconta. Serve de referência de mercado para a simulação: o que
 * concorrentes estão veiculando, desde quando e em quais posicionamentos.
 * Erros da Meta aparecem com a mensagem real, nunca anúncio inventado.
 */
export function BibliotecaAnuncios({ negocio, onResultado }: { negocio: string; onResultado: (anuncios: AnuncioBiblioteca[]) => void }) {
  const [q, setQ] = useState('');
  const [resp, setResp] = useState<BibliotecaResp | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);

  const buscar = async (termo?: string) => {
    const pesquisa = (termo ?? q).trim();
    if (pesquisa.length < 2 || buscando) return;
    setBuscando(true);
    setErro(null);
    try {
      const r = await simulador.biblioteca(pesquisa);
      setResp(r);
      onResultado(r.anuncios);
    } catch (e) {
      setErro(e instanceof ApiError && e.status === 400 ? 'Digite pelo menos 2 letras para pesquisar.' : 'Não consegui pesquisar a biblioteca agora. Tente de novo.');
    } finally {
      setBuscando(false);
    }
  };

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <button type="button" onClick={() => setAberto((v) => !v)} className="flex w-full items-center gap-2 text-left" aria-expanded={aberto}>
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#0081fb]/12 text-[#0081fb]"><Icon name="search" size={13} /></span>
        <span className="text-sm font-bold text-fg">Biblioteca de anúncios da Meta</span>
        <span className="text-2xs text-muted">veja o que concorrentes estão veiculando de verdade</span>
        <Icon name="chevronDown" size={14} className={`ml-auto text-muted transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
        {aberto && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-3 flex gap-2">
              <div className="relative flex-1">
                <Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  className="input h-9 pl-9 text-sm"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void buscar(); }}
                  placeholder="Ex.: clínica de estética, implante dentário…"
                  aria-label="Pesquisar na biblioteca de anúncios"
                />
              </div>
              {negocio.trim() && (
                <button type="button" onClick={() => { setQ(negocio.trim()); void buscar(negocio.trim()); }} className="btn btn-ghost h-9 shrink-0 px-3 text-xs" title="Pesquisar pelo campo Negócio">
                  Usar “{negocio.trim().slice(0, 22)}{negocio.trim().length > 22 ? '…' : ''}”
                </button>
              )}
              <button type="button" onClick={() => void buscar()} disabled={buscando || q.trim().length < 2} className="btn btn-primary h-9 shrink-0 px-3.5 text-xs disabled:opacity-60">
                {buscando ? 'Buscando…' : 'Buscar'}
              </button>
            </div>

            {erro && <p className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">{erro}</p>}
            {resp && resp.status.status !== 'ok' && (
              <p className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                {resp.status.mensagem ?? 'A biblioteca não respondeu.'}{' '}
                {resp.status.doc && <a href={resp.status.doc} target="_blank" rel="noreferrer" className="font-semibold underline">Como funciona o acesso</a>}
              </p>
            )}
            {resp && resp.status.status === 'ok' && resp.anuncios.length === 0 && (
              <p className="mt-2 text-xs text-muted">Nenhum anúncio encontrado para “{resp.pesquisa}” com entrega no {resp.pais}. Tente outro termo ou o nome de um concorrente.</p>
            )}

            {resp && resp.anuncios.length > 0 && (
              <ul className="mt-3 space-y-2">
                {resp.anuncios.map((a, i) => (
                  <motion.li key={a.id || i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.4) }} className="rounded-xl border border-line bg-surface2/60 p-3">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-xs font-bold text-fg">{a.pagina}</p>
                      {a.inicio && <span className="text-2xs text-muted">no ar desde {dataBr(a.inicio)}{a.fim ? ` até ${dataBr(a.fim)}` : ''}</span>}
                      <span className="flex gap-1">
                        {a.plataformas.map((p) => (
                          <span key={p} className="rounded-full bg-surface3 px-1.5 py-0.5 text-2xs capitalize text-muted">{p}</span>
                        ))}
                      </span>
                      {a.snapshotUrl && (
                        <a href={a.snapshotUrl} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 text-2xs font-semibold text-brand hover:underline">
                          Ver anúncio <Icon name="external" size={11} />
                        </a>
                      )}
                    </div>
                    {a.textos[0] && <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted">{a.textos[0]}</p>}
                    {a.titulos[0] && <p className="mt-1 text-2xs font-semibold text-fg">{a.titulos[0]}</p>}
                  </motion.li>
                ))}
              </ul>
            )}
            {resp && resp.anuncios.length > 0 && (
              <p className="mt-2 text-2xs text-faint">Fonte: Biblioteca de Anúncios da Meta (dado público). Estes anúncios entram no relatório final como referência de concorrência.</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
