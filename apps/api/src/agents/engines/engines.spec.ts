import { configPadrao, mesclarConfig, resolverConfig, descreverPersonalidade, type ConfigFragmentacao } from '../config/agent-config';
import { atrasoDigitacao, contarEmojis, fragmentarMensagem, quebrarFraseLonga, segmentarFrases } from './message-chunker';
import { analisarHeuristica, sanearAnalise, intencoesValidas } from './analysis';
import { avaliarRegras, separarAcoes, type ContextoRegras } from './rules-engine';
import { decidirExtracao } from './profile-policy';
import { escolherEstrategia, horarioDaTentativa, motivoParada, partesLocais, proximoHorarioPermitido } from './followup-policy';
import { validarNaturalidade } from './response-validator';
import { checarCenario, compararAvaliacoes, notaCenario, type ResultadoCenario } from './evaluation-scoring';

const frag = (o: Partial<ConfigFragmentacao> = {}): ConfigFragmentacao => ({ ...configPadrao().comunicacao.fragmentacao, ...o });

describe('Message Chunking Engine', () => {
  it('lista fica em um bloco, com quebra de linha, junto da introdução', () => {
    const r = fragmentarMensagem('Os valores são:\n- Design de sobrancelha: R$ 38,50\n- Design com henna: R$ 49,50\n\nQuer agendar?', frag());
    expect(r.blocos.map((b) => b.texto)).toEqual(['Os valores são:\n• Design de sobrancelha: R$ 38,50\n• Design com henna: R$ 49,50', 'Quer agendar?']);
  });
  it('fragmenta o exemplo da especificação em saudação / informação / pergunta', () => {
    const r = fragmentarMensagem(
      'Olá, Ana! Tudo bem? Vi que você demonstrou interesse no nosso tratamento. Gostaria de entender melhor o que está procurando para conseguir te orientar da melhor maneira. Me conta, o que você está procurando exatamente?',
      frag(),
    );
    expect(r.blocos.map((b) => b.texto)).toEqual([
      'Olá, Ana! Tudo bem?',
      'Vi que você demonstrou interesse no nosso tratamento.',
      'Gostaria de entender melhor o que está procurando para conseguir te orientar da melhor maneira.',
      'Me conta, o que você está procurando exatamente?',
    ]);
    expect(r.blocos.map((b) => b.ordem)).toEqual([1, 2, 3, 4]);
  });

  it('respeita parágrafos do modelo como fronteira semântica', () => {
    const r = fragmentarMensagem('Oi, João!\n\nO valor da avaliação é R$ 250,00 e inclui o retorno.\n\nQuer que eu veja um horário?', frag());
    expect(r.estrategia).toBe('semantica');
    expect(r.blocos.map((b) => b.texto)).toEqual(['Oi, João!', 'O valor da avaliação é R$ 250,00 e inclui o retorno.', 'Quer que eu veja um horário?']);
  });

  it('não quebra em abreviação, número decimal, URL nem e-mail', () => {
    expect(segmentarFrases('A Dra. Paula atende às 14h. O valor é R$ 1.500,00 à vista. Veja em site.com.br/precos ou escreva para ola@clinica.com.br. Obrigada!')).toEqual([
      'A Dra. Paula atende às 14h.',
      'O valor é R$ 1.500,00 à vista.',
      'Veja em site.com.br/precos ou escreva para ola@clinica.com.br.',
      'Obrigada!',
    ]);
  });

  it('nunca ultrapassa o limite de caracteres por bloco quando há espaço em maxBlocos', () => {
    const longo = 'Nosso protocolo tem três etapas, começando por uma avaliação completa do couro cabeludo, seguida de um plano personalizado de tratamento, e terminando com o acompanhamento mensal dos resultados, sempre com a mesma especialista.';
    const r = fragmentarMensagem(longo, frag({ maxCaracteresBloco: 90, maxBlocos: 6 }));
    expect(r.blocos.length).toBeGreaterThan(1);
    for (const b of r.blocos) expect(b.texto.length).toBeLessThanOrEqual(90);
    expect(r.blocos.map((b) => b.texto).join(' ')).toBe(longo);
  });

  it('quebrarFraseLonga nunca corta palavra', () => {
    const partes = quebrarFraseLonga('palavra '.repeat(40).trim(), 50, 100);
    for (const p of partes) {
      expect(p.length).toBeLessThanOrEqual(50);
      expect(p.split(' ').every((w) => w === 'palavra')).toBe(true);
    }
  });

  it('limita emojis por bloco', () => {
    const r = fragmentarMensagem('Que ótimo! 😀🎉🔥 Vamos marcar? 🙌🙌', frag({ maxEmojisBloco: 1 }));
    for (const b of r.blocos) expect(contarEmojis(b.texto)).toBeLessThanOrEqual(1);
    expect(r.ajustes.join(' ')).toMatch(/emoji/);
  });

  it('respeita o máximo de blocos fundindo os menores', () => {
    const r = fragmentarMensagem('Oi! Tudo bem? Uma. Duas. Três. Quatro. Cinco? Seis.', frag({ maxBlocos: 2, preferirCurtas: true }));
    expect(r.blocos.length).toBeLessThanOrEqual(2);
  });

  it('respeita o mínimo de blocos sem dividir frase única', () => {
    expect(fragmentarMensagem('Primeira frase aqui. Segunda frase aqui.', frag({ minBlocos: 2, preferirCurtas: false, tamanhoMedio: 400 })).blocos).toHaveLength(2);
    expect(fragmentarMensagem('Só uma frase.', frag({ minBlocos: 3 })).blocos).toHaveLength(1);
  });

  it('desativado envia bloco único', () => {
    const r = fragmentarMensagem('Oi! Tudo bem? Isso é um teste.', frag({ ativo: false }));
    expect(r.estrategia).toBe('unica');
    expect(r.blocos).toHaveLength(1);
  });

  it('remove markdown que o WhatsApp mostraria cru', () => {
    const r = fragmentarMensagem('## Preços\n\n**Avaliação**: R$ 200.', frag());
    expect(r.blocos.map((b) => b.texto).join(' ')).not.toMatch(/[#*]{2}/);
  });

  it('atraso de digitação fica dentro da faixa', () => {
    const cfg = frag({ intervaloMinMs: 1000, intervaloMaxMs: 3000, digitacaoCps: 20 });
    expect(atrasoDigitacao('oi', cfg)).toBe(1000);
    expect(atrasoDigitacao('x'.repeat(500), cfg)).toBe(3000);
    expect(atrasoDigitacao('x'.repeat(40), cfg)).toBe(2000);
  });

  it('pontuação leve tira o ponto final mas preserva ? e !', () => {
    const r = fragmentarMensagem('Perfeito.\n\nVamos agendar?', frag({ pontuacao: 'leve' }));
    expect(r.blocos.map((b) => b.texto)).toEqual(['Perfeito', 'Vamos agendar?']);
  });
});

describe('Configuração do agente', () => {
  it('config vazia vira os padrões completos', () => {
    const { config, avisos } = resolverConfig({});
    expect(avisos).toEqual([]);
    expect(config.comunicacao.fragmentacao.maxBlocos).toBe(4);
    expect(config.personalidade.empatia).toBe(70);
  });
  it('seção inválida cai no padrão sem derrubar as outras', () => {
    const { config, avisos } = resolverConfig({ personalidade: { empatia: 999 }, identidade: { cargo: 'Consultora' } });
    expect(avisos.length).toBeGreaterThan(0);
    expect(config.personalidade.empatia).toBe(70);
    expect(config.identidade.cargo).toBe('Consultora');
  });
  it('mesclar mantém seções omitidas e valida o resultado', () => {
    const base = configPadrao();
    const m = mesclarConfig(base, { identidade: { cargo: 'SDR' } });
    expect(m.identidade.cargo).toBe('SDR');
    expect(m.identidade.idioma).toBe('pt-BR');
    expect(() => mesclarConfig(base, { comunicacao: { fragmentacao: { minBlocos: 5, maxBlocos: 2 } } })).toThrow();
  });
  it('personalidade vira descritores', () => {
    const formal = descreverPersonalidade({ ...configPadrao().personalidade, formalidade: 90 })[0];
    expect(formal).toMatch(/polida/);
    // "o senhor/a senhora" é do TOM formal; com tom cordial ele brigava com "trate pelo primeiro nome".
    expect(formal).not.toMatch(/senhor/);
  });
});

describe('Classificador determinístico', () => {
  it.each([
    ['quanto custa o tratamento?', 'orcamento'],
    ['quero falar com um atendente', 'solicitacao_humana'],
    ['quero cancelar minha assinatura', 'cancelamento'],
    ['tem horario amanha para consulta?', 'agendamento'],
    ['bom dia', 'saudacao'],
    ['isso é um absurdo, péssimo atendimento', 'reclamacao'],
  ])('"%s" → %s', (msg, esperado) => {
    expect(analisarHeuristica(msg).intencao).toBe(esperado);
  });
  it('identifica objeção de preço e adiamento', () => {
    const a = analisarHeuristica('achei muito caro, vou pensar');
    expect(a.objecoes).toEqual(expect.arrayContaining(['preco', 'adiamento']));
  });
  it('extrai e-mail e nome DECLARADOS', () => {
    const a = analisarHeuristica('Meu nome é Ana Souza e meu email é ANA@exemplo.com');
    expect(a.extracoes).toEqual(expect.arrayContaining([
      expect.objectContaining({ campo: 'email', valor: 'ana@exemplo.com', origem: 'declarado' }),
      expect.objectContaining({ campo: 'nome', valor: 'Ana Souza', origem: 'declarado' }),
    ]));
  });
  it('urgência alta', () => {
    expect(analisarHeuristica('preciso urgente, estou com muita dor').urgencia).toBe('alta');
  });
  it('categoria personalizada por exemplo', () => {
    expect(analisarHeuristica('quero revender seus produtos', [{ chave: 'revenda', exemplos: ['revender'] }]).intencao).toBe('revenda');
  });
  it('saneamento descarta intenção desconhecida', () => {
    const a = sanearAnalise({ ...analisarHeuristica('oi'), intencao: 'inventada' }, intencoesValidas([]));
    expect(a.intencao).toBe('duvida');
  });
});

describe('Motor de regras', () => {
  const ctx = (o: Partial<ContextoRegras['analise']> = {}, mensagem = ''): ContextoRegras => ({
    analise: { intencao: 'compra', intencoesSecundarias: [], objecoes: [], sentimento: 'neutro', urgencia: 'baixa', temperatura: 'quente', interesse: 'serviço de implante', ...o },
    mensagem,
    etapa: null,
    perfil: { orcamento: 'R$ 5 mil' },
    jaDisparadas: new Set(['r-uma']),
  });
  it('SE intenção = compra E interesse contém serviço ENTÃO instrução', () => {
    const d = avaliarRegras([{ id: 'r1', nome: 'qualificar', ativo: true, logica: 'e', umaVezPorConversa: false, condicoes: [{ campo: 'intencao', operador: 'igual', valor: 'compra' }, { campo: 'interesse', operador: 'contem', valor: 'serviço' }], acoes: [{ tipo: 'instrucao', valor: 'inicie a qualificação comercial' }] }], ctx());
    expect(separarAcoes(d).instrucoes).toEqual(['inicie a qualificação comercial']);
  });
  it('lógica OU, palavra-chave com alternativas e perfil', () => {
    const regras = [{ id: 'r2', nome: 'preço', ativo: true, logica: 'ou' as const, umaVezPorConversa: false, condicoes: [{ campo: 'objecao' as const, operador: 'igual' as const, valor: 'preco' }, { campo: 'palavra_chave' as const, operador: 'contem' as const, valor: 'desconto|promoção' }], acoes: [{ tipo: 'adicionar_tag' as const, valor: 'objecao-preco' }] }];
    expect(avaliarRegras(regras, ctx({}, 'tem PROMOÇÃO?'))).toHaveLength(1);
    expect(avaliarRegras(regras, ctx({}, 'ok'))).toHaveLength(0);
    expect(avaliarRegras([{ ...regras[0], id: 'r3', condicoes: [{ campo: 'perfil', chave: 'orcamento', operador: 'existe', valor: '' }] }], ctx())).toHaveLength(1);
  });
  it('umaVezPorConversa e regra inativa não disparam', () => {
    const base = { nome: 'x', logica: 'e' as const, condicoes: [{ campo: 'intencao' as const, operador: 'existe' as const, valor: '' }], acoes: [{ tipo: 'silenciar' as const, valor: '' }] };
    expect(avaliarRegras([{ ...base, id: 'r-uma', ativo: true, umaVezPorConversa: true }, { ...base, id: 'off', ativo: false, umaVezPorConversa: false }], ctx())).toHaveLength(0);
  });
});

describe('Política do perfil', () => {
  const pol = { camposAutomaticos: ['email', 'objecoes', 'temperatura'], limiarConfianca: 0.6 };
  it('inferência não sobrescreve confirmado', () => {
    expect(decidirExtracao({ campo: 'temperatura', valor: 'fria', origem: 'inferido', confianca: 0.9 }, { valor: 'quente', origem: 'humano', confianca: 1, status: 'confirmado' }, pol).decisao).toBe('ignorado_confirmado');
  });
  it('declarado de alta confiança nasce confirmado', () => {
    const r = decidirExtracao({ campo: 'email', valor: 'a@b.com', origem: 'declarado', confianca: 0.95 }, null, pol);
    expect(r).toMatchObject({ decisao: 'aplicado', statusFinal: 'confirmado' });
  });
  it('campo fora dos automáticos fica pendente', () => {
    expect(decidirExtracao({ campo: 'orcamento', valor: 'R$ 3 mil', origem: 'declarado', confianca: 0.9 }, null, pol).decisao).toBe('pendente_revisao');
  });
  it('inferência abaixo do limiar é ignorada', () => {
    expect(decidirExtracao({ campo: 'temperatura', valor: 'morna', origem: 'inferido', confianca: 0.3 }, null, pol).decisao).toBe('ignorado_confianca');
  });
  it('lista acumula sem duplicar', () => {
    const r = decidirExtracao({ campo: 'objecoes', valor: 'preco, tempo', origem: 'inferido', confianca: 0.8 }, { valor: ['Preço'], origem: 'inferido', confianca: 0.7, status: 'pendente' }, pol);
    expect(r.valorFinal).toEqual(['Preço', 'tempo']);
  });
  it('contradição a valor confirmado por humano vai para revisão', () => {
    expect(decidirExtracao({ campo: 'email', valor: 'novo@b.com', origem: 'declarado', confianca: 0.95 }, { valor: 'velho@b.com', origem: 'humano', confianca: 1, status: 'confirmado' }, pol).decisao).toBe('pendente_revisao');
  });
  it('valor rejeitado por humano não volta', () => {
    expect(decidirExtracao({ campo: 'email', valor: 'x@b.com', origem: 'declarado', confianca: 0.95 }, { valor: 'x@b.com', origem: 'humano', confianca: 1, status: 'rejeitado' }, pol).decisao).toBe('ignorado_politica');
  });
});

describe('Follow-up', () => {
  const todas = new Set(['sem_resposta', 'objecao_preco', 'pos_orcamento', 'pos_interesse', 'agendamento_pendente', 'oportunidade_perdida'] as const);
  it('escolhe a estratégia mais específica ativa', () => {
    const base = { intencao: null, objecoes: [], temperatura: null, etapaPerdida: false, orcamentoEnviado: false, agendamentoPendente: false };
    expect(escolherEstrategia({ ...base, objecoes: ['preco'] }, todas)).toBe('objecao_preco');
    expect(escolherEstrategia({ ...base, intencao: 'orcamento' }, todas)).toBe('pos_orcamento');
    expect(escolherEstrategia({ ...base, intencao: 'agendamento' }, todas)).toBe('agendamento_pendente');
    expect(escolherEstrategia(base, todas)).toBe('sem_resposta');
    expect(escolherEstrategia({ ...base, objecoes: ['preco'] }, new Set(['pos_interesse']))).toBeNull();
  });
  it('opt-out sempre para; resposta para quando configurado', () => {
    const e = { respondeuDepois: false, convertido: false, optout: true, humanoAssumiu: false, agendou: false, desinteresse: false };
    expect(motivoParada([], e)).toMatch(/optou/);
    expect(motivoParada(['respondeu'], { ...e, optout: false, respondeuDepois: true })).toMatch(/respondeu/);
    expect(motivoParada([], { ...e, optout: false, respondeuDepois: true })).toBeNull();
  });
  it('janela de horário no fuso de São Paulo', () => {
    const janela = { horarioInicio: 9, horarioFim: 18, diasSemana: [1, 2, 3, 4, 5], fuso: 'America/Sao_Paulo' };
    // sábado 2026-11-07 15:00 em SP (18:00Z) → segunda 09:00 SP (12:00Z)
    const r = proximoHorarioPermitido(new Date('2026-11-07T18:00:00Z'), janela)!;
    expect(r.toISOString()).toBe('2026-11-09T12:00:00.000Z');
    // terça 07:30 SP → terça 09:00 SP
    expect(proximoHorarioPermitido(new Date('2026-11-10T10:30:00Z'), janela)!.toISOString()).toBe('2026-11-10T12:00:00.000Z');
    // dentro da janela → o próprio instante
    expect(proximoHorarioPermitido(new Date('2026-11-10T15:00:00Z'), janela)!.toISOString()).toBe('2026-11-10T15:00:00.000Z');
    expect(partesLocais(r, 'America/Sao_Paulo')).toMatchObject({ diaSemana: 1, hora: 9 });
    expect(proximoHorarioPermitido(new Date(), { ...janela, diasSemana: [] })).toBeNull();
  });
  it('tentativa usa o intervalo correspondente', () => {
    const regra = { intervalosHoras: [24, 72], horarioInicio: 0, horarioFim: 24, diasSemana: [0, 1, 2, 3, 4, 5, 6], fuso: 'UTC' };
    const base = new Date('2026-11-02T10:00:00Z');
    expect(horarioDaTentativa(base, 1, regra)!.toISOString()).toBe('2026-11-03T10:00:00.000Z');
    expect(horarioDaTentativa(base, 3, regra)!.toISOString()).toBe('2026-11-05T10:00:00.000Z');
  });
});

describe('Validador de naturalidade', () => {
  const base = { agenteNome: 'Lia', contatoNome: 'Ana', jaFalouAntes: true, reapresentar: false, usarNome: 'natural' as const, emojis: 'raro' as const, evitarRepeticao: true, anteriores: ['Qual tratamento você procura?'] };
  it('remove reapresentação e pergunta repetida', () => {
    const r = validarNaturalidade('Oi, Ana! Sou a Lia. Entendi seu caso. Qual tratamento você procura?', base);
    expect(r.texto).toBe('Oi, Ana! Entendi seu caso.');
    expect(r.avisos).toEqual(expect.arrayContaining(['reapresentação removida', 'pergunta repetida removida']));
  });
  it('não esvazia a resposta', () => {
    expect(validarNaturalidade('Qual tratamento você procura?', base).texto).toBe('Qual tratamento você procura?');
  });
  it('remove emojis quando a política é nunca', () => {
    expect(validarNaturalidade('Perfeito 😀', { ...base, emojis: 'nunca' }).texto).toBe('Perfeito');
  });
  it('no meio da conversa tira o cumprimento que abre a resposta', () => {
    const r = validarNaturalidade('Oi Ana! Tudo bem? 😊\n\nA manicure fica R$ 38,50.', { ...base, ultimaDoContato: 'e a manicure?' });
    expect(r.texto).toBe('A manicure fica R$ 38,50.');
    expect(r.avisos).toContain('cumprimento repetido removido');
  });
  it('mantém o cumprimento quando o contato cumprimentou ou é a primeira resposta', () => {
    expect(validarNaturalidade('Bom dia, Ana! A manicure fica R$ 38,50.', { ...base, ultimaDoContato: 'bom dia, e a manicure?' }).texto).toBe('Bom dia, Ana! A manicure fica R$ 38,50.');
    expect(validarNaturalidade('Oi Ana! A manicure fica R$ 38,50.', { ...base, jaFalouAntes: false, ultimaDoContato: 'e a manicure?' }).texto).toBe('Oi Ana! A manicure fica R$ 38,50.');
  });
  it('tira frase de enchimento solta, mas não a que tem conteúdo', () => {
    const r = validarNaturalidade('Com certeza! A manicure fica R$ 38,50. Fico à disposição!', { ...base, ultimaDoContato: 'e a manicure?' });
    expect(r.texto).toBe('A manicure fica R$ 38,50.');
    expect(validarNaturalidade('Com certeza dá para fazer as duas no mesmo dia.', base).texto).toBe('Com certeza dá para fazer as duas no mesmo dia.');
  });
  it('não confunde frase com conteúdo com cumprimento', () => {
    expect(validarNaturalidade('Oi Ana, a manicure fica R$ 38,50.', { ...base, ultimaDoContato: 'e a manicure?' }).texto).toBe('Oi Ana, a manicure fica R$ 38,50.');
  });
});

describe('Avaliação', () => {
  const saida = { texto: 'A avaliação custa R$ 250', blocos: 2, transferiu: false, intencao: 'orcamento', ferramentas: ['buscar_conhecimento'], fontes: 1, guardrail: false };
  it('checagens e nota', () => {
    const cs = checarCenario({ deveConter: ['250|duzentos'], naoDeveConter: ['desconto'], intencaoEsperada: 'orcamento', deveTransferir: false, ferramentasEsperadas: ['buscar_conhecimento'], exigeFonte: true }, saida);
    expect(cs.every((c) => c.ok)).toBe(true);
    expect(notaCenario(cs, null)).toBe(100);
    expect(notaCenario(cs, { qualidade: 5, precisao: 5, aderenciaBase: 5, naturalidade: 5, resolucao: 5, alucinacao: true, comentario: '' })).toBe(70);
  });
  it('detecta regressão por queda de nota e por checagem crítica', () => {
    const mk = (nota: number, critOk: boolean): ResultadoCenario => ({ cenarioId: 'c1', nome: 'preço', nota, juiz: null, saida, checagens: [{ nome: 'não transfere', ok: critOk, critica: true, detalhe: '' }] });
    expect(compararAvaliacoes([mk(90, true)], [mk(95, true)]).regressao).toBe(true);
    expect(compararAvaliacoes([mk(94, false)], [mk(95, true)]).pioraram).toEqual(['preço']);
    expect(compararAvaliacoes([mk(96, true)], [mk(95, true)]).regressao).toBe(false);
    expect(compararAvaliacoes([mk(96, true)], null).delta).toBeNull();
  });
});
