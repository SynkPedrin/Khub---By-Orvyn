import { HttpException } from '@nestjs/common';
import { AdsSimulatorService, extrairJson, limparTexto, sugestaoProibida } from './ads-simulator.service';
import type { AIProvider } from '../ai/provider.contract';

const uso = { entrada: 10, saida: 20, cache: 0, custoUsd: 0 };
function montar(opts: { configurado?: boolean; respostas?: string[]; historico?: Record<string, number> | null } = {}) {
  const respostas = [...(opts.respostas ?? [])];
  const chamadas: unknown[] = [];
  const usos: unknown[] = [];
  const llm = {
    nome: 'ollama',
    configured: () => opts.configurado ?? true,
    missing: () => (opts.configurado === false ? ['OLLAMA_BASE_URL'] : []),
    modeloPara: () => 'qwen3.5:9b',
    generate: jest.fn(),
    toolCall: jest.fn(),
    conversar: jest.fn(async (input: unknown) => {
      chamadas.push(input);
      return { texto: respostas.shift() ?? '', toolCalls: [], pararPor: 'end_turn', uso, modelo: 'qwen3.5:9b', blocos: [] };
    }),
  } as unknown as AIProvider;
  const tx = {
    $queryRaw: jest.fn(async () => [opts.historico === null ? { impressoes: 0, cliques: 0, gasto: 0, leads: 0, conversoes: 0 } : (opts.historico ?? { impressoes: 0, cliques: 0, gasto: 0, leads: 0, conversoes: 0 })]),
    aiUsageEvent: { create: jest.fn(async (a: unknown) => { usos.push(a); return {}; }) },
  };
  const prisma = { withTenant: (_t: string, fn: (t: typeof tx) => unknown) => fn(tx) };
  return { svc: new AdsSimulatorService(prisma as never, llm), chamadas, usos };
}

const criativo = { nome: 'A', formato: 'imagem', hook: 'Você ainda sente dor ao sorrir?', copy: 'Agende hoje.', titulo: 'Avaliação', cta: 'enviar_mensagem' };
const simulacao = { objetivo: 'mensagens', orcamentoDia: 50, dias: 7, publico: 200000, posicionamento: 'automatico', ticketMedio: 300, taxaFechamento: 20, criativos: [criativo] };
const analiseOk = JSON.stringify({ notaVisual: 72, resumo: 'Bom hook.', pontosFortes: ['Fala com a dor'], melhorias: ['Mostre um rosto'], hooksAlternativos: ['Dor ao sorrir?'], copySugerida: 'Texto', riscosPolitica: [] });

describe('AdsSimulatorService', () => {
  it('simular: valida o corpo (400 com payload inválido)', async () => {
    const { svc } = montar();
    await expect(svc.simular('t1', { ...simulacao, orcamentoDia: 1 })).rejects.toThrow('Simulação inválida');
    await expect(svc.simular('t1', { ...simulacao, criativos: [] })).rejects.toThrow('Simulação inválida');
  });

  it('simular: sem histórico usa referência; com histórico calibra pela conta', async () => {
    const sem = await montar({ historico: null }).svc.simular('t1', simulacao);
    expect(sem.calibracao).toBeNull();
    expect(sem.base.fonte).toBe('referencia');
    const com = await montar({ historico: { impressoes: 400000, cliques: 9000, gasto: 12000, leads: 900, conversoes: 10 } }).svc.simular('t1', simulacao);
    expect(com.base.fonte).toBe('conta');
    expect(com.calibracao?.resultados).toBe(900);
  });

  it('analisar: sem provedor de IA → 501 config_required (nunca análise inventada)', async () => {
    const { svc } = montar({ configurado: false });
    const e = await svc.analisar('t1', { objetivo: 'mensagens', criativo }).catch((x) => x);
    expect(e).toBeInstanceOf(HttpException);
    expect((e as HttpException).getStatus()).toBe(501);
    expect((e as HttpException).getResponse()).toMatchObject({ status: 'config_required', missing: ['OLLAMA_BASE_URL'] });
  });

  it('analisar: manda imagem como bloco de visão, devolve análise e registra uso', async () => {
    const { svc, chamadas, usos } = montar({ respostas: ['```json\n' + analiseOk + '\n```'] });
    const img = { tipo: 'image/jpeg', base64: 'A'.repeat(200), rotulo: 'frame 0s' };
    const r = await svc.analisar('t1', { objetivo: 'mensagens', criativo, imagens: [img] });
    expect(r.notaVisual).toBe(72);
    expect(r.analisouImagem).toBe(true);
    const conteudo = (chamadas[0] as { mensagens: { content: { type: string }[] }[] }).mensagens[0].content;
    expect(conteudo[0].type).toBe('image');
    expect(JSON.stringify(conteudo)).toContain('<anuncio aviso=');
    expect(usos).toHaveLength(1);
  });

  it('analisar: sem imagem, nota visual é sempre null', async () => {
    const r = await montar({ respostas: [analiseOk] }).svc.analisar('t1', { objetivo: 'mensagens', criativo });
    expect(r.notaVisual).toBeNull();
  });

  it('analisar: resposta sem JSON duas vezes → 502 ia_invalida', async () => {
    const e = await montar({ respostas: ['não sei', 'nada'] }).svc.analisar('t1', { objetivo: 'mensagens', criativo }).catch((x) => x);
    expect((e as HttpException).getStatus()).toBe(502);
  });

  it('analisar: rejeita imagem que não é base64', async () => {
    const { svc } = montar({ respostas: [analiseOk] });
    await expect(svc.analisar('t1', { objetivo: 'mensagens', criativo, imagens: [{ tipo: 'image/jpeg', base64: '<script>'.repeat(30) }] })).rejects.toThrow('Análise inválida');
  });

  it('extrairJson tolera cerca de código e texto em volta', () => {
    expect(extrairJson('ok:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extrairJson('sem json')).toBeNull();
  });

  it('validador pós-resposta: tira sugestão de antes e depois, mantém aviso e troca travessão', async () => {
    expect(sugestaoProibida('Use uma foto de antes/depois do tratamento')).toBe(true);
    expect(sugestaoProibida('Evite antes e depois: a Meta reprova')).toBe(false);
    expect(limparTexto('Texto pequeno — aumente o contraste')).toBe('Texto pequeno, aumente o contraste');
    const bruto = JSON.stringify({ notaVisual: 50, resumo: 'Bom — mas fraco.', pontosFortes: [], melhorias: ['Mostre antes e depois da pele', 'Aumente o contraste'], hooksAlternativos: ['Pele firme sem cirurgia?'], copySugerida: 'Veja o antes e depois. Agende hoje.', riscosPolitica: ['Evite antes e depois em estética'] });
    const r = await montar({ respostas: [bruto] }).svc.analisar('t1', { objetivo: 'mensagens', criativo });
    expect(r.melhorias).toEqual(['Aumente o contraste']);
    expect(r.copySugerida).toBe('Agende hoje.');
    expect(r.riscosPolitica).toEqual(['Evite antes e depois em estética']);
    expect(r.resumo).toBe('Bom, mas fraco.');
  });
});

describe('Simulações salvas (db/067)', () => {
  function montarSalvas(linhas: unknown[] = []) {
    const tx = {
      $queryRaw: jest.fn(async () => linhas),
      $executeRaw: jest.fn(async () => 1),
      aiUsageEvent: { create: jest.fn(async () => ({})) },
    };
    const prisma = { withTenant: (_t: string, fn: (t: typeof tx) => unknown) => fn(tx) };
    const llm = { configured: () => false, missing: () => ['OLLAMA_BASE_URL'] } as unknown as AIProvider;
    return { svc: new AdsSimulatorService(prisma as never, llm), tx };
  }

  it('salvar: valida nome e entrada (400)', async () => {
    const { svc } = montarSalvas();
    await expect(svc.salvarSimulacao('t1', { nome: '', entrada: simulacao })).rejects.toThrow('Simulação inválida');
    await expect(svc.salvarSimulacao('t1', { nome: 'x'.repeat(121), entrada: simulacao })).rejects.toThrow('Simulação inválida');
    await expect(svc.salvarSimulacao('t1', { nome: 'Ok', entrada: { ...simulacao, criativos: [] } })).rejects.toThrow('Simulação inválida');
  });

  it('salvar: grava (upsert) e apara as mais antigas além do teto', async () => {
    const linha = { id: 's1', nome: 'Sim', entrada: simulacao, resumo: {}, salvoEm: new Date() };
    const { svc, tx } = montarSalvas([linha]);
    const r = await svc.salvarSimulacao('t1', { nome: 'Sim', entrada: simulacao, resumo: { resultados: 10 } });
    expect(r).toEqual(linha);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('remover: 404 quando a simulação não existe (ou é de outra subconta)', async () => {
    const { svc } = montarSalvas([]);
    await expect(svc.removerSimulacao('t1', 'b7f3f3f3-0000-4000-8000-000000000067')).rejects.toThrow('Simulação não encontrada');
  });

  it('listar: devolve as linhas da subconta (RLS filtra no banco)', async () => {
    const linhas = [{ id: 's1', nome: 'A', entrada: {}, resumo: {}, salvoEm: new Date() }];
    const { svc } = montarSalvas(linhas);
    await expect(svc.listarSalvas('t1')).resolves.toEqual(linhas);
  });
});
