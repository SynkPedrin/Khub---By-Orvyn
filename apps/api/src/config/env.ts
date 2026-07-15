import { z } from 'zod';

/** Validação de ambiente (sem segredo no código). Erro FATAL no boot se faltar
 *  chave obrigatória (invariante 6). Ver RegrasNegocio.md §6. */
const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  // Auth (FASE 1)
  JWT_SECRET: z.string().min(16, 'JWT_SECRET obrigatório (>=16 chars)'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const faltando = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ');
    throw new Error(`Env inválida — ${faltando}`);
  }
  return parsed.data;
}
