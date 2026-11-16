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
    integration: { findFirst: jest.fn(async () => null) },
  };
  const prisma = { withTenant: (_t: string, fn: (t: typeof tx) => unknown) => fn(tx) };
  const crypto = { decryptJson: jest.fn(() => ({ accessToken: 'tok' })) };
  const graph = { get: jest.fn(async () => ({ data: [] })) };
  const redesConexao = { contas: jest.fn(async (): Promise<unknown[]> => []), ativa: jest.fn() };
  const redesHttp = { metaGet: jest.fn() };
  const svc = new AdsSimulatorService(prisma as never, llm, crypto as never, graph as never, redesConexao as never, redesHttp as never);
  return { svc, chamadas, usos, tx, crypto, graph, redesConexao, redesHttp };
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
    const vazio = {} as never;
    return { svc: new AdsSimulatorService(prisma as never, llm, vazio, vazio, vazio, vazio), tx };
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

describe('Leads qualificados (taxaQualificacao)', () => {
  it('sem taxa, todos os resultados contam (comportamento anterior); com taxa, qualificados e vendas caem na proporção', async () => {
    const sem = await montar().svc.simular('t1', simulacao);
    expect(sem.total.leadsQualificados!.p50).toBeCloseTo(sem.total.resultados.p50, 6);
    const com = await montar().svc.simular('t1', { ...simulacao, taxaQualificacao: 50 });
    expect(com.total.leadsQualificados!.p50).toBeCloseTo(com.total.resultados.p50 / 2, 6);
    expect(com.total.vendas).toBeCloseTo(com.total.resultados.p50 * 0.5 * (simulacao.taxaFechamento / 100), 6);
    expect(com.total.custoPorLeadQualificado!.p50).toBeCloseTo(com.total.custoPorResultado.p50 * 2, 6);
    expect(com.criativos[0].leadsQualificados!.p50).toBeCloseTo(com.criativos[0].resultados.p50 / 2, 6);
  });

  it('objetivo sem intenção (engajamento) não tem lead qualificado', async () => {
    const r = await montar().svc.simular('t1', { ...simulacao, objetivo: 'engajamento' });
    expect(r.total.leadsQualificados).toBeNull();
    expect(r.total.custoPorLeadQualificado).toBeNull();
    expect(r.criativos[0].leadsQualificados).toBeNull();
  });
});

describe('Posts do Instagram para o simulador', () => {
  const midia = { id: 'm1', caption: 'Você ainda sente dor ao sorrir?\nAgende.', media_type: 'VIDEO', media_product_type: 'REELS', thumbnail_url: 'https://img/m1.jpg', permalink: 'https://ig/p/m1', timestamp: '2026-11-01T10:00:00Z', like_count: 120, comments_count: 14 };
  const insight = (name: string, value: number) => ({ name, total_value: { value } });

  it('sem conta conectada, avisa para conectar (nunca post inventado)', async () => {
    const { svc } = montar();
    const r = await svc.postsInstagram('t1');
    expect(r.conectado).toBe(false);
    expect(r.posts).toEqual([]);
    expect(r.status.status).toBe('sem_dados');
  });

  it('com conta, devolve posts com métricas reais de insights', async () => {
    const { svc, redesConexao, redesHttp } = montar();
    redesConexao.contas.mockResolvedValue([{ id: 'c1', nome: '@clinica', status: 'conectado' }]);
    redesConexao.ativa.mockResolvedValue({ id: 'c1', externalId: 'ig1', token: 'tok' });
    redesHttp.metaGet
      .mockResolvedValueOnce({ data: [midia] })
      .mockResolvedValueOnce({ data: [insight('reach', 3000), insight('likes', 130), insight('comments', 14), insight('shares', 9), insight('saved', 22), insight('total_interactions', 175)] });
    const r = await svc.postsInstagram('t1');
    expect(r.conectado).toBe(true);
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0].tipo).toBe('reels');
    expect(r.posts[0].legenda).toContain('dor ao sorrir');
    expect(r.posts[0].metricas.curtidas).toBe(130);
    expect(r.posts[0].metricas.alcance).toBe(3000);
    expect(r.posts[0].metricas.engajamento).toBeCloseTo(5.83, 2);
  });
});

describe('Biblioteca de anúncios (ads_archive)', () => {
  it('pesquisa curta demais → 400', async () => {
    const { svc } = montar();
    await expect(svc.biblioteca('t1', 'a')).rejects.toThrow('pelo menos 2 letras');
  });

  it('sem integração Meta, explica o que falta', async () => {
    const { svc } = montar();
    const r = await svc.biblioteca('t1', 'clínica estética');
    expect(r.anuncios).toEqual([]);
    expect(r.status.mensagem).toContain('Conecte a conta Meta');
  });

  it('com integração, mapeia os anúncios e passa o token da subconta', async () => {
    const { svc, tx, graph } = montar();
    (tx.integration.findFirst as jest.Mock).mockResolvedValue({ credentialsEncrypted: 'enc' });
    (graph.get as jest.Mock).mockResolvedValue({
      data: [{ id: '1', page_name: 'Concorrente', ad_delivery_start_time: '2026-10-01', ad_creative_bodies: ['Agende sua avaliação'], ad_creative_link_titles: ['Clínica X'], ad_snapshot_url: 'https://fb/ads/1', publisher_platforms: ['instagram', 'facebook'] }],
    });
    const r = await svc.biblioteca('t1', 'estética', 'BR');
    expect(r.status.status).toBe('ok');
    expect(r.anuncios).toHaveLength(1);
    expect(r.anuncios[0].pagina).toBe('Concorrente');
    expect(r.anuncios[0].plataformas).toEqual(['instagram', 'facebook']);
    expect((graph.get as jest.Mock).mock.calls[0][2]).toBe('tok');
    expect(String((graph.get as jest.Mock).mock.calls[0][1].ad_reached_countries)).toContain('BR');
  });

  it('erro da Meta vira status legível, não exceção', async () => {
    const { svc, tx, graph } = montar();
    (tx.integration.findFirst as jest.Mock).mockResolvedValue({ credentialsEncrypted: 'enc' });
    (graph.get as jest.Mock).mockRejectedValue(new Error('Meta Graph 400: (#10) permissão'));
    const r = await svc.biblioteca('t1', 'estética');
    expect(r.status.status).toBe('erro');
    expect(r.status.mensagem).toContain('Meta');
  });
});

describe('Relatório final da simulação', () => {
  const relatorioOk = JSON.stringify({
    veredicto: 'Vale rodar depois de reescrever o hook.',
    notaGeral: 68,
    resumo: 'Projeção de 40 a 90 conversas na faixa provável.',
    pontosFortes: ['Verba suficiente para sair do aprendizado'],
    riscos: ['Frequência passa de 3 na segunda semana'],
    melhorias: ['Troque o hook por uma pergunta direta'],
    proximosPassos: ['Meça o custo por conversa nos 3 primeiros dias'],
  });

  it('sem IA configurada → 501 config_required', async () => {
    const { svc } = montar({ configurado: false });
    const e = await svc.relatorio('t1', { entrada: simulacao }).catch((x) => x);
    expect((e as HttpException).getStatus()).toBe(501);
  });

  it('com IA, devolve o relatório e manda os números da simulação no prompt', async () => {
    const { svc, chamadas } = montar({ respostas: [relatorioOk] });
    const r = await svc.relatorio('t1', {
      nome: 'Captação novembro',
      negocio: 'Clínica odontológica',
      entrada: { ...simulacao, taxaQualificacao: 60 },
      posts: [{ tipo: 'reels', engajamento: 5.8, curtidas: 130, comentarios: 14, compartilhamentos: 9, salvamentos: 22, alcance: 3000 }],
      biblioteca: [{ pagina: 'Concorrente', texto: 'Agende sua avaliação', plataformas: ['instagram'] }],
    });
    expect(r.veredicto).toContain('Vale rodar');
    expect(r.notaGeral).toBe(68);
    const prompt = JSON.stringify(chamadas[0]);
    expect(prompt).toContain('Leads qualificados');
    expect(prompt).toContain('engajamento 5.8%');
    expect(prompt).toContain('Concorrente');
    expect(prompt).toContain('Captação novembro');
  });

  it('resposta inválida duas vezes → 502', async () => {
    const e = await montar({ respostas: ['x', 'y'] }).svc.relatorio('t1', { entrada: simulacao }).catch((x) => x);
    expect((e as HttpException).getStatus()).toBe(502);
  });
});
