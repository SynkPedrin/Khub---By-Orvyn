import { NicoInsightsService } from './insights.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { FinanceiroService } from '../financeiro/financeiro.service';
import type { NicoAnalisesService } from './analises.service';

const prismaCom = (naoRespondidas: number) => ({ withTenant: (_t: string, f: (t: unknown) => unknown) => f({ conversation: { count: async () => naoRespondidas } }) }) as unknown as PrismaService;
const fin = (o: { vencidas: number; vencidoCentavos: number }) => ({ resumo: async () => ({ recebidoCentavos: 100_000, aReceberCentavos: 50_000, total: 5, pagas: 2, ...o }) }) as unknown as FinanceiroService;
const analises = (campanhas: unknown, achados: string[]) => ({ analisarCampanhas: async () => campanhas, diagnosticarAutomacoes: async () => ({ achados }) }) as unknown as NicoAnalisesService;

describe('Insights proativos da NICO (sem LLM)', () => {
  it('junta alertas de campanha, cobrança, automação e conversa, com os graves primeiro', async () => {
    const s = new NicoInsightsService(
      prismaCom(3),
      analises({ campanhas: [{ campanha: 'Black Friday', alertas: ['CPL 80% acima da mediana'] }, { campanha: 'Ok', alertas: [] }] }, ['😴 "Boas-vindas" está ATIVA e não rodou']),
      fin({ vencidas: 2, vencidoCentavos: 420_000 }),
    );
    const r = await s.listar('t1');
    expect(r.map((i) => i.gravidade)).toEqual(['alta', 'alta', 'media', 'media']);
    expect(r.find((i) => i.id === 'financeiro-vencidas')?.titulo).toContain('R$');
    expect(r.every((i) => i.pergunta.length > 20)).toBe(true);
  });

  it('sem problema não inventa alerta ("vazio" de campanha e automações saudáveis)', async () => {
    const s = new NicoInsightsService(prismaCom(0), analises({ vazio: true, aviso: 'sem Meta' }, ['✅ Nenhum problema relevante']), fin({ vencidas: 0, vencidoCentavos: 0 }));
    expect(await s.listar('t2')).toEqual([]);
  });

  it('uma fonte quebrada não derruba as outras', async () => {
    const quebrada = { resumo: async () => { throw new Error('banco caiu'); } } as unknown as FinanceiroService;
    const s = new NicoInsightsService(prismaCom(1), analises({ vazio: true }, ['✅ ok']), quebrada);
    const r = await s.listar('t3');
    expect(r.map((i) => i.id)).toEqual(['conversas-paradas']);
  });

  it('cacheia por tenant (não recalcula a cada abertura da tela)', async () => {
    const analisar = jest.fn().mockResolvedValue({ vazio: true });
    const s = new NicoInsightsService(prismaCom(0), { analisarCampanhas: analisar, diagnosticarAutomacoes: async () => ({ achados: ['✅'] }) } as unknown as NicoAnalisesService, fin({ vencidas: 0, vencidoCentavos: 0 }));
    await s.listar('t4');
    await s.listar('t4');
    expect(analisar).toHaveBeenCalledTimes(1);
  });
});
