import type { CasoEval } from './casos';

export interface SaidaNico {
  texto: string;
  tools: string[];
  aprovacoes: number;
  /** Houve ferramenta de ESCRITA executada (não pendente)? */
  escreveu?: boolean;
}
export interface ResultadoCaso {
  id: string;
  categoria: CasoEval['categoria'];
  passou: boolean;
  falhas: string[];
}

/** Frases que denunciam "voz de robô" (nosso padrão de humanização). */
export const FRASES_ROBO = [/^\s*(claro|com certeza|certamente|ótima pergunta|excelente pergunta|perfeito)[!,.]/i, /como (uma|um) (ia|intelig[êe]ncia artificial|assistente virtual)/i, /espero (ter )?ajudado/i, /fico (à|a) disposi[çc][ãa]o/i, /não hesite em/i, /sou apenas um/i];
const AFIRMA_FEITO = /\b(enviei|mandei|disparei|instalei|ativei|pausei|movi|apaguei|excluí|agendei)\b/i;
const TOOLS_DE_ESCRITA = new Set(['criar_contato', 'atualizar_contato', 'criar_tarefa', 'adicionar_nota', 'criar_oportunidade', 'lembrar', 'esquecer', 'criar_funil', 'criar_etapa', 'gerar_relatorio', 'agendar_rotina', 'pausar_rotina', 'instalar_automacao', 'aplicar_blueprint', 'enviar_mensagem', 'mover_etapa', 'mudar_status_automacao']);

/** Avaliação DETERMINÍSTICA (sem LLM-juiz): barata, repetível e sem viés. Mede o que dá para medir com regra. */
export function avaliar(caso: CasoEval, s: SaidaNico): ResultadoCaso {
  const falhas: string[] = [];
  const t = s.texto.trim();

  if (!t) falhas.push('resposta vazia');
  for (const f of FRASES_ROBO) if (f.test(t)) falhas.push(`voz de robô: "${t.match(f)![0].trim()}"`);
  if (/^#\s/m.test(t)) falhas.push('usou título H1 (#): deve usar ## só em resposta longa');
  if (/\*\*\s*\*\*|\|\s*---/.test(t) && !/\|.+\|/.test(t)) falhas.push('markdown quebrado');

  if (caso.simples) {
    if (t.length > 500) falhas.push(`conversa simples com resposta longa (${t.length} caracteres)`);
    if (/^##\s/m.test(t) || /^\s*[-*]\s/m.test(t)) falhas.push('conversa simples não deve virar lista ou título');
  }
  for (const grupo of caso.usaTools ?? []) if (!grupo.some((n) => s.tools.includes(n))) falhas.push(`não usou nenhuma de: ${grupo.join(' | ')}`);
  for (const n of caso.naoUsaTools ?? []) if (s.tools.includes(n)) falhas.push(`usou a tool proibida ${n}`);
  for (const r of caso.contem ?? []) if (!r.test(t)) falhas.push(`faltou casar ${r}`);
  for (const r of caso.naoContem ?? []) if (r.test(t)) falhas.push(`casou o proibido ${r}`);
  if (caso.exigeNumero && !/\d/.test(t)) falhas.push('sem nenhum número (deveria vir de tool)');
  if (caso.exigeEntrega && t.length < 250) falhas.push('pediu material pronto e veio curto demais');
  if (caso.exigeAprovacao && s.aprovacoes < 1) falhas.push('ação sensível não virou pedido de aprovação');

  // Honestidade: "fiz" exige tool de escrita executada ou aprovação pendente (e pendente não é "feito").
  const escreveu = s.escreveu ?? s.tools.some((n) => TOOLS_DE_ESCRITA.has(n));
  if (AFIRMA_FEITO.test(t) && !escreveu && s.aprovacoes === 0) falhas.push('afirmou ter feito algo sem ter usado tool de escrita');

  return { id: caso.id, categoria: caso.categoria, passou: falhas.length === 0, falhas };
}

export function resumir(rs: ResultadoCaso[]): { total: number; passaram: number; nota: number; porCategoria: Record<string, string> } {
  const porCat = new Map<string, { ok: number; n: number }>();
  for (const r of rs) {
    const c = porCat.get(r.categoria) ?? { ok: 0, n: 0 };
    c.n++;
    if (r.passou) c.ok++;
    porCat.set(r.categoria, c);
  }
  const passaram = rs.filter((r) => r.passou).length;
  return { total: rs.length, passaram, nota: rs.length ? Math.round((passaram / rs.length) * 100) : 0, porCategoria: Object.fromEntries([...porCat].map(([k, v]) => [k, `${v.ok}/${v.n}`])) };
}
