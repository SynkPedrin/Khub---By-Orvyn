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

const RE_DIZ_QUE_AGENDOU = /\b(agendamento (esta |ficou |foi )?(confirmado|feito|realizado|marcado)|(esta|ficou|foi) (agendad|marcad|reservad)[oa]|agendei|ja (agendei|marquei|reservei)|vaga (esta |ficou )?garantida|horario (esta |ficou )?(confirmado|garantido|reservado))/;

/**
 * Tira a frase que AFIRMA um agendamento que não existe (nenhum
 * solicitar_agendamento deu certo neste turno). Prometer ("vou agendar") pode;
 * afirmar sem ter feito é o pior erro de um agente de agenda.
 */
/** A fala afirma um agendamento ("Agendei…", "vaga garantida") — não é uma proposta a aceitar. */
export function afirmaAgendamento(texto: string): boolean {
  return segmentarFrases(texto.replace(/\n+/g, ' ')).some((f) => RE_DIZ_QUE_AGENDOU.test(norm(f)));
}

export function semAgendamentoInventado(texto: string): { texto: string; removeu: boolean } {
  let removeu = false;
  const out = texto
    .split(/\n\s*\n/)
    .map((par) => segmentarFrases(par).filter((f) => {
      if (RE_DIZ_QUE_AGENDOU.test(norm(f))) { removeu = true; return false; }
      return true;
    }).join(' '))
    .filter((x) => x.trim())
    .join('\n\n');
  return { texto: out.trim() ? out : texto, removeu: removeu && !!out.trim() };
}

// Disponibilidade dita sem consultar a agenda (auditoria 16/11: a agente disse
// "não temos horário" sem ter olhado nada). Pegam as duas mentiras possíveis:
// "não tem vaga/agenda lotada" e "temos horário amanhã às 14h/horários livres".
// "Qual horário fica melhor?" e "funcionamos das 9 às 18" não casam.
const RE_SEM_VAGA = /\b(nao (temos|tem|ha|teremos|tenho|existe|existem)( mais| nenhum| nenhuma)? (horario|horarios|vaga|vagas|disponibilidade|agenda|encaixe)|sem (horario|horarios|vaga|vagas|disponibilidade|agenda livre)|agenda (esta |ta |ja esta |ja ta )?(lotada|cheia|fechada|bloqueada|toda ocupada)|(horarios?|vagas?) (esgotad|preenchid|ocupad|indisponive)|nao (consigo|da pra|da para|tem como) (te )?encaixar|(esta|estao|ta|tao) ((todo|toda|todos|todas) )?(ocupad|lotad|cheio|cheia))/;
const RE_TEM_VAGA = /\b((temos|tenho|tem|ha|existe) (um |uma )?(horario|horarios|vaga|vagas|disponibilidade|encaixe)( livre| livres| disponive\w*)? (livre|livres|disponive\w*|para|pra|na|no|nas|nos|as|a partir|amanha|hoje|segunda|terca|quarta|quinta|sexta|sabado|domingo|de manha|a tarde|a noite)|(horarios?|vagas?) (livres?|disponive\w*|abert\w*) (sao|e|para|pra|na|no|amanha|hoje|as)|consigo (te )?encaixar|(esta|ta) livre (as|a|amanha|hoje|na|no))/;

/** Pede a preferência em vez de afirmar vaga que ninguém consultou. */
export const PEDIR_PREFERENCIA_AGENDA = 'Me conta qual dia e período ficam melhores pra você que eu confirmo o horário certinho na agenda.';

/**
 * Tira a frase que AFIRMA haver (ou não haver) horário quando a agenda não foi
 * consultada neste turno (`ver_agendamentos`). Se não sobrar nada, pede a
 * preferência do contato — nunca inventa vaga nem nega vaga que existe.
 */
export function semDisponibilidadeInventada(texto: string): { texto: string; removeu: boolean } {
  let removeu = false;
  const out = texto
    .split(/\n\s*\n/)
    .map((par) => segmentarFrases(par).filter((f) => {
      const n = norm(f);
      if (RE_SEM_VAGA.test(n) || RE_TEM_VAGA.test(n)) { removeu = true; return false; }
      return true;
    }).join(' '))
    .filter((x) => x.trim())
    .join('\n\n')
    .trim();
  if (!removeu) return { texto, removeu: false };
  const pergunta = /\?\s*$/.test(out);
  return { texto: out ? (pergunta ? out : `${out}\n\n${PEDIR_PREFERENCIA_AGENDA}`) : PEDIR_PREFERENCIA_AGENDA, removeu: true };
}

// ---------------------------------------------------------------- travas de dinheiro

/** "R$ 38,50", "R$38", "R$ 1.617,00" → centavos. */
const RE_REAIS = /R\$\s*(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/g;
export function valoresEmCentavos(texto: string): number[] {
  return [...texto.matchAll(RE_REAIS)].map((m) => Number(m[1].replace(/\./g, '')) * 100 + Number((m[2] ?? '0').padEnd(2, '0')));
}

/** Frase com o valor que a IA vai trocar quando não houver fonte. */
export const CONFIRMAR_VALOR = 'O valor certinho eu confirmo com a equipe e já te passo.';

/**
 * Trava de PREÇO: frase com valor em reais que não está nas fontes do turno
 * (instruções, trechos da base, resultado das ferramentas, o que a empresa já
 * disse na conversa) sai. Vale também a soma de dois valores conhecidos
 * ("manicure + pedicure = R$ 82,50") e 50% de um valor (sinal). Preço
 * inventado é o pior erro de atendimento de salão: a cliente cobra depois.
 */
export function semPrecoInventado(texto: string, fontes: string[]): { texto: string; removeu: boolean; valores: number[] } {
  const conhecidos = new Set(fontes.flatMap(valoresEmCentavos));
  const lista = [...conhecidos];
  const permitido = (v: number) => {
    if (conhecidos.has(v)) return true;
    if (lista.some((a) => Math.abs(a / 2 - v) <= 1)) return true; // sinal de 50%
    for (let i = 0; i < lista.length; i++) for (let j = i; j < lista.length; j++) if (lista[i] + lista[j] === v) return true;
    return false;
  };
  const removidos: number[] = [];
  const out = texto
    .split(/\n\s*\n/)
    .map((par) => segmentarFrases(par).filter((f) => {
      const vals = valoresEmCentavos(f);
      const ruins = vals.filter((v) => !permitido(v));
      if (ruins.length) { removidos.push(...ruins); return false; }
      return true;
    }).join(' '))
    .filter((x) => x.trim())
    .join('\n\n')
    .trim();
  if (!removidos.length) return { texto, removeu: false, valores: [] };
  return { texto: out ? `${out}\n\n${CONFIRMAR_VALOR}` : CONFIRMAR_VALOR, removeu: true, valores: removidos };
}

const RE_OFERTA_DESCONTO = /\b(consigo|posso|vou|dou|damos|faco|fazemos|temos|tem|te dou|te faco|ofereco|oferecemos|libero|liberar|aplico|aplicar|ganha|ganhar)\b[^.!?]{0,40}\b(descont\w*|abatimento|promoc\w*|cortesia|brinde|gratis|de graca)\b|\b\d{1,2}\s?%\s?(de\s)?(desconto|off)\b/;

/**
 * Trava de DESCONTO: a IA não tem autoridade para dar desconto, promoção ou
 * cortesia. Frase que OFERECE isso sai, a não ser que a mesma condição esteja
 * nas fontes (ex.: promoção cadastrada pela dona). "Não temos desconto" fica.
 */
const normPct = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');

export function semDescontoInventado(texto: string, fontes: string[]): { texto: string; removeu: boolean } {
  const base = normPct(fontes.join(' '));
  let removeu = false;
  const out = texto
    .split(/\n\s*\n/)
    .map((par) => segmentarFrases(par).filter((f) => {
      const n = normPct(f);
      if (/\b(nao|sem)\b[^.!?]{0,25}\b(descont|promoc)/.test(n)) return true;
      if (!RE_OFERTA_DESCONTO.test(n)) return true;
      const pct = n.match(/(\d{1,2})\s?%/)?.[1];
      if (pct && base.includes(`${pct}%`) && /desconto|promocao/.test(base)) return true;
      removeu = true;
      return false;
    }).join(' '))
    .filter((x) => x.trim())
    .join('\n\n')
    .trim();
  if (!removeu) return { texto, removeu: false };
  return { texto: out || 'Sobre condições especiais, eu confirmo com a equipe e te retorno.', removeu: true };
}

