'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../icons';
import { cx } from '../ui';
import { aprovacoes, ROTULO_STATUS, type StatusAprovacao } from '@/lib/aprovacoes';
import { ativarPush, ehAppInstalado, ehIOS, estadoPush, type EstadoPush } from '@/lib/push';

type IconName = Parameters<typeof Icon>[0]['name'];

// ── Formatação ───────────────────────────────────────────────────────────────

const FUSO = 'America/Sao_Paulo';
export const fmtHora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: FUSO });
export const fmtDia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: FUSO }).replace('.', '');
export const fmtDiaSemana = (iso: string) => {
  const t = new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', timeZone: FUSO });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
export const fmtDataHora = (iso: string) => `${fmtDia(iso)}, ${fmtHora(iso)}`;
/** "há 5 min", "ontem", "12 nov". */
export function fmtRelativo(iso: string): string {
  const d = new Date(iso).getTime();
  const min = Math.round((Date.now() - d) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  if (h < 48) return 'ontem';
  return fmtDia(iso);
}
/** Dia (AAAA-MM-DD) em São Paulo. */
export const diaSP = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: FUSO });

export function useVibrar() {
  return useCallback((ms: number | number[] = 12) => {
    try { navigator.vibrate?.(ms); } catch { /* sem vibração */ }
  }, []);
}

/** Recarrega ao voltar para o app e a cada `ms` enquanto visível. */
export function useAtualizarAoVoltar(fn: () => void, ms = 45_000) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const vis = () => { if (document.visibilityState === 'visible') ref.current(); };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('focus', vis);
    const t = window.setInterval(vis, ms);
    return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('focus', vis); window.clearInterval(t); };
  }, [ms]);
}

// ── Casca do app ─────────────────────────────────────────────────────────────

const ABAS: { href: string; label: string; icon: IconName }[] = [
  { href: '/m', label: 'Início', icon: 'home' },
  { href: '/m/aprovacoes', label: 'Aprovações', icon: 'check2' },
  { href: '/m/agenda', label: 'Agenda', icon: 'calendar' },
  { href: '/m/perfil', label: 'Perfil', icon: 'user' },
];

export function MobileShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/m';
  const [pendentes, setPendentes] = useState(0);
  const carregar = useCallback(() => {
    aprovacoes.resumo('cliente').then((r) => setPendentes(r.pendente)).catch(() => undefined);
  }, []);
  useEffect(() => { carregar(); }, [carregar, pathname]);
  useEffect(() => {
    window.addEventListener('khub:aprovacoes', carregar);
    return () => window.removeEventListener('khub:aprovacoes', carregar);
  }, [carregar]);
  useAtualizarAoVoltar(carregar);
  // Badge no ícone do app (Android/desktop; iOS 16.4+ com o app instalado).
  useEffect(() => {
    const n = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (pendentes > 0) n.setAppBadge?.(pendentes).catch(() => undefined);
    else n.clearAppBadge?.().catch(() => undefined);
  }, [pendentes]);

  const ativa = (href: string) => (href === '/m' ? pathname === '/m' : pathname.startsWith(href));
  return (
    <div className="m-app flex min-h-[100dvh] flex-col bg-bg text-fg">
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))]">{children}</main>
      <nav
        aria-label="Navegação do app"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto flex max-w-md items-stretch">
          {ABAS.map((a) => {
            const on = ativa(a.href);
            return (
              <Link
                key={a.href}
                href={a.href}
                aria-current={on ? 'page' : undefined}
                className={cx('relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition-colors', on ? 'text-brand' : 'text-muted')}
              >
                <span className="relative">
                  <Icon name={a.icon} size={23} />
                  {a.href === '/m/aprovacoes' && pendentes > 0 && (
                    <span className="absolute -right-2.5 -top-1.5 grid min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-[18px] text-white">
                      {pendentes > 99 ? '99+' : pendentes}
                    </span>
                  )}
                </span>
                {a.label}
                {on && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-brand" />}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export function Cabecalho({ titulo, sub, voltar, acao }: { titulo: string; sub?: ReactNode; voltar?: string; acao?: ReactNode }) {
  return (
    <header className="mb-4 flex items-start gap-3 pt-2">
      {voltar && (
        <Link href={voltar} aria-label="Voltar" className="-ml-1 mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface2 text-fg active:scale-95">
          <Icon name="chevronRight" size={20} style={{ transform: 'rotate(180deg)' }} />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-[26px] font-bold leading-tight tracking-tight">{titulo}</h1>
        {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
      </div>
      {acao}
    </header>
  );
}

// ── Peças ────────────────────────────────────────────────────────────────────

const TOM_STATUS: Record<StatusAprovacao, string> = {
  pendente: 'bg-warning-soft text-warning',
  aprovado: 'bg-success-soft text-success',
  ajustes: 'bg-info-soft text-info',
  recusado: 'bg-danger-soft text-danger',
};
export function StatusPill({ status, rotulos = ROTULO_STATUS }: { status: StatusAprovacao; rotulos?: Record<StatusAprovacao, string> }) {
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold', TOM_STATUS[status])}>{rotulos[status]}</span>;
}

export function Vazio({ icone, titulo, texto, children }: { icone: IconName; titulo: string; texto?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-surface2 text-brand"><Icon name={icone} size={28} /></span>
      <p className="text-base font-semibold">{titulo}</p>
      {texto && <p className="mt-1 max-w-[260px] text-sm text-muted">{texto}</p>}
      {children}
    </div>
  );
}

export function Esqueleto({ linhas = 3 }: { linhas?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface2" />
      ))}
    </div>
  );
}

/**
 * Imagem servida com a sessão (cookie). Se o acesso curto expirou, renova a
 * sessão uma vez e tenta de novo — `<img>` não passa pelo cliente que renova.
 */
export function ImagemProtegida({ src, alt, className, onClick }: { src: string; alt: string; className?: string; onClick?: () => void }) {
  const [url, setUrl] = useState(src);
  const [falhou, setFalhou] = useState(false);
  const tentou = useRef(false);
  useEffect(() => { setUrl(src); setFalhou(false); tentou.current = false; }, [src]);
  if (falhou) {
    return <div className={cx('grid place-items-center bg-surface2 text-xs text-muted', className)}>Não foi possível carregar</div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      onClick={onClick}
      onError={() => {
        if (tentou.current) return setFalhou(true);
        tentou.current = true;
        fetch('/api/auth/refresh', { method: 'POST' })
          .then((r) => (r.ok ? setUrl(`${src}${src.includes('?') ? '&' : '?'}r=${Date.now()}`) : setFalhou(true)))
          .catch(() => setFalhou(true));
      }}
    />
  );
}

// ── Folha inferior (bottom sheet) ────────────────────────────────────────────

export function Folha({ aberta, onFechar, titulo, children }: { aberta: boolean; onFechar: () => void; titulo: string; children: ReactNode }) {
  useEffect(() => {
    if (!aberta) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    document.addEventListener('keydown', esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = overflow; };
  }, [aberta, onFechar]);
  if (!aberta) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={titulo}>
      <button type="button" aria-label="Fechar" className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onFechar} />
      <div className="m-folha relative max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-line bg-surface px-5 pt-3 shadow-2xl" style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}>
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line-strong" />
        <h2 className="mb-4 text-lg font-bold">{titulo}</h2>
        {children}
      </div>
    </div>
  );
}

export function BotaoGrande({ children, tom = 'brand', className, ...rest }: { tom?: 'brand' | 'neutro' | 'perigo' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const t = {
    brand: 'bg-brand text-[#0b0b0b]',
    neutro: 'bg-surface2 text-fg border border-line',
    perigo: 'bg-danger-soft text-danger border border-danger-border',
  }[tom];
  return (
    <button type="button" className={cx('flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl px-4 text-[15px] font-bold transition active:scale-[0.98] disabled:opacity-50', t, className)} {...rest}>
      {children}
    </button>
  );
}

export function Aviso({ texto, tom = 'erro' }: { texto: string; tom?: 'erro' | 'ok' }) {
  return <p role={tom === 'erro' ? 'alert' : 'status'} className={cx('rounded-xl px-3 py-2 text-sm', tom === 'erro' ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success')}>{texto}</p>;
}

// ── Notificações no celular ──────────────────────────────────────────────────

export function BannerNotificacoes({ compacto = false }: { compacto?: boolean }) {
  const [estado, setEstado] = useState<EstadoPush | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  useEffect(() => { estadoPush().then(setEstado).catch(() => setEstado('sem-suporte')); }, []);
  if (!estado || estado === 'ativado' || estado === 'servidor-desligado' || (compacto && estado === 'sem-suporte')) return null;

  if (estado === 'instalar-primeiro' || (ehIOS() && !ehAppInstalado())) {
    return (
      <Link href="/baixar" className="mb-4 flex items-center gap-3 rounded-2xl border border-brand-border bg-brand-soft p-4 active:scale-[0.99]">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand text-[#0b0b0b]"><Icon name="download" size={20} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">Instale o app para receber avisos</span>
          <span className="block text-xs text-muted">No iPhone, os avisos só chegam com o KHUB na tela inicial.</span>
        </span>
        <Icon name="chevronRight" size={18} className="text-muted" />
      </Link>
    );
  }
  if (estado === 'bloqueado') {
    return compacto ? null : (
      <div className="mb-4 rounded-2xl border border-warning-border bg-warning-soft p-4 text-sm">
        <p className="font-bold text-warning">Notificações bloqueadas</p>
        <p className="mt-1 text-muted">Libere nas configurações do celular: Ajustes → Notificações → KHUB.</p>
      </div>
    );
  }
  if (estado === 'sem-suporte') {
    return <div className="mb-4 rounded-2xl bg-surface2 p-4 text-sm text-muted">Este navegador não recebe notificações. Instale o app pelo Chrome (Android) ou Safari (iPhone).</div>;
  }
  return (
    <div className="mb-4 rounded-2xl border border-brand-border bg-brand-soft p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand text-[#0b0b0b]"><Icon name="bell" size={20} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Ative as notificações</p>
          <p className="text-xs text-muted">Você recebe um aviso no celular sempre que tiver algo para aprovar.</p>
        </div>
      </div>
      <button
        type="button"
        disabled={ocupado}
        onClick={async () => {
          setOcupado(true); setErro('');
          try { setEstado(await ativarPush()); } catch { setErro('Não foi possível ativar agora. Tente de novo.'); } finally { setOcupado(false); }
        }}
        className="mt-3 h-11 w-full rounded-xl bg-brand text-sm font-bold text-[#0b0b0b] active:scale-[0.98] disabled:opacity-60"
      >
        {ocupado ? 'Ativando…' : 'Ativar notificações'}
      </button>
      {erro && <p className="mt-2 text-xs text-danger">{erro}</p>}
    </div>
  );
}
