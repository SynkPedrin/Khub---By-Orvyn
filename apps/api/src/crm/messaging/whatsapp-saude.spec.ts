import { saudeDaInstancia, WhatsappSaudeService } from './whatsapp-saude.service';
import { StevoApiError, type StevoApiProvider } from './stevo-api.provider';
import type { PrismaService } from '../../prisma/prisma.service';

const T = 'c5b82d42-cd59-443e-bb3d-c0c8cbdad2a3';

describe('saudeDaInstancia', () => {
  it('pareada = conectado e saudável', () => {
    expect(saudeDaInstancia({ pareada: true })).toEqual({ status: 'connected', health: 'ok', erro: null });
  });
  it('sem login no WhatsApp = desconectado e alerta (health down)', () => {
    expect(saudeDaInstancia({ pareada: false })).toMatchObject({ status: 'disconnected', health: 'down' });
  });
  it('not_ready (instância parada na Stevo) = erro com instrução de reiniciar', () => {
    const s = saudeDaInstancia({ falha: { codigo: 'not_ready', retryable: false } });
    expect(s).toMatchObject({ status: 'error', health: 'down' });
    expect(s?.erro).toMatch(/painel da Stevo/);
  });
  it('instabilidade passageira não derruba o canal', () => {
    expect(saudeDaInstancia({ falha: { codigo: 'upstream_unavailable', retryable: true } })).toBeNull();
  });
});

function montar(conexao: () => Promise<{ connected: boolean; logged_in: boolean; phone_number: string | null }>, integ: Record<string, unknown> | null) {
  const update = jest.fn(async () => ({}));
  const tx = { integration: { findFirst: jest.fn(async () => integ), update } };
  const prisma = { withTenant: jest.fn(async (_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;
  const stevo = {
    configured: () => true,
    listarInstancias: async () => [{ id: 'inst-dra', external_ref: T }, { id: 'inst-solta', external_ref: null }],
    conexao: jest.fn(conexao),
  } as unknown as StevoApiProvider;
  return { svc: new WhatsappSaudeService(prisma, stevo), update, stevo };
}

describe('WhatsappSaudeService.verificarTodos', () => {
  it('instância parada que o KHUB achava conectada passa a erro/down (caso Dra. 25/11)', async () => {
    const { svc, update } = montar(async () => { throw new StevoApiError(502, 'not_ready', false, null); }, { id: 'i1', status: 'connected', health: 'ok', erro: null });
    const r = await svc.verificarTodos();
    expect(r).toEqual({ instancias: 2, mudancas: 1, falhas: 0 });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'i1' }, data: expect.objectContaining({ status: 'error', health: 'down' }) }));
  });
  it('reconectou: volta a conectado e conta como mudança', async () => {
    const { svc, update } = montar(async () => ({ connected: true, logged_in: true, phone_number: '55' }), { id: 'i1', status: 'error', health: 'down', erro: 'x' });
    expect((await svc.verificarTodos()).mudancas).toBe(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'connected', health: 'ok', erro: null }) }));
  });
  it('estado igual não é mudança (só atualiza o horário da verificação)', async () => {
    const { svc } = montar(async () => ({ connected: true, logged_in: true, phone_number: '55' }), { id: 'i1', status: 'connected', health: 'ok', erro: null });
    expect((await svc.verificarTodos()).mudancas).toBe(0);
  });
  it('instância sem vínculo no KHUB ou sem external_ref é ignorada', async () => {
    const { svc, update, stevo } = montar(async () => ({ connected: true, logged_in: true, phone_number: null }), null);
    expect((await svc.verificarTodos()).mudancas).toBe(0);
    expect(update).not.toHaveBeenCalled();
    expect((stevo.conexao as jest.Mock).mock.calls).toHaveLength(0);
  });
  it('Stevo instável (retryable) não grava nada', async () => {
    const { svc, update } = montar(async () => { throw new StevoApiError(503, 'upstream_unavailable', true, null); }, { id: 'i1', status: 'connected', health: 'ok', erro: null });
    await svc.verificarTodos();
    expect(update).not.toHaveBeenCalled();
  });
});
