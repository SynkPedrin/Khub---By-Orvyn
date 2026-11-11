import { segmentarFrases } from './message-chunker';

/**
 * VALIDAÇÃO DE NATURALIDADE (Conversation Engine §6.3 — passo 14 do ciclo)
 * ========================================================================
 * Complementa o guardrail de compliance (nyro/guardrails.ts). Aqui o alvo é
 * soar humano: não se reapresentar a cada mensagem, não repetir a mesma
 * pergunta, não abusar de emoji nem de nome. Corrige o que dá para corrigir
 * sem reescrever o sentido (remove a frase ofensora) e devolve avisos para o
 * trace e o aprendizado.
 */

export interface PoliticaNaturalidade {
  agenteNome: string;
  contatoNome: string | null;
  jaFalouAntes: boolean;
  reapresentar: boolean;
  usarNome: 'natural' | 'sempre' | 'nunca';
  emojis: 'nunca' | 'raro' | 'moderado';
  evitarRepeticao: boolean;
  /** Últimas mensagens do agente nesta conversa (mais recente por último). */
  anteriores: readonly string[];
  /** Última mensagem do contato: se ELE cumprimentou, o agente pode cumprimentar de volta. */
  ultimaDoContato?: string;
}

export interface ResultadoValidacao {
  texto: string;
  avisos: string[];
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

export function similaridade(a: string, b: string): number {
  const ta = new Set(norm(a).split(' ').filter((w) => w.length > 2));
  const tb = new Set(norm(b).split(' ').filter((w) => w.length > 2));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / (ta.size + tb.size - inter);
}

const RE_EMOJI = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;
const RE_CUMPRIMENTO = /^(oi+e*|ola|opa|bom dia|boa tarde|boa noite|tudo (bem|bom|certo|sim|otimo|joia)|como vai|e (ai|com voce))\b/;

const RE_ENCHIMENTO = /^(com certeza|fico a (sua )?disposicao|estou a (sua )?disposicao|qualquer duvida(,)? (estou|fico) a disposicao|estou aqui para (te |lhe )?ajudar|otima pergunta|entendo perfeitamente|sera um prazer (te |lhe )?ajudar)$/;

/** Frase que é SÓ enchimento de telemarketing ("Com certeza!", "Fico à disposição!"). */
export function eEnchimento(frase: string): boolean {
  return RE_ENCHIMENTO.test(norm(frase.replace(RE_EMOJI, '')));
}

/** Frase que é SÓ cumprimento ("Oi Mariana!", "Tudo sim, e com você?"): curta, sem número, começa saudando. */
export function eCumprimento(frase: string): boolean {
  const n = norm(frase.replace(RE_EMOJI, ''));
  return n.length > 0 && n.length <= 45 && !/\d/.test(n) && RE_CUMPRIMENTO.test(n);
}

export function validarNaturalidade(texto: string, p: PoliticaNaturalidade): ResultadoValidacao {
  const avisos: string[] = [];
  const paragrafos = texto.split(/\n\s*\n/);
  const perguntasAnteriores = p.anteriores.flatMap((m) => segmentarFrases(m)).filter((f) => f.trim().endsWith('?'));
  const nomeAgente = norm(p.agenteNome);

  // Meio da conversa: "Oi Mariana! Tudo bem?" de novo é o tique mais robótico
  // que existe. Só cai o cumprimento que ABRE a resposta, e só se o contato
  // não cumprimentou nesta mensagem.
  const contatoCumprimentou = !!p.ultimaDoContato && segmentarFrases(p.ultimaDoContato).some((f) => RE_CUMPRIMENTO.test(norm(f)));
  // Sem a mensagem do contato não dá para saber se ele cumprimentou: não mexe.
  let abrindo = p.jaFalouAntes && p.ultimaDoContato !== undefined && !contatoCumprimentou;

  // Linha a linha: uma lista ("• Manicure R$ 38,50\n• Pedicure…") não pode
  // virar uma frase corrida só porque o validador remontou com espaço.
  const limparLinha = (linha: string): string => {
      const frases = segmentarFrases(linha).filter((f) => {
        if (!abrindo) return true;
        if (eCumprimento(f)) {
          avisos.push('cumprimento repetido removido');
          return false;
        }
        abrindo = false;
        return true;
      });
      const mantidas = frases.filter((f) => {
        const n = norm(f);
        if (eEnchimento(f)) {
          avisos.push('frase de enchimento removida');
          return false;
        }
        if (p.jaFalouAntes && !p.reapresentar && nomeAgente && (new RegExp(`\\b(sou (a|o)|aqui (e|eh) (a|o)|meu nome (e|eh)) ${nomeAgente}\\b`).test(n))) {
          avisos.push('reapresentação removida');
          return false;
        }
        if (p.evitarRepeticao && f.trim().endsWith('?') && perguntasAnteriores.some((q) => similaridade(q, f) >= 0.8)) {
          avisos.push('pergunta repetida removida');
          return false;
        }
        return true;
      });
      return mantidas.join(' ');
  };
  const saida = paragrafos
    .map((par) => par.split('\n').map(limparLinha).filter((l) => l.trim()).join('\n'))
    .filter((x) => x.trim());

  let resultado = saida.join('\n\n');
  // Se a limpeza esvaziaria a resposta, mantém o original (melhor repetir que calar).
  if (!resultado.trim()) {
    resultado = texto;
    if (avisos.length) avisos.push('limpeza revertida: resposta ficaria vazia');
  }

  if (p.emojis === 'nunca' && RE_EMOJI.test(resultado)) {
    resultado = resultado.replace(RE_EMOJI, '').replace(/[ \t]{2,}/g, ' ').trim();
    avisos.push('emojis removidos (política: nunca)');
  }

  if (p.contatoNome && p.usarNome !== 'nunca') {
    const primeiro = p.contatoNome.trim().split(/\s+/)[0];
    if (primeiro.length > 1) {
      const vezes = (resultado.match(new RegExp(`\\b${primeiro.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')) ?? []).length;
      if (vezes > 1) avisos.push(`nome do contato usado ${vezes}x na mesma resposta`);
    }
  }
  return { texto: resultado.trim(), avisos };
}
