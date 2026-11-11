'use client';

import { useMemo, useState } from 'react';
import { Icon } from '@/components/icons';
import { Tooltip } from '@/components/kit';
import { cx } from '@/components/ui';
import { ICONE, ACENTO } from '@/components/automations/NoCanvas';
import { SeloNo } from '@/components/automations/marcas';
import type { MetaNo } from '@/lib/automations';

export const MIME_NO = 'application/khub-no';
export const MIME_NOTA = 'application/khub-nota';

const CATEGORIAS = [
  { id: 'gatilho', titulo: 'Gatilhos', icone: 'zap' },
  { id: 'controle', titulo: 'Controle', icone: 'filter' },
  { id: 'acao', titulo: 'Ações', icone: 'bolt' },
] as const;

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

interface Props {
  catalogo: MetaNo[];
  aberta: boolean;
  onAlternar: () => void;
  /** Clique num item: cria o nó ligado ao selecionado (ou ao último). */
  onEscolher: (tipo: string) => void;
  onNota: () => void;
  desabilitada?: boolean;
}

/**
 * Paleta recolhível (Q3.3). Aberta: busca + lista por categoria, arrastar
 * para o canvas ou clicar para encaixar no fluxo. Recolhida: um trilho fino
 * com as categorias, para o canvas ganhar a tela (padrão em telas estreitas).
 */
export function PaletaNos({ catalogo, aberta, onAlternar, onEscolher, onNota, desabilitada }: Props) {
  const [q, setQ] = useState('');
  const filtro = normalizar(q.trim());
  const itens = useMemo(
    () => catalogo.filter((m) => !filtro || normalizar(`${m.nome} ${m.descricao} ${(m.busca ?? []).join(' ')}`).includes(filtro)),
    [catalogo, filtro],
  );

  if (!aberta) {
    return (
      <aside className="glass crystal-edge flex w-12 shrink-0 flex-col items-center gap-2 rounded-3xl py-3" aria-label="Paleta de nós (recolhida)">
        <Tooltip content="Abrir a paleta" side="bottom">
          <button type="button" onClick={onAlternar} className="btn btn-ghost btn-icon btn-sm" aria-label="Abrir a paleta de nós" aria-expanded={false}>
            <Icon name="chevronRight" size={16} />
          </button>
        </Tooltip>
        {CATEGORIAS.map((c) => (
          <Tooltip key={c.id} content={c.titulo} side="bottom">
            <button type="button" onClick={onAlternar} className="grid h-8 w-8 place-items-center rounded-lg" style={{ color: ACENTO[c.id] }} aria-label={`Abrir ${c.titulo}`}>
              <Icon name={c.icone} size={16} />
            </button>
          </Tooltip>
        ))}
        <Tooltip content="Nota de texto" side="bottom">
          <button type="button" onClick={onNota} disabled={desabilitada} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:text-fg disabled:opacity-40" aria-label="Adicionar nota de texto">
            <Icon name="note" size={16} />
          </button>
        </Tooltip>
      </aside>
    );
  }

  return (
    <aside className="glass crystal-edge flex w-64 shrink-0 flex-col overflow-hidden rounded-3xl" aria-label="Paleta de nós">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <div className="relative min-w-0 flex-1">
          <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar nó"
            aria-label="Buscar nó"
            className="input h-8 pl-8 text-sm"
          />
        </div>
        <Tooltip content="Recolher a paleta" side="bottom">
          <button type="button" onClick={onAlternar} className="btn btn-ghost btn-icon btn-sm" aria-label="Recolher a paleta" aria-expanded>
            <Icon name="arrowLeft" size={15} />
          </button>
        </Tooltip>
      </div>
      <p className="px-4 pb-2 text-2xs text-muted">Arraste para o canvas ou clique para encaixar.</p>
      <div className="flex-1 space-y-4 overflow-y-auto px-3 pb-3 scrollbar-thin">
        {CATEGORIAS.map((cat) => {
          const lista = itens.filter((m) => m.categoria === cat.id);
          if (!lista.length) return null;
          return (
            <div key={cat.id}>
              <p className="mb-1.5 px-1 text-2xs font-semibold uppercase tracking-wide" style={{ color: ACENTO[cat.id] }}>{cat.titulo}</p>
              <div className="space-y-1">
                {lista.map((m) => (
                  <button
                    key={m.tipo}
                    type="button"
                    draggable={!desabilitada}
                    disabled={desabilitada}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(MIME_NO, m.tipo);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => onEscolher(m.tipo)}
                    title={m.descricao}
                    className="group flex w-full cursor-grab items-center gap-2.5 rounded-xl border border-line bg-surface px-2.5 py-2 text-left text-xs text-fg transition hover:border-brand-border hover:bg-brand-softer active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <SeloNo tipo={m.tipo} icone={ICONE[m.tipo] ?? 'sparkles'} acento={ACENTO[cat.id]} tamanho={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{m.nome}</span>
                      <span className="block truncate text-2xs text-faint">{m.descricao}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {!itens.length && <p className="px-1 py-6 text-center text-xs text-muted">Nenhum nó com esse nome.</p>}

        <div>
          <p className="mb-1.5 px-1 text-2xs font-semibold uppercase tracking-wide text-muted">Anotação</p>
          <button
            type="button"
            draggable={!desabilitada}
            disabled={desabilitada}
            onDragStart={(e) => {
              e.dataTransfer.setData(MIME_NOTA, '1');
              e.dataTransfer.effectAllowed = 'move';
            }}
            onClick={onNota}
            className={cx('flex w-full cursor-grab items-center gap-2.5 rounded-xl border border-dashed border-line px-2.5 py-2 text-left text-xs font-medium text-fg transition hover:bg-surface2 disabled:opacity-50')}
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface2 text-muted"><Icon name="note" size={14} /></span>
            <span className="min-w-0 flex-1">
              Nota de texto
              <span className="block text-2xs font-normal text-muted">Não executa nada</span>
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}
