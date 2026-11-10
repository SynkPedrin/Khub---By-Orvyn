import { acharContatoPorTelefone, soDigitos } from './telefone';
import type { Prisma } from '@prisma/client';

/**
 * Simula o Postgres: aplica o mesmo `right(regexp_replace(...), 8)` da query
 * sobre uma tabela em memória. Se o SQL e este fake divergirem, o teste E2E
 * pega — foi assim que o BUG-012 apareceu.
 */
function fakeTx(contatos: { id: string; telefone: string | null }[]): Prisma.TransactionClient {
  return {
    $queryRaw: jest.fn(async (_strings: TemplateStringsArray, ...params: unknown[]) => {
      const cauda = params[1] as string; // (CAUDA, cauda)
      return contatos
        .filter((c) => c.telefone && (c.telefone.replace(/\D/g, '').slice(-8) === cauda))
        .map((c) => ({ id: c.id }))
        .slice(0, 1);
    }),
  } as unknown as Prisma.TransactionClient;
}

describe('acharContatoPorTelefone (BUG-012 — o contato duplicado do inbox)', () => {
  it('soDigitos tira máscara, DDI e traço', () => {
    expect(soDigitos('+55 11 97777-1234')).toBe('5511977771234');
    expect(soDigitos('(11) 97777-1234')).toBe('11977771234');
    expect(soDigitos(null)).toBe('');
  });

  /**
   * O caso exato que quebrou: o WhatsApp manda "5511977771234" (dígitos crus) e
   * o banco tem "+55 11 97777-1234". O código antigo fazia
   * `contains('77771234')` contra a string formatada — o traço no meio ("97777-1234")
   * impedia o match e um contato NOVO era criado a cada resposta.
   */
  it('acha o contato salvo COM máscara a partir do número cru do WhatsApp', async () => {
    const tx = fakeTx([{ id: 'c1', telefone: '+55 11 97777-1234' }]);
    expect(await acharContatoPorTelefone(tx, '5511977771234')).toBe('c1');
  });

  it('acha nos dois sentidos: salvo cru, recebido com máscara', async () => {
    const tx = fakeTx([{ id: 'c1', telefone: '5511977771234' }]);
    expect(await acharContatoPorTelefone(tx, '+55 (11) 97777-1234')).toBe('c1');
  });

  it('mesma pessoa em formatos diferentes = um contato só', async () => {
    const tx = fakeTx([{ id: 'c1', telefone: '+55 11 97777-1234' }]);
    for (const formato of ['5511977771234', '011977771234', '11977771234', '97777-1234', '+55 11 97777 1234']) {
      expect(await acharContatoPorTelefone(tx, formato)).toBe('c1');
    }
  });

  it('números diferentes não colidem', async () => {
    const tx = fakeTx([{ id: 'c1', telefone: '+55 11 97777-1234' }]);
    expect(await acharContatoPorTelefone(tx, '+55 11 98888-5678')).toBeNull();
  });

  it('número curto demais não busca (evitaria falso positivo)', async () => {
    const tx = fakeTx([{ id: 'c1', telefone: '+55 11 97777-1234' }]);
    expect(await acharContatoPorTelefone(tx, '1234')).toBeNull();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('contato sem telefone é ignorado', async () => {
    const tx = fakeTx([{ id: 'c1', telefone: null }]);
    expect(await acharContatoPorTelefone(tx, '5511977771234')).toBeNull();
  });
});
