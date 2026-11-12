'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { Icon } from '../icons';
import { cx } from '../ui';
import { PRIMARY_NAV, AGENCY_NAV, activeHref, agruparNav, type NavItem } from './nav';
import { modoDemo } from '@/lib/demo/flag';
import { useEffect, useState } from 'react';
import { useLocale } from '@/lib/locale';
import { useAgency } from '@/components/agency/AgencyProvider';
import { SubaccountSwitcher } from '@/components/agency/SubaccountSwitcher';
import { motionTokens } from '@/lib/motion';
import { billingApi, NOME_PLANO, ROTULO_STATUS, type BillingStatus } from '@/lib/billing';

const PREF_RECOLHIDA = 'khub:sidebar-recolhida';

/**
 * Sidebar fixa do KHUB.
 *
 * Liquid Glass regular flutuando sobre o ambient (ADR-0029). O item ativo
 * é um tint de marca que desliza entre itens (spring do framer-motion),
 * e o que fica dentro do vidro usa preenchimento, nunca outro vidro.
 *
 * Acessibilidade: `<nav>` rotulado, `aria-current="page"` no item ativo
 * (é ele quem pinta o estado — não uma classe condicional), e foco visível
 * herdado de `:focus-visible` do design system.
 */
export function Sidebar({
  badges,
  onNavigate,
  className,
}: {
  /** Contadores dinâmicos por chave (ex.: `{ conversas: 3 }`). */
  badges?: Partial<Record<NonNullable<NavItem['badge']>, number>>;
  /** Chamado ao navegar — usado pelo drawer mobile para se fechar. */
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname() ?? '/';
  const {t}=useLocale();
  const { contexto, clienteAtivo } = useAgency();
  // Modo agência tem a PRÓPRIA navegação (seção 24 do brief) — nunca
  // misturada com a operacional de um cliente. `/agency` nunca é rota de
  // um cliente (nome reservado), então esta checagem é segura.
  const modoAgencia = pathname.startsWith('/agency');
  const nav = modoAgencia ? AGENCY_NAV : PRIMARY_NAV;
  const active = activeHref(pathname, nav);
  const grupos = agruparNav(nav);

  // Recolher (ADR-0036): só no desktop — a gaveta mobile (tem `onNavigate`)
  // sempre abre inteira. Preferência de conveniência por navegador.
  const podeRecolher = !onNavigate;
  const [recolhida, setRecolhida] = useState(false);
  useEffect(() => {
    if (!podeRecolher) return;
    try {
      setRecolhida(localStorage.getItem(PREF_RECOLHIDA) === '1');
    } catch {
      /* armazenamento indisponível: fica expandida */
    }
  }, [podeRecolher]);
  // Editor de automação: o canvas precisa de espaço, então a sidebar fica
  // recolhida no quadrado do KHUB (o editor começa logo depois dela, ver
  // automacoes/[id]/page.tsx). Não mexe na preferência das outras telas.
  const noEditor = /^\/automacoes\/[^/]+$/.test(pathname);
  const alternar = () =>
    setRecolhida((r) => {
      try {
        localStorage.setItem(PREF_RECOLHIDA, r ? '0' : '1');
      } catch {
        /* sem persistência: vale só nesta visita */
      }
      return !r;
    });
  const curta = podeRecolher && (noEditor || recolhida);

  // Plano real do tenant ativo (assinatura da plataforma). Sem assinatura ou
  // sem resposta, o cartão não aparece: nada de "Plano Pro" fixo (Q1.9).
  const [assinatura, setAssinatura] = useState<BillingStatus | null>(null);
  const demo = modoDemo();
  useEffect(() => {
    if (demo) return;
    let vivo = true;
    billingApi
      .status()
      .then((b) => vivo && setAssinatura(b))
      .catch(() => vivo && setAssinatura(null));
    return () => {
      vivo = false;
    };
  }, [demo, clienteAtivo?.id]);

  return (
    <div
      className={cx(
        'glass-floating nav-floating sidebar-shell flex h-full flex-col transition-[width] duration-200 ease-out',
        curta ? 'w-[76px]' : 'w-sidebar',
        className,
      )}
    >
      {/* Marca — logo branca ocupando a sidebar de ponta a ponta; símbolo KHUB quando recolhida. */}
      <div className={cx('sidebar-brand sidebar-hairline flex shrink-0 items-center border-b', curta ? 'h-topbar justify-center px-2' : 'px-4 py-5')}>
        <Link
          href="/dashboard"
          onClick={onNavigate}
          aria-label="KHUB, ir para o Dashboard"
          className="flex w-full items-center"
        >
          {curta ? (
            <Image src="/khub-mark.png" alt="KHUB" width={330} height={330} unoptimized priority className="h-9 w-9 object-contain" />
          ) : (
            <Image
              src="/khub-logo.png"
              alt="KHUB"
              width={711}
              height={261}
              unoptimized
              priority
              className="h-auto w-full object-contain"
            />
          )}
        </Link>
      </div>

      {/* Seletor de subcontas (estilo GHL): só para quem é de uma agência. */}
      {contexto && (
        <div className={cx('shrink-0 pt-3', curta ? 'px-2' : 'px-3')}>
          <SubaccountSwitcher curta={curta} onNavigate={onNavigate} />
        </div>
      )}

      {/* Navegação primária */}
      <nav aria-label="Navegação principal" className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2">
        {grupos.map(({ grupo, itens }, gi) => (
          <div key={grupo ?? gi} className={cx(gi > 0 && (curta ? 'mt-2 border-t border-line pt-2' : 'sidebar-hairline mt-3 border-t pt-3'))}>
            {grupo && !curta && <p className="nav-grupo">{grupo}</p>}
            <ul className="space-y-0.5">
              {itens.map((item) => {
                const isActive = item.href === active;
                const count = item.badge ? badges?.[item.badge] : undefined;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={isActive ? 'page' : undefined}
                      title={curta ? t(item.label) : undefined}
                      className={cx('nav-floating-item nav-item !bg-transparent', curta && 'justify-center px-0')}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="active-nav-indicator"
                          className="glass-accent absolute inset-0 rounded-[inherit]"
                          transition={motionTokens.spring.responsive}
                          aria-hidden
                        />
                      )}
                      <Icon name={item.icon} size={21} className="relative shrink-0" />
                      <span className={cx('relative flex-1 truncate', curta && 'sr-only')}>{t(item.label)}</span>
                      {count ? (
                        <span
                          className={cx(
                            'inline-flex items-center justify-center rounded-full bg-brand font-semibold text-[#0e1a04]',
                            curta ? 'absolute right-2 top-1.5 h-4 min-w-4 px-1 text-2xs' : 'h-5 min-w-5 px-1.5 text-[11px]',
                          )}
                          aria-label={`${count} não lidas`}
                        >
                          {count > 99 ? '99+' : count}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Rodapé: plano. No modo real vem de `GET /billing/status`; sem
          assinatura o cartão some. Sem tela de cobrança no app ainda, não há
          botão de upgrade (seria um botão morto, ADR-0039). */}
      <div className="sidebar-hairline shrink-0 space-y-2 border-t p-3">
        {!curta &&
          (demo ? (
            <PlanCard plano="Plano Pro" descricao="Seu crescimento sem limites." usado={284} total={500_000} />
          ) : assinatura?.plano && assinatura.status !== 'sem_assinatura' ? (
            <PlanCard
              plano={`Plano ${NOME_PLANO[assinatura.plano] ?? assinatura.plano}`}
              descricao={ROTULO_STATUS[assinatura.status]}
              alerta={assinatura.status === 'inadimplente' || assinatura.status === 'cancelada'}
            />
          ) : null)}
        {podeRecolher && !noEditor && (
          <button
            type="button"
            onClick={alternar}
            className={cx('nav-item w-full text-[13px]', curta && 'justify-center px-0')}
            aria-label={curta ? 'Expandir menu lateral' : 'Recolher menu lateral'}
            aria-expanded={!curta}
            title={curta ? 'Expandir menu' : undefined}
          >
            <Icon name="chevronRight" size={17} className={cx('shrink-0 transition-transform duration-200', !curta && 'rotate-180')} />
            {!curta && <span>Recolher menu</span>}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Cartão de plano da sidebar: apresentacional, recebe o plano por props.
 * O botão de upgrade só aparece quando houver `href` para uma tela de
 * cobrança que exista.
 */
export function PlanCard({
  plano,
  descricao,
  usado,
  total,
  unidade = 'leads',
  href,
  alerta = false,
}: {
  plano: string;
  descricao?: string;
  usado?: number;
  total?: number;
  unidade?: string;
  href?: string;
  /** Pagamento pendente/cancelado: descrição em tom de atenção. */
  alerta?: boolean;
}) {
  const temUso = typeof usado === 'number' && typeof total === 'number' && total > 0;
  const pct = temUso ? Math.min(100, Math.round((usado / total) * 100)) : 0;

  return (
    <div className="lg-well p-4">
      <div className="flex items-center gap-2.5">
        <span className="icon-tile h-8 w-8">
          <Icon name="crown" size={16} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-fg">{plano}</p>
        </div>
      </div>
      {descricao && <p className={cx('mt-1.5 text-xs leading-snug', alerta ? 'font-medium text-warning' : 'text-muted')}>{descricao}</p>}

      {temUso && (
        <div className="mt-3">
          <p className="text-xs text-muted">
            <span className="font-semibold text-fg tabular">{usado.toLocaleString('pt-BR')}</span> de{' '}
            {total.toLocaleString('pt-BR')} {unidade}
          </p>
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface3"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Uso do plano: ${pct}%`}
          >
            <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {href && (
        <Link href={href} className="btn btn-soft btn-sm mt-3 w-full">
          Fazer upgrade
          <Icon name="arrowRight" size={14} />
        </Link>
      )}
    </div>
  );
}
