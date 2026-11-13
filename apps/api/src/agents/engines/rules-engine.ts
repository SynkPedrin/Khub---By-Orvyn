import type { AcaoRegra, Condicao, Regra } from '../config/agent-config';
import type { Analise } from './analysis';

/**
 * MOTOR DE REGRAS CONDICIONAIS (Agent Builder §5.3)
 * =================================================
 *
 *   SE intenção = compra E interesse contém "serviço"
 *   ENTÃO instrução "inicie a qualificação comercial"
 *
 * Avaliação PURA sobre a análise da mensagem + perfil do contato. Quem executa
 * as ações (tag, workflow, transferência…) é o Action Engine, com as mesmas
 * permissões das ferramentas — uma regra nunca ganha poder que a ferramenta
 * equivalente não tem.
 */

export interface ContextoRegras {
  analise: Pick<Analise, 'intencao' | 'intencoesSecundarias' | 'objecoes' | 'sentimento' | 'urgencia' | 'temperatura' | 'interesse'>;
  mensagem: string;
  etapa: string | null;
  /** Fatos do perfil (campo → valor textual). */
  perfil: Record<string, string>;
  /** Regras já disparadas nesta conversa (para `umaVezPorConversa`). */
  jaDisparadas: ReadonlySet<string>;
}

export interface RegraDisparada {
  regraId: string;
  nome: string;
  acoes: AcaoRegra[];
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

function valoresDoCampo(c: Condicao, ctx: ContextoRegras): string[] {
  switch (c.campo) {
    case 'intencao':
      return [ctx.analise.intencao, ...ctx.analise.intencoesSecundarias];
    case 'objecao':
      return ctx.analise.objecoes;
    case 'sentimento':
      return [ctx.analise.sentimento];
    case 'urgencia':
      return [ctx.analise.urgencia];
    case 'temperatura':
      return [ctx.analise.temperatura];
    case 'etapa':
      return ctx.etapa ? [ctx.etapa] : [];
    case 'interesse':
      return ctx.analise.interesse ? [ctx.analise.interesse] : [];
    case 'palavra_chave':
      return [ctx.mensagem];
    case 'perfil':
      return c.chave && ctx.perfil[c.chave] ? [ctx.perfil[c.chave]] : [];
  }
}

export function avaliarCondicao(c: Condicao, ctx: ContextoRegras): boolean {
  const valores = valoresDoCampo(c, ctx).map(norm).filter(Boolean);
  const alvo = norm(c.valor);
  switch (c.operador) {
    case 'existe':
      return valores.length > 0;
    case 'nao_existe':
      return valores.length === 0;
    case 'igual':
      return valores.includes(alvo);
    case 'diferente':
      return !valores.includes(alvo);
    case 'contem':
      // Palavra-chave aceita alternativas separadas por "|": "preço|valor|quanto custa".
      return alvo.split('|').map((x) => x.trim()).filter(Boolean).some((a) => valores.some((v) => v.includes(a)));
  }
}

export function avaliarRegras(regras: readonly Regra[], ctx: ContextoRegras): RegraDisparada[] {
  const saida: RegraDisparada[] = [];
  for (const r of regras) {
    if (!r.ativo) continue;
    if (r.umaVezPorConversa && ctx.jaDisparadas.has(r.id)) continue;
    const resultados = r.condicoes.map((c) => avaliarCondicao(c, ctx));
    const bate = r.logica === 'e' ? resultados.every(Boolean) : resultados.some(Boolean);
    if (bate) saida.push({ regraId: r.id, nome: r.nome, acoes: r.acoes });
  }
  return saida;
}

/** Separa o que vira texto no prompt (instruções) do que vira ação executável. */
export function separarAcoes(disparadas: RegraDisparada[]): {
  instrucoes: string[];
  silenciar: boolean;
  transferir: string | null;
  executaveis: (AcaoRegra & { regraId: string })[];
  consultarBase: string[];
} {
  const instrucoes: string[] = [];
  const executaveis: (AcaoRegra & { regraId: string })[] = [];
  const consultarBase: string[] = [];
  let silenciar = false;
  let transferir: string | null = null;
  for (const d of disparadas) {
    for (const a of d.acoes) {
      if (a.tipo === 'instrucao' && a.valor.trim()) instrucoes.push(a.valor.trim());
      else if (a.tipo === 'silenciar') silenciar = true;
      else if (a.tipo === 'transferir') transferir ??= a.valor.trim() || `regra "${d.nome}"`;
      else if (a.tipo === 'consultar_base') consultarBase.push(a.valor.trim());
      else executaveis.push({ ...a, regraId: d.regraId });
    }
  }
  return { instrucoes, silenciar, transferir, executaveis, consultarBase };
}
