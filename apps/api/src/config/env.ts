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

  // IA (opcionais — ausência degrada limpo: Nyro 501 / RAG cai p/ BM25)
  ANTHROPIC_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),

  // Cripto dos tokens OAuth por tenant (AES-256-GCM, 32 bytes base64)
  INTEGRATIONS_ENCRYPTION_KEY: z.string().optional(),

  // URL pública do front (redirect pós-OAuth)
  WEB_URL: z.string().url().default('http://localhost:3210'),

  // Meta Ads (app do operador; token do cliente vem do OAuth)
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_GRAPH_VERSION: z.string().default('v21.0'),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),

  // Google Ads / TikTok / Stripe / WhatsApp (sprints B/C/D)
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
  GOOGLE_ADS_CLIENT_ID: z.string().optional(),
  GOOGLE_ADS_CLIENT_SECRET: z.string().optional(),
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional(),
  TIKTOK_APP_ID: z.string().optional(),
  TIKTOK_APP_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  EVOLUTION_API_URL: z.string().optional(),
  EVOLUTION_API_KEY: z.string().optional(),

  // WhatsApp via STEVO (API não oficial) — envio tipo SMS, chat estilo WhatsApp
  STEVO_API_URL: z.string().optional(),
  STEVO_API_KEY: z.string().optional(),
  STEVO_INSTANCE: z.string().optional(),
  STEVO_SEND_PATH: z.string().default('/message/sendText'),
  STEVO_WEBHOOK_TOKEN: z.string().optional(),
  STEVO_FALLBACK_TENANT_ID: z.string().optional(), // dev: roteia entrada quando não há integração mapeada
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
