'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { Icon } from '../icons';
import { cx } from '../ui';
import { useAgency } from './AgencyProvider';
import { motionTokens } from '@/lib/motion';
import type { SubcontaSeletor } from '@/lib/agency';

const MAX_RECENTES = 3;
const LARGURA_PAINEL = 360;
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const painelVariants: Variants = {
  fechado: { opacity: 0, y: -8, scale: 0.96 },
  aberto: { opacity: 1, y: 0, scale: 1, transition: { ...motionTokens.spring.responsive, staggerChildren: 0.025, delayChildren: 0.04 } },
  saindo: { opacity: 0, y: -6, scale: 0.97, transition: { duration: motionTokens.duration.instant } },
};
const linhaVariants: Variants = {
  fechado: { opacity: 0, x: -8 },
  aberto: { opacity: 1, x: 0, transition: { duration: motionTokens.duration.fast, ease: motionTokens.easing.standard } },
};

/**
 * SELETOR DE SUBCONTAS (estilo GHL) — topo da sidebar para quem é de uma
 * agência. Card com a subconta atual (nome + endereço) e, ao abrir, busca,
 * "Mudar para Exibição da Agência", "Recente" e "Todas as contas" (fixadas
 * primeiro). Os dados vêm de `GET /agency/switcher`: só aparece o que a
 * pessoa pode acessar, e "entrar" troca o tenant da sessão no backend
 * (`AgencyProvider.entrarNoCliente`) — nada aqui decide permissão.
 *
 * Teclado: ↑/↓ navegam, Enter entra, Esc fecha (combobox + listbox, com
 * `aria-activedescendant`). O painel vai num portal: a sidebar tem rolagem e
 * cantos arredondados que cortariam um popover de 360px.
 */
export function SubaccountSwitcher({ curta = false, onNavigate }: { curta?: boolean; onNavigate?: () => void }) {
  const { contexto, subcontas, clienteAtivo, entrarNoCliente, trocandoCliente, fixar, erro } = useAgency();
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const modoAgencia = pathname.startsWith('/agency');
  const idBase = useId().replace(/:/g, '');

  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [destaque, setDestaque] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number; origem: string } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const termo = normalizar(busca.trim());
  const secoes = useMemo(() => {
    const filtradas = termo
      ? subcontas.filter((c) => normalizar(c.nome).includes(termo) || normalizar(c.endereco ?? '').includes(termo))
      : subcontas;
    const todas = [...filtradas].sort((a, b) => Number(b.fixado) - Number(a.fixado) || a.nome.localeCompare(b.nome, 'pt-BR'));
    if (termo) return [{ chave: 'resultados', titulo: 'Resultados', itens: todas }];
    const recentes = subcontas
      .filter((c) => c.ultimoAcessoEm)
      .sort((a, b) => (b.ultimoAcessoEm ?? '').localeCompare(a.ultimoAcessoEm ?? ''))
      .slice(0, MAX_RECENTES);
    return [
      ...(recentes.length ? [{ chave: 'recente', titulo: 'Recente', itens: recentes }] : []),
      { chave: 'todas', titulo: 'Todas as contas', itens: todas },
    ];
  }, [subcontas, termo]);
  // Ordem de navegação por teclado (a mesma subconta pode estar em "Recente" e em "Todas").
  const navegaveis = useMemo(() => secoes.flatMap((s) => s.itens.map((c) => ({ secao: s.chave, c }))), [secoes]);

  const posicionar = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const largura = Math.min(LARGURA_PAINEL, window.innerWidth - 24);
    const top = curta ? r.top : r.bottom + 8;
    let left = curta ? r.right + 10 : r.left;
    left = Math.max(12, Math.min(left, window.innerWidth - largura - 12));
    setPos({ top, left, maxH: Math.max(240, window.innerHeight - top - 16), origem: curta ? 'left top' : 'top left' });
  }, [curta]);

  const fechar = useCallback((devolverFoco = false) => {
    setAberto(false);
    if (devolverFoco) triggerRef.current?.focus();
  }, []);

  const abrir = () => {
    posicionar();
    setBusca('');
    setDestaque(0);
    setAberto(true);
  };

  // Clique fora, redimensionar e rolar: fecha/reposiciona como um menu nativo.
  useEffect(() => {
    if (!aberto) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    const onDown = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (painelRef.current?.contains(alvo) || triggerRef.current?.contains(alvo)) return;
      fechar();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', posicionar);
    window.addEventListener('scroll', posicionar, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', posicionar);
      window.removeEventListener('scroll', posicionar, true);
    };
  }, [aberto, fechar, posicionar]);

  useEffect(() => setDestaque(0), [termo]);
  // Mantém a linha destacada visível ao navegar com as setas.
  useEffect(() => {
    if (!aberto) return;
    document.getElementById(`${idBase}-op-${destaque}`)?.scrollIntoView({ block: 'nearest' });
  }, [aberto, destaque, idBase]);

  if (!contexto) return null;

  const escolher = (c: SubcontaSeletor) => {
    if (c.status !== 'active') return;
    fechar();
    onNavigate?.();
    // Já é a subconta da sessão: só volta para a operação dela.
    if (c.id === clienteAtivo?.id) {
      if (modoAgencia) router.push('/dashboard');
      return;
    }
    void entrarNoCliente(c.id);
  };

  const irParaAgencia = () => {
    fechar();
    onNavigate?.();
    router.push('/agency');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setDestaque((i) => (navegaveis.length ? (i + 1) % navegaveis.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setDestaque((i) => (navegaveis.length ? (i - 1 + navegaveis.length) % navegaveis.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const alvo = navegaveis[destaque];
      if (alvo) escolher(alvo.c);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      fechar(true);
    }
  };

  const titulo = modoAgencia ? contexto.nome : clienteAtivo?.nome ?? contexto.nome;
  const subtitulo = modoAgencia ? 'Exibição da agência' : clienteAtivo ? clienteAtivo.endereco || 'Subconta' : 'Escolha uma subconta';
  const podeGerenciar = contexto.role === 'owner' || contexto.role === 'admin';
  let indice = -1;

  return (
    <>
      <motion.button
        ref={triggerRef}
        type="button"
        onClick={() => (aberto ? fechar() : abrir())}
        whileTap={{ scale: 0.98 }}
        disabled={trocandoCliente}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-label={`Subconta atual: ${titulo}. Trocar de subconta`}
        title={curta ? titulo : undefined}
        className={cx(
          'subconta-trigger group relative flex w-full items-center gap-2.5 rounded-[14px] text-left transition-colors',
          curta ? 'justify-center p-1.5' : 'px-2.5 py-2',
          aberto && 'subconta-trigger-aberto',
        )}
      >
        <Avatar nome={titulo} agencia={modoAgencia} grande />
        {!curta && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold leading-tight text-fg">{titulo}</span>
              <span className="block truncate text-[12px] leading-tight text-muted">{subtitulo}</span>
            </span>
            <motion.span animate={{ rotate: aberto ? 180 : 0 }} transition={motionTokens.spring.responsive} className="shrink-0 text-faint group-hover:text-fg">
              <Icon name="chevronsUpDown" size={16} />
            </motion.span>
          </>
        )}
      </motion.button>
      {erro && !curta && <p role="alert" className="mt-1.5 px-1 text-xs text-danger">{erro}</p>}

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {aberto && pos && (
              <motion.div
                ref={painelRef}
                key="painel-subcontas"
                initial="fechado"
                animate="aberto"
                exit="saindo"
                variants={painelVariants}
                style={{ position: 'fixed', top: pos.top, left: pos.left, width: Math.min(LARGURA_PAINEL, typeof window !== 'undefined' ? window.innerWidth - 24 : LARGURA_PAINEL), maxHeight: pos.maxH, transformOrigin: pos.origem, zIndex: 'var(--z-dropdown)' as unknown as number }}
                className="lg-popover subconta-painel flex flex-col overflow-hidden p-2"
                onKeyDown={onKeyDown}
              >
                <motion.label variants={linhaVariants} className="subconta-busca flex items-center gap-2 rounded-[12px] px-3">
                  <Icon name="search" size={16} className="shrink-0 text-faint" />
                  <input
                    ref={inputRef}
                    type="text"
                    role="combobox"
                    aria-expanded
                    aria-controls={`${idBase}-lista`}
                    aria-activedescendant={navegaveis.length ? `${idBase}-op-${destaque}` : undefined}
                    aria-label="Procurar por uma subconta"
                    placeholder="Procurar por uma subconta"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    className="h-10 w-full bg-transparent text-[13.5px] text-fg outline-none placeholder:text-faint"
                  />
                </motion.label>

                {!modoAgencia && (
                  <motion.button variants={linhaVariants} type="button" onClick={irParaAgencia} className="subconta-agencia mt-2 flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[13px] font-medium">
                    <span className="subconta-agencia-icone flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
                      <Icon name="undo" size={13} />
                    </span>
                    Mudar para Exibição da Agência
                  </motion.button>
                )}

                <div className="mt-2 border-t border-line" />

                <div id={`${idBase}-lista`} role="listbox" aria-label="Subcontas" className="min-h-0 flex-1 overflow-y-auto scrollbar-thin pt-1">
                  {secoes.map((s) => (
                    <div key={s.chave} role="group" aria-labelledby={`${idBase}-${s.chave}`}>
                      <motion.p variants={linhaVariants} id={`${idBase}-${s.chave}`} className="px-2.5 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">
                        {s.titulo}
                      </motion.p>
                      <AnimatePresence initial={false}>
                        {s.itens.map((c) => {
                          indice += 1;
                          const i = indice;
                          const atual = c.id === clienteAtivo?.id;
                          const inativa = c.status !== 'active';
                          return (
                            <motion.div
                              key={`${s.chave}-${c.id}`}
                              id={`${idBase}-op-${i}`}
                              role="option"
                              aria-selected={i === destaque}
                              aria-disabled={inativa || undefined}
                              aria-current={atual ? 'true' : undefined}
                              layout="position"
                              variants={linhaVariants}
                              exit={{ opacity: 0, x: -6, transition: { duration: motionTokens.duration.instant } }}
                              transition={motionTokens.spring.soft}
                              onMouseEnter={() => setDestaque(i)}
                              onClick={() => escolher(c)}
                              className={cx(
                                'subconta-linha relative mb-1 flex cursor-pointer items-center gap-2.5 rounded-[12px] px-2.5 py-2',
                                atual && 'subconta-linha-atual',
                                inativa && 'cursor-not-allowed opacity-55',
                              )}
                            >
                              {i === destaque && (
                                <motion.span layoutId={`${idBase}-destaque`} className="subconta-destaque absolute inset-0 rounded-[inherit]" transition={motionTokens.spring.responsive} aria-hidden />
                              )}
                              <Avatar nome={c.nome} />
                              <span className="relative min-w-0 flex-1">
                                <span className="flex items-center gap-1.5">
                                  <span className="truncate text-[13px] font-medium text-fg">{c.nome}</span>
                                  {c.isDemo && <span className="subconta-selo">Demo</span>}
                                  {inativa && <span className="subconta-selo">{c.status === 'paused' ? 'Pausada' : 'Arquivada'}</span>}
                                </span>
                                <span className="block truncate text-[11.5px] text-muted">{c.endereco || 'Endereço não cadastrado'}</span>
                              </span>
                              <span className="relative flex shrink-0 items-center gap-1">
                                {atual && (
                                  <span className="subconta-casa flex h-7 w-7 items-center justify-center" title="Subconta atual">
                                    <Icon name="home" size={15} />
                                    <span className="sr-only">Subconta atual</span>
                                  </span>
                                )}
                                <button
                                  type="button"
                                  tabIndex={-1}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void fixar(c.id, !c.fixado);
                                  }}
                                  aria-pressed={c.fixado}
                                  aria-label={c.fixado ? `Desafixar ${c.nome}` : `Fixar ${c.nome}`}
                                  title={c.fixado ? 'Desafixar' : 'Fixar no topo'}
                                  className={cx('subconta-pino flex h-7 w-7 items-center justify-center rounded-[8px]', c.fixado && 'subconta-pino-ativo')}
                                >
                                  <motion.span
                                    key={c.fixado ? 'fixo' : 'solto'}
                                    initial={{ scale: 0.5, rotate: c.fixado ? -35 : 0 }}
                                    animate={{ scale: 1, rotate: c.fixado ? 0 : 35 }}
                                    transition={{ type: 'spring', stiffness: 520, damping: 18 }}
                                    className="flex"
                                  >
                                    <Icon name="pin" size={15} />
                                  </motion.span>
                                </button>
                              </span>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </div>
                  ))}

                  {!navegaveis.length && (
                    <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="px-3 py-8 text-center text-[13px] text-muted">
                      {subcontas.length ? 'Nenhuma subconta encontrada.' : 'Você ainda não tem acesso a nenhuma subconta.'}
                    </motion.p>
                  )}
                </div>

                <motion.div variants={linhaVariants} className="mt-1 flex items-center justify-between border-t border-line px-2.5 pt-2 text-[11.5px] text-faint">
                  <span>
                    {subcontas.length} {subcontas.length === 1 ? 'subconta' : 'subcontas'}
                  </span>
                  {podeGerenciar && (
                    <button
                      type="button"
                      onClick={() => {
                        fechar();
                        onNavigate?.();
                        router.push('/agency/clients');
                      }}
                      className="font-medium text-muted transition-colors hover:text-fg"
                    >
                      Gerenciar subcontas
                    </button>
                  )}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

/** Inicial da subconta (como o círculo "S" do GHL); a agência usa o prédio. */
function Avatar({ nome, agencia = false, grande = false }: { nome: string; agencia?: boolean; grande?: boolean }) {
  const letra = (nome.trim()[0] ?? '?').toUpperCase();
  return (
    <span className={cx('subconta-avatar relative flex shrink-0 items-center justify-center font-semibold', grande ? 'h-9 w-9 rounded-[11px] text-[14px]' : 'h-8 w-8 rounded-full text-[12.5px]')} aria-hidden>
      {agencia ? <Icon name="building" size={grande ? 17 : 15} /> : letra}
    </span>
  );
}
