import { ConfigRequiredException, ConfigService, type Provider } from './config.service';

/**
 * Canário do Brief §2: com TODA credencial de terceiro ausente, nada explode —
 * o sistema sabe dizer o que falta, e só a chamada externa fica bloqueada.
 */
const TERCEIROS: Provider[] = ['stevo', 'stevo_api', 'stevo_webhook', 'evolution', 'meta', 'google_ads', 'tiktok', 'stripe', 'voyage', 'anthropic', 'email', 'oauth_google', 'oauth_github', 'google_calendar', 'integrations_crypto', 'storage', 'youtube'];

describe('ConfigService (gating por credencial)', () => {
  const backup = { ...process.env };
  let svc: ConfigService;

  beforeEach(() => {
    svc = new ConfigService();
    for (const p of TERCEIROS) for (const k of svc.missingVars(p)) delete process.env[k];
    // limpa também as que estiverem presentes no ambiente do dev
    for (const k of ['STEVO_API_URL', 'STEVO_API_KEY', 'STEVO_INSTANCE', 'STEVO_REVENUE_API_KEY', 'STEVO_WEBHOOK_SECRET', 'EVOLUTION_BASE_URL', 'EVOLUTION_API_KEY', 'META_APP_ID', 'META_APP_SECRET', 'VOYAGE_API_KEY', 'ANTHROPIC_API_KEY', 'SMTP_URL', 'STRIPE_SECRET_KEY', 'INTEGRATIONS_ENCRYPTION_KEY']) {
      delete process.env[k];
    }
  });
  afterAll(() => {
    process.env = backup;
  });

  it('CANÁRIO: sem nenhuma credencial de terceiro, snapshot() responde sem lançar', () => {
    const snap = svc.snapshot();
    expect(snap).toHaveLength(TERCEIROS.length);
    expect(snap.every((s) => !s.configured && s.missing.length > 0)).toBe(true);
  });

  it('missingVars lista exatamente o que falta', () => {
    expect(svc.missingVars('stevo')).toEqual(['STEVO_API_URL', 'STEVO_API_KEY', 'STEVO_INSTANCE']);
    process.env.STEVO_API_URL = 'https://api.stevo.chat';
    expect(svc.missingVars('stevo')).toEqual(['STEVO_API_KEY', 'STEVO_INSTANCE']);
  });

  it('variável vazia conta como ausente (não como configurada)', () => {
    process.env.VOYAGE_API_KEY = '   ';
    expect(svc.isConfigured('voyage')).toBe(false);
    expect(svc.get('VOYAGE_API_KEY')).toBeUndefined();
  });

  it('require() lança 501 com provider e missing', () => {
    try {
      svc.require('meta');
      fail('deveria ter lançado');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigRequiredException);
      const r = (e as ConfigRequiredException).getResponse() as any;
      expect((e as ConfigRequiredException).getStatus()).toBe(501);
      expect(r.status).toBe('config_required');
      expect(r.provider).toBe('meta');
      expect(r.missing).toEqual(['META_APP_ID', 'META_APP_SECRET']);
    }
  });

  it('provider configurado não lança', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-teste';
    expect(svc.isConfigured('anthropic')).toBe(true);
    expect(() => svc.require('anthropic')).not.toThrow();
  });
});
