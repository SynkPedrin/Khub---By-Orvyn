/**
 * Acesso por módulo (ADR-0045).
 *
 * O PAPEL (owner/admin/manager/member/viewer) diz o que a pessoa pode FAZER;
 * os MÓDULOS dizem quais áreas do sistema ela VÊ. Serve para o colaborador da
 * loja do cliente: entra só em Conversas e Agenda, por exemplo, e a IA é
 * liberada depois, por pessoa.
 *
 * Regras:
 * - `users.permissoes.modulos` ausente = sem restrição (comportamento de antes).
 * - Owner e admin nunca são restritos: são quem gerencia a equipe.
 * - A API bloqueia por rota (PermissionsGuard), não só o menu.
 * - Leitura de cadastro compartilhado (contato, negócio, compromisso) é
 *   liberada para qualquer módulo que precise dela na própria tela (ex.:
 *   Conversas mostra o contato e a agenda dele); escrever exige o módulo dono.
 */
export const MODULOS = ['dashboard', 'leads', 'pipeline', 'conversas', 'agenda', 'tarefas', 'ia', 'automacoes', 'analytics', 'financeiro'] as const;
export type Modulo = (typeof MODULOS)[number];

const CONJUNTO = new Set<string>(MODULOS);

/** Limpa a lista vinda do cliente: só chaves conhecidas, sem repetição, na ordem do catálogo. */
export function normalizarModulos(lista: unknown): Modulo[] {
  if (!Array.isArray(lista)) return [];
  const pedidos = new Set(lista.filter((m): m is string => typeof m === 'string' && CONJUNTO.has(m)));
  return MODULOS.filter((m) => pedidos.has(m));
}

/** Lê `permissoes.modulos` de um JSON de users/invites. `null` = sem restrição. */
export function modulosDe(permissoes: unknown): Modulo[] | null {
  if (!permissoes || typeof permissoes !== 'object' || Array.isArray(permissoes)) return null;
  const m = (permissoes as Record<string, unknown>).modulos;
  return Array.isArray(m) ? normalizarModulos(m) : null;
}

/** Papéis que podem ter módulos restritos. */
export function papelRestringivel(role: string): boolean {
  return role === 'manager' || role === 'member' || role === 'viewer';
}

/** Módulos que abrem dados compartilhados de CRM (contato, empresa) para leitura. */
const LEEM_CADASTRO: Modulo[] = ['dashboard', 'leads', 'pipeline', 'conversas', 'agenda', 'tarefas'];

/**
 * Quais módulos liberam esta rota (basta UM). `null` = rota não é de módulo
 * (perfil, configurações, integrações, agência...): só o papel decide.
 */
export function modulosDaRota(controller: string, route: string, method: string): Modulo[] | null {
  const leitura = ['GET', 'HEAD', 'OPTIONS'].includes(method);
  switch (controller) {
    case 'nyro':
    case 'agents':
    case 'rag':
      return ['ia'];
    case 'agenda':
    case 'booking-pages':
      return leitura ? ['agenda', 'conversas', 'leads', 'dashboard'] : ['agenda'];
    case 'financeiro':
      return ['financeiro'];
    case 'redes':
    case 'redes/instagram':
      return ['automacoes'];
    case 'analytics':
      return ['analytics', 'dashboard'];
    case 'automations':
    case 'marketplace':
    case 'blueprints':
    case 'disparos':
      return ['automacoes'];
    case 'forms':
      // A agenda usa formulários nas páginas de agendamento.
      return leitura ? ['automacoes', 'agenda'] : ['automacoes'];
    case 'crm':
      return moduloCrm(route, leitura);
    default:
      return null;
  }
}

function moduloCrm(route: string, leitura: boolean): Modulo[] | null {
  const r = route.split('/')[0];
  if (r === 'overview') return ['dashboard'];
  if (['conversations', 'quick-replies', 'atendentes'].includes(r)) return ['conversas'];
  if (['pipelines', 'pipeline', 'stages', 'deals', 'proposals', 'lost-reasons'].includes(r)) {
    return leitura ? ['pipeline', 'dashboard', 'leads', 'conversas'] : ['pipeline'];
  }
  if (r === 'tasks') return leitura ? ['tarefas', 'dashboard', 'leads', 'pipeline'] : ['tarefas', 'leads', 'pipeline', 'conversas'];
  if (r === 'carteira') return ['leads'];
  if (['contacts', 'companies', 'contact-views', 'notes', 'custom-fields', 'import'].includes(r)) {
    return leitura ? LEEM_CADASTRO : ['leads', 'conversas', 'pipeline'];
  }
  // `search` (paleta ⌘K) e o que vier depois: só o papel decide.
  return null;
}

/** A pessoa (com estes módulos) passa nesta rota? */
export function moduloLiberado(modulos: readonly string[] | null | undefined, exigidos: Modulo[] | null): boolean {
  if (!exigidos || modulos == null) return true;
  return exigidos.some((m) => modulos.includes(m));
}
