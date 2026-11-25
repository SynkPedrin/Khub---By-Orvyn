import { UnauthorizedException } from '@nestjs/common';
import { outboxFake } from '../../../common/outbox.fake';
import { assinarStevo } from '../stevo-assinatura';
import { ConfigService } from '../../../config/config.service';
import { DeliveryError } from '../stevo.provider';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { MessagesService } from '../messages.service';
import { OpenWaProvider, sessaoDoTenant, tenantDaSessao } from './openwa.provider';
import { OpenWaWebhookController } from './openwa.controllers';
import { OpenWaEventosService, type EventoOpenWa } from './openwa-eventos.service';
import { corpoDaMensagem, eventoDaMensagem, type OpenWaHistoricoService } from './openwa-historico.service';
import { mascarar } from './openwa-conexao.service';
import { hasPermission, permissionFor } from '../../../auth/permissions.guard';

const TENANT = '11111111-1111-4111-8111-111111111111';
const SESSAO = `khub-${TENANT}`;
const SEGREDO = 'segredo-de-teste';

describe('open-wa — sessão e textos', () => {
  it('sessão ↔ tenant (só o formato do contrato)', () => {
    expect(sessaoDoTenant(TENANT)).toBe(SESSAO);
    expect(tenantDaSessao(SESSAO)).toBe(TENANT);
    expect(tenantDaSessao('khub-../../etc')).toBeNull();
    expect(tenantDaSessao(TENANT)).toBeNull();
  });
  it('corpo: texto, legenda ou rótulo da mídia; vazio fica de fora', () => {
    expect(corpoDaMensagem({ texto: ' oi ', tipo: 'texto' })).toBe('oi');
    expect(corpoDaMensagem({ texto: '', tipo: 'audio' })).toBe('🎤 Áudio');
    expect(corpoDaMensagem({ texto: '', tipo: 'outro' })).toBe('[outro]');
    expect(corpoDaMensagem({ texto: '', tipo: 'texto' })).toBe('');
  });
  it('a chave de dedupe do histórico é a mesma da entrada ao vivo', () => {
    expect(eventoDaMensagem(TENANT, 'ABC')).toBe(`${TENANT}:openwa:ABC`);
  });
  it('número na página pública sai mascarado', () => {
    expect(mascarar('5518991234567')).toBe('5518••••4567');
  });
  it('painel e link são de owner/admin (integrations.manage)', () => {
    const u = (role: string) => ({ identityId: 'i', tenantId: 't', role, email: 'e' });
    for (const [rota, metodo] of [['', 'GET'], ['links', 'POST'], ['desconectar', 'POST']] as const) {
      expect(hasPermission(u('admin'), permissionFor('integrations/whatsapp-qr', rota, metodo))).toBe(true);
      expect(hasPermission(u('manager'), permissionFor('integrations/whatsapp-qr', rota, metodo))).toBe(false);
    }
  });
});

describe('OpenWaProvider — envio pelo gateway', () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => { process.env = { ...ORIGINAL }; jest.restoreAllMocks(); });
  const prov = () => {
    process.env.OPENWA_GATEWAY_URL = 'https://wa.exemplo.test/';
    process.env.OPENWA_GATEWAY_KEY = 'chave';
    process.env.OPENWA_WEBHOOK_SECRET = SEGREDO;
    return new OpenWaProvider(new ConfigService());
  };
  const resposta = (status: number, corpo: unknown) => jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(corpo), { status }));

  it('POST /sessions/:id/messages/text com a chave, só dígitos e idempotência', async () => {
    const f = resposta(200, { providerId: 'wa-1' });
    await expect(prov().sendText('+55 (18) 99123-4567', 'oi', SESSAO, 'k1')).resolves.toEqual({ providerId: 'wa-1' });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://wa.exemplo.test/sessions/${SESSAO}/messages/text`);
    expect((init.headers as Record<string, string>)['x-gateway-key']).toBe('chave');
    expect(JSON.parse(String(init.body))).toEqual({ to: '5518991234567', texto: 'oi', idempotencyKey: 'k1' });
  });
  it('409 (desconectada) = nada saiu; 504 = aceite incerto (nunca reenviar)', async () => {
    resposta(409, { erro: 'sessao_desconectada' });
    const e1 = await prov().sendText('5518991234567', 'oi', SESSAO, 'k').catch((e) => e);
    expect(e1).toBeInstanceOf(DeliveryError);
    expect(e1).toMatchObject({ retryable: false, uncertain: false });
    resposta(504, { erro: 'aceite_incerto' });
    const e2 = await prov().sendText('5518991234567', 'oi', SESSAO, 'k').catch((e) => e);
    expect(e2).toMatchObject({ uncertain: true });
  });
  it('sem configuração não chama ninguém', () => {
    delete process.env.OPENWA_GATEWAY_URL;
    expect(new OpenWaProvider(new ConfigService()).configured()).toBe(false);
  });
});

describe('OpenWaWebhookController', () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => { process.env = { ...ORIGINAL }; });

  function montar(o: { vinculo?: boolean; falha?: boolean } = {}) {
    process.env.OPENWA_WEBHOOK_SECRET = SEGREDO;
    const fake = outboxFake();
    const gravados: unknown[] = [];
    const tx = {
      $queryRaw: jest.fn(async (s: TemplateStringsArray, ...v: unknown[]) => {
        const r = await fake.queryRaw(s, ...v);
        if (/INSERT/.test(s.join('')) && r.length) gravados.push([...fake.linhas.values()].at(-1));
        return r;
      }),
      integration: { findFirst: jest.fn(async () => (o.vinculo === false ? null : { id: 'i1' })) },
      outboxEvent: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const prisma = { withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)) } as unknown as PrismaService;
    const eventos = { processar: jest.fn(async () => { if (o.falha) throw new Error('fora'); return 'entrada'; }) } as unknown as OpenWaEventosService;
    const ctrl = new OpenWaWebhookController(prisma, new ConfigService(), eventos);
    const req = (corpo: unknown, assinar = true) => {
      const raw = Buffer.from(JSON.stringify(corpo));
      const ts = String(Math.floor(Date.now() / 1000));
      return { rawBody: raw, body: corpo, headers: { 'x-khub-timestamp': ts, 'x-khub-signature': assinar ? assinarStevo(SEGREDO, ts, raw) : 'sha256=' + '0'.repeat(64) } } as never;
    };
    return { ctrl, req, gravados, eventos, tx };
  }
  const ev = (over: Record<string, unknown> = {}) => ({ eventId: 'e1', sessionId: SESSAO, tipo: 'mensagem', criadoEm: '2026-11-24T20:00:00Z', dados: { id: 'wa1', numero: '5518991234567', deMim: false, texto: 'oi', tipo: 'texto', timestamp: 1764000000 }, ...over });

  it('assinatura inválida → 401, nada gravado', async () => {
    const m = montar();
    await expect(m.ctrl.receber(m.req(ev(), false))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(m.gravados).toHaveLength(0);
  });
  it('válido → outbox com dedupe por eventId e processado na hora', async () => {
    const m = montar();
    await expect(m.ctrl.receber(m.req(ev()))).resolves.toEqual({ ok: true });
    expect(m.gravados[0]).toMatchObject({ tenantId: TENANT, kind: 'openwa.event', dedupeKey: 'openwa-e1' });
    expect(m.eventos.processar).toHaveBeenCalledWith(TENANT, expect.objectContaining({ tipo: 'mensagem' }));
    expect(m.tx.outboxEvent.updateMany).toHaveBeenCalled();
  });
  it('sessão sem integração ativa → ignorado, nada gravado', async () => {
    const m = montar({ vinculo: false });
    await expect(m.ctrl.receber(m.req(ev()))).resolves.toEqual({ ignorado: 'sessao_sem_vinculo' });
    expect(m.gravados).toHaveLength(0);
  });
  it('sessão fora do formato e evento não usado (sessao.qr) → ignorados', async () => {
    const m = montar();
    await expect(m.ctrl.receber(m.req(ev({ sessionId: 'outra' })))).resolves.toEqual({ ignorado: 'sessao_invalida' });
    await expect(m.ctrl.receber(m.req(ev({ tipo: 'sessao.qr' })))).resolves.toEqual({ ignorado: 'evento_nao_usado' });
  });
  it('falha no processamento imediato → 200 e fica para o worker', async () => {
    const m = montar({ falha: true });
    await expect(m.ctrl.receber(m.req(ev()))).resolves.toEqual({ ok: true });
    expect(m.tx.outboxEvent.updateMany).not.toHaveBeenCalled();
  });
});

describe('OpenWaEventosService', () => {
  function montar() {
    const tx = {
      integration: {
        findFirst: jest.fn(async () => ({ id: 'i1', status: 'connecting', lastSyncAt: null })),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      message: { findFirst: jest.fn(async () => null), updateMany: jest.fn(async () => ({ count: 2 })) },
      $executeRaw: jest.fn(async () => 1),
    };
    const prisma = { withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)) } as unknown as PrismaService;
    const mensagens = { receiveInbound: jest.fn(async () => ({ conversationId: 'c1' })), receberHumano: jest.fn(async () => ({ conversationId: 'c1' })) } as unknown as MessagesService;
    const provider = { pedirHistorico: jest.fn(async () => ({ loteId: 'l1' })), foto: jest.fn(async () => null) } as unknown as OpenWaProvider;
    const historico = { importarLote: jest.fn(async () => ({ conversas: 1, mensagens: 3 })), resumo: jest.fn(async () => ({ conversas: 1, mensagens: 3 })) } as unknown as OpenWaHistoricoService;
    const realtime = { publicar: jest.fn() };
    const svc = new OpenWaEventosService(prisma, mensagens, provider, historico, undefined, undefined, realtime as never);
    return { svc, tx, mensagens, provider, historico, realtime };
  }
  const e = (tipo: string, dados: Record<string, unknown>): EventoOpenWa => ({ eventId: 'x', sessionId: SESSAO, tipo, dados });

  it('mensagem do contato → receiveInbound com id estável do WhatsApp', async () => {
    const m = montar();
    await m.svc.processar(TENANT, e('mensagem', { id: 'wa1', numero: '5518991234567', deMim: false, nomeContato: 'Ana', texto: 'oi', tipo: 'texto' }));
    expect(m.mensagens.receiveInbound).toHaveBeenCalledWith({ tenantId: TENANT, fromNumber: '5518991234567', fromName: 'Ana', text: 'oi', providerMessageId: 'openwa:wa1' });
  });
  it('mensagem digitada no celular (deMim) → humano, sem acionar IA', async () => {
    const m = montar();
    await m.svc.processar(TENANT, e('mensagem', { id: 'wa2', numero: '5518991234567', deMim: true, texto: 'já te respondo', tipo: 'texto' }));
    expect(m.mensagens.receberHumano).toHaveBeenCalledWith({ tenantId: TENANT, numeroContato: '5518991234567', texto: 'já te respondo', providerMessageId: 'openwa:wa2' });
    expect(m.mensagens.receiveInbound).not.toHaveBeenCalled();
  });
  it('primeira conexão: integração conectada, link marcado e histórico pedido sozinho', async () => {
    const m = montar();
    await m.svc.processar(TENANT, e('sessao.estado', { estado: 'conectado', numero: '5518991234567' }));
    expect(m.tx.integration.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'connected', health: 'ok' }) }));
    expect(m.tx.$executeRaw).toHaveBeenCalled();
    expect(m.provider.pedirHistorico).toHaveBeenCalledWith(SESSAO, { dias: 90 });
    expect(m.realtime.publicar).toHaveBeenCalledWith(TENANT, 'whatsapp.estado', { estado: 'conectado', numero: '5518991234567' });
  });
  it('reconexão (histórico já importado) não pede de novo', async () => {
    const m = montar();
    m.tx.integration.findFirst.mockResolvedValue({ id: 'i1', status: 'disconnected', lastSyncAt: new Date() } as never);
    await m.svc.processar(TENANT, e('sessao.estado', { estado: 'conectado' }));
    expect(m.provider.pedirHistorico).not.toHaveBeenCalled();
  });
  it('status de entrega só avança; lote do histórico importa e avisa a tela', async () => {
    const m = montar();
    await m.svc.processar(TENANT, e('mensagem.status', { ids: ['wa1'], estado: 'lido' }));
    expect(m.tx.message.updateMany).toHaveBeenCalledWith({ where: { providerId: { in: ['wa1'] }, deliveryStatus: { in: ['sending', 'pending', 'unknown', 'sent', 'delivered'] } }, data: { deliveryStatus: 'read' } });
    await m.svc.processar(TENANT, e('historico.lote', { chats: [{ numero: '5518991234567', mensagens: [] }], ultimo: true }));
    expect(m.historico.importarLote).toHaveBeenCalled();
    expect(m.realtime.publicar).toHaveBeenCalledWith(TENANT, 'whatsapp.estado', { estado: 'conectado', historico: { conversas: 1, mensagens: 3, concluido: true } });
  });
});
