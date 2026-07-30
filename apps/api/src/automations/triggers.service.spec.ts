import { TriggersService } from './triggers.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RunsService } from './runs.service';

// filtroBate é a lógica pura de "este evento casa com o filtro do gatilho?".
// Testável isolada, sem fila nem banco.
const svc = new TriggersService({} as PrismaService, {} as RunsService);
const bate = (tipo: string, config: Record<string, unknown>, dados: Record<string, unknown>): boolean =>
  (svc as unknown as { filtroBate: (g: unknown, j: unknown, c: unknown) => boolean }).filtroBate(
    { id: 'g', tipo, posicao: { x: 0, y: 0 }, config },
    { tenantId: 't', evento: 'x', dados, dedupeKey: 'd' },
    {},
  );

describe('TriggersService.filtroBate', () => {
  it('negócio ganho/perdido: vazio casa qualquer; configurado casa só o igual', () => {
    expect(bate('gatilho.negocio_status', {}, { status: 'ganho' })).toBe(true);
    expect(bate('gatilho.negocio_status', {}, { status: 'perdido' })).toBe(true);
    expect(bate('gatilho.negocio_status', { status: 'ganho' }, { status: 'ganho' })).toBe(true);
    expect(bate('gatilho.negocio_status', { status: 'ganho' }, { status: 'perdido' })).toBe(false);
  });

  it('mudou de etapa: vazio = qualquer etapa; configurado casa a etapa certa', () => {
    expect(bate('gatilho.etapa_mudou', {}, { stageId: 's1' })).toBe(true);
    expect(bate('gatilho.etapa_mudou', { stageId: 's1' }, { stageId: 's1' })).toBe(true);
    expect(bate('gatilho.etapa_mudou', { stageId: 's1' }, { stageId: 's2' })).toBe(false);
  });

  it('tag adicionada: casa ignorando maiúscula/minúscula', () => {
    expect(bate('gatilho.tag_adicionada', { tag: 'VIP' }, { tag: 'vip' })).toBe(true);
    expect(bate('gatilho.tag_adicionada', { tag: 'VIP' }, { tag: 'lead' })).toBe(false);
  });

  it('mensagem recebida: filtra por texto contido', () => {
    expect(bate('gatilho.mensagem_recebida', { contem: 'preço' }, { texto: 'qual o PREÇO?' })).toBe(true);
    expect(bate('gatilho.mensagem_recebida', { contem: 'preço' }, { texto: 'bom dia' })).toBe(false);
  });
});
