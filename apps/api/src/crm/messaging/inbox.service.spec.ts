import { BadRequestException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { InboxService, LIMITE_LEITURA_TELA, type AnexoMensagem } from './inbox.service';
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

function ambiente(opts: { storage?: boolean; membros?: string[]; contato?: { telefone: string | null }; conversaExistente?: boolean; contatoPorTelefone?: { id: string; nome: string; telefone: string } | null; respostas?: { id: string; criadoPor: string | null; atalho: string; titulo: string; corpo: string }[] } = {}) {
  const notas: Record<string, unknown>[] = [];
  const notificacoes: Record<string, unknown>[] = [];
  const conversasCriadas: Record<string, unknown>[] = [];
  const contatosCriados: Record<string, unknown>[] = [];
  const membros = opts.membros ?? [EU, ANA];
  const tx = {
    conversation: {
      findUnique: jest.fn(async () => ({ id: CONV, nome: 'Marina' })),
      findFirst: jest.fn(async () => (opts.conversaExistente ? { id: CONV } : null)),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { conversasCriadas.push(data); return { id: 'nova' }; }),
    },
    contact: {
      findUnique: jest.fn(async () => ({ id: 'c1', nome: 'Marina', telefone: opts.contato ? opts.contato.telefone : '+55 11 99999-0000' })),
      findFirst: jest.fn(async () => opts.contatoPorTelefone ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { contatosCriados.push(data); return { id: 'c9', nome: data.nome, telefone: data.telefone }; }),
    },
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
    $queryRaw: jest.fn(async () => (opts.contatoPorTelefone ? [opts.contatoPorTelefone] : [])),
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
  return { svc, tx, notas, notificacoes, conversasCriadas, contatosCriados, enviados, uploads, publicados };
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
    expect(await a.svc.iniciarConversa(T, { contactId: 'c1' }, EU)).toEqual({ id: 'nova', criada: true });
    expect(a.conversasCriadas[0]).toMatchObject({ canal: 'WhatsApp', atendimento: 'humano', assigneeId: EU, contactId: 'c1' });
    expect(a.publicados[0].evento).toBe('conversation.updated');
  });

  it('já existe conversa: devolve a mesma, sem duplicar', async () => {
    const a = ambiente({ conversaExistente: true });
    expect(await a.svc.iniciarConversa(T, { contactId: 'c1' }, EU)).toEqual({ id: CONV, criada: false });
    expect(a.conversasCriadas).toHaveLength(0);
  });

  it('contato sem telefone: 422', async () => {
    const a = ambiente({ contato: { telefone: null } });
    await expect(a.svc.iniciarConversa(T, { contactId: 'c1' }, EU)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('número direto sem contato: cria o contato com DDI 55 e abre a conversa', async () => {
    const a = ambiente();
    expect(await a.svc.iniciarConversa(T, { telefone: '(18) 99777-6655' }, EU)).toEqual({ id: 'nova', criada: true });
    expect(a.contatosCriados[0]).toMatchObject({ telefone: '+5518997776655', nome: '+5518997776655' });
    expect(a.conversasCriadas[0]).toMatchObject({ contactId: 'c9', canal: 'WhatsApp' });
  });

  it('número direto de contato existente: reusa o contato, não cria outro', async () => {
    const a = ambiente({ contatoPorTelefone: { id: 'c1', nome: 'Marina', telefone: '+55 18 99777-6655' } });
    await a.svc.iniciarConversa(T, { telefone: '5518997776655' }, EU);
    expect(a.contatosCriados).toHaveLength(0);
    expect(a.conversasCriadas[0]).toMatchObject({ contactId: 'c1', nome: 'Marina' });
  });

  it('número incompleto: 422', async () => {
    const a = ambiente();
    await expect(a.svc.iniciarConversa(T, { telefone: '9777-665' }, EU)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('sem contato nem telefone: 400', async () => {
    const a = ambiente();
    await expect(a.svc.iniciarConversa(T, {}, EU)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('InboxService — thread: leitura da mídia e selo "pelo celular"', () => {
  const M_AUDIO = 'd0000000-0000-4000-8000-000000000001';
  const M_VIDEO = 'd0000000-0000-4000-8000-000000000002';
  const M_CELULAR = 'd0000000-0000-4000-8000-000000000003';
  const M_KHUB = 'd0000000-0000-4000-8000-000000000004';
  const M_PDF = 'd0000000-0000-4000-8000-000000000005';

  /** Thread com as mensagens dadas; `anexos` = o Json gravado em `message.anexo`; `doCelular` = ids que o banco devolve no filtro do prefixo. */
  function ambienteThread(anexos: Record<string, unknown>, doCelular: string[] = []) {
    const base = [M_AUDIO, M_VIDEO, M_CELULAR, M_KHUB, M_PDF].map((id, i) => ({
      id,
      de: id === M_CELULAR || id === M_KHUB ? 'humano' : 'contato',
      texto: 'mensagem',
      hora: '10:00',
      status: 'legacy',
      agentId: null,
      criadaEm: new Date(Date.UTC(2026, 0, 1, 10, i)).toISOString(),
      agentNome: null,
      workflowId: null,
      workflowNome: null,
      enviadoPorId: id === M_KHUB ? EU : null,
      enviadoPorNome: id === M_KHUB ? 'Pedro' : null,
    }));
    const consultas: Record<string, unknown>[] = [];
    const tx = {
      message: {
        findMany: jest.fn(async (args: { where: Record<string, unknown> }) => {
          consultas.push(args);
          if ('idempotencyKey' in args.where) return doCelular.map((id) => ({ id }));
          return Object.entries(anexos).map(([id, anexo]) => ({ id, anexo }));
        }),
      },
      conversationNote: { findMany: jest.fn(async () => []) },
      user: { findMany: jest.fn(async () => []) },
    };
    const prisma = { withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)) } as unknown as PrismaService;
    const crm = { mensagensDaConversa: jest.fn(async () => ({ id: CONV, total: base.length, mensagens: base })) } as unknown as CrmService;
    const storage = { urlLeitura: jest.fn((chave: string) => `https://s3/${chave}?assinada`) } as unknown as StorageService;
    const svc = new InboxService(prisma, crm, {} as MessagesService, storage, new NotificationsService(), {} as DomainEventsService);
    /** Anexo da mensagem na resposta da thread (nota interna não tem anexo). */
    const anexoDe = async (id: string): Promise<AnexoMensagem | null> => {
      const m = (await svc.thread(T, CONV)).mensagens.find((x) => x.id === id);
      return m && 'anexo' in m ? m.anexo : null;
    };
    return { svc, consultas, anexoDe };
  }

  it('entrega anexo.leitura pronta (transcrição) e marca o vídeo para a tela rotular como transcrição', async () => {
    const a = ambienteThread({
      [M_AUDIO]: { tipo: 'audio', mime: 'audio/ogg', nome: 'audio.ogg', tamanho: 10, dataUrl: 'data:audio/ogg;base64,AAAA', leitura: { status: 'pronta', texto: '  Quero marcar um horário.  ', por: 'groq-whisper', em: '2026-01-01T10:00:05.000Z' } },
      [M_VIDEO]: { tipo: 'video', mime: 'video/mp4', nome: 'video.mp4', tamanho: 99, leitura: { status: 'pendente', desde: '2026-01-01T10:01:00.000Z' } },
    });
    const r = await a.svc.thread(T, CONV);
    const audio = r.mensagens.find((m) => m.id === M_AUDIO);
    const video = r.mensagens.find((m) => m.id === M_VIDEO);
    expect(audio).toMatchObject({ anexo: { tipo: 'audio', url: 'data:audio/ogg;base64,AAAA', leitura: { status: 'pronta', texto: 'Quero marcar um horário.', por: 'groq-whisper' } } });
    expect(video).toMatchObject({ anexo: { tipo: 'documento', video: true, url: null, leitura: { status: 'pendente', desde: '2026-01-01T10:01:00.000Z' } } });
  });

  it('nunca devolve o dataUrl nem a chave do storage fora de `url`, e não repassa campos desconhecidos da leitura', async () => {
    const a = ambienteThread({
      [M_PDF]: { tipo: 'documento', mime: 'application/pdf', nome: 'exame.pdf', tamanho: 5, storageKey: `inbox/${T}/x`, dataUrl: 'data:application/pdf;base64,AAAA', leitura: { status: 'falhou', motivo: 'download', texto: 'não deveria sair', interno: 'x', faltando: ['A'] } },
    });
    const pdf = await a.anexoDe(M_PDF);
    expect(pdf?.url).toBe(`https://s3/inbox/${T}/x?assinada`);
    expect(pdf).not.toHaveProperty('dataUrl');
    expect(pdf).not.toHaveProperty('storageKey');
    expect(pdf?.leitura).toEqual({ status: 'falhou', motivo: 'download' });
  });

  it('texto de leitura gigante é cortado no DTO e sinalizado; status desconhecido vira "sem leitura"', async () => {
    const a = ambienteThread({
      [M_PDF]: { tipo: 'documento', mime: 'application/pdf', nome: 'contrato.pdf', tamanho: 5, leitura: { status: 'pronta', texto: 'a'.repeat(LIMITE_LEITURA_TELA + 50) } },
      [M_AUDIO]: { tipo: 'audio', mime: 'audio/ogg', nome: 'a.ogg', tamanho: 1, leitura: { status: 'inventado', texto: 'x' } },
    });
    const pdf = await a.anexoDe(M_PDF);
    expect(pdf?.leitura?.texto).toHaveLength(LIMITE_LEITURA_TELA);
    expect(pdf?.leitura?.truncado).toBe(true);
    const audio = await a.anexoDe(M_AUDIO);
    expect(audio).toMatchObject({ tipo: 'audio' });
    expect(audio).not.toHaveProperty('leitura');
  });

  it('config_required expõe só nomes de variáveis válidos', async () => {
    const a = ambienteThread({
      [M_AUDIO]: { tipo: 'audio', mime: 'audio/ogg', nome: 'a.ogg', tamanho: 1, leitura: { status: 'config_required', faltando: ['GROQ_API_KEY', 'valor com espaço', 7] } },
    });
    expect((await a.anexoDe(M_AUDIO))?.leitura).toEqual({ status: 'config_required', faltando: ['GROQ_API_KEY'] });
  });

  it('peloCelular vem do filtro no banco (humano, sem autor, prefixo `celular:`) e a chave de idempotência nunca sai', async () => {
    const a = ambienteThread({}, [M_CELULAR]);
    const r = await a.svc.thread(T, CONV);
    const filtro = a.consultas.find((c) => 'idempotencyKey' in (c.where as Record<string, unknown>)) as { where: Record<string, unknown>; select: Record<string, unknown> };
    expect(filtro.where).toMatchObject({ autorTipo: 'humano', enviadoPorId: null, idempotencyKey: { startsWith: 'celular:' } });
    expect(filtro.select).toEqual({ id: true });
    expect(r.mensagens.find((m) => m.id === M_CELULAR)).toMatchObject({ peloCelular: true, anexo: null });
    expect(r.mensagens.find((m) => m.id === M_KHUB)).toMatchObject({ peloCelular: false });
    expect(r.mensagens.find((m) => m.id === M_AUDIO)).toMatchObject({ peloCelular: false });
    expect(JSON.stringify(r)).not.toMatch(/idempotency|celular:/i);
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
