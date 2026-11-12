'use client';

import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { cx } from '@/components/ui';
import { Skeleton } from '@/components/kit';
import type { ContagensConversas } from '@/lib/inbox';
import { STATUS_LISTA, alternarEtiqueta, canaisDaColuna, type FiltroLista, type StatusLista } from '@/lib/conversas-filtro';
import { CanalIcone, canalInfo } from './CanalIcone';

const ICONE_STATUS: Record<StatusLista, IconName> = { todas: 'grid', nao_lidas: 'chat', em_atendimento: 'refresh', aguardando: 'clock', resolvidas: 'check2' };

function Grupo({ titulo, extra, children }: { titulo: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1.5 text-[12.5px] font-semibold text-fg">
        <h3>{titulo}</h3>
        {extra}
      </div>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function Item({ ativo, onClick, icone, total, children, titulo }: { ativo: boolean; onClick: () => void; icone: ReactNode; total?: number; children: ReactNode; titulo?: string }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={ativo}
        title={titulo}
        className={cx(
          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors',
          ativo ? 'bg-brand-soft font-semibold text-brand' : 'text-muted hover:bg-[var(--fill-4)] hover:text-fg',
        )}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icone}</span>
        <span className="min-w-0 flex-1 truncate">{children}</span>
        {typeof total === 'number' && <span className="shrink-0 text-[11.5px] tabular text-muted">{total}</span>}
      </button>
    </li>
  );
}

/**
 * Coluna 1 de Conversas (mockup da LP): Canais com contagem real, Status e
 * Etiquetas com cor. Sem canal conectado, mostra "Conectar" (estado vazio
 * honesto). O "+" abre "Canais conectados".
 */
export function ColunaCanais({ contagens, filtro, onFiltro, onConectar }: { contagens: ContagensConversas | null; filtro: FiltroLista; onFiltro: (f: FiltroLista) => void; onConectar: () => void }) {
  const { canais, semNenhumConectado } = canaisDaColuna(contagens);
  return (
    <nav aria-label="Filtros de conversas" className="min-h-0 overflow-y-auto p-3 scrollbar-thin">
      <Grupo
        titulo="Canais"
        extra={
          <span className="flex items-center gap-2">
            {contagens && <span className="font-normal text-muted tabular">Todos {contagens.total}</span>}
            <button type="button" className="btn btn-ghost btn-icon btn-sm h-6 w-6" aria-label="Conectar canais" onClick={onConectar}>
              <Icon name="plus" size={14} className="text-brand" />
            </button>
          </span>
        }
      >
        {!contagens ? (
          <li className="space-y-2 px-2 py-1">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </li>
        ) : (
          <>
            <Item ativo={filtro.canal === 'todos'} onClick={() => onFiltro({ ...filtro, canal: 'todos' })} icone={<Icon name="users" size={14} />} total={contagens.total}>
              Todos os canais
            </Item>
            {canais.map((c) => (
              <Item
                key={c.canal}
                ativo={filtro.canal === c.canal}
                onClick={() => onFiltro({ ...filtro, canal: c.canal })}
                icone={<CanalIcone canal={c.canal} size={15} />}
                total={c.total}
                titulo={c.conectado ? undefined : 'Conta não conectada: só o histórico'}
              >
                {canalInfo(c.canal).rotulo}
              </Item>
            ))}
            {semNenhumConectado && (
              <li className="mt-2 rounded-xl border border-dashed border-line px-3 py-3 text-center">
                <p className="text-[12.5px] text-muted">Nenhum canal conectado ainda.</p>
                <button type="button" className="btn btn-primary btn-sm mt-2 w-full" onClick={onConectar}>
                  <Icon name="link" size={14} /> Conectar
                </button>
              </li>
            )}
          </>
        )}
      </Grupo>

      <Grupo titulo="Status">
        {STATUS_LISTA.map((s) => (
          <Item key={s.chave} ativo={filtro.status === s.chave} onClick={() => onFiltro({ ...filtro, status: s.chave })} icone={<Icon name={ICONE_STATUS[s.chave]} size={14} />} total={contagens?.status[s.chave]} titulo={s.dica}>
            {s.rotulo}
          </Item>
        ))}
      </Grupo>

      <Grupo titulo="Etiquetas">
        {contagens && contagens.etiquetas.length === 0 && <li className="px-2 text-[12.5px] text-muted">As etiquetas dos contatos aparecem aqui.</li>}
        {contagens?.etiquetas.map((e) => (
          <Item
            key={e.nome}
            ativo={(filtro.etiqueta ?? '').toLowerCase() === e.nome.toLowerCase()}
            onClick={() => onFiltro(alternarEtiqueta(filtro, e.nome))}
            icone={<span className="h-2.5 w-2.5 rounded-full bg-[var(--text-3)]" style={e.cor ? { background: e.cor } : undefined} aria-hidden />}
            total={e.total}
          >
            {e.nome}
          </Item>
        ))}
      </Grupo>
    </nav>
  );
}
