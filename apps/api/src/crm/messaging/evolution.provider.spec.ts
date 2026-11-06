import { EvolutionProvider, normalizeQrResponse } from './evolution.provider';
import { DeliveryError } from './stevo.provider';
import type { ConfigService } from '../../config/config.service';

/** Fake mínimo de ConfigService: Evolution sempre "configurada". */
function configFake(): ConfigService {
  return {
    isConfigured: () => true,
    missingVars: () => [],
    require: () => undefined,
    get: (k: string) => ({ EVOLUTION_BASE_URL: 'https://evolution.teste', EVOLUTION_API_KEY: 'k' })[k],
  } as unknown as ConfigService;
}

/**
 * `normalizeQrResponse` — os dois formatos aqui foram observados AO VIVO
 * contra uma instância Evolution v2.3.7 real nesta sessão:
 *   - `POST /instance/create` devolve o QR aninhado em `qrcode: {...}`.
 *   - `GET /instance/connect/:name` devolve os mesmos campos no nível raiz.
 * Os formatos "defensivos" (sem prefixo `data:image`, campo `qr` em vez de
 * `code`/`base64`) NÃO foram observados nesta instância — cobertos aqui
 * porque outra versão/fork pode divergir, não porque foram vistos.
 */
describe('normalizeQrResponse', () => {
  it('formato de /instance/connect (raiz, verificado ao vivo)', () => {
    const r = normalizeQrResponse({
      pairingCode: null,
      code: '2@abc123...',
      base64: 'data:image/png;base64,iVBORw0KGgo=',
      count: 1,
    });
    expect(r.qrText).toBe('2@abc123...');
    expect(r.qrImageDataUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(r.pairingCode).toBeUndefined();
    expect(r.expiresAt).toBeTruthy();
  });

  it('formato de /instance/create (aninhado em qrcode, verificado ao vivo)', () => {
    const r = normalizeQrResponse({
      instance: { instanceName: 'x' },
      hash: 'TOKEN',
      qrcode: { pairingCode: null, code: '2@xyz...', base64: 'data:image/png;base64,ABC=', count: 1 },
    });
    expect(r.qrText).toBe('2@xyz...');
    expect(r.qrImageDataUrl).toBe('data:image/png;base64,ABC=');
  });

  it('adiciona o prefixo data:image quando o base64 vem cru (defensivo, não observado)', () => {
    const r = normalizeQrResponse({ code: 'x', base64: 'iVBORw0KGgo=' });
    expect(r.qrImageDataUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('não duplica o prefixo quando já vem completo', () => {
    const r = normalizeQrResponse({ code: 'x', base64: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(r.qrImageDataUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('captura pairing code quando presente', () => {
    const r = normalizeQrResponse({ code: 'x', base64: 'data:image/png;base64,A=', pairingCode: 'ABCD-1234' });
    expect(r.pairingCode).toBe('ABCD-1234');
  });

  it('sem nenhum campo reconhecido: não lança, devolve QR vazio', () => {
    const r = normalizeQrResponse({});
    expect(r.qrImageDataUrl).toBeUndefined();
    expect(r.qrText).toBeUndefined();
    expect(r.expiresAt).toBeTruthy();
  });

  it('expiresAt é sempre no futuro próximo (QR de WhatsApp expira em segundos)', () => {
    const antes = Date.now();
    const r = normalizeQrResponse({ code: 'x', base64: 'data:image/png;base64,A=' });
    const delta = new Date(r.expiresAt).getTime() - antes;
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(60_000);
  });
});

/**
 * Achado real da auditoria de produção: diferente de Voyage/Meta/Anthropic/
 * Stripe (todos com circuit breaker), o envio da Evolution era `fetch()` cru
 * — uma instância self-hosted lenta travava cada mensagem nos 15s de timeout,
 * uma por uma, em vez de falhar rápido depois de falhas repetidas.
 */
describe('EvolutionProvider.sendText — circuit breaker no envio', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

  it('depois de falhas seguidas, abre o circuito e PARA de chamar a Evolution (fail-fast)', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('timeout'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const provider = new EvolutionProvider(configFake());

    // limiteFalhas=4 no provider — as 4 primeiras tentam de verdade e falham.
    for (let i = 0; i < 4; i++) {
      await expect(provider.sendText('5511999999999', 'oi', 'inst-1')).rejects.toThrow();
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // Circuito aberto: a 5ª chamada NÃO bate na rede.
    await expect(provider.sendText('5511999999999', 'oi', 'inst-1')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(4); // continua 4 — não tentou de novo
  });

  it('o erro do circuito aberto é retryable (429) — nunca "unknown"/não-reprocessável', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('timeout'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const provider = new EvolutionProvider(configFake());

    for (let i = 0; i < 4; i++) {
      await provider.sendText('5511999999999', 'oi', 'inst-1').catch(() => undefined);
    }
    try {
      await provider.sendText('5511999999999', 'oi', 'inst-1');
      throw new Error('deveria ter lançado');
    } catch (e) {
      expect(e).toBeInstanceOf(DeliveryError);
      const err = e as DeliveryError;
      // Nenhuma chamada real aconteceu (fail-fast) — zero ambiguidade sobre
      // ter sido enviado, então TEM que ser retryable (429), nunca um 5xx
      // (que o MessagesService trata como "unknown" e nunca reprocessa).
      expect(err.retryable).toBe(true);
      expect(err.uncertain).toBe(false);
    }
  });
});
