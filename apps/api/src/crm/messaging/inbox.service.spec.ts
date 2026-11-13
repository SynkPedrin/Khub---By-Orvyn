import { BadRequestException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { InboxService } from './inbox.service';
import { ConfigRequiredException } from '../../config/config.service';
import { NotificationsService } from '../../common/notifications.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CrmService } from '../crm.service';
import type { MessagesService } from './messages.service';
import type { StorageService } from '../../common/storage.service';
import type { DomainEventsService } from '../../events/domain-events.service';

const T = '11111111-1111-4111-8111-111111111111';
const EU = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ANA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONV = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function ambiente(opts: { storage?: boolean; membros?: string[]; contato?: { telefone: string | null }; conversaExistente?: boolean; respostas?: { id: string; criadoPor: string | null; atalho: string; titulo: string; corpo: string }[] } = {}) {
  const notas: Record<string, unknown>[] = [];
  const notificacoes: Record<string, unknown>[] = [];
  const conversasCriadas: Record<string, unknown>[] = [];
  const membros = opts.membros ?? [EU, ANA];
  const tx = {
    conversation: {
      findUnique: jest.fn(async () => ({ id: CONV, nome: 'Marina' })),
      findFirst: jest.fn(async () => (opts.conversaExistente ? { id: CONV } : null)),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { conversasCriadas.push(data); return { id: 'nova' }; }),
    },
    contact: { findUnique: jest.fn(async () => ({ id: 'c1', nome: 'Marina', telefone: opts.contato ? opts.contato.telefone : '+55 11 99999-0000' })) },
    user: {
      findMany: jest.fn(async ({ where }: { where: { identityId: { in: string[] } } }) => where.identityId.in.filter((i) => membros.includes(i)).map((identityId) => ({ identityId }))),
      findFirst: jest.fn(async () => ({ nome: 'Pedro' })),
    },
    conversationNote: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { const n = { id: `n${notas.length}`, createdAt: new Date(), ...data }; notas.push(n); return n; }) },
    notification: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { notificacoes.push(data); return { id: `x${notificacoes.length}`, identityId: data.identityId }; }) },
    quickReply: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => opts.respostas?.find((r) => r.id === where.id) ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      delete: jest.fn(async () => ({})),
    },
    $queryRaw: jest.fn(async () => []),
    $executeRaw: jest.fn(async () => 1),
  };
  const prisma = { withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)) } as unknown as PrismaService;
  const enviados: unknown[][] = [];
  const messages = { send: jest.fn(async (...a: unknown[]) => { enviados.push(a); return { id: 'm1', hora: '10:00', status: 'sent', erro: null, missing: [] }; }) } as unknown as MessagesService;
  const uploads: { chave: string; tamanho: number }[] = [];
  const storage = {
    configurado: () => !!opts.storage,
    faltando: () => (opts.storage ? [] : ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']),
    enviar: jest.fn(async (chave: string, corpo: Buffer) => { uploads.push({ chave, tamanho: corpo.length }); }),
    urlLeitura: jest.fn((chave: string) => (opts.storage ? `https://s3/${chave}?assinada` : null)),
  } as unknown as StorageService;
  const publicados: { evento: string; dados: unknown }[] = [];
  const eventos = { publicar: jest.fn((_t: string, evento: string, dados: unknown) => publicados.push({ evento, dados })) } as unknown as DomainEventsService;
  const svc = new InboxService(prisma, {} as CrmService, messages, storage, new NotificationsService(), eventos);
  return { svc, tx, notas, notificacoes, conversasCriadas, enviados, uploads, publicados };
}

describe('InboxService — notas internas com @menção', () => {
  it('grava a nota, notifica só quem foi citado (nunca o autor) e publica os eventos', async () => {
    const a = ambiente();
    const nota = await a.svc.criarNota(T, CONV, EU, '  @Ana confere o boleto ', [ANA, EU, ANA]);
    expect(nota).toMatchObject({ de: 'nota', interna: true, texto: '@Ana confere o boleto' });
    expect(a.notas[0]).toMatchObject({ tenantId: T, conversationId: CONV, autorId: EU, mencoes: [ANA] });
    expect(a.notificacoes).toEqual([expect.objectContaining({ identityId: ANA, tipo: 'mencao', url: `/conversas?c=${CONV}`, titulo: 'Pedro mencionou você em Marina' })]);
    expect(a.publicados.map((p) => p.evento)).toEqual(['conversation.note_created', 'notification.created']);
  });

  it('menção a quem não é da equipe é recusada antes de gravar', async () => {
    const a = ambiente({ membros: [EU] });
    await expect(a.svc.criarNota(T, CONV, EU, 'oi', [ANA])).rejects.toBeInstanceOf(BadRequestException);
    expect(a.notas).toHaveLength(0);
  });
});

describe('InboxService — mídia de saída', () => {
  const ENTRADA = { tipo: 'imagem' as const, mime: 'image/png', nome: 'foto.png', base64: PNG.toString('base64') };

  it('sem storage e ≤ 5 MB: segue em base64 para o envio, com o que falta ao storage', async () => {
    const a = ambiente();
    await a.svc.enviarMidia(T, CONV, ENTRADA, 'chave-0000000000000001', { tipo: 'humano', identityId: EU });
    const midia = a.enviados[0][6] as Record<string, unknown>;
    expect(a.enviados[0][2]).toBe('📎 Imagem: foto.png');
    expect(midia).toMatchObject({ tipo: 'imagem', base64: PNG.toString('base64'), tamanho: PNG.length, storageFaltando: expect.arrayContaining(['S3_BUCKET']) });
    expect(midia.url).toBeUndefined();
    expect(a.uploads).toHaveLength(0);
  });

  it('sem storage e > 5 MB: 501 config_required do storage, nada enviado', async () => {
    const a = ambiente();
    const grande = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(6 * 1024 * 1024)]);
    await expect(a.svc.enviarMidia(T, CONV, { tipo: 'documento', mime: 'application/pdf', nome: 'g.pdf', base64: grande.toString('base64') }, 'chave-0000000000000002', { tipo: 'humano', identityId: EU }))
      .rejects.toBeInstanceOf(ConfigRequiredException);
    expect(a.enviados).toHaveLength(0);
  });

  it('com storage: guarda em chave determinística (retry sobrescreve) e manda a URL, não o base64', async () => {
    const a = ambiente({ storage: true });
    const r = await a.svc.enviarMidia(T, CONV, { ...ENTRADA, nome: 'Foto da Clínica.png' }, 'chave-0000000000000003', { tipo: 'humano', identityId: EU });
    expect(a.uploads[0].chave).toBe(`inbox/${T}/${CONV}/chave-0000000000000003-Foto-da-Clinica.png`);
    const midia = a.enviados[0][6] as Record<string, unknown>;
    expect(midia).toMatchObject({ storageKey: a.uploads[0].chave, url: expect.stringContaining('assinada') });
    expect(midia.base64).toBeUndefined();
    expect(r.anexo.url).toContain('assinada');
  });

  it('conteúdo que não confere com o formato: 422', async () => {
    const a = ambiente();
    await expect(a.svc.enviarMidia(T, CONV, { ...ENTRADA, base64: Buffer.from('MZ executavel').toString('base64') }, 'chave-0000000000000004', { tipo: 'humano', identityId: EU }))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('InboxService — iniciar conversa', () => {
  it('cria conversa de WhatsApp com quem iniciou como responsável', async () => {
    const a = ambiente();
    expect(await a.svc.iniciarConversa(T, 'c1', EU)).toEqual({ id: 'nova', criada: true });
    expect(a.conversasCriadas[0]).toMatchObject({ canal: 'WhatsApp', atendimento: 'humano', assigneeId: EU, contactId: 'c1' });
    expect(a.publicados[0].evento).toBe('conversation.updated');
  });

  it('já existe conversa: devolve a mesma, sem duplicar', async () => {
    const a = ambiente({ conversaExistente: true });
    expect(await a.svc.iniciarConversa(T, 'c1', EU)).toEqual({ id: CONV, criada: false });
    expect(a.conversasCriadas).toHaveLength(0);
  });

  it('contato sem telefone: 422', async () => {
    const a = ambiente({ contato: { telefone: null } });
    await expect(a.svc.iniciarConversa(T, 'c1', EU)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('InboxService — respostas rápidas', () => {
  it('variável desconhecida: 400 dizendo qual', async () => {
    const a = ambiente();
    await expect(a.svc.criarResposta(T, EU, { atalho: 'ola', titulo: 'Olá', corpo: 'Oi {{contato.cpf}}' })).rejects.toThrow(/contato\.cpf/);
  });

  it('cria com atalho normalizado e autor', async () => {
    const a = ambiente();
    await a.svc.criarResposta(T, EU, { atalho: '/Boas Vindas', titulo: 'Boas-vindas', corpo: 'Oi {{contato.primeiro_nome}}!' });
    expect(a.tx.quickReply.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: T, atalho: 'boas-vindas', criadoPor: EU }) }));
  });

  it('membro não altera resposta de outra pessoa; gestão altera', async () => {
    const a = ambiente({ respostas: [{ id: 'r1', criadoPor: ANA, atalho: 'ola', titulo: 'Olá', corpo: 'Oi' }] });
    await expect(a.svc.removerResposta(T, { identityId: EU, role: 'member' }, 'r1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(a.svc.removerResposta(T, { identityId: EU, role: 'manager' }, 'r1')).resolves.toEqual({ ok: true });
  });
});
