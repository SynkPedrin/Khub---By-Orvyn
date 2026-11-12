'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { Avatar, cx } from '../ui';
import { useAuth } from '@/lib/auth';
import { useAgency } from '@/components/agency/AgencyProvider';
import { NotificationsBell } from '@/components/app/NotificationsBell';
import { usePersonalization } from '@/components/app/PersonalizationProvider';

/**
 * Topbar global: busca à esquerda, notificações e conta à direita.
 *
 * A busca aqui é o **gatilho** da paleta de comandos, não um campo de texto:
 * clicar (ou ⌘K / Ctrl+K) dispara o evento `khub:command` que a CommandBar
 * escuta. Evita dois campos concorrentes e mantém um único caminho de busca.
 */
export function Topbar({ onMobileMenu }: { onMobileMenu?: () => void }) {
  // ADR-0034: a barra "acende" (aro + luz roxa) quando o conteúdo rola por
  // baixo dela — dá profundidade e mostra que há conteúdo acima.
  const [rolou, setRolou] = useState(false);
  useEffect(() => {
    const area = document.getElementById('conteudo');
    if (!area) return;
    const medir = () => setRolou(area.scrollTop > 8);
    medir();
    area.addEventListener('scroll', medir, { passive: true });
    return () => area.removeEventListener('scroll', medir);
  }, []);

  return (
    <header
      className="glass-floating nav-floating sticky top-0 z-topbar flex h-topbar shrink-0 items-center gap-3 px-4 lg:px-6"
      role="banner"
      data-rolou={rolou}
    >
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-sm lg:hidden"
        onClick={onMobileMenu}
        aria-label="Abrir menu de navegação"
      >
        <Icon name="menu" size={20} />
      </button>

      <SearchTrigger />

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <ThemeToggle />
        <NotificationsBell />
        <AccountMenu />
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Tema claro/escuro                                                   */
/* ------------------------------------------------------------------ */

/**
 * Atalho do tema: alterna claro ↔ escuro e grava em `users.prefs` (mesma
 * preferência de Configurações › Tema). Lê o tema efetivo do documento,
 * que já vem certo do script anti-flash do layout raiz.
 */
function ThemeToggle() {
  const { prefs, update } = usePersonalization();
  const [claro, setClaro] = useState(false);
  useEffect(() => {
    setClaro(document.documentElement.getAttribute('data-theme') === 'light');
  }, [prefs.theme]);

  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon"
      onClick={() => {
        update({ theme: claro ? 'dark' : 'light' });
        setClaro(!claro);
      }}
      aria-label={claro ? 'Mudar para o tema escuro' : 'Mudar para o tema claro'}
      title={claro ? 'Tema escuro' : 'Tema claro'}
    >
      <Icon name={claro ? 'moon' : 'sun'} size={19} />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Busca global                                                        */
/* ------------------------------------------------------------------ */

/**
 * A CommandBar já registra o atalho ⌘K/Ctrl+K globalmente e escuta
 * `khub:cmdk`. Aqui só emitimos o evento — registrar um segundo listener
 * de teclado faria os dois competirem pelo mesmo atalho.
 */
function openCommandBar() {
  window.dispatchEvent(new CustomEvent('khub:cmdk'));
}

function SearchTrigger() {
  const [mac, setMac] = useState(false);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  return (
    <button
      type="button"
      onClick={openCommandBar}
      className="search-field group min-w-0 flex-1 max-w-[460px] text-left"
      aria-label="Buscar leads, conversas e contatos"
      aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
    >
      <Icon name="search" size={17} className="shrink-0 text-faint" />
      <span className="flex-1 truncate text-[13.5px] text-faint">Buscar leads, conversas, contatos...</span>
      <kbd className="hidden shrink-0 items-center gap-0.5 rounded-full bg-[var(--fill-3)] px-2 py-0.5 text-[11px] font-medium text-muted sm:inline-flex">
        {mac ? '⌘' : 'Ctrl'} K
      </kbd>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Notificações                                                        */
/* ------------------------------------------------------------------ */

// Central de notificações (Q2.6): `components/app/NotificationsBell.tsx`.

/* ------------------------------------------------------------------ */
/* Conta / workspace                                                   */
/* ------------------------------------------------------------------ */

function AccountMenu() {
  const { user, ready, signOut } = useAuth();
  const { contexto, subcontas, clienteAtivo, entrarNoCliente } = useAgency();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora ou com Esc — comportamento esperado de menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!ready) {
    return <div className="h-9 w-36 rounded-full skeleton" aria-hidden />;
  }

  if (!user) {
    return (
      <Link href="/login" className="btn btn-primary btn-sm">
        Entrar
      </Link>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'flex h-11 items-center gap-2.5 rounded-full py-1 pl-1 pr-2.5 transition hover:bg-[var(--fill-3)]',
          open && 'bg-[var(--fill-3)]',
        )}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar name={user.name} size={32} />
        <span className="hidden min-w-0 text-left sm:block">
          <span className="block truncate text-[13.5px] font-semibold leading-tight text-fg">{user.name}</span>
          <span className="block truncate text-[12px] leading-tight text-muted">
            {contexto ? (clienteAtivo?.nome ?? contexto.nome) : (user.empresa ?? 'Workspace')}
          </span>
        </span>
        <Icon name="chevronDown" size={16} className="shrink-0 text-faint" />
      </button>

      {open && (
        <div
          role="menu"
          className="lg-popover absolute right-0 top-[calc(100%+8px)] z-dropdown w-72 animate-scale-in p-1.5"
        >
          <div className="px-2.5 py-2">
            <p className="truncate text-[13.5px] font-semibold text-fg">{user.name}</p>
            {contexto ? (
              <p className="truncate text-xs text-muted">Agência</p>
            ) : (
              <p className="truncate text-xs text-muted">{user.email}</p>
            )}
          </div>

          {/* Agência — só existe pra identidade com AgencyMembership (seção 28: cliente direto nunca vê isto). */}
          {contexto && (
            <>
              <hr className="divider my-1.5" />
              <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Clientes</p>
              <div className="max-h-56 overflow-y-auto">
                {subcontas.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="menuitem"
                    disabled={c.id === clienteAtivo?.id}
                    onClick={() => {
                      setOpen(false);
                      void entrarNoCliente(c.id);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition hover:bg-[var(--fill-3)] disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <span className="icon-tile h-7 w-7 shrink-0 rounded-sm">
                      <Icon name="building" size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-fg">{c.nome}</span>
                    </span>
                    {c.isDemo && <span className="pill shrink-0 text-2xs">DEMO</span>}
                    {c.id === clienteAtivo?.id && <Icon name="check" size={15} className="shrink-0 text-brand" />}
                  </button>
                ))}
              </div>
              <hr className="divider my-1.5" />
              <MenuLink href="/agency" icon="grid" onClick={() => setOpen(false)}>
                Gerenciar agência
              </MenuLink>
            </>
          )}

          {!contexto && user.empresa && (
            <>
              <hr className="divider my-1.5" />
              <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Workspace</p>
              <div className="flex items-center gap-2 px-2.5 py-1.5">
                <span className="icon-tile h-7 w-7 rounded-sm">
                  <Icon name="building" size={14} />
                </span>
                <span className="truncate text-[13px] font-medium text-fg">{user.empresa}</span>
                <Icon name="check" size={15} className="ml-auto shrink-0 text-brand" />
              </div>
            </>
          )}

          <hr className="divider my-1.5" />

          <MenuLink href="/configuracoes" icon="settings" onClick={() => setOpen(false)}>
            Configurações
          </MenuLink>
          <MenuLink href="/configuracoes?aba=equipe" icon="users" onClick={() => setOpen(false)}>
            Equipe
          </MenuLink>
          <MenuLink href="/configuracoes?aba=plano" icon="crown" onClick={() => setOpen(false)}>
            Plano e uso
          </MenuLink>

          <hr className="divider my-1.5" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void signOut().then(() => {
                window.location.href = '/login';
              });
            }}
            className="lg-menu-item"
          >
            <Icon name="logout" size={16} />
            Sair
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  children,
  onClick,
}: {
  href: string;
  icon: Parameters<typeof Icon>[0]['name'];
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className="lg-menu-item"
    >
      <Icon name={icon} size={16} />
      {children}
    </Link>
  );
}
