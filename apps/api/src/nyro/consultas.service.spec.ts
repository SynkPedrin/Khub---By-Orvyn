import { NicoConsultasService } from './consultas.service';
import type { PrismaService } from '../prisma/prisma.service';

/** Prisma falso: cada chamada de $queryRaw devolve, em ordem, a próxima resposta preparada. */
function servico(...respostas: unknown[][]) {
  const fila = [...respostas];
  const tx = { $queryRaw: jest.fn(async () => fila.shift() ?? []) };
  const prisma = { withTenant: async (_t: string, f: (t: typeof tx) => unknown) => f(tx) } as unknown as PrismaService;
  return { svc: new NicoConsultasService(prisma), tx };
}

describe('Consultas da NICO sobre a operação', () => {
  it('leadsSemResposta conta por etapa, ordena pelos mais antigos e não vaza telefone nem texto', async () => {
    const { svc } = servico([
      { nome: 'Ana', canal: 'WhatsApp', horas: 80.4, etapa: 'Sem Resposta', valor: 300 },
      { nome: 'Bia', canal: 'Instagram', horas: 30, etapa: 'Sem Resposta', valor: null },
      { nome: 'Caio', canal: 'WhatsApp', horas: 26, etapa: null, valor: null },
    ]);
    const r = await svc.leadsSemResposta('t1', 24);
    expect(r.total).toBe(3);
    expect(r.porEtapa[0]).toEqual({ etapa: 'Sem Resposta', qtd: 2 });
    expect(r.porEtapa.find((e) => e.etapa === 'Sem negócio aberto')?.qtd).toBe(1);
    expect(r.maisAntigos[0]).toEqual({ nome: 'Ana', canal: 'WhatsApp', etapa: 'Sem Resposta', horasSemResposta: 80, valor: 300 });
    expect(JSON.stringify(r)).not.toMatch(/telefone|email|corpo/i);
    expect(r.criterio).toContain('24h');
  });

  it('leadsSemResposta filtra por etapa sem depender de acento ou caixa', async () => {
    const { svc } = servico([
      { nome: 'Ana', canal: 'WhatsApp', horas: 50, etapa: 'Em Atendimento', valor: null },
      { nome: 'Bia', canal: 'WhatsApp', horas: 50, etapa: 'Novo Lead', valor: null },
    ]);
    expect((await svc.leadsSemResposta('t1', 24, 'em atendimento')).total).toBe(1);
  });

  it('leadsSemResposta limita as horas a um intervalo válido', async () => {
    const { svc, tx } = servico([], [], []);
    await svc.leadsSemResposta('t1', 999_999);
    await svc.leadsSemResposta('t1', -5);
    // chamada de template: [strings, valor0, valor1...]
    const horas = (tx.$queryRaw.mock.calls as unknown as unknown[][]).map((c) => c[1]);
    expect(horas).toEqual([720, 1]);
  });

  it('negocios devolve total e valor da MESMA seleção, arredondado, com dias parados inteiros', async () => {
    const { svc } = servico(
      [{ titulo: 'Corte + escova', contato: 'Ana', etapa: 'Em Atendimento', valor: 350.456, origem: 'Meta Ads', dias: 9.8 }],
      [{ n: 81, total: 28300.5 }],
    );
    const r = await svc.negocios('t1', { etapa: 'atendimento', status: 'aberto', paradosHaDias: 7, limite: 30 });
    expect(r).toMatchObject({ total: 81, valorTotal: 28300.5, mostrando: 1, filtro: { etapa: 'atendimento', status: 'aberto', paradosHaDias: 7 } });
    expect(r.negocios[0]).toEqual({ titulo: 'Corte + escova', contato: 'Ana', etapa: 'Em Atendimento', valor: 350.46, origem: 'Meta Ads', diasParado: 9 });
  });

  it('agendaPeriodo calcula % de faltas só sobre o que já aconteceu e soma o valor', async () => {
    const { svc } = servico(
      [{ status: 'concluido', n: 8, centavos: 120000 }, { status: 'faltou', n: 2, centavos: 0 }, { status: 'agendado', n: 5, centavos: 40000 }],
      [{ titulo: 'Corte', inicio: new Date('2026-11-14T13:00:00Z'), status: 'agendado', contato: 'Ana' }],
    );
    const r = await svc.agendaPeriodo('t1', '2026-11-09', '2026-11-15');
    expect(r.total).toBe(15);
    expect(r.faltasPercentual).toBe(20); // 2 de 10 atendimentos realizados
    expect(r.valorTotalCentavos).toBe(160000);
    expect(r.compromissos[0].inicio).toBe('2026-11-14T13:00:00.000Z');
  });

  it('agendaPeriodo recusa datas inválidas ou invertidas antes de ir ao banco', async () => {
    const { svc, tx } = servico();
    await expect(svc.agendaPeriodo('t1', '09/11/2026', '2026-11-15')).rejects.toThrow(/período inválido/);
    await expect(svc.agendaPeriodo('t1', '2026-11-15', '2026-11-09')).rejects.toThrow(/período inválido/);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('metricasAtendimento agrupa por canal e arredonda a mediana', async () => {
    const { svc } = servico(
      [{ com_entrada: 120, sem_resposta: 14, mediana_min: 12.34 }],
      [{ canal: 'WhatsApp', autor_tipo: 'contato', n: 300 }, { canal: 'WhatsApp', autor_tipo: 'ia', n: 200 }, { canal: 'WhatsApp', autor_tipo: 'humano', n: 50 }, { canal: 'Instagram', autor_tipo: 'contato', n: 40 }],
    );
    const r = await svc.metricasAtendimento('t1', 30);
    expect(r).toMatchObject({ conversasComMensagemRecebida: 120, semNenhumaResposta: 14, medianaAtePrimeiraRespostaMinutos: 12.3 });
    expect(r.porCanal).toEqual([{ canal: 'WhatsApp', recebidas: 300, enviadas: 250 }, { canal: 'Instagram', recebidas: 40, enviadas: 0 }]);
  });
});
