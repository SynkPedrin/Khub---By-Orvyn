import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AvaliacoesService, destinoDaNota, ehRobo, montarMensagem, novoToken, TOKEN_RE } from './avaliacoes.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ConfigService } from '../config/config.service';
import type { MessagesService } from '../crm/messaging/messages.service';
import type { MailerService } from '../common/mailer.service';
import type { NotificationsService } from '../common/notifications.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TENANT = '11111111-1111-4111-8111-111111111111';
const CONTATO = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'abcdefghijklmnopqrstuv';

function ambiente(opts: { pedido?: Record<string, any>; settings?: Record<string, any> | null; contato?: Record<string, any> } = {}) {
  const pedido: Record<string, any> | null = opts.pedido ? { id: 'rr1', tenantId: TENANT, contactId: CONTATO, canal: 'whatsapp', link: 'https://g.page/r/abc', token: TOKEN, status: 'enviado', cliques: 0, clicadoEm: null, filtroSatisfacao: false, notaMinima: 4, avaliacaoInterna: null, avaliadoEm: null, comentario: null, redirecionado: false, enviadoEm: null, erro: null, ...opts.pedido } : null;
  const criados: Record<string, any>[] = [];
  const settings = opts.settings === undefined ? { tenantId: TENANT, link: 'https://g.page/r/abc', mensagemPadrao: 'Oi {{contato.primeiroNome}}, avalie: {{link}}', assuntoEmail: 'Avalie', filtroSatisfacao: true, notaMinima: 4 } : opts.settings;
  const tx: any = {
    reviewRequest: {
      findUnique: jest.fn(async () => pedido),
      findFirst: jest.fn(async () => pedido),
      update: jest.fn(async ({ data }: any) => {
        const alvo = pedido ?? criados[criados.length - 1];
        for (const [k, v] of Object.entries(data)) alvo[k] = v && typeof v === 'object' && 'increment' in (v as object) ? (alvo[k] ?? 0) + (v as any).increment : v;
        return alvo;
      }),
      create: jest.fn(async ({ data }: any) => { const p = { id: 'rr-novo', status: 'pendente', enviadoEm: null, ...data }; criados.push(p); return p; }),
    },
    reviewSettings: { findUnique: jest.fn(async () => settings) },
    contact: { findUnique: jest.fn(async () => ({ id: CONTATO, nome: 'ana souza', email: 'ana@ex.com', telefone: '5511999990000', empresa: null, camposCustom: {}, optedOutAt: null, ...opts.contato })) },
    conversation: { findFirst: jest.fn(async () => ({ id: 'conv1' })), create: jest.fn() },
    tenant: { findUnique: jest.fn(async () => ({ nome: 'Clínica Sorriso' })) },
    membership: { findMany: jest.fn(async () => [{ identityId: 'dono' }, { identityId: 'admin' }]) },
    $executeRaw: jest.fn(async () => 1),
  };
  const prisma = {
    withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)),
    $queryRaw: jest.fn(async () => (pedido ? [{ tenant_id: TENANT, review_request_id: pedido.id }] : [])),
  } as unknown as PrismaService;
  const send = jest.fn(async () => ({ id: 'msg1', status: 'sent', erro: null, missing: [] }));
  const notif = { criar: jest.fn(async () => ({ id: 'n', identityId: 'x' })) };
  const config = { get: (k: string) => (k === 'WEB_URL' ? 'https://app.khub.com.br/' : undefined) } as unknown as ConfigService;
  const mailer = { configured: () => true, missing: () => [], send: jest.fn(async () => ({ sent: true })) } as unknown as MailerService;
  const svc = new AvaliacoesService(prisma, config, { send } as unknown as MessagesService, mailer, notif as unknown as NotificationsService);
  return { svc, tx, pedido, criados, send, notif };
}

describe('pedido de avaliação: regras puras', () => {
  it('token curto aleatório no formato aceito pela rota pública', () => {
    const t = novoToken();
    expect(t).toMatch(TOKEN_RE);
    expect(t).toHaveLength(22);
    expect(novoToken()).not.toBe(t);
  });

  it('mensagem troca {{link}} pelo link curto; sem {{link}}, o link vai no fim', () => {
    const c = { nome: 'ana souza', email: null, telefone: null, empresa: null };
    expect(montarMensagem('Oi, {{contato.primeiroNome}}! {{link}}', c, 'https://k.br/r/x')).toBe('Oi, Ana! https://k.br/r/x');
    expect(montarMensagem('Obrigado, {{contato.primeiroNome}}!', c, 'https://k.br/r/x')).toBe('Obrigado, Ana!\n\nhttps://k.br/r/x');
  });

  it('filtro de satisfação: nota >= mínima vai ao público; abaixo, feedback interno', () => {
    expect(destinoDaNota(5, 4)).toBe('publico');
    expect(destinoDaNota(4, 4)).toBe('publico');
    expect(destinoDaNota(3, 4)).toBe('feedback');
  });

  it('robô de pré-visualização não é clique', () => {
    expect(ehRobo('WhatsApp/2.23.20 A')).toBe(true);
    expect(ehRobo('facebookexternalhit/1.1')).toBe(true);
    expect(ehRobo(null)).toBe(true);
    expect(ehRobo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1')).toBe(false);
  });
});

describe('AvaliacoesService: clique e nota', () => {
  const NAVEGADOR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

  it('clique registra a primeira abertura, conta cliques e, sem filtro, devolve o destino', async () => {
    const a = ambiente({ pedido: {} });
    const r1 = await a.svc.abrir(TOKEN, NAVEGADOR);
    expect(r1).toEqual({ empresa: 'Clínica Sorriso', filtroSatisfacao: false, destino: 'https://g.page/r/abc', jaAvaliou: false });
    expect(a.pedido!.cliques).toBe(1);
    expect(a.pedido!.clicadoEm).toBeInstanceOf(Date);
    expect(a.pedido!.redirecionado).toBe(true);
    const primeiro = a.pedido!.clicadoEm;
    await a.svc.abrir(TOKEN, NAVEGADOR);
    expect(a.pedido!.cliques).toBe(2);
    expect(a.pedido!.clicadoEm).toBe(primeiro);
  });

  it('pré-visualização do WhatsApp não conta clique', async () => {
    const a = ambiente({ pedido: {} });
    await a.svc.abrir(TOKEN, 'WhatsApp/2.23');
    expect(a.pedido!.cliques).toBe(0);
    expect(a.pedido!.clicadoEm).toBeNull();
  });

  it('com filtro, não entrega o destino antes da nota e nunca expõe dado do contato', async () => {
    const a = ambiente({ pedido: { filtroSatisfacao: true } });
    const r = await a.svc.abrir(TOKEN, NAVEGADOR);
    expect(r).toMatchObject({ filtroSatisfacao: true, destino: null, notaMinima: 4 });
    expect(JSON.stringify(r)).not.toContain('ana');
  });

  it('nota alta segue para o Google; nota baixa abre o feedback interno', async () => {
    const alta = ambiente({ pedido: { filtroSatisfacao: true } });
    expect(await alta.svc.avaliar(TOKEN, { nota: 5 })).toEqual({ destino: 'https://g.page/r/abc', proximo: 'publico' });
    expect(alta.pedido).toMatchObject({ avaliacaoInterna: 5, redirecionado: true });

    const baixa = ambiente({ pedido: { filtroSatisfacao: true } });
    expect(await baixa.svc.avaliar(TOKEN, { nota: 2 })).toEqual({ destino: null, proximo: 'feedback' });
    expect(baixa.pedido).toMatchObject({ avaliacaoInterna: 2, redirecionado: false });
  });

  it('feedback interno grava e avisa owner/admin uma única vez', async () => {
    const a = ambiente({ pedido: { filtroSatisfacao: true } });
    await a.svc.feedback(TOKEN, { nota: 2, comentario: 'Demorou muito' });
    expect(a.pedido!.comentario).toBe('Demorou muito');
    expect(a.notif.criar).toHaveBeenCalledTimes(2);
    expect(a.notif.criar).toHaveBeenCalledWith(a.tx, TENANT, expect.objectContaining({ tipo: 'avaliacao_negativa', url: `/contatos/${CONTATO}` }));
    await a.svc.feedback(TOKEN, { nota: 1, comentario: 'Mudei de ideia' });
    expect(a.notif.criar).toHaveBeenCalledTimes(2);
  });

  it('token inválido ou desconhecido é 404, nota fora de 1 a 5 é 400', async () => {
    const a = ambiente();
    await expect(a.svc.abrir('curto', NAVEGADOR)).rejects.toBeInstanceOf(NotFoundException);
    await expect(a.svc.abrir(TOKEN, NAVEGADOR)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ambiente({ pedido: {} }).svc.avaliar(TOKEN, { nota: 9 })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AvaliacoesService: pedir', () => {
  it('manual: envia pelo WhatsApp com o link curto rastreável', async () => {
    const a = ambiente();
    a.tx.reviewRequest.findFirst.mockResolvedValue(null);
    const r = await a.svc.pedir(TENANT, { contactId: CONTATO, canal: 'whatsapp' }, { tipo: 'manual', identityId: 'dono' });
    expect(r.status).toBe('enviado');
    const token = a.criados[0].token as string;
    expect(a.send).toHaveBeenCalledWith(TENANT, 'conv1', `Oi Ana, avalie: https://app.khub.com.br/r/${token}`, 'avaliacao:rr-novo', undefined, { tipo: 'humano' });
    expect(a.criados[0]).toMatchObject({ link: 'https://g.page/r/abc', filtroSatisfacao: true, origem: 'manual' });
  });

  it('sem configuração de avaliação é 400; opt-out é 400', async () => {
    await expect(ambiente({ settings: null }).svc.pedir(TENANT, { contactId: CONTATO, canal: 'whatsapp' }, { tipo: 'manual', identityId: 'd' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ambiente({ contato: { optedOutAt: new Date() } }).svc.pedir(TENANT, { contactId: CONTATO, canal: 'whatsapp' }, { tipo: 'manual', identityId: 'd' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('automação: retry com a mesma chave não manda de novo', async () => {
    const a = ambiente({ pedido: { status: 'enviado', idempotencyKey: 'run1:no1:avaliacao' } });
    const r = await a.svc.pedir(TENANT, { contactId: CONTATO, canal: 'whatsapp' }, { tipo: 'automacao', idempotencyKey: 'run1:no1:avaliacao' });
    expect(r).toMatchObject({ status: 'enviado', reaproveitado: true });
    expect(a.send).not.toHaveBeenCalled();
    expect(a.tx.reviewRequest.create).not.toHaveBeenCalled();
  });
});
