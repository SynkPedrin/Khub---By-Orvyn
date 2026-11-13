import { NotFoundException } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { ConfigService } from '../../config/config.service';
import type { StevoProvider } from './stevo.provider';
import type { EvolutionProvider } from './evolution.provider';
import type { DomainEventsService } from '../../events/domain-events.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AtendimentoService } from './atendimento.service';
import type { StevoApiProvider } from './stevo-api.provider';

const TENANT = '11111111-1111-1111-1111-111111111111';

/**
 * Banco em memória. Este arquivo é o caminho do WhatsApp — onde nasceram
 * BUG-011 (evento não publicado) e BUG-012 (contato duplicado). A Agenda vai
 * usá-lo para confirmação e lembrete, então a rede vem antes.
 */
function ambiente(opts: { contatos?: any[]; conversas?: any[]; dedupe?: boolean; agentePadrao?: string; stevoApi?: { externalBusinessId: string; status: string } } = {}) {
  const contatos = opts.contatos ?? ((opts.conversas ?? [])
    .filter((c) => c.contactId && c.contact)
    .map((c) => ({ id: c.contactId, ...c.contact })));
  const conversas = opts.conversas ?? [];
  const mensagens: any[] = [];
  const auditados: string[] = [];
  const locks: string[] = [];

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
    message: {
      findUnique: jest.fn(async ({ where }: any) => mensagens.find((m) =>
        m.tenantId === where.tenantId_idempotencyKey?.tenantId &&
        m.idempotencyKey === where.tenantId_idempotencyKey?.idempotencyKey) ?? null),
      create: jest.fn(async ({ data }: any) => { const m = { id: `msg${mensagens.length}`, ...data }; mensagens.push(m); return m; }),
      update: jest.fn(async ({ where, data }: any) => {
        const m = mensagens.find((x) => x.id === where.id);
        Object.assign(m, data);
        return m;
      }),
    },
    contact: {
      findUnique: jest.fn(async ({ where }: any) => contatos.find((c) => c.id === where.id) ?? null),
      create: jest.fn(async ({ data }: any) => { const c = { id: `novo${contatos.length}`, ...data }; contatos.push(c); return c; }),
      update: jest.fn(async ({ where, data }: any) => {
        const c = contatos.find((x) => x.id === where.id);
        Object.assign(c, data);
        return c;
      }),
    },
    workflowRun: { updateMany: jest.fn(async () => ({ count: 0 })) },
    webhookEvent: {
      create: jest.fn(async () => { if (opts.dedupe) throw new Error('unique violation'); return {}; }),
    },
    // espelha o `right(só_dígitos, 8)` que o helper faz no Postgres (BUG-012)
    $queryRaw: jest.fn(async (s: TemplateStringsArray, ...p: unknown[]) => {
      // Comportamento REAL do Prisma: pg_advisory_xact_lock devolve `void` e $queryRaw
      // não consegue desserializar (P2010). Só $executeRaw é válido para o lock.
      if (s.join('').includes('pg_advisory_xact_lock')) throw Object.assign(new Error("Failed to deserialize column of type 'void'"), { code: 'P2010' });
      const cauda = p[1] as string;
      return contatos.filter((c) => c.telefone && String(c.telefone).replace(/\D/g, '').slice(-8) === cauda).map((c) => ({ id: c.id })).slice(0, 1);
    }),
    $executeRaw: jest.fn(async (s: TemplateStringsArray) => {
      if (s.join('').includes('pg_advisory_xact_lock')) { locks.push(s.join('')); return 1; }
      if (s.join('').includes('INSERT INTO webhook_events') && opts.dedupe) return 0;
      auditados.push(s.join(''));
      return 1;
    }),
    integration: { findFirst: jest.fn(async ({ where }: any) => (where.provider === 'stevo_api' ? opts.stevoApi ?? null : null)) },
  };

  const prisma = { withTenant: jest.fn(async (_t: string, work: (tx: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const publicados: { evento: string; dados: any }[] = [];
  const eventos = { publicar: jest.fn((_t: string, evento: string, dados: any) => publicados.push({ evento, dados })) } as unknown as DomainEventsService;

  // Atendimento: conversa nova nasce com humano (sem agente padrão) e a
  // regra "humano que responde assume" fica registrada nas chamadas.
  const atendimento = {
    estadoInicial: jest.fn(async () => (opts.agentePadrao ? { atendimento: 'ia', agentId: opts.agentePadrao } : { atendimento: 'humano', agentId: null })),
    aoHumanoEnviar: jest.fn(async () => null),
    publicar: jest.fn(),
  } as unknown as AtendimentoService;

  const stevoApi = { configured: () => true, missing: () => [], sendText: jest.fn(async () => ({ providerId: 'wamid-stevo-1' })) } as unknown as StevoApiProvider;

  return { contatos, conversas, mensagens, auditados, locks, publicados, prisma, eventos, tx, atendimento, stevoApi };
}

function evolutionDesligada() {
  return { configured: () => false, missing: () => ['EVOLUTION_BASE_URL', 'EVOLUTION_API_KEY'], sendText: jest.fn() } as unknown as EvolutionProvider;
}

function stevo(configurado: boolean, aoEnviar?: () => Promise<void>) {
  return {
    configured: () => configurado,
    missing: () => (configurado ? [] : ['STEVO_API_URL', 'STEVO_INSTANCE']),
    sendText: jest.fn(async () => { if (aoEnviar) await aoEnviar(); return { providerId: 'p1' }; }),
  } as unknown as StevoProvider;
}

// Fora de produção a saída só vai para o número de teste (trava de dev, doc 18 B-3).
const NUMERO_TESTE = '5511900000000';
beforeEach(() => { process.env.STEVO_TEST_NUMBER = NUMERO_TESTE; });
afterAll(() => { delete process.env.STEVO_TEST_NUMBER; });

describe('MessagesService.send — a mensagem SEMPRE persiste (ADR-0008)', () => {
  const CONV = [{ id: 'conv1', contactId: 'c1', contact: { telefone: '+55 11 99999-1111' } }];

  it('com STEVO configurado: grava, audita e entrega', async () => {
    const a = ambiente({ conversas: CONV });
    const prov = stevo(true);
    const r = await new MessagesService(a.prisma, prov, evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).send(TENANT, 'conv1', 'Olá!');

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
    const r = await new MessagesService(a.prisma, prov, evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).send(TENANT, 'conv1', 'Olá!');

    expect(r.status).toBe('config_required');
    expect(r.missing).toEqual(['STEVO_API_URL', 'STEVO_INSTANCE']);
    expect(a.mensagens).toHaveLength(1);      // persistiu
    expect(prov.sendText).not.toHaveBeenCalled();
  });

  it('STEVO com aceitação incerta: status unknown, mas a mensagem continua gravada', async () => {
    const a = ambiente({ conversas: CONV });
    const prov = stevo(true, async () => { throw new Error('STEVO 500'); });
    const r = await new MessagesService(a.prisma, prov, evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).send(TENANT, 'conv1', 'Olá!');

    expect(r.status).toBe('unknown');
    expect(r.erro).toBe('provider_acceptance_unknown');
    expect(a.mensagens).toHaveLength(1);
  });

  it('contato sem telefone: sem_telefone (não tenta enviar para o vazio)', async () => {
    const a = ambiente({ conversas: [{ id: 'conv1', contact: { telefone: null } }] });
    const prov = stevo(true);
    const r = await new MessagesService(a.prisma, prov, evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).send(TENANT, 'conv1', 'Olá!');
    expect(r.status).toBe('sem_telefone');
    expect(prov.sendText).not.toHaveBeenCalled();
  });

  it('Q3.1 · contato em "não perturbe" (opted_out_at): grava, NÃO chama o provedor e devolve cancelled', async () => {
    const a = ambiente({ conversas: [{ id: 'conv1', contactId: 'c1', contact: { telefone: '+55 11 99999-1111', optedOutAt: new Date() } }] });
    const prov = stevo(true);
    const r = await new MessagesService(a.prisma, prov, evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).send(TENANT, 'conv1', 'Promoção!');
    expect(r.status).toBe('cancelled');
    expect(prov.sendText).not.toHaveBeenCalled();
  });

  it('conversa inexistente falha antes de qualquer efeito', async () => {
    const a = ambiente({ conversas: [] });
    await expect(new MessagesService(a.prisma, stevo(true), evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).send(TENANT, 'sumiu', 'Oi'))
      .rejects.toThrow(NotFoundException);
    expect(a.mensagens).toHaveLength(0);
  });

  it('publica message.created e conversation.updated (BUG-011)', async () => {
    const a = ambiente({ conversas: CONV });
    await new MessagesService(a.prisma, stevo(true), evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).send(TENANT, 'conv1', 'Olá!');
    expect(a.publicados.map((p) => p.evento)).toEqual(['message.created', 'conversation.updated']);
    expect(a.publicados[0].dados).toMatchObject({ de: 'humano', texto: 'Olá!' });
  });
});

describe('MessagesService.receiveInbound — entrada do WhatsApp', () => {
  const ENTRADA = { tenantId: TENANT, fromNumber: '5511999991111', text: 'Oi, tenho interesse', providerMessageId: 'wamid-1' };

  /** BUG-012: número cru vs telefone formatado criava contato duplicado. */
  it('acha o contato salvo COM máscara a partir do número cru (regressão BUG-012)', async () => {
    const a = ambiente({ contatos: [{ id: 'c1', nome: 'Marina', telefone: '+55 11 99999-1111' }] });
    await new MessagesService(a.prisma, stevo(true), evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).receiveInbound(ENTRADA);

    expect(a.contatos).toHaveLength(1);       // NÃO duplicou
    expect(a.conversas[0].contactId).toBe('c1');
  });

  it('número desconhecido cria contato e publica contact.created', async () => {
    const a = ambiente();
    await new MessagesService(a.prisma, stevo(true), evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).receiveInbound({ ...ENTRADA, fromName: 'Novo Lead' });

    expect(a.contatos[0]).toMatchObject({ nome: 'Novo Lead', tag: 'Lead' });
    expect(a.publicados.map((p) => p.evento)).toContain('contact.created');
  });

  it('contato criado pela entrada nasce com origem = WhatsApp (o outbox lê contacts.origem, db/050)', async () => {
    const a = ambiente();
    await new MessagesService(a.prisma, stevo(true), evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).receiveInbound({ ...ENTRADA, fromName: 'Novo Lead' });

    expect(a.contatos[0].origem).toBe('WhatsApp');
    expect(a.conversas[0].canal).toBe('WhatsApp');
  });

  it('IDEMPOTÊNCIA: reentrega do mesmo webhook não duplica nem republica', async () => {
    const a = ambiente({ contatos: [{ id: 'c1', nome: 'Marina', telefone: '+55 11 99999-1111' }], dedupe: true });
    const r = await new MessagesService(a.prisma, stevo(true), evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).receiveInbound(ENTRADA);

    expect(r).toEqual({ deduped: true });
    expect(a.mensagens).toHaveLength(0);
    expect(a.publicados).toHaveLength(0);     // evento duplicado acionaria automação 2x
  });

  it('mensagem de contato conhecido incrementa não lidas e atualiza a prévia', async () => {
    const a = ambiente({
      contatos: [{ id: 'c1', nome: 'Marina', telefone: '+55 11 99999-1111' }],
      conversas: [{ id: 'conv1', contactId: 'c1', canal: 'WhatsApp', naoLidas: 2 }],
    });
    await new MessagesService(a.prisma, stevo(true), evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).receiveInbound(ENTRADA);

    expect(a.conversas[0].naoLidas).toBe(3);
    expect(a.conversas[0].ultimaPrevia).toBe('Oi, tenho interesse');
    expect(a.publicados.find((p) => p.evento === 'conversation.updated')?.dados.naoLidas).toBe(3);
  });

  it('REGRESSÃO P2010: o lock advisory usa $executeRaw (um $queryRaw de `void` quebra no Prisma real)', async () => {
    const a = ambiente({});
    await new MessagesService(a.prisma, stevo(false), evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).receiveInbound({ tenantId: TENANT, fromNumber: '5511988887777', fromName: 'Lead', text: 'oi', providerMessageId: 'm-lock' });
    expect(a.locks).toHaveLength(1);
    expect(a.locks[0]).toContain('pg_advisory_xact_lock');
  });

  it('contato que já existe NÃO publica contact.created de novo', async () => {
    const a = ambiente({ contatos: [{ id: 'c1', nome: 'Marina', telefone: '+55 11 99999-1111' }] });
    await new MessagesService(a.prisma, stevo(true), evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).receiveInbound(ENTRADA);
    expect(a.publicados.map((p) => p.evento)).not.toContain('contact.created');
  });

  it('a entrada vem marcada como do contato (senão o fluxo responderia a si mesmo)', async () => {
    const a = ambiente({ contatos: [{ id: 'c1', nome: 'M', telefone: '+55 11 99999-1111' }] });
    await new MessagesService(a.prisma, stevo(true), evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).receiveInbound(ENTRADA);
    expect(a.mensagens[0].autorTipo).toBe('contato');
    expect(a.publicados.find((p) => p.evento === 'message.created')?.dados.de).toBe('contato');
  });

  it('toda operação abre transação com o tenant da sessão (isolamento)', async () => {
    const a = ambiente({ contatos: [{ id: 'c1', nome: 'M', telefone: '+55 11 99999-1111' }] });
    await new MessagesService(a.prisma, stevo(true), evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).receiveInbound(ENTRADA);
    expect((a.prisma.withTenant as jest.Mock).mock.calls.every((c) => c[0] === TENANT)).toBe(true);
  });
});

describe('MessagesService — atendimento IA/humano (ADR-0030)', () => {
  const ENTRADA2 = { tenantId: TENANT, fromNumber: '5511988887777', fromName: 'Lia', text: 'Oi, quero saber o preço', providerMessageId: 'wamid-ag-1' };

  it('conversa nova nasce com a IA quando há agente padrão ativo', async () => {
    const a = ambiente({ agentePadrao: 'ag1' });
    await new MessagesService(a.prisma, stevo(true), evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).receiveInbound(ENTRADA2);
    expect(a.conversas[0]).toMatchObject({ atendimento: 'ia', agentId: 'ag1' });
  });

  it('sem agente padrão, conversa nova nasce com humano (comportamento anterior)', async () => {
    const a = ambiente();
    await new MessagesService(a.prisma, stevo(true), evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).receiveInbound(ENTRADA2);
    expect(a.conversas[0]).toMatchObject({ atendimento: 'humano', agentId: null });
  });

  it('humano digitando no Inbox aciona "assumir"; automação (sem identityId) não', async () => {
    const CONV = [{ id: 'conv1', contactId: 'c1', contact: { telefone: '+55 11 99999-1111' } }];
    const a = ambiente({ conversas: CONV });
    const svc = new MessagesService(a.prisma, stevo(true), evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi);
    await svc.send(TENANT, 'conv1', 'Automação falando', 'chave-automacao-000001');
    expect(a.atendimento.aoHumanoEnviar).not.toHaveBeenCalled();
    await svc.send(TENANT, 'conv1', 'Oi, aqui é a Ana', 'chave-humano-00000001', undefined, { tipo: 'humano', identityId: 'id-ana' });
    expect(a.atendimento.aoHumanoEnviar).toHaveBeenCalledWith(expect.anything(), TENANT, 'conv1', 'id-ana');
  });

  it('mensagem do agente é gravada como autor "ia" com o agente, e o evento diz "ia"', async () => {
    const CONV = [{ id: 'conv1', contactId: 'c1', contact: { telefone: '+55 11 99999-1111' } }];
    const a = ambiente({ conversas: CONV });
    await new MessagesService(a.prisma, stevo(true), evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi)
      .send(TENANT, 'conv1', 'Olá! Sou a assistente.', 'agent:msg-1', undefined, { tipo: 'ia', agentId: 'ag1' });
    expect(a.mensagens[0]).toMatchObject({ autorTipo: 'ia', agentId: 'ag1' });
    expect(a.publicados.find((p) => p.evento === 'message.created')?.dados).toMatchObject({ de: 'ia', agentId: 'ag1' });
    expect(a.atendimento.aoHumanoEnviar).not.toHaveBeenCalled();
  });
});

describe('MessagesService — trava de envio fora de produção (doc 18, B-3)', () => {
  const CONV = [{ id: 'conv1', contactId: 'c1', contact: { telefone: '+55 11 98888-7777' } }];

  it('sem STEVO_TEST_NUMBER: grava a mensagem, NÃO chama o provedor e marca bloqueado_dev', async () => {
    delete process.env.STEVO_TEST_NUMBER;
    const a = ambiente({ conversas: CONV });
    const prov = stevo(true);
    const r = await new MessagesService(a.prisma, prov, evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).send(TENANT, 'conv1', 'Olá!', 'chave-trava-dev-000001');
    expect(prov.sendText).not.toHaveBeenCalled();
    expect(r.status).toBe('bloqueado_dev');
    expect(a.mensagens[0]).toMatchObject({ deliveryStatus: 'bloqueado_dev' });
  });

  it('com STEVO_TEST_NUMBER: envia para o número de teste, nunca para o telefone do contato', async () => {
    const a = ambiente({ conversas: CONV });
    const prov = stevo(true);
    await new MessagesService(a.prisma, prov, evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).send(TENANT, 'conv1', 'Olá!', 'chave-trava-dev-000002');
    expect(prov.sendText).toHaveBeenCalledWith(NUMERO_TESTE, 'Olá!', undefined, 'chave-trava-dev-000002');
  });
});

describe('MessagesService — provedor por tenant: Stevo API de gestão', () => {
  const CONV = [{ id: 'conv1', contactId: 'c1', contact: { telefone: '+55 11 98888-7777' } }];

  it('tenant com instância Stevo conectada: envia pela API de gestão, com a instância e a MESMA Idempotency-Key', async () => {
    const a = ambiente({ conversas: CONV, stevoApi: { externalBusinessId: 'inst-studio', status: 'connected' } });
    const legado = stevo(true);
    const r = await new MessagesService(a.prisma, legado, evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).send(TENANT, 'conv1', 'Olá!', 'chave-stevo-api-000001');
    expect(a.stevoApi.sendText).toHaveBeenCalledWith(NUMERO_TESTE, 'Olá!', 'inst-studio', 'chave-stevo-api-000001');
    expect(legado.sendText).not.toHaveBeenCalled();
    expect(r.status).toBe('sent');
    expect(a.mensagens[0]).toMatchObject({ providerId: 'wamid-stevo-1' });
  });

  it('instância vinculada mas desconectada: grava, não tenta enviar e diz canal_desconectado', async () => {
    const a = ambiente({ conversas: CONV, stevoApi: { externalBusinessId: 'inst-studio', status: 'disconnected' } });
    const r = await new MessagesService(a.prisma, stevo(true), evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi).send(TENANT, 'conv1', 'Olá!', 'chave-stevo-api-000002');
    expect(a.stevoApi.sendText).not.toHaveBeenCalled();
    expect(r.status).toBe('canal_desconectado');
  });
});


describe('MessagesService — mídia de saída (Q2.5)', () => {
  const CONV = [{ id: 'conv1', contactId: 'c1', contact: { telefone: '+55 11 98888-7777' } }];
  const PDF = { tipo: 'documento' as const, mime: 'application/pdf', nome: 'proposta.pdf', tamanho: 1200 };

  it('Stevo API com URL do storage: envia por sendMedia e grava o anexo com a CHAVE (nunca a URL)', async () => {
    const a = ambiente({ conversas: CONV, stevoApi: { externalBusinessId: 'inst-studio', status: 'connected' } });
    const sendMedia = jest.fn(async () => ({ providerId: 'wamid-midia-1' }));
    Object.assign(a.stevoApi, { sendMedia, aceitaBase64: false });
    const midia = { ...PDF, url: 'https://s3.exemplo/assinada', storageKey: 'inbox/t/conv1/k-proposta.pdf' };
    const r = await new MessagesService(a.prisma, stevo(true), evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi)
      .send(TENANT, 'conv1', '📎 Documento: proposta.pdf', 'chave-midia-stevo-0001', undefined, { tipo: 'humano' }, midia);
    expect(r.status).toBe('sent');
    expect(sendMedia).toHaveBeenCalledWith(NUMERO_TESTE, midia, 'inst-studio', 'chave-midia-stevo-0001');
    expect(a.stevoApi.sendText).not.toHaveBeenCalled();
    expect(a.mensagens[0].anexo).toEqual({ tipo: 'documento', mime: 'application/pdf', nome: 'proposta.pdf', tamanho: 1200, storageKey: 'inbox/t/conv1/k-proposta.pdf' });
    expect(JSON.stringify(a.mensagens[0].anexo)).not.toContain('assinada');
  });

  it('Stevo API sem storage (só base64): grava, NÃO tenta e devolve config_required do storage', async () => {
    const a = ambiente({ conversas: CONV, stevoApi: { externalBusinessId: 'inst-studio', status: 'connected' } });
    const sendMedia = jest.fn();
    Object.assign(a.stevoApi, { sendMedia, aceitaBase64: false });
    const r = await new MessagesService(a.prisma, stevo(true), evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi)
      .send(TENANT, 'conv1', '📎 Documento: proposta.pdf', 'chave-midia-stevo-0002', undefined, { tipo: 'humano' }, { ...PDF, base64: 'JVBERi0=', storageFaltando: ['S3_ENDPOINT'] });
    expect(r.status).toBe('config_required');
    expect(r).toMatchObject({ provider: 'storage', missing: ['S3_ENDPOINT'] });
    expect(sendMedia).not.toHaveBeenCalled();
    expect(a.mensagens).toHaveLength(1);
  });

  it('provedor sem endpoint de mídia (Stevo legado): grava como midia_nao_suportada e não envia texto no lugar', async () => {
    const a = ambiente({ conversas: CONV });
    const legado = stevo(true);
    const r = await new MessagesService(a.prisma, legado, evolutionDesligada(), new ConfigService(), a.eventos, a.atendimento, a.stevoApi)
      .send(TENANT, 'conv1', '📎 Documento: proposta.pdf', 'chave-midia-legado-01', undefined, { tipo: 'humano' }, { ...PDF, url: 'https://s3.exemplo/x' });
    expect(r.status).toBe('midia_nao_suportada');
    expect(legado.sendText).not.toHaveBeenCalled();
  });

  it('Evolution aceita base64: envia sem storage', async () => {
    const a = ambiente({ conversas: CONV });
    const sendMedia = jest.fn(async () => ({ providerId: 'evo-1' }));
    const evo = { configured: () => true, missing: () => [], sendText: jest.fn(), sendMedia, aceitaBase64: true } as unknown as EvolutionProvider;
    a.tx.integration.findFirst = jest.fn(async ({ where }: any) => (where.provider === 'evolution' ? { externalBusinessId: 'khub-t', status: 'connected' } : null));
    const r = await new MessagesService(a.prisma, stevo(true), evo, new ConfigService(), a.eventos, a.atendimento, a.stevoApi)
      .send(TENANT, 'conv1', '📎 Imagem: foto.png', 'chave-midia-evo-00001', undefined, { tipo: 'humano' }, { tipo: 'imagem', mime: 'image/png', nome: 'foto.png', tamanho: 10, base64: 'iVBORw0K' });
    expect(r.status).toBe('sent');
    expect(sendMedia).toHaveBeenCalledWith(NUMERO_TESTE, expect.objectContaining({ base64: 'iVBORw0K' }), 'khub-t', 'chave-midia-evo-00001');
  });
});
