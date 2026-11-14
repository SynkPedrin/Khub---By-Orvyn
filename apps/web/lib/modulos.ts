import type { IconName } from '@/components/icons';

/**
 * Acesso por módulo (ADR-0045) — espelho do catálogo de
 * `apps/api/src/auth/modulos.ts`. O papel diz o que a pessoa FAZ; os módulos
 * dizem o que ela VÊ. A API bloqueia de verdade; aqui o menu some e a rota
 * mostra "sem acesso" em vez de uma tela quebrada.
 */
export type Modulo = 'dashboard' | 'leads' | 'pipeline' | 'conversas' | 'agenda' | 'tarefas' | 'ia' | 'automacoes' | 'analytics' | 'financeiro';

export interface ModuloInfo {
  chave: Modulo;
  nome: string;
  descricao: string;
  icone: IconName;
  /** Rotas do app que pertencem ao módulo (prefixo). */
  rotas: string[];
}

export const MODULOS: ModuloInfo[] = [
  { chave: 'dashboard', nome: 'Dashboard', descricao: 'Números do dia e resumo da operação', icone: 'home', rotas: ['/dashboard'] },
  { chave: 'leads', nome: 'Leads', descricao: 'Contatos, empresas e carteira', icone: 'leads', rotas: ['/leads', '/contatos', '/empresas', '/carteira'] },
  { chave: 'pipeline', nome: 'Pipeline', descricao: 'Funis, negócios e propostas', icone: 'chart', rotas: ['/pipeline', '/funis', '/propostas'] },
  { chave: 'conversas', nome: 'Conversas', descricao: 'Atender os clientes no WhatsApp e demais canais', icone: 'chat', rotas: ['/conversas', '/inbox'] },
  { chave: 'agenda', nome: 'Agenda', descricao: 'Ver e marcar compromissos', icone: 'calendar', rotas: ['/agenda'] },
  { chave: 'tarefas', nome: 'Tarefas', descricao: 'Lista de tarefas da equipe', icone: 'check2', rotas: ['/tarefas'] },
  { chave: 'ia', nome: 'IA', descricao: 'NICO e os agentes de IA que atendem no WhatsApp', icone: 'sparkles', rotas: ['/nyro', '/agentes', '/ia', '/conhecimento'] },
  { chave: 'automacoes', nome: 'Automações e campanhas', descricao: 'Automações, campanhas, formulários, anúncios e redes sociais', icone: 'zap', rotas: ['/automacoes', '/campanhas', '/formularios', '/marketing', '/redes'] },
  { chave: 'analytics', nome: 'Analytics', descricao: 'Relatórios e funil de conversão', icone: 'trend', rotas: ['/analytics'] },
  { chave: 'financeiro', nome: 'Financeiro', descricao: 'Cobranças e links de pagamento', icone: 'finance', rotas: ['/financeiro'] },
];

/** Pacote padrão para o colaborador da loja: o dia a dia, sem IA (liberada depois, por pessoa). */
export const MODULOS_PADRAO: Modulo[] = ['dashboard', 'leads', 'pipeline', 'conversas', 'agenda', 'tarefas'];

/** Owner/admin nunca são restritos (são quem gerencia a equipe). */
export function papelRestringivel(role: string | undefined): boolean {
  return role === 'manager' || role === 'member' || role === 'viewer';
}

/** Módulo dono de uma rota, ou null se a rota não é de módulo (configurações, agência...). */
export function moduloDaRota(pathname: string): Modulo | null {
  for (const m of MODULOS) {
    if (m.rotas.some((r) => pathname === r || pathname.startsWith(`${r}/`))) return m.chave;
  }
  return null;
}

/** `modulos` null/undefined = sem restrição. */
export function podeVer(modulos: readonly string[] | null | undefined, pathname: string): boolean {
  if (modulos == null) return true;
  const m = moduloDaRota(pathname);
  return m === null || modulos.includes(m);
}

/** Primeira tela que a pessoa pode abrir (para onde mandar quem cai numa rota bloqueada). */
export function telaInicial(modulos: readonly string[] | null | undefined): string {
  if (modulos == null) return '/dashboard';
  const m = MODULOS.find((x) => modulos.includes(x.chave));
  return m ? m.rotas[0] : '/configuracoes';
}

/** Filtra um menu pelas rotas que a pessoa vê. */
export function filtrarPorModulos<T extends { href: string }>(itens: T[], modulos: readonly string[] | null | undefined): T[] {
  return modulos == null ? itens : itens.filter((i) => podeVer(modulos, i.href));
}
