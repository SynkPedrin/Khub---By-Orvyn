import { ID_NOTIFICACAO, lidasDasPrefs, montarNotificacoes, registrarLida, MAX_LIDAS_INDIVIDUAIS, type Derivada } from './notificacoes';

const conv = (id: string, ts: string): Derivada => ({ id: `conv:${id}`, tipo: 'mensagem', titulo: 't', detalhe: 'd', url: `/inbox?c=${id}`, ts });
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';

describe('central de notificações (Q2.6)', () => {
  it('derivada é nova se mudou depois do "visto" e depois da leitura individual', () => {
    const r = montarNotificacoes(
      [conv(C1, '2026-11-10T10:00:00.000Z'), conv(C2, '2026-11-10T11:00:00.000Z')],
      [],
      new Date('2026-11-10T09:00:00Z'),
      { [`conv:${C1}`]: '2026-11-10T10:30:00.000Z' },
    );
    expect(r.items.map((i) => [i.id, i.novo])).toEqual([[`conv:${C2}`, true], [`conv:${C1}`, false]]);
    expect(r.naoLidas).toBe(1);
  });

  it('derivada lida volta a ser nova quando chega coisa depois da leitura', () => {
    const r = montarNotificacoes([conv(C1, '2026-11-10T12:00:00.000Z')], [], new Date(0), { [`conv:${C1}`]: '2026-11-10T10:30:00.000Z' });
    expect(r.items[0].novo).toBe(true);
  });

  it('persistida (@menção) usa lida_em e entra em ordem', () => {
    const r = montarNotificacoes(
      [conv(C1, '2026-11-10T10:00:00.000Z')],
      [
        { id: C2, titulo: 'Ana mencionou você', detalhe: 'olha isso', url: `/inbox?c=${C1}`, createdAt: new Date('2026-11-10T12:00:00Z'), lidaEm: null },
        { id: C1, titulo: 'antiga', detalhe: '', url: '/inbox', createdAt: new Date('2026-11-09T12:00:00Z'), lidaEm: new Date() },
      ],
      new Date('2026-11-10T11:00:00Z'),
      {},
    );
    expect(r.items.map((i) => i.id)).toEqual([`men:${C2}`, `conv:${C1}`, `men:${C1}`]);
    expect(r.items[0]).toMatchObject({ tipo: 'mencao', novo: true });
    expect(r.naoLidas).toBe(1);
  });

  it('prefs malformadas não quebram; leitura individual tem teto', () => {
    expect(lidasDasPrefs({ notifsLidas: ['x'] })).toEqual({});
    expect(lidasDasPrefs({ notifsLidas: { a: '2026', b: 3 } })).toEqual({ a: '2026' });
    let lidas: Record<string, string> = {};
    for (let i = 0; i < MAX_LIDAS_INDIVIDUAIS + 10; i++) lidas = registrarLida(lidas, `conv:${i}`, new Date(1_700_000_000_000 + i * 1000).toISOString());
    expect(Object.keys(lidas)).toHaveLength(MAX_LIDAS_INDIVIDUAIS);
    expect(lidas['conv:0']).toBeUndefined();
  });

  it('id aceito só nos três formatos', () => {
    expect(ID_NOTIFICACAO.test(`men:${C1}`)).toBe(true);
    expect(ID_NOTIFICACAO.test(`int:${C1}`)).toBe(true);
    expect(ID_NOTIFICACAO.test('men:1 OR 1=1')).toBe(false);
  });
});
