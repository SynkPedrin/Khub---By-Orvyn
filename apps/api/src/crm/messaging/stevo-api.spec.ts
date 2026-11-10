import { UnauthorizedException } from '@nestjs/common';
import { assinarStevo, verificarAssinaturaStevo } from './stevo-assinatura';
import { StevoApiWebhookController } from './stevo-api-webhook.controller';
import { StevoApiEventosService, numeroDoJid } from './stevo-api-eventos.service';
import { StevoApiProvider } from './stevo-api.provider';
import { StevoApiVinculoService } from './stevo-api-vinculo.service';
import { DeliveryError } from './stevo.provider';
import { ConfigService } from '../../config/config.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MessagesService } from './messages.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const INST = 'ddcee4ba-07c1-4d1a-90d9-418b81cb6dab';
const SEGREDO = 'whsec_teste_atual';
const AGORA = 1_793_990_000;

const envelope = (over: Record<string, unknown> = {}) => ({
  event_id: 'evt_01JABCDEF',
  type: 'message.received',
  attempt: 1,
  created_at: '2026-11-06T12:00:00Z',
  account_id: 'acc-1',
  instance: { id: INST, external_ref: TENANT, metadata: null, engine: 'smv2' },
  data: { message_id: 'wamid-1', chat: '5518991234567@s.whatsapp.net', from: '5518991234567@s.whatsapp.net', from_me: false, is_group: false, push_name: 'Lia', type: 'text', text: 'Oi, quero agendar', raw: { segredo: 'nao-guardar' } },
  ...over,
});

describe('verificarAssinaturaStevo — mesma semântica do verifyWebhook do stevo-sdk', () => {
  const corpo = Buffer.from(JSON.stringify(envelope()));
  const ts = String(AGORA);
  it('assinatura correta passa', () => {
    expect(verificarAssinaturaStevo({ corpoCru: corpo, timestamp: ts, assinaturas: [assinarStevo(SEGREDO, ts, corpo)], segredos: [SEGREDO], agoraSegundos: AGORA })).toEqual({ ok: true });
  });
  it('corpo adulterado é recusado', () => {
    const r = verificarAssinaturaStevo({ corpoCru: Buffer.from(corpo.toString().replace('agendar', 'pagar')), timestamp: ts, assinaturas: [assinarStevo(SEGREDO, ts, corpo)], segredos: [SEGREDO], agoraSegundos: AGORA });
    expect(r).toEqual({ ok: false, motivo: 'assinatura_invalida' });
  });
  it('replay fora da janela de 300 s é recusado', () => {
    const r = verificarAssinaturaStevo({ corpoCru: corpo, timestamp: ts, assinaturas: [assinarStevo(SEGREDO, ts, corpo)], segredos: [SEGREDO], agoraSegundos: AGORA + 301 });
    expect(r).toEqual({ ok: false, motivo: 'expirado' });
  });
  it('rotação: assinatura com o segredo anterior vale enquanto ele estiver configurado', () => {
    const r = verificarAssinaturaStevo({ corpoCru: corpo, timestamp: ts, assinaturas: ['sha256=00', assinarStevo('whsec_antigo', ts, corpo)], segredos: [SEGREDO, 'whsec_antigo'], agoraSegundos: AGORA });
    expect(r).toEqual({ ok: true });
  });
  it('sem segredo configurado nunca aceita', () => {
    expect(verificarAssinaturaStevo({ corpoCru: corpo, timestamp: ts, assinaturas: [assinarStevo(SEGREDO, ts, corpo)], segredos: [undefined], agoraSegundos: AGORA })).toEqual({ ok: false, motivo: 'sem_segredo' });
  });
});

describe('StevoApiWebhookController', () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => { process.env = { ...ORIGINAL }; });

  function montar(o: { tenant?: string | null } = {}) {
    process.env.STEVO_WEBHOOK_SECRET = SEGREDO;
    const gravados: Record<string, unknown>[] = [];
    const tx = { outboxEvent: { upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => { gravados.push(create); return create; }) } };
    const prisma = {
      $queryRaw: jest.fn(async () => [{ tenant_id: o.tenant === undefined ? TENANT : o.tenant }]),
      withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)),
    } as unknown as PrismaService;
    const ctrl = new StevoApiWebhookController(prisma, new ConfigService());
    const req = (corpoObj: unknown, assinar = true) => {
      const raw = Buffer.from(JSON.stringify(corpoObj));
      const ts = String(Math.floor(Date.now() / 1000));
      return { rawBody: raw, body: corpoObj, headers: { 'x-stevo-timestamp': ts, 'x-stevo-signature': assinar ? assinarStevo(SEGREDO, ts, raw) : 'sha256=' + '0'.repeat(64) } } as never;
    };
    return { ctrl, req, gravados, prisma };
  }

  it('assinatura inválida → 401 e nada gravado', async () => {
    const m = montar();
    await expect(m.ctrl.receber(m.req(envelope(), false))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(m.gravados).toHaveLength(0);
  });

  it('evento válido → outbox com dedupe por event_id e SEM o payload cru', async () => {
    const m = montar();
    await expect(m.ctrl.receber(m.req(envelope()))).resolves.toEqual({ ok: true });
    expect(m.gravados[0]).toMatchObject({ tenantId: TENANT, kind: 'stevo_api.event', dedupeKey: 'stevo_api-evt_01JABCDEF', payload: { tipo: 'message.received', texto: 'Oi, quero agendar', eventId: 'evt_01JABCDEF' } });
    expect(JSON.stringify(m.gravados[0])).not.toContain('nao-guardar');
  });

  it('instância sem vínculo → 200 ignorado, nada gravado (sem tempestade de retries)', async () => {
    const m = montar({ tenant: null });
    await expect(m.ctrl.receber(m.req(envelope()))).resolves.toEqual({ ignorado: 'instancia_sem_vinculo' });
    expect(m.gravados).toHaveLength(0);
  });

  it('external_ref divergente do vínculo → descartado (nunca entrega no tenant errado)', async () => {
    const m = montar();
    const ev = envelope({ instance: { id: INST, external_ref: '22222222-2222-2222-2222-222222222222', metadata: null, engine: 'smv2' } });
    await expect(m.ctrl.receber(m.req(ev))).resolves.toEqual({ ignorado: 'external_ref_divergente' });
    expect(m.gravados).toHaveLength(0);
  });

  it('evento que não usamos (ex.: instance.qr.updated) → 200 ignorado', async () => {
    const m = montar();
    await expect(m.ctrl.receber(m.req(envelope({ type: 'instance.qr.updated' })))).resolves.toEqual({ ignorado: 'evento_nao_usado' });
  });
});

describe('StevoApiEventosService', () => {
  function montar() {
    const tx = {
      message: { updateMany: jest.fn(async () => ({ count: 1 })) },
      integration: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const prisma = { withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)) } as unknown as PrismaService;
    const mensagens = { receiveInbound: jest.fn(async () => ({ conversationId: 'cv1' })) } as unknown as MessagesService;
    return { svc: new StevoApiEventosService(prisma, mensagens), tx, mensagens };
  }
  const base = { instanciaId: INST, messageId: 'wamid-1', messageIds: [], chat: '5518991234567@s.whatsapp.net', from: null, fromMe: false, isGroup: false, pushName: 'Lia', conteudoTipo: 'text', texto: 'Oi', timestamp: null, motivo: null, eventId: 'evt_1' };

  it('mensagem recebida → inbox (número do JID, nome, id estável do WhatsApp)', async () => {
    const m = montar();
    await expect(m.svc.processar(TENANT, { ...base, tipo: 'message.received' })).resolves.toBe('entrada');
    expect(m.mensagens.receiveInbound).toHaveBeenCalledWith({ tenantId: TENANT, fromNumber: '5518991234567', fromName: 'Lia', text: 'Oi', providerMessageId: 'stevo_api:wamid-1' });
  });

  it('grupo e from_me ficam de fora', async () => {
    const m = montar();
    await m.svc.processar(TENANT, { ...base, tipo: 'message.received', isGroup: true });
    await m.svc.processar(TENANT, { ...base, tipo: 'message.received', fromMe: true });
    expect(m.mensagens.receiveInbound).not.toHaveBeenCalled();
  });

  it('mídia sem texto vira marcador legível ([audio])', async () => {
    const m = montar();
    await m.svc.processar(TENANT, { ...base, tipo: 'message.received', texto: null, conteudoTipo: 'audio' });
    expect(m.mensagens.receiveInbound).toHaveBeenCalledWith(expect.objectContaining({ text: '[audio]' }));
  });

  it('recibo de leitura só AVANÇA o status (nunca volta de lido para entregue)', async () => {
    const m = montar();
    await m.svc.processar(TENANT, { ...base, tipo: 'message.read', messageIds: ['wamid-9'] });
    expect(m.tx.message.updateMany).toHaveBeenCalledWith({ where: { providerId: { in: ['wamid-9'] }, deliveryStatus: { in: ['sending', 'pending', 'unknown', 'sent', 'delivered'] } }, data: { deliveryStatus: 'read' } });
    await m.svc.processar(TENANT, { ...base, tipo: 'message.delivered', messageIds: ['wamid-9'] });
    expect((m.tx.message.updateMany as jest.Mock).mock.calls[1][0].where.deliveryStatus.in).not.toContain('read');
  });

  it('instância desconectada → integração marcada com o motivo', async () => {
    const m = montar();
    await m.svc.processar(TENANT, { ...base, tipo: 'instance.disconnected', motivo: 'logged_out' });
    expect(m.tx.integration.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'disconnected', erro: 'instance.disconnected: logged_out' }) }));
  });

  it('numeroDoJid limpa sufixo e device', () => {
    expect(numeroDoJid('5518991234567:12@s.whatsapp.net')).toBe('5518991234567');
    expect(numeroDoJid(null)).toBeNull();
  });
});

describe('StevoApiProvider.sendText — contrato oficial', () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => { process.env.STEVO_REVENUE_API_KEY = 'stevo_sk_teste'; });
  afterEach(() => { process.env = { ...ORIGINAL }; jest.restoreAllMocks(); });

  const responder = (status: number, corpo: unknown) =>
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } }));

  it('POST /v1/instances/{id}/messages com to (só dígitos), text, Bearer e Idempotency-Key', async () => {
    const f = responder(201, { data: { engine: 'smv2', sent: true, result: null, message_id: 'wamid-77', status: 'sent' } });
    const r = await new StevoApiProvider(new ConfigService()).sendText('+55 (18) 99165-2039', 'Olá', INST, 'agent:m1');
    expect(r).toEqual({ providerId: 'wamid-77' });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://openapi.stevo.chat/v1/instances/${INST}/messages`);
    expect(JSON.parse(String(init.body))).toEqual({ to: '5518991234567', text: 'Olá' });
    expect(init.headers).toMatchObject({ authorization: 'Bearer stevo_sk_teste', 'idempotency-key': 'agent:m1' });
  });

  it.each([
    [429, 'rate_limited', { retryable: true, uncertain: false }],
    [502, 'upstream_unavailable', { retryable: true, uncertain: false }],
    [504, 'upstream_timeout', { retryable: false, uncertain: true }],
    [502, 'send_failed', { retryable: false, uncertain: false }],
    [409, 'not_ready', { retryable: false, uncertain: false }],
  ])('erro %i %s → semântica documentada', async (status, code, esperado) => {
    responder(status, { error: { code, message: 'x', request_id: 'req-1', retryable: false } });
    const e = (await new StevoApiProvider(new ConfigService()).sendText('5511999999999', 'Olá', INST, 'k').catch((x: unknown) => x)) as DeliveryError;
    expect(e).toBeInstanceOf(DeliveryError);
    expect({ retryable: e.retryable, uncertain: e.uncertain }).toEqual(esperado);
  });
});

describe('StevoApiVinculoService — status pelo pareamento real', () => {
  function montar(conexao: { connected: boolean; logged_in: boolean }, externalRef: string | null = null) {
    const gravado: Record<string, unknown>[] = [];
    const tx = {
      integration: { upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => { gravado.push(create); return { id: 'int1', status: create.status }; }) },
      $executeRaw: jest.fn(async () => 1),
    };
    const prisma = {
      $queryRaw: jest.fn(async () => [{ tenant_id: null }]),
      withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)),
    } as unknown as PrismaService;
    const stevo = {
      obterInstancia: jest.fn(async () => ({ id: INST, name: 'Instância 1', profile_name: 'Studio', external_ref: externalRef })),
      conexao: jest.fn(async () => conexao),
      definirExternalRef: jest.fn(async () => ({})),
    } as unknown as StevoApiProvider;
    return { svc: new StevoApiVinculoService(prisma, stevo), gravado, stevo };
  }

  it('connected sem logged_in (WhatsApp não pareado) vira disconnected', async () => {
    const m = montar({ connected: true, logged_in: false });
    await expect(m.svc.vincular(TENANT, INST, 'id-ana')).resolves.toMatchObject({ status: 'disconnected' });
  });

  it('pareada (connected + logged_in) vira connected e grava external_ref = tenant', async () => {
    const m = montar({ connected: true, logged_in: true });
    await expect(m.svc.vincular(TENANT, INST, 'id-ana')).resolves.toMatchObject({ status: 'connected' });
    expect(m.stevo.definirExternalRef).toHaveBeenCalledWith(INST, TENANT);
  });

  it('instância já com external_ref de OUTRA subconta → recusa (não sequestra)', async () => {
    const m = montar({ connected: true, logged_in: true }, '22222222-2222-2222-2222-222222222222');
    await expect(m.svc.vincular(TENANT, INST, 'id-ana')).rejects.toThrow('já vinculada a outra subconta');
    expect(m.stevo.definirExternalRef).not.toHaveBeenCalled();
  });
});

