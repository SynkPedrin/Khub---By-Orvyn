import { z } from 'zod';

/** Validação de ambiente (sem segredo no código). Erro FATAL no boot se faltar
 *  chave obrigatória (invariante 6). Ver RegrasNegocio.md §6. */
const schema = z.object({
  NODE_ENV: z.string().default('development'),
  KHUB_PROCESS_ROLE: z.enum(['api','worker']).default('api'),
  PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  // Auth (FASE 1)
  JWT_SECRET: z.string().min(16, 'JWT_SECRET obrigatório (>=16 chars)'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // IA (opcionais — ausência degrada limpo: Nyro 501 / RAG cai p/ BM25)
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Base da Messages API (padrão https://api.anthropic.com). Só https em produção. */
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  /** Firecrawl (busca e leitura de páginas da NICO). Ausente = a NICO avisa para conectar. */
  FIRECRAWL_API_KEY: z.string().optional(),

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
  // Conversas omnichannel (db/063): fora de produção, resposta por Instagram,
  // Messenger e YouTube só sai com isto em 'true' (mesma trava de dev do
  // WhatsApp: nada vai a pessoa real sem decisão explícita).
  CANAIS_ENVIO_DEV: z.enum(['true', 'false']).default('false'),
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
  STEVO_TEST_NUMBER: z.string().optional(), // dev: manda toda saída para este número
  // Número que recebe TODA mensagem de execução de teste de automação (Testar e
  // modo simples da NICO). Vale também em produção: teste nunca fala com contato real.
  AUTOMATION_TEST_PHONE: z.string().optional(),
  // Stevo — API de GESTÃO (https://openapi.stevo.chat/v1): instâncias, envio,
  // webhooks de conta assinados. Chave de conta `stevo_sk_…` (sem restrição de
  // instância, exigida para webhook de conta). Nunca vai ao browser.
  // Vazio = não configurado (mesma convenção das outras chaves; o QA isola-se
  // assim). Preenchida, tem de ter o formato da Stevo.
  STEVO_REVENUE_API_KEY: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().regex(/^stevo_sk_/, 'chave Stevo deve começar com stevo_sk_').optional(),
  ),
  STEVO_API_BASE_URL: z.string().url().default('https://openapi.stevo.chat'),
  // Segredo `whsec_…` devolvido UMA vez na criação do webhook de conta; o
  // anterior vale durante a rotação (overlap).
  STEVO_WEBHOOK_SECRET: z.string().optional(),
  STEVO_WEBHOOK_SECRET_PREVIOUS: z.string().optional(),

  // Storage S3-compatible (R2/AWS/MinIO): anexos do Inbox. Sem as quatro
  // primeiras, envio de mídia > 5 MB (ou pela Stevo, que só aceita URL)
  // responde config_required. Endpoint path-style: https://<conta>.r2.cloudflarestorage.com
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  // Base pública do bucket (CDN). Vazio = URLs assinadas (bucket privado).
  S3_PUBLIC_BASE_URL: z.string().url().optional(),

  // E-mail transacional (convites). Sem SMTP_URL o convite volta com link manual.
  SMTP_URL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // Login social (sem estas, a rota responde 501 explicando o que falta)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_ID: z.string().optional(),
  GITHUB_SECRET: z.string().optional(),
  AUTH_SECRET: z.string().optional(),

  // Produção — CORS: origens permitidas (CSV). Vazio = libera tudo em dev,
  // bloqueia tudo menos WEB_URL em produção.
  CORS_ORIGINS: z.string().optional(),

  // Rate limit por tenant/IP (janela fixa em Redis; fail-open se Redis cair).
  RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_TENANT_MAX: z.coerce.number().int().positive().default(600), // req/janela por tenant
  RATE_LIMIT_IP_MAX: z.coerce.number().int().positive().default(120),     // req/janela por IP (rotas públicas)
  // Segredo compartilhado com o web (Next): só com ele a API confia no IP do
  // visitante repassado pelo proxy das páginas públicas /f e /b (rate limit
  // por IP real). Sem ele, vale o IP do socket (o do servidor web).
  KHUB_PROXY_SECRET: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().min(16, 'KHUB_PROXY_SECRET deve ter pelo menos 16 caracteres').optional()),

  // Observabilidade — só falta plugar o DSN para o Sentry entrar (pacote à parte).
  SENTRY_DSN: z.string().optional(),
  LOG_FORMAT: z.enum(['json', 'pretty']).optional(), // default: json em prod, pretty em dev
});

export type Env = z.infer<typeof schema>;

export function loadEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const faltando = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ');
    throw new Error(`Env inválida — ${faltando}`);
  }
  const env=parsed.data;
  if(env.NODE_ENV==='production') {
    const missing=['DATABASE_URL','REDIS_URL'].filter(k=>!process.env[k]?.trim());
    if(missing.length) throw new Error(`Env obrigatória ausente: ${missing.join(', ')}`);
    if(env.JWT_SECRET.length<32) throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres em produção');
    if(env.STEVO_TEST_NUMBER || env.STEVO_FALLBACK_TENANT_ID) throw new Error('roteamento de teste não permitido em produção');
  }
  return env;
}
