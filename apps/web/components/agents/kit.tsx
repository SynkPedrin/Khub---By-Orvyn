'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { cx } from '@/components/ui';
import { useDialogFocus } from '@/lib/use-dialog-focus';
import { ApiError } from '@/lib/api-error';
import type { StatusAgente } from '@/lib/agents';

/**
 * Kit de UI da área de agentes. Só composição dos tokens/classes do design
 * system KHUB (ADR-0036): nenhuma cor literal, nenhum travessão em texto
 * visível (ADR-0037).
 */

// ------------------------------------------------------------------ erros

export function mensagemDeErro(e: unknown): string {
  if (e instanceof ApiError) {
    const b = e.body as { problemas?: { campo: string; erro: string }[]; errors?: string[]; title?: string };
    if (Array.isArray(b?.problemas) && b.problemas.length) return b.problemas.map((p) => `${p.campo}: ${p.erro}`).join(' · ');
    if (Array.isArray(b?.errors) && b.errors.length) return b.errors.join(' · ');
    if (e.configRequired) return `Configure ${e.configRequired.provider} para usar este recurso (${e.configRequired.missing.join(', ')})`;
    return e.message;
  }
  return e instanceof Error ? e.message : 'Algo deu errado';
}

// ------------------------------------------------------------------ toast

type Toast = { id: number; tom: 'ok' | 'erro' | 'info'; texto: string };
const ToastCtx = createContext<(tom: Toast['tom'], texto: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [itens, setItens] = useState<Toast[]>([]);
  const seq = useRef(0);
  const notificar = useCallback((tom: Toast['tom'], texto: string) => {
    const id = ++seq.current;
    setItens((x) => [...x.slice(-3), { id, tom, texto }]);
    setTimeout(() => setItens((x) => x.filter((t) => t.id !== id)), tom === 'erro' ? 7000 : 3800);
  }, []);
  return (
    <ToastCtx.Provider value={notificar}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[80] flex w-[min(380px,calc(100vw-40px))] flex-col gap-2" role="status" aria-live="polite">
        {itens.map((t) => (
          <div key={t.id} className="lg-popover pointer-events-auto flex animate-fade-in items-start gap-2.5 px-3.5 py-3 text-[13.5px] text-fg">
            <span className={cx('icon-tile mt-0.5 h-6 w-6 rounded-md', t.tom === 'ok' ? 'icon-tile-success' : t.tom === 'erro' ? 'icon-tile-danger' : 'icon-tile-info')}>
              <Icon name={t.tom === 'ok' ? 'check' : t.tom === 'erro' ? 'alert' : 'info'} size={13} />
            </span>
            <span className="min-w-0 flex-1 leading-snug">{t.texto}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ------------------------------------------------------------------ carregamento

export function useCarga<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const fnRef = useRef(fn);
  const versao = useRef(0);
  fnRef.current = fn;
  const recarregar = useCallback(async () => {
    const atual = ++versao.current;
    setCarregando(true);
    setErro(null);
    setDados(null);
    try {
      const resultado = await fnRef.current();
      if (atual === versao.current) setDados(resultado);
    } catch (e) {
      if (atual === versao.current) setErro(mensagemDeErro(e));
    } finally {
      if (atual === versao.current) setCarregando(false);
    }
  }, []);
  useEffect(() => {
    void recarregar();
    return () => { versao.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { dados, setDados, erro, carregando, recarregar };
}

/** Ação assíncrona com estado de envio e toast de erro. */
export function useAcao() {
  const toast = useToast();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const executar = useCallback(
    async <T,>(chave: string, fn: () => Promise<T>, sucesso?: string): Promise<T | null> => {
      setOcupado(chave);
      try {
        const r = await fn();
        if (sucesso) toast('ok', sucesso);
        return r;
      } catch (e) {
        toast('erro', mensagemDeErro(e));
        return null;
      } finally {
        setOcupado(null);
      }
    },
    [toast],
  );
  return { ocupado, executar };
}

// ------------------------------------------------------------------ estrutura

export function Painel({ titulo, descricao, acao, children, className, corpo = 'p-5' }: { titulo: ReactNode; descricao?: ReactNode; acao?: ReactNode; children: ReactNode; className?: string; corpo?: string }) {
  return (
    <section className={cx('card', className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h2 className="t-section">{titulo}</h2>
          {descricao && <p className="mt-0.5 max-w-2xl text-[13px] text-muted">{descricao}</p>}
        </div>
        {acao && <div className="flex shrink-0 items-center gap-2">{acao}</div>}
      </header>
      <div className={corpo}>{children}</div>
    </section>
  );
}

export function Vazio({ icone = 'sparkles', titulo, descricao, acao }: { icone?: IconName; titulo: string; descricao?: string; acao?: ReactNode }) {
  return (
    <div className="state">
      <span className="icon-tile icon-tile-neutral h-11 w-11 rounded-lg"><Icon name={icone} size={20} /></span>
      <p className="t-section">{titulo}</p>
      {descricao && <p className="max-w-md text-[13.5px] text-muted">{descricao}</p>}
      {acao}
    </div>
  );
}

export function Erro({ texto, tentar }: { texto: string; tentar?: () => void }) {
  return (
    <div className="state">
      <span className="icon-tile icon-tile-danger h-11 w-11 rounded-lg"><Icon name="alert" size={20} /></span>
      <p className="t-section">Não foi possível carregar</p>
      <p className="max-w-md text-[13.5px] text-muted">{texto}</p>
      {tentar && <button className="btn btn-ghost btn-sm" onClick={tentar}><Icon name="refresh" size={14} /> Tentar de novo</button>}
    </div>
  );
}

export function Esqueleto({ linhas = 4 }: { linhas?: number }) {
  return (
    <div className="space-y-2.5 p-5" aria-busy="true">
      {Array.from({ length: linhas }).map((_, i) => <div key={i} className="skeleton h-10 w-full rounded-md" />)}
    </div>
  );
}

export function StatusAgentePill({ status }: { status: StatusAgente }) {
  const tom = status === 'ativo' ? 'pill-success' : status === 'pausado' ? 'pill-warning' : status === 'arquivado' ? '' : 'pill-info';
  const rot = { ativo: 'Ativo', pausado: 'Pausado', rascunho: 'Rascunho', arquivado: 'Arquivado' }[status];
  return <span className={cx('pill', tom)}><span className={cx('h-1.5 w-1.5 rounded-full', status === 'ativo' ? 'bg-success' : status === 'pausado' ? 'bg-warning' : 'bg-faint')} />{rot}</span>;
}

export function Metrica({ rotulo, valor, detalhe, icone, tom }: { rotulo: string; valor: ReactNode; detalhe?: ReactNode; icone?: IconName; tom?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }) {
  return (
    <div className="rounded-xl border border-line bg-surface2/60 p-3.5">
      <div className="flex items-center gap-2 text-[12px] font-medium text-muted">
        {icone && <span className={cx('icon-tile h-6 w-6 rounded-md', tom && `icon-tile-${tom}`)}><Icon name={icone} size={12} /></span>}
        {rotulo}
      </div>
      <div className="mt-1.5 text-[22px] font-semibold tabular tracking-tight text-fg">{valor}</div>
      {detalhe && <div className="mt-0.5 text-[12px] text-muted">{detalhe}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ formulário

export function Campo({ rotulo, dica, children, className }: { rotulo: string; dica?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-fg">{rotulo}</span>
      {children}
      {dica && <span className="mt-1 block text-xs text-muted">{dica}</span>}
    </label>
  );
}

export function Texto({ valor, onChange, max, linhas = 3, placeholder }: { valor: string; onChange: (v: string) => void; max?: number; linhas?: number; placeholder?: string }) {
  return (
    <div className="relative">
      <textarea className="textarea" rows={linhas} value={valor} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {max && <span className="pointer-events-none absolute bottom-1.5 right-2.5 text-[11px] tabular text-faint">{valor.length}/{max}</span>}
    </div>
  );
}

export function Selecao<T extends string>({ valor, onChange, opcoes, className }: { valor: T; onChange: (v: T) => void; opcoes: { valor: T; rotulo: string }[]; className?: string }) {
  return (
    <select className={cx('select', className)} value={valor} onChange={(e) => onChange(e.target.value as T)}>
      {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
    </select>
  );
}

export function Numero({ valor, onChange, min, max, passo = 1, sufixo }: { valor: number; onChange: (v: number) => void; min?: number; max?: number; passo?: number; sufixo?: string }) {
  return (
    <div className="relative">
      <input
        className="input tabular"
        type="number"
        value={Number.isFinite(valor) ? valor : ''}
        min={min}
        max={max}
        step={passo}
        onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
      />
      {sufixo && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">{sufixo}</span>}
    </div>
  );
}

export function Alternar({ ligado, onChange, rotulo, descricao, desabilitado }: { ligado: boolean; onChange: (v: boolean) => void; rotulo: string; descricao?: string; desabilitado?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      disabled={desabilitado}
      onClick={() => onChange(!ligado)}
      className={cx('flex w-full items-start gap-3 rounded-xl border border-line px-3.5 py-3 text-left transition-colors hover:bg-surface2/70 disabled:cursor-not-allowed disabled:opacity-60', ligado && 'border-brand-border bg-brand-softer/60')}
    >
      <span className={cx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors', ligado ? 'bg-brand' : 'bg-surface3')}>
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', ligado ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium text-fg">{rotulo}</span>
        {descricao && <span className="mt-0.5 block text-xs text-muted">{descricao}</span>}
      </span>
    </button>
  );
}

export function Deslizante({ rotulo, esquerda, direita, valor, onChange }: { rotulo: string; esquerda: string; direita: string; valor: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-fg">{rotulo}</span>
        <span className="text-xs tabular text-muted">{valor}</span>
      </div>
      <input type="range" min={0} max={100} step={5} value={valor} aria-label={rotulo} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-[var(--brand)]" />
      <div className="mt-0.5 flex justify-between text-[11px] text-faint">
        <span>{esquerda}</span>
        <span>{direita}</span>
      </div>
    </div>
  );
}

/** Lista de textos curtos (objetivos, limites, palavras-chave). */
export function ListaTextos({ valores, onChange, placeholder, max = 15 }: { valores: string[]; onChange: (v: string[]) => void; placeholder?: string; max?: number }) {
  const [novo, setNovo] = useState('');
  const add = () => {
    const t = novo.trim();
    if (!t || valores.includes(t) || valores.length >= max) return;
    onChange([...valores, t]);
    setNovo('');
  };
  return (
    <div>
      <div className="flex gap-2">
        <input className="input" value={novo} placeholder={placeholder} onChange={(e) => setNovo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" className="btn btn-soft btn-sm shrink-0" onClick={add} disabled={!novo.trim() || valores.length >= max}><Icon name="plus" size={14} /> Adicionar</button>
      </div>
      {valores.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {valores.map((v) => (
            <li key={v} className="pill pill-brand max-w-full">
              <span className="truncate">{v}</span>
              <button type="button" aria-label={`Remover ${v}`} onClick={() => onChange(valores.filter((x) => x !== v))} className="opacity-70 hover:opacity-100"><Icon name="close" size={11} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Barra de salvar: aparece quando há alteração, com descartar. */
export function BarraSalvar({ sujo, salvando, onSalvar, onDescartar, aviso }: { sujo: boolean; salvando: boolean; onSalvar: () => void; onDescartar: () => void; aviso?: string }) {
  if (!sujo) return null;
  return (
    <div className="sticky bottom-4 z-30 mt-5 flex animate-fade-in flex-wrap items-center justify-between gap-3 rounded-2xl lg-popover px-4 py-3">
      <span className="flex items-center gap-2 text-[13.5px] text-fg"><span className="h-2 w-2 rounded-full bg-warning" /> {aviso ?? 'Alterações não salvas no rascunho'}</span>
      <span className="flex gap-2">
        <button className="btn btn-ghost btn-sm" onClick={onDescartar} disabled={salvando}>Descartar</button>
        <button className="btn btn-primary btn-sm" onClick={onSalvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar rascunho'}</button>
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ sobreposições

export function Modal({ aberto, onFechar, titulo, children, largura = 'max-w-lg', rodape }: { aberto: boolean; onFechar: () => void; titulo: string; children: ReactNode; largura?: string; rodape?: ReactNode }) {
  const foco = useDialogFocus(aberto, onFechar);
  if (!aberto) return null;
  return (
    <div className="lg-backdrop fixed inset-0 z-[70] flex items-end justify-center p-3 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div ref={(el) => { foco.current = el; }} tabIndex={-1} role="dialog" aria-modal="true" aria-label={titulo} className={cx('lg-sheet flex max-h-[90vh] w-full animate-scale-in flex-col', largura)}>
        <header className="flex items-center justify-between gap-3 px-5 pt-5">
          <h2 className="t-title">{titulo}</h2>
          <button className="btn-icon btn btn-ghost" aria-label="Fechar" onClick={onFechar}><Icon name="close" size={16} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {rodape && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3.5">{rodape}</footer>}
      </div>
    </div>
  );
}

export function Gaveta({ aberto, onFechar, titulo, children, largura = 'sm:w-[560px]' }: { aberto: boolean; onFechar: () => void; titulo: string; children: ReactNode; largura?: string }) {
  const foco = useDialogFocus(aberto, onFechar);
  if (!aberto) return null;
  return (
    <div className="lg-backdrop fixed inset-0 z-[70] flex justify-end" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <aside ref={(el) => { foco.current = el; }} tabIndex={-1} role="dialog" aria-modal="true" aria-label={titulo} className={cx('lg-sheet lg-sheet-side flex w-full animate-fade-in flex-col', largura)}>
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="t-title truncate">{titulo}</h2>
          <button className="btn-icon btn btn-ghost" aria-label="Fechar" onClick={onFechar}><Icon name="close" size={16} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

export function Confirmar({ aberto, titulo, texto, confirmar, perigo, exigirTexto, onConfirmar, onFechar }: { aberto: boolean; titulo: string; texto: ReactNode; confirmar: string; perigo?: boolean; exigirTexto?: string; onConfirmar: () => void; onFechar: () => void }) {
  const [digitado, setDigitado] = useState('');
  useEffect(() => { if (!aberto) setDigitado(''); }, [aberto]);
  const ok = !exigirTexto || digitado === exigirTexto;
  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo={titulo} rodape={<><button className="btn btn-ghost" onClick={onFechar}>Cancelar</button><button className={cx('btn', perigo ? 'btn-danger' : 'btn-primary')} disabled={!ok} onClick={onConfirmar}>{confirmar}</button></>}>
      <div className="space-y-3 text-[14px] text-muted">
        {texto}
        {exigirTexto && (
          <Campo rotulo={`Digite "${exigirTexto}" para confirmar`}>
            <input className="input" value={digitado} onChange={(e) => setDigitado(e.target.value)} autoFocus />
          </Campo>
        )}
      </div>
    </Modal>
  );
}

/** Abas de seção (filtros/sub-áreas). */
export function Abas<T extends string>({ valor, onChange, opcoes }: { valor: T; onChange: (v: T) => void; opcoes: { valor: T; rotulo: string; contagem?: number }[] }) {
  return (
    <div className="segbar scroll-fade-x max-w-full overflow-x-auto" role="tablist">
      {opcoes.map((o) => (
        <button key={o.valor} role="tab" aria-selected={valor === o.valor} className="seg shrink-0" onClick={() => onChange(o.valor)}>
          {o.rotulo}
          {typeof o.contagem === 'number' && <span className="tabular text-[11px] text-muted">{o.contagem}</span>}
        </button>
      ))}
    </div>
  );
}

/** Copia profunda para rascunhos locais (JSON-safe: a config é JSON). */
export const clonar = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
