import type { IconName } from '../icons';

/**
 * Navegação do ORVYN Revenue OS.
 *
 * PRIMARY é o menu do produto (10 itens, conforme a especificação visual).
 * SECONDARY são módulos herdados do ORVYN OS que continuam funcionando e
 * testados, mas saem da navegação primária para não diluir o foco em receita.
 * Eles seguem acessíveis por rota direta e por Configurações — ver decisão 3
 * em `docs/ORVYN_REVENUE_AUDIT.md`.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Chave do contador dinâmico exibido como badge (ex.: conversas não lidas). */
  badge?: 'conversas';
}

export const PRIMARY_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'home' },
  { href: '/leads', label: 'Leads', icon: 'leads' },
  { href: '/pipeline', label: 'Pipeline', icon: 'chart' },
  { href: '/conversas', label: 'Conversas', icon: 'chat', badge: 'conversas' },
  { href: '/automacoes', label: 'Automações', icon: 'zap' },
  { href: '/campanhas', label: 'Campanhas', icon: 'send' },
  { href: '/agenda', label: 'Agenda', icon: 'calendar' },
  { href: '/analytics', label: 'Analytics', icon: 'trend' },
  { href: '/ia', label: 'IA', icon: 'ai' },
  { href: '/configuracoes', label: 'Configurações', icon: 'settings' },
];

/** Sidebar quando dentro de `/agency*` — nunca misturada com a navegação operacional de um cliente. */
export const AGENCY_NAV: NavItem[] = [
  { href: '/agency', label: 'Visão geral', icon: 'grid' },
  { href: '/agency/clients', label: 'Clientes', icon: 'building' },
  { href: '/agency/equipe', label: 'Equipe', icon: 'users' },
  { href: '/agency/configuracoes', label: 'Configurações', icon: 'settings' },
];

export const SECONDARY_NAV: NavItem[] = [
  { href: '/empresas', label: 'Empresas', icon: 'building' },
  { href: '/tarefas', label: 'Tarefas', icon: 'check2' },
  { href: '/conhecimento', label: 'Conhecimento', icon: 'knowledge' },
  { href: '/marketing/ads', label: 'Anúncios', icon: 'marketing' },
  { href: '/financeiro', label: 'Financeiro', icon: 'finance' },
];

/**
 * Qual item está ativo para um dado pathname.
 *
 * Regra "mais específico vence": com `/marketing` e `/marketing/ads` no menu,
 * estar em `/marketing/ads` acende só Anúncios. Retorna o href vencedor ou ''.
 */
export function activeHref(pathname: string, items: NavItem[] = PRIMARY_NAV): string {
  return items.reduce((best, item) => {
    const matches = pathname === item.href || pathname.startsWith(item.href + '/');
    return matches && item.href.length > best.length ? item.href : best;
  }, '');
}
