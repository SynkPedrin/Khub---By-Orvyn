'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon, type IconName } from '@/components/icons';
import { cx } from '@/components/ui';
import { CanalIcone } from './CanalIcone';

interface Opcao {
  chave: 'direct' | 'redes';
  titulo: string;
  descricao: string;
  icone: IconName;
}

const OPCOES: Opcao[] = [
  { chave: 'direct', titulo: 'Gerenciar Direct', descricao: 'Ver e responder as mensagens do Direct', icone: 'chat' },
  { chave: 'redes', titulo: 'Gerenciar redes', descricao: 'Métricas, posts, engajamento e público', icone: 'chart' },
];

/**
 * Item "Instagram" da coluna de canais de Conversas. Clicar abre um menu:
 * "Gerenciar Direct" filtra a lista no Instagram (o que o item fazia antes);
 * "Gerenciar redes" abre a gestão completa da conta (/redes/instagram).
 * O menu vai num portal com posição fixa: a coluna rola e cortaria um
 * popover absoluto.
 */
export function ItemInstagram({ ativo, total, titulo, onDirect }: { ativo: boolean; total: number; titulo?: string; onDirect: () => void }) {
  const router = useRouter();
  const botao = useRef<HTMLButtonElement>(null);
  const painel = useRef<HTMLDivElement>(null);
  const [aberto, setAberto] = useState(false);
  const [foco, setFoco] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  const posicionar = () => {
    const r = botao.current?.getBoundingClientRect();
    if (!r) return;
    const largura = 280;
    const cabeAoLado = r.right + 8 + largura <= window.innerWidth - 8;
    setPos(cabeAoLado ? { top: Math.min(r.top - 6, window.innerHeight - 220), left: r.right + 8 } : { top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - largura - 8)) });
  };
  useLayoutEffect(() => {
    if (!aberto) return;
    posicionar();
    const fechar = () => setAberto(false);
    window.addEventListener('resize', fechar);
    window.addEventListener('scroll', fechar, true);
    return () => {
      window.removeEventListener('resize', fechar);
      window.removeEventListener('scroll', fechar, true);
    };
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (!painel.current?.contains(alvo) && !botao.current?.contains(alvo)) setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    requestAnimationFrame(() => painel.current?.focus());
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  const escolher = (o: Opcao) => {
    setAberto(false);
    if (o.chave === 'direct') onDirect();
    else router.push('/redes/instagram');
  };

  const teclado = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); setAberto(false); botao.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setFoco((f) => (f + 1) % OPCOES.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFoco((f) => (f - 1 + OPCOES.length) % OPCOES.length); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); escolher(OPCOES[foco]); }
    else if (e.key === 'Tab') setAberto(false);
  };

  return (
    <li>
      <button
        ref={botao}
        type="button"
        onClick={() => { setFoco(0); setAberto((v) => !v); }}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-pressed={ativo}
        title={titulo}
        className={cx(
          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors',
          ativo ? 'bg-brand-soft font-semibold text-brand' : 'text-muted hover:bg-[var(--fill-4)] hover:text-fg',
          aberto && !ativo && 'bg-[var(--fill-4)] text-fg',
        )}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center"><CanalIcone canal="Instagram" size={15} /></span>
        <span className="min-w-0 flex-1 truncate">Instagram</span>
        <span className="shrink-0 text-[11.5px] tabular text-muted">{total}</span>
        <Icon name="chevronRight" size={12} className={cx('shrink-0 text-muted transition-transform duration-200', aberto && 'rotate-90')} />
      </button>

      {montado && createPortal(
        <AnimatePresence>
          {aberto && pos && (
            <motion.div
              ref={painel}
              role="menu"
              aria-label="Instagram"
              tabIndex={-1}
              onKeyDown={teclado}
              initial={{ opacity: 0, scale: 0.94, x: -6 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.96, x: -4, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 34 }}
              style={{ top: pos.top, left: pos.left, transformOrigin: 'top left' }}
              className="fixed z-[70] w-[280px] overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-2xl outline-none"
            >
              <div className="relative mb-1 flex items-center gap-2.5 overflow-hidden rounded-xl px-2.5 py-2">
                <span aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.14]" style={{ background: 'linear-gradient(120deg, #feda75, #fa7e1e 30%, #d62976 55%, #962fbf 80%, #4f5bd5)' }} />
                <motion.span initial={{ rotate: -14, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 16, delay: 0.04 }} className="relative">
                  <CanalIcone canal="Instagram" size={20} />
                </motion.span>
                <div className="relative min-w-0">
                  <p className="text-[13px] font-bold text-fg">Instagram</p>
                  <p className="text-2xs text-muted">{total} conversa(s) no Direct</p>
                </div>
              </div>
              {OPCOES.map((o, i) => (
                <motion.button
                  key={o.chave}
                  type="button"
                  role="menuitem"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 + i * 0.05, type: 'spring', stiffness: 500, damping: 32 }}
                  onMouseEnter={() => setFoco(i)}
                  onClick={() => escolher(o)}
                  className={cx('relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left', foco === i ? 'text-fg' : 'text-muted')}
                >
                  {foco === i && <motion.span layoutId="menu-instagram-foco" className="absolute inset-0 rounded-xl bg-[var(--fill-4)]" transition={{ type: 'spring', stiffness: 600, damping: 40 }} />}
                  <span className={cx('relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', o.chave === 'redes' ? 'bg-[#d62976]/12 text-[#d62976]' : 'bg-brand/12 text-brand')}>
                    <Icon name={o.icone} size={16} />
                  </span>
                  <span className="relative min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
                      {o.titulo}
                      {o.chave === 'direct' && ativo && <span className="rounded-full bg-brand/15 px-1.5 text-2xs font-semibold text-brand">aberto</span>}
                    </span>
                    <span className="block text-2xs text-muted">{o.descricao}</span>
                  </span>
                  <Icon name={o.chave === 'redes' ? 'external' : 'chevronRight'} size={13} className="relative shrink-0 text-muted" />
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </li>
  );
}
