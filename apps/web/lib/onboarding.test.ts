import { describe, expect, it } from 'vitest';
import { ApiError } from './api-error';
import {
  FILTROS_VAZIOS,
  aprovacaoDosTestes,
  contadoresPorStatus,
  contarFiltros,
  evidenciasAgregadas,
  mensagemErro,
  normalizarEscopo,
  paraQueryVisao,
  pautaParaEscopo,
  pendenciasDoErro,
  pendenciasFinalizacao,
  progressoPct,
  rotuloCampo,
  secoesFaltantes,
  servicosAtivos,
  testesPorCenario,
  type Conferencia,
  type DetalheOnboarding,
} from './onboarding';

const ESCOPO_TUDO = { trafego: true, social: true, audiovisual: true, agente_ia: true, branding: true };

describe('onboarding: escopo', () => {
  it('normaliza: só chaves conhecidas, sempre booleano', () => {
    expect(normalizarEscopo(null)).toEqual({ trafego: false, social: false, audiovisual: false, agente_ia: false, branding: false });
    expect(normalizarEscopo({ trafego: true, social: 1, x: true, agente_ia: false })).toEqual({
      trafego: true,
      social: false,
      audiovisual: false,
      agente_ia: false,
      branding: false,
    });
  });

  it('lista os serviços ativos na ordem do catálogo', () => {
    expect(servicosAtivos(normalizarEscopo({ branding: true, trafego: true }))).toEqual(['Tráfego pago', 'Branding']);
    expect(servicosAtivos(normalizarEscopo({}))).toEqual([]);
  });
});

describe('onboarding: filtros da visão executiva', () => {
  const ID = 'aaaaaaaa-0000-4000-8000-000000000001';

  it('só emite valores válidos; chave vazia some', () => {
    expect(paraQueryVisao(FILTROS_VAZIOS)).toEqual({});
    expect(contarFiltros(FILTROS_VAZIOS)).toBe(0);
    const q = paraQueryVisao({ status: 'imersao', etapa: '  kickoff ', responsavel: ID, cliente: ID, de: '2026-11-01', ate: '2026-11-30', prioridade: 'alta' });
    expect(q).toEqual({ status: 'imersao', etapa: 'kickoff', responsavel: ID, cliente: ID, de: '2026-11-01', ate: '2026-11-30', prioridade: 'alta' });
    expect(contarFiltros({ ...FILTROS_VAZIOS, status: 'pronto', prioridade: 'urgente' })).toBe(2);
  });

  it('valor adulterado à mão não chega à API', () => {
    const q = paraQueryVisao({ status: 'hackeado' as never, etapa: '', responsavel: 'fulano', cliente: '123', de: '01/11/2026', ate: 'ontem', prioridade: '' });
    expect(q).toEqual({});
  });
});

describe('onboarding: contadores e progresso', () => {
  it('todo status aparece nos contadores, mesmo zerado', () => {
    expect(contadoresPorStatus({ coleta: 2, pronto: 1 })).toEqual([
      { status: 'coleta', total: 2 },
      { status: 'imersao', total: 0 },
      { status: 'implantacao', total: 0 },
      { status: 'homologacao', total: 0 },
      { status: 'pronto', total: 1 },
      { status: 'bloqueado', total: 0 },
    ]);
  });

  it('progresso em % arredondado; sem verificações = 0', () => {
    expect(progressoPct(3, 16)).toBe(19);
    expect(progressoPct(0, 0)).toBe(0);
    expect(progressoPct(5, 5)).toBe(100);
  });
});

describe('onboarding: pauta da imersão (espelho do catálogo)', () => {
  it('base tem 14 tópicos; escopo adiciona os tópicos extras dos serviços', () => {
    expect(pautaParaEscopo(normalizarEscopo({}))).toHaveLength(14);
    const comTudo = pautaParaEscopo(ESCOPO_TUDO);
    expect(comTudo).toHaveLength(19);
    expect(comTudo.map((t) => t.chave)).toContain('verba_midia');
    expect(pautaParaEscopo(normalizarEscopo({ trafego: true })).map((t) => t.chave)).toContain('verba_midia');
    expect(pautaParaEscopo(normalizarEscopo({ trafego: true })).map((t) => t.chave)).not.toContain('captacoes');
  });
});

describe('onboarding: testes do agente', () => {
  const aprovado = (cenario: string) => ({ cenario, status: 'aprovado' as const });

  it('aprovado só com os 11 cenários base aprovados', () => {
    expect(aprovacaoDosTestes([])).toBe('rascunho');
    expect(aprovacaoDosTestes([aprovado('primeiro_contato')])).toBe('em_testes');
    const dez = ['primeiro_contato', 'duvida_preco', 'interesse_comercial', 'objecao', 'cliente_indeciso', 'fora_do_escopo', 'pergunta_sem_resposta', 'reclamacao', 'escalacao_humana', 'lead_sem_resposta'];
    expect(aprovacaoDosTestes(dez.map(aprovado))).toBe('em_testes');
    expect(aprovacaoDosTestes([...dez, 'intencao_compra'].map(aprovado))).toBe('aprovado');
  });

  it('um reprovado no meio impede a aprovação; último resultado por cenário vence', () => {
    const onze = ['primeiro_contato', 'duvida_preco', 'interesse_comercial', 'objecao', 'cliente_indeciso', 'fora_do_escopo', 'pergunta_sem_resposta', 'reclamacao', 'escalacao_humana', 'lead_sem_resposta', 'intencao_compra'];
    const comFalha = onze.map((c) => ({ cenario: c, status: (c === 'objecao' ? 'reprovado' : 'aprovado') as 'reprovado' | 'aprovado' }));
    expect(aprovacaoDosTestes(comFalha)).toBe('em_testes');
    const porCenario = testesPorCenario([{ cenario: 'objecao', status: 'reprovado' }, { cenario: 'objecao', status: 'aprovado' }]);
    expect(porCenario.get('objecao')?.status).toBe('aprovado');
  });
});

describe('onboarding: conferência', () => {
  const conf = (over: Partial<Conferencia> = {}): Conferencia => ({
    onboardingId: 'o1',
    status: 'homologacao',
    responsavelId: null,
    conhecimento: [],
    verificacoes: [],
    tarefas: [],
    escopo: normalizarEscopo({}),
    ...over,
  });

  it('pendências de finalização: obrigatórias não verificadas, exceto a aprovação final', () => {
    const c = conf({
      verificacoes: [
        {
          secao: 'coleta',
          status: 'em_andamento',
          pendencias: 2,
          itens: [
            { id: '1', chave: 'info_essenciais', rotulo: 'Informações essenciais coletadas', status: 'pendente', obrigatorio: true, evidencias: 0, taskId: null, verificadoPor: null, verificadoEm: null },
            { id: '2', chave: 'escopo_confirmado', rotulo: 'Escopo contratado confirmado', status: 'verificado', obrigatorio: true, evidencias: 1, taskId: null, verificadoPor: 'm', verificadoEm: 'x' },
            { id: '3', chave: 'aprovacao_final', rotulo: 'Aprovação humana final', status: 'pendente', obrigatorio: true, evidencias: 0, taskId: null, verificadoPor: null, verificadoEm: null },
          ],
        },
      ],
    });
    expect(pendenciasFinalizacao(c)).toEqual([{ chave: 'info_essenciais', rotulo: 'Informações essenciais coletadas', status: 'pendente' }]);
  });

  it('seção de conhecimento falta quando pendente ou com campo obrigatório vazio', () => {
    const c = conf({
      conhecimento: [
        { secao: 'institucional', rotulo: 'Institucional', pendente: false, confirmadoEm: 'x', camposFaltantes: [], knowledgeId: 'k1' },
        { secao: 'operacao', rotulo: 'Operação', pendente: true, confirmadoEm: null, camposFaltantes: [], knowledgeId: 'k2' },
        { secao: 'produtos', rotulo: 'Produtos e serviços', pendente: false, confirmadoEm: null, camposFaltantes: ['precos'], knowledgeId: 'k3' },
      ],
    });
    expect(secoesFaltantes(c).map((s) => s.secao)).toEqual(['operacao', 'produtos']);
  });
});

describe('onboarding: evidências agregadas', () => {
  it('junta evidências de verificações e tarefas com a origem', () => {
    const d = {
      verifications: [
        { chave: 'acessos', rotulo: 'Acessos validados', secao: 'acessos', evidencias: [{ tipo: 'link', referencia: 'https://x' }] },
      ],
      tarefas: [
        { secao: 'coleta', task: { titulo: 'Validar informações coletadas' }, evidencias: [{ tipo: 'nota', referencia: 'conferido' }] },
        { secao: null, task: null, evidencias: 'não-lista' },
      ],
    } as unknown as Pick<DetalheOnboarding, 'verifications' | 'tarefas'>;
    expect(evidenciasAgregadas(d)).toEqual([
      { origem: 'verificacao', origemRotulo: 'Acessos validados', secao: 'acessos', evidencia: { tipo: 'link', referencia: 'https://x' } },
      { origem: 'tarefa', origemRotulo: 'Validar informações coletadas', secao: 'coleta', evidencia: { tipo: 'nota', referencia: 'conferido' } },
    ]);
  });
});

describe('onboarding: erros', () => {
  it('pendências do 409 de finalizar saem do corpo RFC 7807', () => {
    const e = new ApiError(409, { title: 'homologação incompleta', code: 'onboarding_pendencias', pendencias: [{ chave: 'verba_confirmada', rotulo: 'Verba de mídia confirmada', status: 'pendente' }, { ruim: true }] });
    expect(pendenciasDoErro(e)).toEqual([{ chave: 'verba_confirmada', rotulo: 'Verba de mídia confirmada', status: 'pendente' }]);
    expect(pendenciasDoErro(new Error('x'))).toEqual([]);
    expect(mensagemErro(e, 'padrão')).toBe('homologação incompleta');
  });
});

describe('onboarding: rótulos', () => {
  it('humaniza chaves de campo', () => {
    expect(rotuloCampo('contatos_principais')).toBe('Contatos principais');
    expect(rotuloCampo('nome_empresa')).toBe('Nome empresa');
  });
});
