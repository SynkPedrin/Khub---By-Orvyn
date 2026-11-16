import { z } from 'zod';

/**
 * PARÂMETROS OPERACIONAIS DO TENANT (configuração centralizada)
 * =============================================================
 *
 * Preços, durações, políticas de agenda e dados de recebimento ficam em
 * `tenants.settings.operacao` — UMA fonte, lida pelas ferramentas do agente
 * na hora da execução. Nada de valor fixo espalhado em prompt ou automação.
 *
 * Falha fechada (gating): sem `pix.chave` a ferramenta de sinal registra a
 * cobrança interna mas NÃO entrega dados de pagamento ao contato — avisa que
 * a equipe envia. Valor de consulta ausente → a ferramenta recusa informar
 * preço por conta própria (a base de conhecimento manda na conversa).
 */

const centavos = z.number().int().min(0).max(100_000_000);

export const operacaoSchema = z
  .object({
    consultaParticularCentavos: centavos.nullable().default(null),
    consultaConvenioCentavos: centavos.nullable().default(null),
    /** Sinal de agendamento (descontado da consulta). */
    sinalCentavos: centavos.nullable().default(null),
    /** Duração padrão da consulta quando a mais longa não se aplica. */
    duracaoConsultaMin: z.number().int().min(15).max(240).default(80),
    duracaoConsultaLongaMin: z.number().int().min(15).max(240).default(100),
    duracaoProcedimentoMin: z.number().int().min(15).max(240).default(40),
    toleranciaAtrasoMin: z.number().int().min(0).max(120).default(10),
    limiteRemarcacoes: z.number().int().min(0).max(10).default(1),
    antecedenciaRemarcacaoH: z.number().int().min(0).max(720).default(24),
    pix: z
      .object({
        chave: z.string().max(200).default(''),
        recebedor: z.string().max(160).default(''),
        instrucoes: z.string().max(1000).default(''),
      })
      .strict()
      .default({}),
  })
  .strict();

export type OperacaoTenant = z.infer<typeof operacaoSchema>;

/** Lê `tenant.settings.operacao` de forma tolerante: inválido → padrões seguros. */
export function lerOperacao(settings: unknown): OperacaoTenant {
  const bruto = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).operacao : undefined;
  const r = operacaoSchema.safeParse(bruto ?? {});
  return r.success ? r.data : operacaoSchema.parse({});
}

export function pixConfigurado(op: OperacaoTenant): boolean {
  return op.pix.chave.trim().length > 0;
}

/** Valor do saldo no dia da consulta (consulta − sinal), null se não configurado. */
export function saldoConsultaCentavos(op: OperacaoTenant, temPlano: boolean | null): number | null {
  const consulta = temPlano ? op.consultaConvenioCentavos : op.consultaParticularCentavos;
  if (consulta == null || op.sinalCentavos == null) return null;
  return Math.max(0, consulta - op.sinalCentavos);
}

export const brl = (centavos: number): string => `R$ ${(centavos / 100).toFixed(2).replace('.', ',').replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1.')}`;
