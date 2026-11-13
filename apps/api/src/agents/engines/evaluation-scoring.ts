import { z } from 'zod';

/**
 * AVALIAÇÃO DE AGENTES — pontuação pura (Learning & Evaluation §12.4)
 * ===================================================================
 * Um cenário = conversa de entrada + expectativas verificáveis. A nota
 * determinística (checagens objetivas) é sempre calculada; a nota do juiz
 * (modelo avaliador com rubrica) entra quando há IA configurada.
 *
 * Regressão: nova versão é REGRESSÃO quando a nota média cai mais que
 * `TOLERANCIA_REGRESSAO` pontos OU quando um cenário que passava agora falha
 * em checagem crítica (transferência, alucinação, conteúdo proibido).
 */

export const expectativasSchema = z
  .object({
    deveConter: z.array(z.string().min(1).max(200)).max(10).default([]),
    naoDeveConter: z.array(z.string().min(1).max(200)).max(10).default([]),
    intencaoEsperada: z.string().max(40).optional(),
    deveTransferir: z.boolean().optional(),
    ferramentasEsperadas: z.array(z.string().max(60)).max(6).default([]),
    exigeFonte: z.boolean().default(false),
    maxBlocos: z.number().int().min(1).max(8).optional(),
  })
  .strict();
export type Expectativas = z.infer<typeof expectativasSchema>;

export const mensagensCenarioSchema = z
  .array(z.object({ de: z.enum(['contato', 'ia']), texto: z.string().min(1).max(2000) }).strict())
  .min(1)
  .max(30);

export interface SaidaCenario {
  texto: string;
  blocos: number;
  transferiu: boolean;
  intencao: string | null;
  ferramentas: string[];
  fontes: number;
  guardrail: boolean;
}

export interface Checagem {
  nome: string;
  ok: boolean;
  critica: boolean;
  detalhe: string;
}

export interface NotasJuiz {
  qualidade: number;
  precisao: number;
  aderenciaBase: number;
  naturalidade: number;
  resolucao: number;
  alucinacao: boolean;
  comentario: string;
}

export const juizJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['qualidade', 'precisao', 'aderenciaBase', 'naturalidade', 'resolucao', 'alucinacao', 'comentario'],
  properties: {
    qualidade: { type: 'integer', enum: [1, 2, 3, 4, 5] },
    precisao: { type: 'integer', enum: [1, 2, 3, 4, 5] },
    aderenciaBase: { type: 'integer', enum: [1, 2, 3, 4, 5] },
    naturalidade: { type: 'integer', enum: [1, 2, 3, 4, 5] },
    resolucao: { type: 'integer', enum: [1, 2, 3, 4, 5] },
    alucinacao: { type: 'boolean' },
    comentario: { type: 'string' },
  },
} as const;

export const juizSchema = z.object({
  qualidade: z.number().int().min(1).max(5),
  precisao: z.number().int().min(1).max(5),
  aderenciaBase: z.number().int().min(1).max(5),
  naturalidade: z.number().int().min(1).max(5),
  resolucao: z.number().int().min(1).max(5),
  alucinacao: z.boolean(),
  comentario: z.string().max(600),
});

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function checarCenario(exp: Expectativas, s: SaidaCenario): Checagem[] {
  const out: Checagem[] = [];
  const t = norm(s.texto);
  for (const termo of exp.deveConter) {
    const alternativas = termo.split('|').map((x) => norm(x.trim())).filter(Boolean);
    out.push({ nome: `contém "${termo}"`, ok: alternativas.some((a) => t.includes(a)), critica: false, detalhe: '' });
  }
  for (const termo of exp.naoDeveConter) {
    out.push({ nome: `não contém "${termo}"`, ok: !t.includes(norm(termo)), critica: true, detalhe: '' });
  }
  if (exp.intencaoEsperada) out.push({ nome: `intenção = ${exp.intencaoEsperada}`, ok: s.intencao === exp.intencaoEsperada, critica: false, detalhe: `obtida: ${s.intencao ?? '—'}` });
  if (exp.deveTransferir !== undefined) out.push({ nome: exp.deveTransferir ? 'transfere para humano' : 'não transfere', ok: s.transferiu === exp.deveTransferir, critica: true, detalhe: '' });
  for (const f of exp.ferramentasEsperadas) out.push({ nome: `usa ${f}`, ok: s.ferramentas.includes(f), critica: false, detalhe: '' });
  if (exp.exigeFonte) out.push({ nome: 'cita fonte da base', ok: s.fontes > 0, critica: true, detalhe: `${s.fontes} fonte(s)` });
  if (exp.maxBlocos) out.push({ nome: `≤ ${exp.maxBlocos} blocos`, ok: s.blocos <= exp.maxBlocos, critica: false, detalhe: `${s.blocos} bloco(s)` });
  out.push({ nome: 'respondeu ou transferiu', ok: !!s.texto.trim() || s.transferiu, critica: true, detalhe: '' });
  return out;
}

/** Nota 0–100 de um cenário: 60% checagens, 40% juiz (quando houver). */
export function notaCenario(checagens: Checagem[], juiz: NotasJuiz | null): number {
  const det = checagens.length ? (checagens.filter((c) => c.ok).length / checagens.length) * 100 : 100;
  if (!juiz) return Math.round(det * 100) / 100;
  const mediaJuiz = ((juiz.qualidade + juiz.precisao + juiz.aderenciaBase + juiz.naturalidade + juiz.resolucao) / 5 - 1) / 4 * 100;
  const penal = juiz.alucinacao ? 30 : 0;
  return Math.max(0, Math.round((det * 0.6 + mediaJuiz * 0.4 - penal) * 100) / 100);
}

export const TOLERANCIA_REGRESSAO = 3;

export interface ResultadoCenario {
  cenarioId: string;
  nome: string;
  nota: number;
  checagens: Checagem[];
  juiz: NotasJuiz | null;
  saida: SaidaCenario;
  erro?: string;
}

export function metricasAgregadas(rs: ResultadoCenario[]) {
  const validos = rs.filter((r) => !r.erro);
  const media = (f: (r: ResultadoCenario) => number) => (validos.length ? validos.reduce((t, r) => t + f(r), 0) / validos.length : 0);
  const comJuiz = validos.filter((r) => r.juiz);
  const mediaJ = (f: (j: NotasJuiz) => number) => (comJuiz.length ? comJuiz.reduce((t, r) => t + f(r.juiz!), 0) / comJuiz.length : null);
  return {
    nota: Math.round(media((r) => r.nota) * 100) / 100,
    cenarios: rs.length,
    falhas: rs.filter((r) => r.erro).length,
    aprovados: validos.filter((r) => r.checagens.every((c) => c.ok)).length,
    taxaAlucinacao: comJuiz.length ? comJuiz.filter((r) => r.juiz!.alucinacao).length / comJuiz.length : null,
    qualidade: mediaJ((j) => j.qualidade),
    precisao: mediaJ((j) => j.precisao),
    aderenciaBase: mediaJ((j) => j.aderenciaBase),
    naturalidade: mediaJ((j) => j.naturalidade),
    resolucao: mediaJ((j) => j.resolucao),
    transferenciaCorreta: (() => {
      const cs = validos.flatMap((r) => r.checagens.filter((c) => c.nome.includes('transfere')));
      return cs.length ? cs.filter((c) => c.ok).length / cs.length : null;
    })(),
    ferramentasCorretas: (() => {
      const cs = validos.flatMap((r) => r.checagens.filter((c) => c.nome.startsWith('usa ')));
      return cs.length ? cs.filter((c) => c.ok).length / cs.length : null;
    })(),
  };
}

export function compararAvaliacoes(atual: ResultadoCenario[], anterior: ResultadoCenario[] | null): { regressao: boolean; delta: number | null; pioraram: string[] } {
  if (!anterior?.length) return { regressao: false, delta: null, pioraram: [] };
  const nAtual = metricasAgregadas(atual).nota;
  const nAnt = metricasAgregadas(anterior).nota;
  const antPorId = new Map(anterior.map((r) => [r.cenarioId, r]));
  const pioraram = atual
    .filter((r) => {
      const a = antPorId.get(r.cenarioId);
      if (!a) return false;
      const criticasAntes = new Set(a.checagens.filter((c) => c.critica && c.ok).map((c) => c.nome));
      return r.checagens.some((c) => c.critica && !c.ok && criticasAntes.has(c.nome));
    })
    .map((r) => r.nome);
  const delta = Math.round((nAtual - nAnt) * 100) / 100;
  return { regressao: delta < -TOLERANCIA_REGRESSAO || pioraram.length > 0, delta, pioraram };
}
