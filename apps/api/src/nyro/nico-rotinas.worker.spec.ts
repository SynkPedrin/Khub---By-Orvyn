import { NicoRotinasProcessor } from './nico-rotinas.worker';
import type { PrismaService } from '../prisma/prisma.service';
import type { NyroService } from './nyro.service';

const agora = new Date('2026-11-13T11:00:00Z');
const rotina = (extra: Record<string, unknown> = {}) => ({
  id: 'r1', titulo: 'Análise semanal', instrucao: 'analise as campanhas', frequencia: 'diaria', hora: '08:00', diaSemana: null, diaMes: null, fuso: 'America/Sao_Paulo',
  proximoEm: new Date(agora.getTime() - 60_000), destinatarioId: 'u1', criadoPor: 'u1', ...extra,
});

function montar(vencidas: ReturnType<typeof rotina>[], reservou = 1, executa = jest.fn().mockResolvedValue({ relatorioId: 'rel1' })) {
  const updateMany = jest.fn().mockResolvedValue({ count: reservou });
  const update = jest.fn().mockResolvedValue({});
  const tx = { nicoAgendamento: { findMany: jest.fn().mockResolvedValue(vencidas), updateMany, update } };
  const prisma = { withTenant: (_t: string, f: (t: typeof tx) => unknown) => f(tx), tenant: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaService;
  const nyro = { configurada: () => true, executarRotina: executa } as unknown as NyroService;
  const proc = new NicoRotinasProcessor(prisma, nyro);
  return { proc, updateMany, update, executa, rodar: () => (proc as unknown as { rodarVencidas: (t: string, a: Date) => Promise<void> }).rodarVencidas('t1', agora) };
}

describe('Rotinas da NICO (proatividade)', () => {
  it('roda a rotina vencida, avança o próximo horário e registra sucesso', async () => {
    const m = montar([rotina()]);
    await m.rodar();
    expect(m.executa).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1', tenantId: 't1', titulo: 'Análise semanal' }));
    const reserva = m.updateMany.mock.calls[0][0] as { data: { proximoEm: Date } };
    expect(reserva.data.proximoEm.getTime()).toBeGreaterThan(agora.getTime()); // próxima janela no futuro
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ultimoStatus: 'ok', ultimoErro: null }) }));
  });

  it('se outro worker já reservou, não executa (sem rodar em dobro)', async () => {
    const m = montar([rotina()], 0);
    await m.rodar();
    expect(m.executa).not.toHaveBeenCalled();
  });

  it('janela perdida há mais de 6h é pulada, não executada', async () => {
    const m = montar([rotina({ proximoEm: new Date(agora.getTime() - 7 * 3_600_000) })]);
    await m.rodar();
    expect(m.executa).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ultimoStatus: 'pulada' }) }));
  });

  it('falha na execução é registrada e não derruba as próximas rotinas', async () => {
    const executa = jest.fn().mockRejectedValueOnce(new Error('modelo fora do ar')).mockResolvedValueOnce({});
    const m = montar([rotina({ id: 'a' }), rotina({ id: 'b' })], 1, executa);
    await m.rodar();
    expect(executa).toHaveBeenCalledTimes(2);
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ultimoStatus: 'erro', ultimoErro: 'modelo fora do ar' }) }));
  });
});
