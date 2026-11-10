import { ExecutorService, type Contexto } from './executor.service';
import { ConfigService } from '../config/config.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CrmService } from '../crm/crm.service';
import type { MessagesService } from '../crm/messaging/messages.service';
import type { TasksService } from '../crm/tasks.service';
import type { NotesService } from '../crm/notes.service';
import type { MailerService } from '../common/mailer.service';
import type { AiService } from '../ai/ai.service';
import type { Grafo, No } from './catalogo';

const TENANT = '11111111-1111-1111-1111-111111111111';
const CTX: Contexto = { contato: { id: 'c1', nome: 'Ana', email: null, telefone: '+5511999', empresa: null, tag: 'Lead', tags: [], valor: 0 } };
const GRAFO: Grafo = { nos: [], arestas: [] };

const vazio = <T,>() => ({} as T);
function executor() {
  const prisma = { withTenant: jest.fn(async (_t: string, w: (tx: unknown) => Promise<unknown>) => w({})) } as unknown as PrismaService;
  return new ExecutorService(prisma, new ConfigService(), vazio<CrmService>(), vazio<MessagesService>(), vazio<TasksService>(), vazio<NotesService>(), vazio<MailerService>(), vazio<AiService>());
}

const no: No = { id: 'espera', tipo: 'controle.esperar_resposta', posicao: { x: 0, y: 0 }, config: { duracao: 2, unidade: 'dias' } };

describe('Esperar resposta (E.2) — o nó que evita o follow-up burro', () => {
  it('1ª passada: marca a espera e reagenda o PRÓPRIO nó para o prazo', async () => {
    const r = await executor().executar(TENANT, no, CTX, GRAFO);
    expect(r.esperarMs).toBe(172_800_000); // 2 dias
    expect(r.mesmoNo).toBe(true);          // o mesmo nó acorda no timeout
    expect(r.contexto?.aguardandoResposta).toBe('espera');
    expect(r.ramo).toBeUndefined();        // ainda não decidiu caminho
  });

  it('acordou pelo prazo, sem resposta: ramo "timeout"', async () => {
    const ctx: Contexto = { ...CTX, aguardandoResposta: 'espera' };
    const r = await executor().executar(TENANT, no, ctx, GRAFO);
    expect(r.ramo).toBe('timeout');
    expect(r.contexto?.aguardandoResposta).toBeNull(); // limpa a marca
  });

  it('contato respondeu: ramo "resposta" — e NÃO manda o follow-up', async () => {
    const ctx: Contexto = { ...CTX, aguardandoResposta: 'espera', respondeu: true };
    const r = await executor().executar(TENANT, no, ctx, GRAFO);
    expect(r.ramo).toBe('resposta');
    // limpa as duas marcas: outro "esperar resposta" adiante não pode herdar
    expect(r.contexto?.respondeu).toBe(false);
    expect(r.contexto?.aguardandoResposta).toBeNull();
  });

  it('sem contato no contexto falha explícito (não fica esperando para sempre)', async () => {
    await expect(executor().executar(TENANT, no, {}, GRAFO)).rejects.toThrow(/sem contato/);
  });

  it('unidades: minutos, horas e dias', async () => {
    const casos: [string, number, number][] = [['minutos', 30, 1_800_000], ['horas', 3, 10_800_000], ['dias', 1, 86_400_000]];
    for (const [unidade, duracao, esperado] of casos) {
      const r = await executor().executar(TENANT, { ...no, config: { duracao, unidade } }, CTX, GRAFO);
      expect(r.esperarMs).toBe(esperado);
    }
  });
});
