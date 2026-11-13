/**
 * Lógica pura da tela de Conversas (desenho do mockup da LP): filtros que vão
 * ao servidor, busca local instantânea e quais canais a coluna "Canais" lista.
 * Sem React: testada com vitest (`conversas-filtro.test.ts`).
 */

export type StatusLista = 'todas' | 'nao_lidas' | 'em_atendimento' | 'aguardando' | 'resolvidas';

export interface FiltroLista {
  canal: string;
  status: StatusLista;
  etiqueta: string | null;
}

export const FILTRO_INICIAL: FiltroLista = { canal: 'todos', status: 'todas', etiqueta: null };

/** Ordem fixa da coluna Canais (WhatsApp primeiro: é o canal principal). */
export const ORDEM_CANAIS = ['WhatsApp', 'Instagram', 'Messenger', 'Facebook', 'YouTube', 'TikTok', 'E-mail', 'Site'] as const;

export const STATUS_LISTA: { chave: StatusLista; rotulo: string; dica: string }[] = [
  { chave: 'todas', rotulo: 'Todas', dica: 'Todas as conversas' },
  { chave: 'nao_lidas', rotulo: 'Não lidas', dica: 'Com mensagem que ninguém abriu' },
  { chave: 'em_atendimento', rotulo: 'Em atendimento', dica: 'Abertas e com alguém respondendo (equipe ou IA)' },
  { chave: 'aguardando', rotulo: 'Aguardando resposta', dica: 'O cliente falou por último e espera a sua resposta' },
  { chave: 'resolvidas', rotulo: 'Resolvidas', dica: 'Marcadas como resolvidas' },
];

/** Query string para `GET /crm/conversations` (só o que estreita; vazio = tudo). */
export function queryDaLista(f: FiltroLista): string {
  const p = new URLSearchParams();
  if (f.canal && f.canal !== 'todos') p.set('canal', f.canal);
  if (f.status !== 'todas') p.set('status', f.status);
  if (f.etiqueta) p.set('etiqueta', f.etiqueta);
  return p.toString();
}

/** Mesmo filtro? (evita recarregar a lista quando o clique não muda nada) */
export function mesmoFiltro(a: FiltroLista, b: FiltroLista): boolean {
  return a.canal === b.canal && a.status === b.status && (a.etiqueta ?? '').toLowerCase() === (b.etiqueta ?? '').toLowerCase();
}

/** Clique num item da coluna: clicar de novo na etiqueta ativa a desliga. */
export function alternarEtiqueta(f: FiltroLista, etiqueta: string): FiltroLista {
  const ativa = (f.etiqueta ?? '').toLowerCase() === etiqueta.toLowerCase();
  return { ...f, etiqueta: ativa ? null : etiqueta };
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

interface ItemBuscavel {
  nome: string;
  ultimaPrevia: string | null;
  contato?: { telefone: string | null; empresa?: string | null } | null;
  etiquetas?: string[];
}

/**
 * Busca local instantânea na lista já carregada: nome, prévia, empresa,
 * etiqueta (sem acento/caixa) e telefone (só dígitos, a partir de 4).
 */
export function filtrarBusca<T extends ItemBuscavel>(lista: T[], busca: string): T[] {
  const q = semAcento(busca.trim());
  if (!q) return lista;
  const dig = busca.replace(/\D/g, '');
  return lista.filter((c) => {
    if (semAcento(c.nome).includes(q)) return true;
    if (c.ultimaPrevia && semAcento(c.ultimaPrevia).includes(q)) return true;
    if (c.contato?.empresa && semAcento(c.contato.empresa).includes(q)) return true;
    if (c.etiquetas?.some((e) => semAcento(e).includes(q))) return true;
    return dig.length >= 4 && (c.contato?.telefone ?? '').replace(/\D/g, '').includes(dig);
  });
}

/**
 * Canais que a coluna lista: os conectados e os que já têm conversa, na ordem
 * fixa. Canal sem conta e sem conversa não aparece (a coluna não promete o
 * que não existe); `semNenhumConectado` liga o "Conectar" honesto.
 */
export function canaisDaColuna(contagens: { canais: Record<string, number>; conectados: string[] } | null): { canais: { canal: string; total: number; conectado: boolean }[]; semNenhumConectado: boolean } {
  if (!contagens) return { canais: [], semNenhumConectado: false };
  const conectados = new Set(contagens.conectados);
  // Comentário da página do Facebook usa a conta do Messenger.
  if (conectados.has('Messenger')) conectados.add('Facebook');
  const canais: { canal: string; total: number; conectado: boolean }[] = ORDEM_CANAIS.filter((c) => conectados.has(c) || (contagens.canais[c] ?? 0) > 0).map((c) => ({ canal: c, total: contagens.canais[c] ?? 0, conectado: conectados.has(c) }));
  // Canal com conversa que a ordem fixa não conhece (dado antigo) também aparece.
  for (const [c, total] of Object.entries(contagens.canais)) {
    if (total > 0 && !(ORDEM_CANAIS as readonly string[]).includes(c)) canais.push({ canal: c, total, conectado: false });
  }
  return { canais, semNenhumConectado: contagens.conectados.length === 0 };
}
