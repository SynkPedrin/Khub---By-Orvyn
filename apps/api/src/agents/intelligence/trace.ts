import type { ResultadoCore } from './intelligence-core.service';

/** Trace persistido no run: decisões e resultados estruturados, nunca raciocínio privado. */
export function traceDoResultado(r: ResultadoCore, extra: Record<string, unknown> = {}) {
  return {
    decisao: r.decisao,
    motivo: r.motivo,
    analise: { ...r.analise, extracoes: undefined },
    regras: r.regras,
    conhecimento: { consulta: r.conhecimento.consulta, confianca: r.conhecimento.confianca, conflitos: r.conhecimento.conflitos, fontes: r.conhecimento.fontes.map((f) => ({ chunkId: f.chunkId, titulo: f.titulo })) },
    memoria: r.memoria,
    extracoes: r.extracoes,
    ferramentas: r.ferramentas,
    validacao: r.validacao,
    guardrail: r.guardrail,
    fragmentacao: { estrategia: r.fragmentacao.estrategia, ajustes: r.fragmentacao.ajustes, blocos: r.fragmentacao.blocos.map((b) => ({ ordem: b.ordem, caracteres: b.texto.length, atrasoMs: b.atrasoMs })) },
    modelos: r.modelos,
    tempos: r.tempos,
    ...extra,
  };
}
