'use client';

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../icons';
import { cx } from '../ui';

/**
 * Paginação do KHUB: uma só, para o sistema inteiro.
 *
 * Duas formas de uso:
 *  - lista já em memória: `usePaginacao(itens)` devolve a fatia da página e as
 *    props para <Paginacao />;
 *  - lista no servidor por cursor (Leads, Contatos): <PaginacaoCursor /> (anterior
 *    e próxima, sem número de página que o cursor não sabe).
 * O objetivo é a página nunca virar um scroll sem fim: cada página tem tamanho
 * fixo e a navegação fica sempre à vista no rodapé da lista.
 */

export const TAMANHOS_PAGINA = [10, 25, 50, 100] as const;

export function usePaginacao<T>(itens: readonly T[] | null | undefined, tamanhoInicial = 25) {
  const [pagina, setPagina] = useState(1);
  const [tamanho, setTamanhoBruto] = useState(tamanhoInicial);
  const total = itens?.length ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / tamanho));
  const atual = Math.min(pagina, totalPaginas);

  // lista encolheu (filtro, exclusão): volta para uma página que existe
  useEffect(() => {
    if (pagina > totalPaginas) setPagina(totalPaginas);
  }, [pagina, totalPaginas]);

  const fatia = useMemo(() => (itens ? itens.slice((atual - 1) * tamanho, atual * tamanho) : null), [itens, atual, tamanho]);
  const setTamanho = (n: number) => {
    setTamanhoBruto(n);
    setPagina(1);
  };
  return { fatia, pagina: atual, totalPaginas, total, tamanho, setPagina, setTamanho };
}

/** Janela de números: 1 … 4 5 [6] 7 8 … 20 */
export function janelaDePaginas(atual: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const meio = new Set([1, total, atual - 1, atual, atual + 1].filter((p) => p >= 1 && p <= total));
  const ordenadas = [...meio].sort((a, b) => a - b);
  const saida: (number | '…')[] = [];
  ordenadas.forEach((p, i) => {
    if (i > 0 && p - ordenadas[i - 1] > 1) saida.push('…');
    saida.push(p);
  });
  return saida;
}

interface PaginacaoProps {
  pagina: number;
  totalPaginas: number;
  total: number;
  tamanho: number;
  onPagina: (p: number) => void;
  onTamanho?: (n: number) => void;
  /** "leads", "lançamentos"... usado no "Mostrando 1 a 25 de 340 leads". */
  rotulo?: string;
  className?: string;
}

export function Paginacao({ pagina, totalPaginas, total, tamanho, onPagina, onTamanho, rotulo = 'itens', className }: PaginacaoProps) {
  // Uma página só e sem seletor de tamanho: não há o que navegar, não ocupa espaço.
  if (total <= TAMANHOS_PAGINA[0] && totalPaginas <= 1) return null;
  const de = total === 0 ? 0 : (pagina - 1) * tamanho + 1;
  const ate = Math.min(pagina * tamanho, total);
  return (
    <nav className={cx('flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3', className)} aria-label={`Paginação de ${rotulo}`}>
      <p className="text-[13px] text-muted" aria-live="polite">
        Mostrando {de} a {ate} de {total.toLocaleString('pt-BR')} {rotulo}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {onTamanho && (
          <label className="flex items-center gap-1.5 text-[13px] text-muted">
            Por página
            <select className="select !h-8 !py-0 text-[13px]" value={tamanho} onChange={(e) => onTamanho(Number(e.target.value))} aria-label="Itens por página">
              {TAMANHOS_PAGINA.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex items-center gap-1">
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Página anterior" disabled={pagina <= 1} onClick={() => onPagina(pagina - 1)}>
            <Icon name="arrowLeft" size={15} />
          </button>
          {janelaDePaginas(pagina, totalPaginas).map((p, i) =>
            p === '…' ? (
              <span key={`r${i}`} className="px-1 text-muted" aria-hidden>
                …
              </span>
            ) : (
              <button key={p} type="button" className={cx('btn btn-sm min-w-8 px-2', p === pagina && 'btn-soft')} aria-current={p === pagina ? 'page' : undefined} aria-label={`Página ${p}`} onClick={() => onPagina(p)}>
                {p}
              </button>
            ),
          )}
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Próxima página" disabled={pagina >= totalPaginas} onClick={() => onPagina(pagina + 1)}>
            <Icon name="arrowRight" size={15} />
          </button>
        </div>
      </div>
    </nav>
  );
}

/** Para listas no servidor paginadas por cursor: só anterior e próxima (o cursor não conhece o total). */
export function PaginacaoCursor({ pagina, temProxima, carregando, onAnterior, onProxima, mostrando, rotulo = 'itens', className }: {
  pagina: number;
  temProxima: boolean;
  carregando?: boolean;
  onAnterior: () => void;
  onProxima: () => void;
  mostrando: number;
  rotulo?: string;
  className?: string;
}) {
  if (pagina <= 1 && !temProxima) return null;
  return (
    <nav className={cx('flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3', className)} aria-label={`Paginação de ${rotulo}`}>
      <p className="text-[13px] text-muted" aria-live="polite">
        Página {pagina} · {mostrando} {rotulo} nesta página
      </p>
      <div className="flex items-center gap-1">
        <button type="button" className="btn btn-ghost btn-sm" disabled={pagina <= 1 || carregando} onClick={onAnterior}>
          <Icon name="arrowLeft" size={15} /> Anterior
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!temProxima || carregando} onClick={onProxima}>
          Próxima <Icon name="arrowRight" size={15} />
        </button>
      </div>
    </nav>
  );
}
