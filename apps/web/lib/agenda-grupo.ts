import { ApiError } from './api-error';
import type { ItemGrupo } from './agenda';

/**
 * Lógica pura do agendamento multi-serviço (grupos): montar os itens do
 * `POST /v1/agenda/grupos` a partir das linhas do formulário, sugerir o
 * encadeamento (próximo serviço começa quando o anterior termina) e calcular
 * o delta do "reagendar tudo". Sem React e sem fetch: testável em vitest.
 */

/** Limites do backend (`POST /v1/agenda/grupos`). */
export const MIN_ITENS_GRUPO = 2;
export const MAX_ITENS_GRUPO = 8;

/** Linha do formulário já resolvida: data montada, valor em centavos. */
export interface LinhaGrupo {
  titulo?: string;
  servicoId: string;
  profissionalId: string;
  inicio: Date | null;
  duracaoMin: number;
  valorCentavos: number | null;
}

/** Fim derivado da linha (início + duração). `null` se a linha está incompleta. */
export function fimDaLinha(l: Pick<LinhaGrupo, 'inicio' | 'duracaoMin'>): Date | null {
  if (!l.inicio || Number.isNaN(+l.inicio) || !(l.duracaoMin > 0)) return null;
  return new Date(+l.inicio + l.duracaoMin * 60_000);
}

/**
 * Encadeamento: início sugerido da próxima linha é o fim da última linha com
 * horário válido. `null` quando nenhuma linha tem início ainda.
 */
export function sugerirInicioEncadeado(linhas: Pick<LinhaGrupo, 'inicio' | 'duracaoMin'>[]): Date | null {
  for (let i = linhas.length - 1; i >= 0; i--) {
    const fim = fimDaLinha(linhas[i]);
    if (fim) return fim;
  }
  return null;
}

/** Mensagem da primeira linha incompleta; `null` = tudo pronto para enviar. */
export function erroDasLinhas(linhas: LinhaGrupo[]): string | null {
  if (linhas.length < MIN_ITENS_GRUPO) return `Um agendamento com vários serviços precisa de pelo menos ${MIN_ITENS_GRUPO} serviços.`;
  if (linhas.length > MAX_ITENS_GRUPO) return `Um agendamento com vários serviços aceita no máximo ${MAX_ITENS_GRUPO} serviços.`;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l.servicoId || !l.profissionalId) return `Escolha o serviço e a profissional no serviço ${i + 1}.`;
    if (!fimDaLinha(l)) return `Data, horário ou duração inválidos no serviço ${i + 1}.`;
  }
  return null;
}

/** Linhas validadas → body `itens` do POST (fim derivado, valor só quando > 0). */
export function montarItensGrupo(linhas: LinhaGrupo[]): ItemGrupo[] {
  return linhas.map((l) => {
    const fim = fimDaLinha(l);
    return {
      ...(l.titulo?.trim() ? { titulo: l.titulo.trim() } : {}),
      servicoId: l.servicoId,
      profissionalId: l.profissionalId,
      inicio: (l.inicio as Date).toISOString(),
      fim: (fim as Date).toISOString(),
      ...(l.valorCentavos && l.valorCentavos > 0 ? { valorCentavos: l.valorCentavos } : {}),
    };
  });
}

/**
 * Delta em minutos do "reagendar tudo" (`PATCH /agenda/grupos/:id`): a UI pede
 * o novo início do PRIMEIRO item ativo; o backend desloca todos pelo deslocamento.
 */
export function deltaReagendamento(inicioAtualIso: string, novoInicio: Date): number {
  return Math.round((+novoInicio - +new Date(inicioAtualIso)) / 60_000);
}

/**
 * No choque de horário (409) do grupo a API diz qual profissional/horário deu
 * conflito — repassa essa mensagem em vez do texto genérico. Fora do 409,
 * devolve `null` para o chamador cair no `mensagemErro` de sempre.
 */
export function detalheChoque(e: unknown): string | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const b = e.body ?? {};
  const t = [b.title, b.detail, b.message, b.erro].find((x): x is string => typeof x === 'string' && x.trim().length > 0);
  if (!t) return 'Um dos serviços choca com outro atendimento nesse horário. Ajuste os horários e tente de novo.';
  const s = t.trim();
  return /[.!?]$/.test(s) ? s : `${s}.`;
}
