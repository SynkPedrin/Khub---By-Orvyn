import { escolherFunil, receitaMensal, resumirFunil, type EtapaRef, type NegocioRef } from './funil';

const F1 = { id: 'f1', nome: 'Funil de Vendas' };
const F2 = { id: 'f2', nome: 'Marketing Pipeline' };
const etapas: EtapaRef[] = [
  { id: 'a1', pipelineId: 'f1', nome: 'Captação', cor: '#000', ordem: 0 },
  { id: 'a2', pipelineId: 'f1', nome: 'Fechado', cor: '#000', ordem: 1 },
  { id: 'b1', pipelineId: 'f2', nome: 'Novo Lead', cor: '#000', ordem: 0 },
  { id: 'b2', pipelineId: 'f2', nome: 'Em Atendimento', cor: '#000', ordem: 1 },
  { id: 'b3', pipelineId: 'f2', nome: 'Serviço Finalizado', cor: '#000', ordem: 2 },
];
let seq = 0;
const neg = (pipelineId: string, stageId: string, status: string, valor = 100, atualizadoEm = new Date('2026-11-05T12:00:00Z')): NegocioRef => ({
  id: `d${++seq}`, pipelineId, stageId, status, valor, atualizadoEm,
});

describe('funil (dashboard e pipeline)', () => {
  it('escolhe o funil com mais negócios ABERTOS, não o primeiro', () => {
    const ns = [neg('f1', 'a1', 'ganho'), neg('f1', 'a1', 'ganho'), neg('f2', 'b1', 'aberto')];
    expect(escolherFunil([F1, F2], ns)?.id).toBe('f2');
  });

  it('respeita o funil pedido quando existe; ignora id desconhecido', () => {
    expect(escolherFunil([F1, F2], [], 'f2')?.id).toBe('f2');
    expect(escolherFunil([F1, F2], [], 'zzz')?.id).toBe('f1');
    expect(escolherFunil([], [])).toBeNull();
  });

  it('não mistura etapas de outro funil e não conta fechados como abertos', () => {
    const ns = [neg('f2', 'b1', 'aberto', 300), neg('f2', 'b2', 'ganho', 900), neg('f2', 'b1', 'perdido', 50), neg('f1', 'a1', 'aberto', 999)];
    const r = resumirFunil('f2', etapas, ns);
    expect(r.etapas.map((e) => e.nome)).toEqual(['Novo Lead', 'Em Atendimento', 'Serviço Finalizado']);
    expect(r.abertos).toBe(1);
    expect(r.valorAberto).toBe(300);
    expect(r.etapas[1].total).toBe(0); // o ganho na etapa 2 não aparece no quadro
  });

  it('conversão = ganhos / fechados quando há fechamentos', () => {
    const ns = [neg('f2', 'b1', 'ganho'), neg('f2', 'b1', 'ganho'), neg('f2', 'b1', 'perdido'), neg('f2', 'b1', 'aberto')];
    expect(resumirFunil('f2', etapas, ns)).toMatchObject({ conversao: 67, conversaoBase: 'fechados' });
  });

  it('sem fechamentos (base importada), usa a fatia na etapa final e declara a base', () => {
    const ns = [neg('f2', 'b3', 'aberto'), neg('f2', 'b1', 'aberto'), neg('f2', 'b2', 'aberto'), neg('f2', 'b2', 'aberto')];
    expect(resumirFunil('f2', etapas, ns)).toMatchObject({ conversao: 25, conversaoBase: 'etapa_final' });
    expect(resumirFunil('f1', etapas, [])).toMatchObject({ conversao: null, conversaoBase: null });
  });

  it('receita mensal: só ganhos, 6 meses com zeros, corte no fuso de São Paulo', () => {
    const agora = new Date('2026-11-08T12:00:00Z');
    const ns = [
      neg('f2', 'b1', 'ganho', 500, new Date('2026-11-02T12:00:00Z')),
      neg('f2', 'b1', 'ganho', 200, new Date('2026-09-10T12:00:00Z')),
      neg('f2', 'b1', 'perdido', 999, new Date('2026-09-10T12:00:00Z')),
      // 1º de outubro 01h UTC ainda é 30 de setembro em São Paulo
      neg('f2', 'b1', 'ganho', 50, new Date('2026-10-01T01:00:00Z')),
      neg('f2', 'b1', 'ganho', 777, new Date('2025-01-10T12:00:00Z')), // fora da janela
    ];
    const s = receitaMensal(ns, agora);
    expect(s.map((x) => x.mes)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(s.find((x) => x.mes === '2026-09')!.valor).toBe(250);
    expect(s.find((x) => x.mes === '2026-11')!.valor).toBe(500);
    expect(s.find((x) => x.mes === '2026-10')!.valor).toBe(0);
  });
});
