/**
 * Resposta afirmativa a um lembrete de agendamento (RV-07.1).
 *
 * Determinístico de propósito: nada de IA decidindo se "talvez" é "sim". A
 * mensagem inteira (normalizada) precisa ser uma confirmação curta conhecida,
 * opcionalmente com saudação/pontuação. "Sim, mas preciso remarcar" NÃO casa:
 * qualquer palavra fora do vocabulário derruba o casamento, e quem tem dúvida
 * fica para a equipe.
 */

/** Palavras/expressões que, sozinhas ou combinadas, valem como "confirmo". */
const AFIRMATIVAS = [
  'sim', 's', 'ss', 'simm', 'siim', 'confirmo', 'confirmado', 'confirmada', 'confirmar', 'confirma', 'confirmadissimo',
  'ok', 'okay', 'okk', 'blz', 'beleza', 'certo', 'certeza', 'claro', 'combinado', 'fechado', 'perfeito', 'positivo',
  'pode', 'pode confirmar', 'pode ser', 'estarei', 'estarei la', 'estarei ai', 'vou', 'eu vou', 'vou sim', 'vou estar',
  'com certeza', 'tudo certo', 'ta confirmado', 'esta confirmado', 'ta certo', 'ta bom', 'ta', 'yes',
];

/** Cortesias que podem acompanhar a confirmação sem mudar o sentido. */
const NEUTRAS = ['obrigado', 'obrigada', 'obg', 'brigado', 'brigada', 'valeu', 'vlw', 'bom dia', 'boa tarde', 'boa noite', 'oi', 'ola', 'otimo', 'ate amanha', 'ate la', 'abs', 'att'];

/** Emojis que valem como "sim". */
const EMOJIS_AFIRMATIVOS = /^(?:\u{1F44D}|\u{1F44C}|✅|✔️?|\u{1F64F}|\u{1F60A}|\u{1F642}|\u{1F600}|\u{1F601}|☺️?|\u{1F91D})(?:\u{1F3FB}|\u{1F3FC}|\u{1F3FD}|\u{1F3FE}|\u{1F3FF})?$/u;

function normalizar(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(.)\1{2,}/g, '$1$1') // "simmmm" → "simm"
    .trim();
}

const FRASES = [...AFIRMATIVAS, ...NEUTRAS].sort((a, b) => b.length - a.length);

/**
 * `true` só quando a mensagem é uma confirmação curta: tokens de AFIRMATIVAS,
 * NEUTRAS e emojis afirmativos, com pelo menos UM afirmativo. Até 60 caracteres
 * (resposta longa quase sempre carrega um "mas").
 */
export function ehRespostaAfirmativa(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const bruto = texto.trim();
  if (!bruto || bruto.length > 60) return false;

  let resto = normalizar(bruto);
  let afirmou = false;

  // Emojis primeiro (separados por espaço ou colados).
  const emojis = resto.match(/\p{Extended_Pictographic}(?:️)?(?:\p{Emoji_Modifier})?/gu) ?? [];
  for (const e of emojis) {
    if (!EMOJIS_AFIRMATIVOS.test(e)) return false;
    afirmou = true;
  }
  resto = resto.replace(/\p{Extended_Pictographic}(?:️)?(?:\p{Emoji_Modifier})?/gu, ' ');
  // Pontuação vira separador.
  resto = resto.replace(/[.,;:!?¡¿()"'*~\-_/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!resto) return afirmou;

  // Consome frases conhecidas (mais longas primeiro) até sobrar nada.
  while (resto) {
    const f = FRASES.find((p) => resto === p || resto.startsWith(`${p} `));
    if (!f) return false;
    if (AFIRMATIVAS.includes(f)) afirmou = true;
    resto = resto.slice(f.length).trim();
  }
  return afirmou;
}
