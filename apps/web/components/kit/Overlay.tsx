'use client';

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { useFocusTrap, useScrollLock } from './focus';
import { Button } from './Button';

/**
 * Sobreposições do kit: Modal, Drawer e Confirm.
 *
 * Contrato de acessibilidade (igual nos três): `role="dialog"` +
 * `aria-modal="true"` + rótulo pelo título, foco preso dentro (Tab circula),
 * Esc fecha, o foco volta a quem abriu, e o corpo da página não rola por
 * baixo. Renderizam num portal em `document.body` para escapar de
 * `overflow`/`transform` de quem os chama (ex.: coluna do Kanban).
 */

// Portal síncrono no cliente: o conteúdo existe já no primeiro commit, então
// o focus trap (layout effect) encontra o diálogo montado. As sobreposições
// nascem fechadas no SSR, então não há divergência de hidratação.
function Portal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

const LARGURA_MODAL = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const;

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Texto de apoio sob o título (vira `aria-describedby`). */
  description?: ReactNode;
  children?: ReactNode;
  /** Ações no rodapé (botões alinhados à direita). */
  footer?: ReactNode;
  size?: keyof typeof LARGURA_MODAL;
  /** Elemento que recebe o foco ao abrir (padrão: o primeiro focável). */
  initialFocus?: RefObject<HTMLElement>;
  /** Clique fora fecha (padrão: sim). */
  closeOnBackdrop?: boolean;
  className?: string;
}

export function Modal({ open, onClose, title, description, children, footer, size = 'md', initialFocus, closeOnBackdrop = true, className }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const tituloId = useId();
  const descId = useId();
  useFocusTrap(ref, open, { onEsc: onClose, inicial: initialFocus });
  useScrollLock(open);
  if (!open) return null;
  return (
    <Portal>
      <div
        className="lg-backdrop fixed inset-0 z-modal flex items-end justify-center p-3 sm:items-center"
        onMouseDown={(e) => {
          if (closeOnBackdrop && e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={tituloId}
          aria-describedby={description ? descId : undefined}
          className={cx('lg-sheet flex max-h-[90vh] w-full animate-scale-in flex-col outline-none', LARGURA_MODAL[size], className)}
        >
          <header className="flex items-start justify-between gap-3 px-5 pt-5">
            <div className="min-w-0">
              <h2 id={tituloId} className="t-title">
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-1 text-sm text-muted">
                  {description}
                </p>
              )}
            </div>
            <button type="button" className="btn btn-ghost btn-icon btn-sm shrink-0" aria-label="Fechar" onClick={onClose}>
              <Icon name="close" size={16} />
            </button>
          </header>
          {children !== undefined && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">{children}</div>}
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</footer>}
        </div>
      </div>
    </Portal>
  );
}

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Título visível no cabeçalho (e rótulo do diálogo). */
  title: ReactNode;
  /** Rótulo acessível quando o título não é texto simples. */
  ariaLabel?: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  side?: 'right' | 'left';
  /** Classe de largura (padrão `sm:max-w-lg`). */
  width?: string;
  /** Ações extras no cabeçalho, à esquerda do X. */
  headerActions?: ReactNode;
  initialFocus?: RefObject<HTMLElement>;
  className?: string;
}

export function Drawer({ open, onClose, title, ariaLabel, description, children, footer, side = 'right', width = 'sm:max-w-lg', headerActions, initialFocus, className }: DrawerProps) {
  const ref = useRef<HTMLElement>(null);
  const tituloId = useId();
  const descId = useId();
  useFocusTrap(ref, open, { onEsc: onClose, inicial: initialFocus });
  useScrollLock(open);
  if (!open) return null;
  return (
    <Portal>
      <div
        className={cx('lg-backdrop fixed inset-0 z-drawer flex', side === 'right' ? 'justify-end' : 'justify-start')}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <aside
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabel ? undefined : tituloId}
          aria-describedby={description ? descId : undefined}
          className={cx('lg-sheet lg-sheet-side flex w-full animate-fade-in flex-col outline-none', width, className)}
        >
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id={tituloId} className="truncate text-xs font-semibold uppercase tracking-wide text-muted">
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-0.5 text-sm text-muted">
                  {description}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {headerActions}
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Fechar" onClick={onClose}>
                <Icon name="close" size={16} />
              </button>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-5 scrollbar-thin">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</footer>}
        </aside>
      </div>
    </Portal>
  );
}

export interface ConfirmProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
  description?: ReactNode;
  /** Rótulo do botão de confirmação (padrão "Excluir"). */
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` (padrão) para ação destrutiva; `primary` para confirmação comum. */
  tone?: 'danger' | 'primary';
  /** Mostra carregando e trava os botões (ex.: enquanto a exclusão roda). */
  loading?: boolean;
  /** Exige digitar este texto antes de liberar (exclusão de alto impacto). */
  requireText?: string;
}

/**
 * Confirmação de ação. O foco inicial vai para "Cancelar": Enter por
 * engano nunca dispara a ação destrutiva.
 */
export function Confirm({ open, onClose, onConfirm, title, description, confirmLabel = 'Excluir', cancelLabel = 'Cancelar', tone = 'danger', loading = false, requireText }: ConfirmProps) {
  const cancelar = useRef<HTMLButtonElement>(null);
  const [digitado, setDigitado] = useState('');
  useEffect(() => {
    if (!open) setDigitado('');
  }, [open]);
  const liberado = !requireText || digitado === requireText;
  return (
    <Modal
      open={open}
      onClose={loading ? () => undefined : onClose}
      title={title}
      description={description}
      size="sm"
      initialFocus={cancelar}
      closeOnBackdrop={!loading}
      footer={
        <>
          <Button ref={cancelar} variant="ghost" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={loading} disabled={!liberado} onClick={() => void onConfirm()}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {requireText ? (
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-fg">Digite &quot;{requireText}&quot; para confirmar</span>
          <input className="input" value={digitado} onChange={(e) => setDigitado(e.target.value)} />
        </label>
      ) : undefined}
    </Modal>
  );
}
