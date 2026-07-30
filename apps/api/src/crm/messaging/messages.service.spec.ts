import { NotFoundException } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { ConfigService } from '../../config/config.service';
import type { StevoProvider } from './stevo.provider';
import type { DomainEventsService } from '../../events/domain-events.service';
import type { PrismaService } from '../../prisma/prisma.service';

const TENANT = '11111111-1111-1111-1111-111111111111';

/**
 * Banco em memória. Este arquivo é o caminho do WhatsApp — onde nasceram
 * BUG-011 (evento não publicado) e BUG-012 (contato duplicado). A Agenda vai
 * usá-lo para confirmação e lembrete, então a rede vem antes.
 */
function ambiente(opts: { contatos?: any[]; conversas?: any[]; dedupe?: boolean } = {}) {
  const contatos = opts.contatos ?? [];
  const conversas = opts.conversas ?? [];
  const mensagens: any[] = [];
  const auditados: string[] = [];

  const tx = {
    conversation: {
      findUnique: jest.fn(async ({ where }: any) => conversas.find((c) => c.id === where.id) ?? null),
      findFirst: jest.fn(async ({ where }: any) => conversas.find((c) => c.contactId === where.contactId) ?? null),
      create: jest.fn(async ({ data }: any) => { const c = { id: `conv${conversas.length}`, naoLidas: 0, ...data }; conversas.push(c); return c; }),
      update: jest.fn(async ({ where, data }: any) => {
        const c = conversas.find((x) => x.id === where.id);
        if (data.naoLidas?.increment) c.naoLidas = (c.naoLidas ?? 0) + data.naoLidas.increment;
        Object.assign(c, { ...data, naoLidas: c.naoLidas });
        return c;
      }),
    },
    message: { create: jest.fn(async ({ data }: any) => { const m = { id: `msg${mensagens.length}`, ...data }; mensagens.push(m); return m; }) },
    contact: {
      findUnique: jest.fn(async ({ where }: any) => contatos.find((c) => c.id === where.id) ?? null),
      create: jest.fn(async ({ data }: any) => { const c = { id: `novo${contatos.length}`, ...data }; contatos.push(c); return c; }),
    },
    webhookEvent: {
      create: jest.fn(async () => { if (opts.dedupe) throw new Error('unique violation'); return {}; }),
    },
    // espelha o `right(só_dígitos, 8)` que o helper faz no Postgres (BUG-012)
    $queryRaw: jest.fn(async (_s: TemplateStringsArray, ...p: unknown[]) => {
      const cauda = p[1] as string;
      return contatos.filter((c) => c.telefone && String(c.telefone).replace(/\D/g, '').slice(-8) === cauda).map((c) => ({ id: c.id })).slice(0, 1);
    }),
    $executeRaw: jest.fn(async (s: TemplateStringsArray) => { auditados.push(s.join('')); return 1; }),
  };

  const prisma = { withTenant: jest.fn(async (_t: string, work: (tx: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const publicados: { evento: string; dados: any }[] = [];
  const eventos = { publicar: jest.fn((_t: string, evento: string, dados: any) => publicados.push({ evento, dados })) } as unknown as DomainEventsService;

  return { contatos, conversas, mensagens, auditados, publicados, prisma, eventos, tx };
}

function stevo(configurado: boolean, aoEnviar?: () => Promise<void>) {
  return {
    configured: () => configurado,
    missing: () => (configurado ? [] : ['STEVO_API_URL', 'STEVO_INSTANCE']),
    sendText: jest.fn(async () => { if (aoEnviar) await aoEnviar(); return { providerId: 'p1' }; }),
  } as unknown as StevoProvider;
}

describe('MessagesService.send — a mensagem SEMPRE persiste (ADR-0008)', () => {
  const CONV = [{ id: 'conv1', contact: { telefone: '+55 11 99999-1111' } }];

  it('com STEVO configurado: grava, audita e entrega', async () => {
    const a = ambiente({ conversas: CONV });
    const prov = stevo(true);
    const r = await new MessagesService(a.prisma, prov, new ConfigService(), a.eventos).send(TENANT, 'conv1', 'Olá!');

    expect(r.status).toBe('sent');
    expect(a.mensagens[0]).toMatchObject({ corpo: 'Olá!', autorTipo: 'humano' });
    expect(prov.sendText).toHaveBeenCalled();
    expect(a.auditados.join(' ')).toContain('audit_logs');
  });

  /**
   * O contrato do gating: sem credencial a operação local NÃO falha. A mensagem
   * fica gravada e o cliente vê o que falta — nunca perde o texto digitado.
   */
  it('sem credencial: grava do mesmo jeito e devolve config_required + missing', async () => {
    const a = ambiente({ conversas: CONV });
    const prov = stevo(false);
    const r = await new MessagesService(a.prisma, prov, new ConfigService(), a.eventos).send(TENANT, 'conv1', 'Olá!');

    expect(r.status).toBe('config_required');
    expect(r.missing).toEqual(['STEVO_API_URL', 'STEVO_INSTANCE']);
    expect(a.mensagens).toHaveLength(1);      // persistiu
    expect(prov.sendText).not.toHaveBeenCalled();
  });

  it('STEVO fora do ar: status failed, mas a mensagem continua gravada', async () => {
    const a = ambiente({ conversas: CONV });
    const prov = stevo(true, async () => { throw new Error('STEVO 500'); });
    const r = await new MessagesService(a.prisma, prov, new ConfigService(), a.eventos).send(TENANT, 'conv1', 'Olá!');

    expect(r.status).toBe('failed');
    expect(r.erro).toContain('STEVO 500');
    expect(a.mensagens).toHaveLength(1);
  });

  it('contato sem telefone: sem_telefone (não tenta enviar para o vazio)', async () => {
    const a = ambiente({ conversas: [{ id: 'conv1', contact: { telefone: null } }] });
    const prov = stevo(true);
    const r = await new MessagesService(a.prisma, prov, new ConfigService(), a.eventos).send(TENANT, 'conv1', 'Olá!');
    expect(r.status).toBe('sem_telefone');
    expect(prov.sendText).not.toHaveBeenCalled();
  });

  it('conversa inexistente falha antes de qualquer efeito', async () => {
    const a = ambiente({ conversas: [] });
    await expect(new MessagesService(a.prisma, stevo(true), new ConfigService(), a.eventos).send(TENANT, 'sumiu', 'Oi'))
      .rejects.toThrow(NotFoundException);
    expect(a.mensagens).toHaveLength(0);
  });

  it('publica message.created e conversation.updated (BUG-011)', async () => {
    const a = ambiente({ conversas: CONV });
    await new MessagesService(a.prisma, stevo(true), new ConfigService(), a.eventos).send(TENANT, 'conv1', 'Olá!');
    expect(a.publicados.map((p) => p.evento)).toEqual(['message.created', 'conversation.updated']);
    expect(a.publicados[0].dados).toMatchObject({ de: 'humano', texto: 'Olá!' });
  });
});

describe('MessagesService.receiveInbound — entrada do WhatsApp', () => {
  const ENTRADA = { tenantId: TENANT, fromNumber: '5511999991111', text: 'Oi, tenho interesse', providerMessageId: 'wamid-1' };

  /** BUG-012: número cru vs telefone formatado criava contato duplicado. */
  it('acha o contato salvo COM máscara a partir do número cru (regressão BUG-012)', async () => {
    const a = ambiente({ contatos: [{ id: 'c1', nome: 'Marina', telefone: '+55 11 99999-1111' }] });
    await new MessagesService(a.prisma, stevo(true), new ConfigService(), a.eventos).receiveInbound(ENTRADA);

    expect(a.contatos).toHaveLength(1);       // NÃO duplicou
    expect(a.conversas[0].contactId).toBe('c1');
  });

  it('número desconhecido cria contato e publica contact.created', async () => {
    const a = ambiente();
    await new MessagesService(a.prisma, stevo(true), new ConfigService(), a.eventos).receiveInbound({ ...ENTRADA, fromName: 'Novo Lead' });

    expect(a.contatos[0]).toMatchObject({ nome: 'Novo Lead', tag: 'Lead' });
    expect(a.publicados.map((p) => p.evento)).toContain('contact.created');
  });

  it('IDEMPOTÊNCIA: reentrega do mesmo webhook não duplica nem republica', async () => {
    const a = ambiente({ contatos: [{ id: 'c1', nome: 'Marina', telefone: '+55 11 99999-1111' }], dedupe: true });
    const r = await new MessagesService(a.prisma, stevo(true), new ConfigService(), a.eventos).receiveInbound(ENTRADA);

    expect(r).toEqual({ deduped: true });
    expect(a.mensagens).toHaveLength(0);
    expect(a.publicados).toHaveLength(0);     // evento duplicado acionaria automação 2x
  });

  it('mensagem de contato conhecido incrementa não lidas e atualiza a prévia', async () => {
    const a = ambiente({
      contatos: [{ id: 'c1', nome: 'Marina', telefone: '+55 11 99999-1111' }],
      conversas: [{ id: 'conv1', contactId: 'c1', canal: 'WhatsApp', naoLidas: 2 }],
    });
    await new MessagesService(a.prisma, stevo(true), new ConfigService(), a.eventos).receiveInbound(ENTRADA);

    expect(a.conversas[0].naoLidas).toBe(3);
    expect(a.conversas[0].ultimaPrevia).toBe('Oi, tenho interesse');
    expect(a.publicados.find((p) => p.evento === 'conversation.updated')?.dados.naoLidas).toBe(3);
  });

  it('contato que já existe NÃO publica contact.created de novo', async () => {
    const a = ambiente({ contatos: [{ id: 'c1', nome: 'Marina', telefone: '+55 11 99999-1111' }] });
    await new MessagesService(a.prisma, stevo(true), new ConfigService(), a.eventos).receiveInbound(ENTRADA);
    expect(a.publicados.map((p) => p.evento)).not.toContain('contact.created');
  });

  it('a entrada vem marcada como do contato (senão o fluxo responderia a si mesmo)', async () => {
    const a = ambiente({ contatos: [{ id: 'c1', nome: 'M', telefone: '+55 11 99999-1111' }] });
    await new MessagesService(a.prisma, stevo(true), new ConfigService(), a.eventos).receiveInbound(ENTRADA);
    expect(a.mensagens[0].autorTipo).toBe('contato');
    expect(a.publicados.find((p) => p.evento === 'message.created')?.dados.de).toBe('contato');
  });

  it('toda operação abre transação com o tenant da sessão (isolamento)', async () => {
    const a = ambiente({ contatos: [{ id: 'c1', nome: 'M', telefone: '+55 11 99999-1111' }] });
    await new MessagesService(a.prisma, stevo(true), new ConfigService(), a.eventos).receiveInbound(ENTRADA);
    expect((a.prisma.withTenant as jest.Mock).mock.calls.every((c) => c[0] === TENANT)).toBe(true);
  });
});
