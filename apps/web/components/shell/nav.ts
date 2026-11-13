import type { IconName } from '../icons';

/**
 * Navegação do KHUB.
 *
 * PRIMARY é o menu do produto. SECONDARY são módulos herdados do KHUB OS que
 * continuam funcionando e testados, mas saem da navegação primária para não
 * diluir o foco em receita — acessíveis só por rota direta hoje (nenhuma tela
 * ainda lista SECONDARY_NAV; ver decisão 3 em `docs/KHUB_REVENUE_AUDIT.md`).
 * "Agentes de IA" é exceção deliberada: feature nova e central (ADR-0030),
 * foi para o PRIMARY para não nascer invisível.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Chave do contador dinâmico exibido como badge (ex.: conversas não lidas). */
  badge?: 'conversas';
  /** Grupo visual da sidebar (ADR-0036): itens não ficam todos no mesmo nível. */
  grupo?: NavGrupo;
}

export type NavGrupo = 'Operação' | 'Crescimento' | 'Inteligência' | 'Agência' | 'Conta';

/** Agrupa preservando a ordem de declaração (o primeiro item define a ordem do grupo). */
export function agruparNav(items: NavItem[]): { grupo: NavGrupo | null; itens: NavItem[] }[] {
  const grupos: { grupo: NavGrupo | null; itens: NavItem[] }[] = [];
  for (const item of items) {
    const g = item.grupo ?? null;
    const atual = grupos.find((x) => x.grupo === g);
    if (atual) atual.itens.push(item);
    else grupos.push({ grupo: g, itens: [item] });
  }
  return grupos;
}

export const PRIMARY_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'home', grupo: 'Operação' },
  { href: '/leads', label: 'Leads', icon: 'leads', grupo: 'Operação' },
  { href: '/pipeline', label: 'Pipeline', icon: 'chart', grupo: 'Operação' },
  { href: '/conversas', label: 'Conversas', icon: 'chat', badge: 'conversas', grupo: 'Operação' },
  { href: '/agenda', label: 'Agenda', icon: 'calendar', grupo: 'Operação' },
  { href: '/tarefas', label: 'Tarefas', icon: 'check2', grupo: 'Operação' },
  { href: '/automacoes', label: 'Automações', icon: 'zap', grupo: 'Crescimento' },
  { href: '/campanhas', label: 'Campanhas', icon: 'send', grupo: 'Crescimento' },
  // Captura de leads por link/embed (Q4.1).
  { href: '/formularios', label: 'Formulários', icon: 'file', grupo: 'Crescimento' },
  { href: '/analytics', label: 'Analytics', icon: 'trend', grupo: 'Crescimento' },
  // Cobranças e links de pagamento: receita, junto das ferramentas de crescimento (Q2.6).
  { href: '/financeiro', label: 'Financeiro', icon: 'finance', grupo: 'Crescimento' },
  // NICO = agente INTERNA (trabalha com a equipe); Agentes de IA = atendem CLIENTES no WhatsApp (ADR-0040).
  { href: '/nyro', label: 'NICO', icon: 'sparkles', grupo: 'Inteligência' },
  { href: '/agentes', label: 'Agentes de IA', icon: 'chat', grupo: 'Inteligência' },
  { href: '/configuracoes', label: 'Configurações', icon: 'settings', grupo: 'Conta' },
];

/** Sidebar quando dentro de `/agency*` — nunca misturada com a navegação operacional de um cliente. */
export const AGENCY_NAV: NavItem[] = [
  { href: '/agency', label: 'Visão geral', icon: 'grid', grupo: 'Agência' },
  { href: '/agency/clients', label: 'Clientes', icon: 'building', grupo: 'Agência' },
  { href: '/agency/equipe', label: 'Equipe', icon: 'users', grupo: 'Agência' },
  { href: '/nyro', label: 'NICO', icon: 'sparkles', grupo: 'Inteligência' },
  { href: '/agency/configuracoes', label: 'Configurações', icon: 'settings', grupo: 'Conta' },
];

/** Empresas, Tarefas e Financeiro subiram para o PRIMARY na Q2.6. */
export const SECONDARY_NAV: NavItem[] = [
  { href: '/conhecimento', label: 'Conhecimento', icon: 'knowledge' },
  { href: '/marketing/ads', label: 'Anúncios', icon: 'marketing' },
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
