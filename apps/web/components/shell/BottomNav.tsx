'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { Icon, type IconName } from '../icons';
import { cx } from '../ui';
import { activeHref, type NavItem } from './nav';
import { useLocale } from '@/lib/locale';
import { useAgency } from '@/components/agency/AgencyProvider';
import { useAuth } from '@/lib/auth';
import { podeVer } from '@/lib/modulos';
import { motionTokens } from '@/lib/motion';

/**
 * Barra de navegação inferior — mobile e tablet (< lg).
 *
 * Vidro flutuante igual à sidebar/topbar (ADR-0029), com o indicador ativo
 * deslizando entre as abas via `layoutId` (spring compartilhado do design
 * system). Mostra os atalhos centrais da operação; o restante do menu abre
 * na gaveta pela aba "Menu". Respeita a safe-area do iPhone e o acesso por
 * módulo (ADR-0045): aba escondida no mobile some daqui também.
 */
export function BottomNav({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname() ?? '/';
  const { t } = useLocale();
  const { contexto } = useAgency();
  const { user } = useAuth();
  const modoAgencia = pathname.startsWith('/agency');

  const atalhos: { href: string; label: string; icon: IconName }[] = modoAgencia
    ? [
        { href: '/agency', label: 'Visão geral', icon: 'grid' },
        { href: '/agency/clients', label: 'Clientes', icon: 'building' },
        { href: '/nyro', label: 'NICO', icon: 'sparkles' },
      ]
    : [
        { href: '/dashboard', label: 'Dashboard', icon: 'home' },
        { href: '/conversas', label: 'Conversas', icon: 'chat' },
        { href: '/pipeline', label: 'Pipeline', icon: 'chart' },
        { href: '/agenda', label: 'Agenda', icon: 'calendar' },
      ];

  const visiveis = atalhos.filter((a) => modoAgencia || podeVer(user?.modulos, a.href as NavItem['href']));
  const active = activeHref(pathname, visiveis);

  return (
    <nav
      aria-label="Navegação inferior"
      className="glass-floating nav-floating fixed inset-x-3 bottom-0 z-topbar mx-auto flex max-w-md items-stretch gap-1 rounded-full p-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] lg:hidden"
    >
      {visiveis.map((item) => {
        const isActive = item.href === active;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className="relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-full px-1 py-1.5"
          >
            {isActive && (
              <motion.span
                layoutId="bottomnav-active"
                className="glass-accent absolute inset-0 rounded-full"
                transition={motionTokens.spring.responsive}
                aria-hidden
              />
            )}
            <Icon
              name={item.icon}
              size={21}
              className={cx('relative shrink-0 transition-colors', isActive ? 'text-fg' : 'text-faint')}
            />
            <span
              className={cx(
                'relative max-w-full truncate text-2xs font-medium leading-none transition-colors',
                isActive ? 'text-fg' : 'text-faint',
              )}
            >
              {t(item.label)}
            </span>
          </Link>
        );
      })}

      <button
        type="button"
        onClick={onMenu}
        aria-label="Abrir menu completo"
        className="relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-full px-1 py-1.5"
      >
        <Icon name="menu" size={21} className="relative shrink-0 text-faint" />
        <span className="relative max-w-full truncate text-2xs font-medium leading-none text-faint">Menu</span>
      </button>
    </nav>
  );
}
