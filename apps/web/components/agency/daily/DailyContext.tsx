'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { daily, type BaseDaily, type NovaTarefa } from '@/lib/agency-daily';
import { TarefaDrawer } from './TarefaDrawer';
import { NovaTarefaModal } from './NovaTarefaModal';

interface DailyApi {
  base: BaseDaily | null;
  erroBase: boolean;
  /** Muda a cada alteração: as telas recarregam quando ela muda. */
  versao: number;
  recarregar: () => void;
  abrirTarefa: (id: string) => void;
  novaTarefa: (padrao?: Partial<NovaTarefa>) => void;
}

const Ctx = createContext<DailyApi | null>(null);

export function useDaily(): DailyApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useDaily fora do DailyProvider');
  return c;
}

/**
 * Estado compartilhado das telas do Daily: membros/clientes (para filtros e
 * seletores), a gaveta de detalhe e a criação rápida. A gaveta abre por
 * `?tarefa=<id>` também, para o link de uma tarefa poder ser compartilhado.
 */
export function DailyProvider({ children }: { children: ReactNode }) {
  const [base, setBase] = useState<BaseDaily | null>(null);
  const [erroBase, setErroBase] = useState(false);
  const [versao, setVersao] = useState(0);
  const [aberta, setAberta] = useState<string | null>(null);
  const [criando, setCriando] = useState<Partial<NovaTarefa> | null>(null);

  useEffect(() => {
    daily.base().then(setBase).catch(() => setErroBase(true));
    const id = new URLSearchParams(window.location.search).get('tarefa');
    if (id && /^[0-9a-f-]{36}$/i.test(id)) setAberta(id);
  }, []);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  const abrirTarefa = useCallback((id: string) => {
    setAberta(id);
    const url = new URL(window.location.href);
    url.searchParams.set('tarefa', id);
    window.history.replaceState(null, '', url);
  }, []);
  const fecharTarefa = useCallback(() => {
    setAberta(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('tarefa');
    window.history.replaceState(null, '', url);
  }, []);

  const api = useMemo<DailyApi>(
    () => ({ base, erroBase, versao, recarregar, abrirTarefa, novaTarefa: (p) => setCriando(p ?? {}) }),
    [base, erroBase, versao, recarregar, abrirTarefa],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <TarefaDrawer id={aberta} onClose={fecharTarefa} />
      <NovaTarefaModal padrao={criando} onClose={() => setCriando(null)} />
    </Ctx.Provider>
  );
}
