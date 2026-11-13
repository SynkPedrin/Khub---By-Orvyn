import { IngestionService } from './ingestion.service';
import { IngestionProcessor } from './ingestion.processor';
import { ChunkingService } from '../chunking.service';
import type { EmbeddingsService } from '../embeddings/embeddings.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { IngestionQueue } from './ingestion.types';

describe('IngestionService (R1.3 idempotência)', () => {
  const baseInput = {
    escopo: 'tenant' as const,
    tenantId: '11111111-1111-1111-1111-111111111111',
    titulo: 'Tabela',
    fonte: 'upload_cliente',
    content: '# Tabela\n\nConsulta R$ 300',
  };

  function setup(existing: unknown = null) {
    const create = jest.fn().mockResolvedValue({ id: 'doc-1', status: 'pending' });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const withTenant = jest.fn(async (_t: string, work: (tx: unknown) => Promise<unknown>) => work({ ragDocument: { findFirst, create } }));
    const prisma = { ragDocument: { findFirst, create }, withTenant } as unknown as PrismaService;
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const queue = { enqueue } as IngestionQueue;
    return { svc: new IngestionService(prisma, queue), create, findFirst, enqueue, withTenant };
  }

  it('hash é determinístico', () => {
    expect(IngestionService.contentHash('abc')).toBe(IngestionService.contentHash('abc'));
    expect(IngestionService.contentHash('abc')).not.toBe(IngestionService.contentHash('abd'));
  });

  it('novo conteúdo cria doc e enfileira', async () => {
    const { svc, create, enqueue } = setup(null);
    const r = await svc.register(baseInput);
    expect(r.deduped).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('BUG-022: base de tenant grava sob withTenant e passa o tenant para a fila', async () => {
    const { svc, withTenant, enqueue } = setup(null);
    await svc.register(baseInput);
    expect(withTenant).toHaveBeenCalledWith(baseInput.tenantId, expect.any(Function));
    expect(enqueue).toHaveBeenCalledWith('doc-1', baseInput.content, baseInput.tenantId);
  });

  it('base compartilhada não usa contexto de tenant', async () => {
    const { svc, withTenant, enqueue } = setup(null);
    await svc.register({ ...baseInput, escopo: 'nicho', tenantId: null, nicho: 'medico' } as never);
    expect(withTenant).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith('doc-1', baseInput.content, null);
  });

  it('conteúdo repetido faz dedupe (não cria, não enfileira)', async () => {
    const { svc, create, enqueue } = setup({ id: 'doc-existente', status: 'published' });
    const r = await svc.register(baseInput);
    expect(r).toEqual({ id: 'doc-existente', status: 'published', deduped: true });
    expect(create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('mesmo conteúdo de documento que falhou volta para a fila', async () => {
    const { svc, create, enqueue } = setup({ id: 'doc-falhou', status: 'failed' });
    const r = await svc.register(baseInput);
    expect(r.deduped).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith('doc-falhou', baseInput.content, baseInput.tenantId);
  });

  it('rejeita escopo incoerente (tenant sem tenantId)', async () => {
    const { svc } = setup(null);
    await expect(svc.register({ ...baseInput, tenantId: null })).rejects.toThrow(/incoerente/);
  });
});

describe('IngestionProcessor (R1.3 processamento idempotente)', () => {
  const doc = { id: 'doc-1', tenantId: '111', escopo: 'tenant', nicho: 'medico', subespecialidade: null };

  function setup(embedImpl?: () => Promise<number[][]>, disponivel = true) {
    const execCalls: string[] = [];
    const metaCalls: unknown[][] = [];
    const update = jest.fn().mockResolvedValue(undefined);
    const tx = {
      ragDocument: { findUnique: jest.fn().mockResolvedValue(doc), update },
      $executeRawUnsafe: jest.fn(async (sql: string) => {
        execCalls.push(sql.trim().split(/\s+/).slice(0, 2).join(' ')); // "DELETE FROM" | "INSERT INTO"
        return 1;
      }),
      $executeRaw: jest.fn(async (...args: unknown[]) => {
        metaCalls.push(args);
        return 1;
      }),
    };
    const transaction = jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx));
    const withTenant = jest.fn(async (_t: string, cb: (t: unknown) => Promise<unknown>) => cb(tx));
    const prisma = { $transaction: transaction, withTenant } as unknown as PrismaService;
    const embeddings = {
      dims: 1024,
      available: disponivel,
      embed: jest.fn(embedImpl ?? (async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]))),
    } as unknown as EmbeddingsService;
    const proc = new IngestionProcessor(prisma, new ChunkingService(), embeddings);
    return { proc, update, execCalls, embeddings, transaction, withTenant, tx, metaCalls };
  }

  it('faz delete + N inserts (idempotente) e publica', async () => {
    const { proc, update, execCalls } = setup();
    const content = '# T\n\nParágrafo um.\n\nParágrafo dois.';
    const r = await proc.process('doc-1', content);
    expect(r.chunks).toBeGreaterThan(0);
    expect(execCalls.filter((s) => s.startsWith('DELETE')).length).toBe(1);
    expect(execCalls.filter((s) => s.startsWith('INSERT')).length).toBe(r.chunks);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'published' }) }));
  });

  it('BUG-022: documento de tenant é lido, gravado e publicado sob withTenant', async () => {
    const { proc, withTenant, transaction } = setup();
    await proc.process('doc-1', '# T\n\nUm.', '22222222-2222-2222-2222-222222222222');
    expect(withTenant).toHaveBeenCalled();
    expect(withTenant.mock.calls.every((c) => c[0] === '22222222-2222-2222-2222-222222222222')).toBe(true);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('reprocessar 2x mantém a contagem (delete antes de inserir)', async () => {
    const { proc } = setup();
    const content = '# T\n\nUm.\n\nDois.\n\nTrês.';
    const r1 = await proc.process('doc-1', content);
    const r2 = await proc.process('doc-1', content);
    expect(r2.chunks).toBe(r1.chunks);
  });

  it('falha de embedding marca o doc como failed e propaga', async () => {
    const { proc, update } = setup(async () => {
      throw new Error('voyage down');
    });
    await expect(proc.process('doc-1', '# T\n\ntexto')).rejects.toThrow('voyage down');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }));
  });

  it('sem chave de embedding: indexa só para busca lexical (vetor NULL) e marca para reindexar', async () => {
    const { proc, embeddings, tx, metaCalls, update } = setup(undefined, false);
    const r = await proc.process('doc-1', '# T\n\nParágrafo.');
    expect(r.chunks).toBeGreaterThan(0);
    expect(embeddings.embed).not.toHaveBeenCalled();
    const insert = (tx.$executeRawUnsafe.mock.calls as unknown[][]).find((c) => String(c[0]).includes('INSERT'))!;
    expect(insert[10]).toBeNull();
    expect(insert[11]).toBe('none');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'published' }) }));
    expect(JSON.stringify(metaCalls)).toContain('lexical');
  });
});
