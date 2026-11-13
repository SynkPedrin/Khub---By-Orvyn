/**
 * Guardrails de compliance (invariante do CLAUDE.md: **duas camadas**).
 *
 *  Camada 1 — prompt: a instrução entra no system prompt do agente.
 *  Camada 2 — validador: a resposta é checada ANTES de chegar ao usuário.
 *
 * A camada 2 existe porque prompt não é garantia: modelo sob pressão
 * ("me diz logo se é câncer") atropela instrução. Em saúde e jurídico isso não
 * é constrangimento, é risco de processo — e de vida.
 */

export interface RegraGuardrail {
  regra: string;
  /** O que dispara a regra na resposta da Nyro. */
  padrao: RegExp;
  /** Explicação que substitui/acompanha a resposta barrada. */
  motivo: string;
}

/** Instrução que entra no system prompt (camada 1). */
export const INSTRUCOES: Record<string, string> = {
  medico: [
    'COMPLIANCE (CFM) — inegociável:',
    '- Você NÃO dá diagnóstico, não indica medicamento, dose ou tratamento, e não interpreta exame.',
    '- Sintoma relatado => acolha e direcione para avaliação com o profissional da clínica. Nunca especule causa.',
    '- Não prometa resultado ("vai ficar curado", "sem dor para sempre", "100% de sucesso").',
    '- Não use "melhor clínica", "melhor médico" nem compare com concorrentes: o CFM veda.',
    '- Preço e prazo só se estiverem na base de conhecimento da conta. Não invente valor.',
  ].join('\n'),
  juridico: [
    'COMPLIANCE (OAB) — inegociável:',
    '- Você NÃO garante resultado de processo, prazo de decisão nem valor de indenização.',
    '- Não faça captação agressiva ("processe agora", "dinheiro fácil", "ganho garantido").',
    '- Não dê parecer jurídico definitivo: oriente e encaminhe para o advogado responsável.',
    '- Não cite honorário fora do que está na base da conta (a OAB veda mercantilização).',
  ].join('\n'),
  contabil: [
    'COMPLIANCE — inegociável:',
    '- Não garanta economia fiscal, restituição ou enquadramento sem análise do contador responsável.',
    '- Não oriente sonegação, "planejamento" irregular ou omissão de informação ao fisco.',
    '- Prazo e obrigação só a partir da base de conhecimento da conta.',
  ].join('\n'),
};

/**
 * Camada 2. Os padrões são deliberadamente conservadores: **falso positivo aqui
 * custa uma resposta reescrita; falso negativo custa um processo.**
 */
const REGRAS: Record<string, RegraGuardrail[]> = {
  medico: [
    { regra: 'cfm.diagnostico', padrao: /\b(voc[êe]\s+(est[áa]|tem|possui)\s+com?\s*(um|uma)?\s*(c[âa]ncer|tumor|diabetes|depress[ãa]o|infec[çc][ãa]o)|seu\s+diagn[óo]stico\s+[ée]|isso\s+[ée]\s+(um|uma)\s+\w+ite)\b/i, motivo: 'diagnóstico é ato médico privativo (CFM)' },
    { regra: 'cfm.prescricao', padrao: /\b(tome|tomar|use|usar|receito|prescrevo)\s+\d*\s*(mg|ml|comprimidos?|c[áa]psulas?|dipirona|amoxicilina|ibuprofeno|omeprazol|prednisona)\b/i, motivo: 'prescrição exige consulta e receita do médico (CFM)' },
    { regra: 'cfm.promessa', padrao: /\b(cura\s+garantida|vai\s+ficar\s+curad[oa]|100%\s+de\s+(sucesso|efic[áa]cia)|sem\s+risco\s+algum|resultado\s+garantido)\b/i, motivo: 'promessa de resultado é vedada (CFM)' },
    { regra: 'cfm.superlativo', padrao: /\b(melhor\s+(cl[íi]nica|m[ée]dico|profissional)\s+d[aeo]|[ao]\s+mais\s+renomad[oa])\b/i, motivo: 'autopromoção comparativa é vedada (CFM)' },
  ],
  juridico: [
    // Sem `\b` no início: em regex JS, `\b` antes de letra acentuada NÃO casa
    // ("ê" não é \w), e "É êxito garantido" passava batido. Armadilha real.
    { regra: 'oab.garantia', padrao: /(voc[êe]\s+vai\s+ganhar|ganho\s+garantido|resultado\s+garantido|com\s+certeza\s+(ganha|vence)|[êe]xito\s+garantid)/i, motivo: 'garantia de resultado é vedada (OAB)' },
    { regra: 'oab.valor', padrao: /(voc[êe]\s+(vai|ir[áa])\s+receber\s+R\$\s*[\d.,]+|indeniza[çc][ãa]o\s+de\s+R\$\s*[\d.,]+\s+garantid)/i, motivo: 'promessa de valor de indenização é vedada (OAB)' },
    { regra: 'oab.captacao', padrao: /(processe?\s+(agora|j[áa])|dinheiro\s+f[áa]cil|aproveite\s+e\s+processe|n[ãa]o\s+perca\s+essa\s+chance\s+de\s+processar)/i, motivo: 'captação de clientela é vedada (OAB)' },
  ],
  contabil: [
    { regra: 'fiscal.garantia', padrao: /(economia\s+garantida|restitui[çc][ãa]o\s+garantida|imposto\s+zero\s+garantid)/i, motivo: 'garantia de economia fiscal depende de análise do responsável' },
    // cobre as flexões que aparecem de verdade: "omita", "omitir", "não declare/declarar"
    { regra: 'fiscal.irregular', padrao: /(n[ãa]o\s+declar(e|ar)|omit(a|ir)\s+(essa\s+|a\s+)?receita|caixa\s+dois|sonega)/i, motivo: 'orientação irregular perante o fisco' },
  ],
};

export interface ResultadoGuardrail {
  ok: boolean;
  regra?: string;
  motivo?: string;
  /** Resposta segura para mostrar no lugar (quando barrada). */
  substituto?: string;
  /**
   * A MESMA resposta com só os trechos problemáticos trocados por um aviso.
   * Preferível ao `substituto` (que joga a resposta inteira fora) quando sobra
   * conteúdo útil: copy, relatório e conversa não somem por causa de uma frase.
   */
  saneado?: string;
}

/**
 * Linha que CITA a frase proibida para ensinar o que evitar ("evite dizer
 * 'resultado garantido'") não é promessa: não deve ser barrada.
 */
export const CONTEXTO_NEGATIVO = /(evite|evitar|n[ãa]o\s+(use|usar|diga|dizer|fale|falar|escreva|escrever|prometa|prometer|publique|publicar|pode)|nunca\s+(use|diga|fale|prometa|escreva)|proibid|vedad|ilegal|infra[çc][ãa]o|anti[ée]tic|viola|❌|🚫|exemplo\s+(do\s+que|de\s+(o\s+)?que)\s+n[ãa]o)/i;

/** Nicho do tenant → chave das regras. Nicho desconhecido = sem regra extra. */
export function chaveDoNicho(nicho: string | null | undefined): string | null {
  const n = (nicho ?? '').toLowerCase();
  if (/m[ée]dic|cl[íi]nic|sa[úu]de|est[ée]tic|odonto/.test(n)) return 'medico';
  if (/advoc|jur[íi]dic|direito|lawyer/.test(n)) return 'juridico';
  if (/cont[áa]bil|contabilidade|fiscal/.test(n)) return 'contabil';
  return null;
}

export function instrucaoDoNicho(nicho: string | null | undefined): string {
  const chave = chaveDoNicho(nicho);
  return chave ? INSTRUCOES[chave] : '';
}

/** Camada 2: valida a resposta pronta. */
export function validarResposta(texto: string, nicho: string | null | undefined): ResultadoGuardrail {
  const chave = chaveDoNicho(nicho);
  if (!chave) return { ok: true };

  // Por linha: só o trecho que PROMETE/DIAGNOSTICA conta; citar como exemplo do que evitar, não.
  const linhas = texto.split('\n');
  const achados: { i: number; r: RegraGuardrail }[] = [];
  linhas.forEach((l, i) => {
    if (CONTEXTO_NEGATIVO.test(l)) return;
    const r = (REGRAS[chave] ?? []).find((x) => x.padrao.test(l));
    if (r) achados.push({ i, r });
  });
  if (achados.length) {
    const sanear = linhas.map((l, i) => {
      const a = achados.find((x) => x.i === i);
      return a ? `⚠️ _[trecho removido por compliance: ${a.r.motivo}]_` : l;
    });
    const uteis = sanear.filter((l) => !l.startsWith('⚠️ _[trecho removido')).join('').trim().length;
    const r = achados[0].r;
    return {
      saneado: uteis >= 80 ? sanear.join('\n') : undefined,
      ok: false,
      regra: r.regra,
      motivo: r.motivo,
      substituto:
        chave === 'medico'
          ? 'Isso eu não posso responder: só o profissional da clínica pode avaliar seu caso. Quer que eu agende uma consulta ou peça para alguém da equipe te chamar?'
          : chave === 'juridico'
            ? 'Não posso garantir resultado nem antecipar valores — cada caso depende de análise. Quer que eu encaminhe para o advogado responsável avaliar?'
            : 'Isso depende de análise do contador responsável pela sua conta. Quer que eu abra uma tarefa para ele te retornar?',
    };
  }
  return { ok: true };
}
