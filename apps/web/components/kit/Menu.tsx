'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '@/components/icons';
import { cx } from '@/components/ui';

export type MenuEntry =
  | {
      type?: 'item';
      id: string;
      label: ReactNode;
      /** Texto para busca por letra (padrão: `label` quando for string). */
      textValue?: string;
      icon?: IconName;
      /** Bolinha de cor à esquerda (ex.: cor da etapa). */
      color?: string;
      onSelect: () => void;
      disabled?: boolean;
      danger?: boolean;
    }
  | { type: 'label'; id: string; label: ReactNode }
  | { type: 'separator'; id: string };

type Item = Extract<MenuEntry, { onSelect: () => void }>;

export interface MenuProps {
  /** Conteúdo do botão que abre o menu (ícone, texto). */
  trigger: ReactNode;
  /** Nome acessível do botão (obrigatório quando o gatilho é só ícone). */
  label: string;
  items: MenuEntry[];
  /** Alinhamento do menu em relação ao botão. */
  align?: 'start' | 'end';
  triggerClassName?: string;
  /** Largura do menu (classe Tailwind). */
  menuClassName?: string;
  disabled?: boolean;
}

const ehItem = (e: MenuEntry): e is Item => e.type === undefined || e.type === 'item';

/**
 * Menu de ações (padrão WAI-ARIA "menu button"):
 *  - Enter, Espaço ou seta para baixo no botão abre e foca o primeiro item;
 *    seta para cima abre no último;
 *  - setas navegam (circular), Home/End, letra pula para o item que começa
 *    com ela, Enter/Espaço escolhe;
 *  - Esc fecha e devolve o foco ao botão; Tab ou clique fora fecham.
 * Renderiza num portal com posição fixa: não é cortado por `overflow` da
 * coluna do Kanban e vira para cima quando falta espaço embaixo.
 * Cliques e teclas não vazam para o pai (o card do Kanban não abre junto).
 */
export function Menu({ trigger, label, items, align = 'end', triggerClassName, menuClassName = 'w-52', disabled }: MenuProps) {
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(-1);
  const [pos, setPos] = useState<{ top: number; left: number; acima: boolean } | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const botaoId = useId();
  const selecionaveis = items.filter(ehItem).filter((i) => !i.disabled);

  const fechar = useCallback((devolverFoco: boolean) => {
    setAberto(false);
    setAtivo(-1);
    if (devolverFoco) botao.current?.focus();
  }, []);

  const abrir = (indice: number) => {
    setAberto(true);
    setAtivo(indice);
  };

  // Posição: calculada a partir do botão; vira para cima se não couber embaixo.
  useLayoutEffect(() => {
    if (!aberto || !botao.current) return;
    const r = botao.current.getBoundingClientRect();
    const alturaMenu = menu.current?.offsetHeight ?? 0;
    const larguraMenu = menu.current?.offsetWidth ?? 0;
    const acima = r.bottom + 6 + alturaMenu > window.innerHeight && r.top - 6 - alturaMenu > 0;
    const leftBruto = align === 'end' ? r.right - larguraMenu : r.left;
    const left = Math.max(8, Math.min(leftBruto, window.innerWidth - larguraMenu - 8));
    setPos({ top: acima ? r.top - 6 - alturaMenu : r.bottom + 6, left, acima });
  }, [aberto, align, items.length]);

  // Foco segue o item ativo.
  useEffect(() => {
    if (!aberto || ativo < 0) return;
    menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')[ativo]?.focus();
  }, [aberto, ativo, pos]);

  // Clique fora, rolagem e redimensionamento fecham.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (menu.current?.contains(alvo) || botao.current?.contains(alvo)) return;
      fechar(false);
    };
    const rolar = (e: Event) => {
      if (menu.current && e.target instanceof Node && menu.current.contains(e.target)) return;
      fechar(false);
    };
    const redimensionar = () => fechar(false);
    document.addEventListener('pointerdown', fora, true);
    window.addEventListener('scroll', rolar, true);
    window.addEventListener('resize', redimensionar);
    return () => {
      document.removeEventListener('pointerdown', fora, true);
      window.removeEventListener('scroll', rolar, true);
      window.removeEventListener('resize', redimensionar);
    };
  }, [aberto, fechar]);

  const escolher = (item: Item) => {
    fechar(true);
    item.onSelect();
  };

  const onKeyBotao = (e: KeyboardEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape' && aberto) {
      e.preventDefault();
      fechar(true);
    } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      abrir(0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      abrir(selecionaveis.length - 1);
    }
  };

  const onKeyMenu = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const n = selecionaveis.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAtivo((i) => (i + 1) % n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo((i) => (i - 1 + n) % n);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setAtivo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setAtivo(n - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      fechar(true);
    } else if (e.key === 'Tab') {
      fechar(false);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const item = selecionaveis[ativo];
      if (item) escolher(item);
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const letra = e.key.toLowerCase();
      const texto = (i: Item) => (i.textValue ?? (typeof i.label === 'string' ? i.label : '')).toLowerCase();
      const depois = [...selecionaveis.slice(ativo + 1), ...selecionaveis.slice(0, ativo + 1)];
      const alvo = depois.find((i) => texto(i).startsWith(letra));
      if (alvo) setAtivo(selecionaveis.indexOf(alvo));
    }
  };

  let indiceSelecionavel = -1;

  return (
    <>
      <button
        ref={botao}
        id={botaoId}
        type="button"
        className={cx('btn btn-ghost btn-icon btn-sm', triggerClassName)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? menuId : undefined}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (aberto) fechar(false);
          else abrir(-1);
        }}
        onKeyDown={onKeyBotao}
        // Não inicia arrasto do card pai ao clicar no botão.
        onPointerDown={(e) => e.stopPropagation()}
        draggable={false}
      >
        {trigger}
      </button>
      {aberto &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-labelledby={botaoId}
            tabIndex={-1}
            onKeyDown={onKeyMenu}
            onClick={(e) => e.stopPropagation()}
            className={cx('lg-popover fixed z-dropdown p-1 outline-none', menuClassName, pos ? 'animate-scale-in' : 'invisible')}
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0 }}
          >
            {items.map((entrada) => {
              if (entrada.type === 'separator') return <div key={entrada.id} role="separator" className="my-1 h-px bg-[var(--border)]" />;
              if (entrada.type === 'label')
                return (
                  <p key={entrada.id} className="px-2 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted" role="presentation">
                    {entrada.label}
                  </p>
                );
              const item = entrada as Item;
              const indice = item.disabled ? -1 : ++indiceSelecionavel;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  tabIndex={indice === ativo ? 0 : -1}
                  aria-disabled={item.disabled || undefined}
                  onClick={() => !item.disabled && escolher(item)}
                  onMouseEnter={() => indice >= 0 && setAtivo(indice)}
                  className={cx(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors focus:bg-[var(--fill-3)]',
                    item.danger ? 'text-danger' : 'text-fg',
                    item.disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-[var(--fill-3)]',
                  )}
                >
                  {item.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.color }} aria-hidden />}
                  {item.icon && <Icon name={item.icon} size={15} className="shrink-0" />}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
