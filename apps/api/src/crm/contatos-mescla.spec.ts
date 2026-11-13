import { agruparDuplicados, fundirContatos, type ContatoFundivel } from './contatos-mescla';
import { ContatosMesclaService } from './contatos-mescla.service';
import type { PrismaService } from '../prisma/prisma.service';

const base = (id: string, o: Partial<ContatoFundivel> = {}): ContatoFundivel => ({
  id, email: null, telefone: null, empresa: null, cargo: null, origem: null, localizacao: null, site: null, linkedin: null,
  companyId: null, ownerId: null, fotoUrl: null, fotoEm: null, tags: [], camposCustom: {}, consentimento: {}, valorEstimado: 0,
  optedOutAt: null, ultimoContatoAt: null, lastInboundAt: null, createdAt: new Date('2026-01-01T00:00:00Z'), ...o,
});

describe('agruparDuplicados (union-find)', () => {
  it('A~B por e-mail e B~C por telefone viram UM grupo', () => {
    const g = agruparDuplicados([
      { motivo: 'email', chave: 'ana@x.com', ids: ['a', 'b'] },
      { motivo: 'telefone', chave: '77771234', ids: ['b', 'c'] },
      { motivo: 'email', chave: 'zé@x.com', ids: ['d', 'e'] },
    ]);
    expect(g).toHaveLength(2);
    expect(g[0].ids.sort()).toEqual(['a', 'b', 'c']);
    expect(g[0].motivos).toEqual(['email', 'telefone']);
    expect(g[1]).toEqual({ ids: ['d', 'e'], motivos: ['email'] });
  });
});

describe('fundirContatos', () => {
  it('principal manda; vazios completados pelo duplicado mais antigo; tags somam', () => {
    const p = base('p', { email: 'p@x.com', tags: ['VIP'], camposCustom: { plano: 'ouro', cidade: '' } });
    const novo = base('n', { telefone: '5511900000002', empresa: 'Nova', tags: ['vip', 'b'], createdAt: new Date('2026-03-01Z'), camposCustom: { cidade: 'Rio' } });
    const velho = base('v', { email: 'outro@x.com', telefone: '5511900000001', tags: ['a'], createdAt: new Date('2026-02-01Z'), camposCustom: { cidade: 'SP', plano: 'prata' } });
    const f = fundirContatos(p, [novo, velho]);
    expect(f.email).toBe('p@x.com');
    expect(f.telefone).toBe('5511900000001'); // o mais antigo ganha
    expect(f.empresa).toBe('Nova');
    expect(f.tags).toEqual(['VIP', 'a', 'b']); // sem repetir "vip"
    expect(f.camposCustom).toEqual({ plano: 'ouro', cidade: 'SP' });
  });

  it('"não perturbe" de qualquer um vale para o principal; datas de contato pegam a mais recente', () => {
    const optou = new Date('2026-05-01Z');
    const f = fundirContatos(base('p', { ultimoContatoAt: new Date('2026-01-10Z') }), [base('d', { optedOutAt: optou, ultimoContatoAt: new Date('2026-06-01Z'), valorEstimado: 900 })]);
    expect(f.optedOutAt).toEqual(optou);
    expect(f.ultimoContatoAt).toEqual(new Date('2026-06-01Z'));
    expect(f.valorEstimado).toBe(900);
  });
});

describe('ContatosMesclaService.mesclar — validações antes do banco', () => {
  const svc = new ContatosMesclaService({ withTenant: jest.fn() } as unknown as PrismaService);
  const T = '11111111-1111-1111-1111-111111111111';
  it('recusa principal entre os duplicados, lista vazia e mais de 20', async () => {
    await expect(svc.mesclar(T, 'u', 'a', ['a'])).rejects.toThrow(/principal não pode/);
    await expect(svc.mesclar(T, 'u', 'a', [])).rejects.toThrow(/ao menos um/);
    await expect(svc.mesclar(T, 'u', 'a', Array.from({ length: 21 }, (_, i) => `d${i}`))).rejects.toThrow(/no máximo 20/);
  });

  it('SQL de mover respeita índice único (NOT EXISTS) e não interpola o id', () => {
    const sql = (svc as unknown as { sqlMover: (r: unknown, p: string, d: string) => { sql: string; values: unknown[] } }).sqlMover(
      { tabela: 'campaign_enrollments', coluna: 'contact_id', unicos: [['campaign_id']] }, 'P', 'D');
    expect(sql.sql).toContain('UPDATE "campaign_enrollments" AS alvo SET "contact_id"');
    expect(sql.sql).toContain('NOT EXISTS');
    expect(sql.sql).toContain('x."campaign_id" IS NOT DISTINCT FROM alvo."campaign_id"');
    expect(sql.sql).not.toContain("'P'");
    expect(sql.values).toEqual(['P', 'D', 'P']);
  });
});
