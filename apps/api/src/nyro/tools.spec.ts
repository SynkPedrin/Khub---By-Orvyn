import { TOOLS, TOOLS_POR_NOME, paraAnthropic, zodParaJsonSchema } from './tools';
import { AGENTES, PROMPT_ROTEADOR, toolsDoAgente } from './agentes';
import { z } from 'zod';

describe('Tools da Nyro (ADR-0014 — conjunto fechado)', () => {
  it('toda tool tem schema, sensibilidade e resumo em português', () => {
    for (const t of TOOLS) {
      expect(t.nome).toMatch(/^[a-z_]+$/);
      expect(t.descricao.length).toBeGreaterThan(20);
      expect(['leitura', 'escrita', 'sensivel']).toContain(t.sensibilidade);
      expect(typeof t.resumir).toBe('function');
    }
  });

  it('as ações que mexem com o cliente são SENSÍVEIS (pedem aprovação)', () => {
    // é o invariante do human-in-the-loop: mandar mensagem, mexer no funil de
    // alguém e ligar/desligar automação nunca acontecem sozinhos
    for (const nome of ['enviar_mensagem', 'mover_etapa', 'mudar_status_automacao']) {
      expect(TOOLS_POR_NOME.get(nome)?.sensibilidade).toBe('sensivel');
    }
  });

  it('leitura nunca é sensível, e escrita interna não pede aprovação', () => {
    expect(TOOLS_POR_NOME.get('buscar_conhecimento')?.sensibilidade).toBe('leitura');
    expect(TOOLS_POR_NOME.get('resumo_do_funil')?.sensibilidade).toBe('leitura');
    expect(TOOLS_POR_NOME.get('criar_tarefa')?.sensibilidade).toBe('escrita');
  });

  it('o resumo explica a ação ao humano (é o que ele lê antes de aprovar)', () => {
    const t = TOOLS_POR_NOME.get('enviar_mensagem')!;
    expect(t.resumir({ contactId: 'x', texto: 'Oi Marina, tudo bem?' } as never)).toContain('Oi Marina');
    expect(TOOLS_POR_NOME.get('mudar_status_automacao')!.resumir({ workflowId: 'x', status: 'pausado' } as never)).toContain('PAUSAR');
  });

  it('schema Zod vira JSON Schema válido para a Anthropic', () => {
    const j = paraAnthropic(TOOLS);
    expect(j).toHaveLength(TOOLS.length);
    for (const t of j) {
      expect(t.input_schema).toMatchObject({ type: 'object' });
      expect(typeof t.name).toBe('string');
    }
    const enviar = j.find((x) => x.name === 'enviar_mensagem')!;
    expect(enviar.input_schema).toMatchObject({
      type: 'object',
      properties: { contactId: { type: 'string' }, texto: { type: 'string' } },
      required: ['contactId', 'texto'],
    });
  });

  it('campo opcional/com default não entra em `required`', () => {
    const j = zodParaJsonSchema(z.object({ a: z.string(), b: z.string().optional(), c: z.number().default(3) }));
    expect(j.required).toEqual(['a']);
    expect((j.properties as Record<string, unknown>).c).toEqual({ type: 'number' });
  });

  it('enum vira enum no JSON Schema (o modelo não inventa valor)', () => {
    const j = zodParaJsonSchema(z.object({ p: z.enum(['baixa', 'media', 'alta']) }));
    expect((j.properties as Record<string, unknown>).p).toEqual({ type: 'string', enum: ['baixa', 'media', 'alta'] });
  });

  it('array de strings vira { type: array, items: string } (ex.: etapas do funil)', () => {
    const j = zodParaJsonSchema(z.object({ etapas: z.array(z.string()) }));
    expect((j.properties as Record<string, unknown>).etapas).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('tipo não suportado falha alto em vez de gerar schema errado', () => {
    expect(() => zodParaJsonSchema(z.object({ x: z.date() }))).toThrow(/não suportado/);
    expect(() => zodParaJsonSchema(z.string() as never)).toThrow(/z.object/);
  });
});

describe('Visão financeira e guia do sistema', () => {
  it('são leitura e a Estrategista as enxerga', () => {
    for (const n of ['resumo_financeiro', 'listar_cobrancas', 'guia_do_sistema']) expect(TOOLS_POR_NOME.get(n)?.sensibilidade).toBe('leitura');
    const g = toolsDoAgente('growth').map((x) => x.nome);
    expect(g).toEqual(expect.arrayContaining(['resumo_financeiro', 'listar_cobrancas', 'guia_do_sistema']));
  });
  it('guia responde por assunto e cai no mapa inteiro se nada bater', () => {
    const { consultarGuia, GUIA_SISTEMA } = jest.requireActual('./guia-sistema') as typeof import('./guia-sistema');
    expect(consultarGuia('cobrar cliente').some((e) => e.rota === '/financeiro')).toBe(true);
    expect(consultarGuia('xyzqwerty')).toHaveLength(GUIA_SISTEMA.length);
  });
});

describe('Agentes (PRD §5.1 — orquestrador multi-agente)', () => {
  it('cada agente enxerga só as tools do papel dele', () => {
    const consultoria = toolsDoAgente('consultoria').map((t) => t.nome);
    // consultora responde dúvida do nicho: não manda mensagem nem mexe no funil
    expect(consultoria).toContain('buscar_conhecimento');
    expect(consultoria).not.toContain('enviar_mensagem');
    expect(consultoria).not.toContain('mudar_status_automacao');

    const growth = toolsDoAgente('growth').map((t) => t.nome);
    expect(growth).toContain('resumo_do_funil');
    expect(growth).not.toContain('enviar_mensagem'); // estrategista não fala com lead
  });

  it('toda tool citada por um agente existe no catálogo', () => {
    for (const def of Object.values(AGENTES)) {
      for (const nome of def.tools) {
        expect(TOOLS_POR_NOME.has(nome)).toBe(true);
      }
    }
  });

  it('todo agente tem prompt com as regras de grounding e de não-escrita direta', () => {
    for (const def of Object.values(AGENTES)) {
      expect(def.prompt).toContain('buscar_conhecimento');
      expect(def.prompt).toMatch(/lacuna|tools/i);
    }
  });
});

describe('Tools de pesquisa, plano e memória', () => {
  it('atualizar_plano aceita lista de objetos (JSON Schema aninhado correto)', () => {
    const j = paraAnthropic([TOOLS_POR_NOME.get('atualizar_plano')!])[0].input_schema as { properties: { passos: { type: string; items: { type: string; properties: { status: { enum: string[] } }; required: string[] } } }; required: string[] };
    expect(j.required).toEqual(['objetivo', 'passos']);
    expect(j.properties.passos.type).toBe('array');
    expect(j.properties.passos.items.type).toBe('object');
    expect(j.properties.passos.items.properties.status.enum).toEqual(['pendente', 'fazendo', 'feito']);
    expect(j.properties.passos.items.required).toEqual(['texto', 'status']);
  });

  it('pesquisa, leitura de página, plano e conversas dos leads são só leitura', () => {
    for (const n of ['pesquisar_web', 'ler_pagina', 'atualizar_plano', 'insights_conversas']) expect(TOOLS_POR_NOME.get(n)?.sensibilidade).toBe('leitura');
    expect(TOOLS_POR_NOME.get('esquecer')?.sensibilidade).toBe('escrita');
  });

  it('URL inválida é recusada pelo schema antes de qualquer chamada', () => {
    expect(TOOLS_POR_NOME.get('ler_pagina')!.schema.safeParse({ url: 'isso não é url' }).success).toBe(false);
    expect(TOOLS_POR_NOME.get('pesquisar_web')!.schema.safeParse({ consulta: 'ab' }).success).toBe(false);
  });

  it('o agente único enxerga TODAS as tools; o roteador nunca o oferece como opção', () => {
    expect(toolsDoAgente('nico')).toHaveLength(TOOLS.length);
    expect(PROMPT_ROTEADOR).not.toContain('- nico:');
    expect(AGENTES.nico.prompt).toContain('atualizar_plano');
    expect(AGENTES.nico.prompt).toContain('pesquisar_web');
  });
});
