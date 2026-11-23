import { BadRequestException } from '@nestjs/common';
import {
  CENARIOS_TESTE_AGENTE,
  ESCOPO_VAZIO,
  IniciarSchema,
  PAUTA_IMERSAO_BASE,
  TAREFAS_TEMPLATE,
  VERIFICACOES_TEMPLATE,
  aplicavelAoEscopo,
  aprovacaoDosTestes,
  escopoKeyDoTexto,
  escopoKeyParaTexto,
  normalizarEscopo,
  pautaParaEscopo,
  tarefasParaEscopo,
  validar,
  verificacoesParaEscopo,
  type Escopo,
} from './onboarding.catalogo';

const TUDO: Escopo = { trafego: true, social: true, audiovisual: true, agente_ia: true, branding: true };

describe('Onboarding: escopo', () => {
  it('normaliza o jsonb vindo de fora: só chaves conhecidas, sempre booleano', () => {
    expect(normalizarEscopo({ trafego: true, social: 1, hacker: true })).toEqual({ ...ESCOPO_VAZIO, trafego: true });
    expect(normalizarEscopo(null)).toEqual(ESCOPO_VAZIO);
    expect(normalizarEscopo('trafego')).toEqual(ESCOPO_VAZIO);
  });

  it('escopoKey null sempre se aplica; lista aplica se qualquer serviço estiver no escopo', () => {
    const soTrafego = { ...ESCOPO_VAZIO, trafego: true };
    expect(aplicavelAoEscopo(null, ESCOPO_VAZIO)).toBe(true);
    expect(aplicavelAoEscopo('trafego', soTrafego)).toBe(true);
    expect(aplicavelAoEscopo(['social', 'branding'], soTrafego)).toBe(false);
    expect(aplicavelAoEscopo(['social', 'trafego'], soTrafego)).toBe(true);
  });

  it('escopoKey texto: roundtrip com lista', () => {
    expect(escopoKeyParaTexto(null)).toBeNull();
    expect(escopoKeyParaTexto('trafego')).toBe('trafego');
    expect(escopoKeyParaTexto(['social', 'branding'])).toBe('social|branding');
    expect(escopoKeyDoTexto('social|branding')).toEqual(['social', 'branding']);
    expect(escopoKeyDoTexto(null)).toBeNull();
  });
});

describe('Onboarding: verificações de homologação', () => {
  it('verba de mídia só é exigida com tráfego no escopo', () => {
    const semTrafego = verificacoesParaEscopo(ESCOPO_VAZIO).map((v) => v.chave);
    expect(semTrafego).not.toContain('verba_confirmada');
    expect(semTrafego).not.toContain('agente_ia_testado');
    expect(semTrafego).not.toContain('identidade_organizada');
    const comTudo = verificacoesParaEscopo(TUDO).map((v) => v.chave);
    expect(comTudo).toHaveLength(VERIFICACOES_TEMPLATE.length);
    expect(comTudo).toContain('verba_confirmada');
  });

  it('aprovação humana final e análise Genna são sempre exigidas', () => {
    const chaves = verificacoesParaEscopo(ESCOPO_VAZIO).map((v) => v.chave);
    expect(chaves).toContain('aprovacao_final');
    expect(chaves).toContain('genna_analise');
    expect(chaves).toContain('reuniao_imersao');
  });

  it('toda verificação é obrigatória e tem rótulo e seção', () => {
    for (const v of VERIFICACOES_TEMPLATE) {
      expect(v.obrigatorio).toBe(true);
      expect(v.rotulo.length).toBeGreaterThan(0);
      expect(v.secao.length).toBeGreaterThan(0);
    }
  });
});

describe('Onboarding: tarefas por papel', () => {
  it('sem tráfego no escopo, nenhuma tarefa de tráfego entra', () => {
    const tarefas = tarefasParaEscopo({ ...ESCOPO_VAZIO, social: true });
    expect(tarefas.some((t) => t.tipo === 'trafego')).toBe(false);
    expect(tarefas.some((t) => t.papel === 'sofia')).toBe(true); // social ativa a Sofia
    expect(tarefas.some((t) => t.papel === 'interno')).toBe(true); // orquestração sempre
  });

  it('escopo vazio ainda inclui as tarefas universais (escopoKey null)', () => {
    const tarefas = tarefasParaEscopo(ESCOPO_VAZIO);
    expect(tarefas.length).toBeGreaterThan(0);
    expect(tarefas.every((t) => t.escopoKey === null)).toBe(true);
    expect(tarefas.map((t) => t.titulo)).toContain('Agendar reunião de imersão com o cliente');
  });

  it('escopo completo inclui todas as tarefas do template', () => {
    expect(tarefasParaEscopo(TUDO)).toHaveLength(TAREFAS_TEMPLATE.length);
    expect(tarefasParaEscopo(TUDO).map((t) => t.titulo)).toContain('Confirmar verba de mídia com o cliente');
  });

  it('todo template tem critério de aceite e tipo válido do Daily', () => {
    const tipos = ['post', 'carrossel', 'reel', 'criativo', 'copy', 'trafego', 'landing_page', 'branding', 'reuniao', 'administrativo', 'outro'];
    for (const t of TAREFAS_TEMPLATE) {
      expect(t.criterioAceite.length).toBeGreaterThan(0);
      expect(tipos).toContain(t.tipo);
      expect(['marcos', 'sofia', 'matheus', 'interno']).toContain(t.papel);
    }
  });
});

describe('Onboarding: pauta da imersão', () => {
  it('base tem os 14 tópicos e não muda com escopo vazio', () => {
    expect(PAUTA_IMERSAO_BASE).toHaveLength(14);
    expect(pautaParaEscopo(ESCOPO_VAZIO)).toHaveLength(14);
  });

  it('escopo com tráfego e agente de IA adiciona os tópicos específicos', () => {
    const pauta = pautaParaEscopo({ ...ESCOPO_VAZIO, trafego: true, agente_ia: true });
    expect(pauta).toHaveLength(16);
    expect(pauta.map((t) => t.chave)).toEqual(expect.arrayContaining(['verba_midia', 'atendimento_ia']));
    expect(pauta.map((t) => t.chave)).not.toContain('captacoes');
  });
});

describe('Onboarding: cenários de teste do agente', () => {
  it('são exatamente 11 cenários base', () => {
    expect(CENARIOS_TESTE_AGENTE).toHaveLength(11);
    expect(CENARIOS_TESTE_AGENTE.map((c) => c.cenario)).toContain('escalacao_humana');
  });

  it('aprovação é derivada: rascunho → em_testes → aprovado só com os 11 aprovados', () => {
    expect(aprovacaoDosTestes([])).toBe('rascunho');
    const parcial = CENARIOS_TESTE_AGENTE.slice(0, 10).map((c) => ({ cenario: c.cenario, status: 'aprovado' as const }));
    expect(aprovacaoDosTestes(parcial)).toBe('em_testes');
    const completo = CENARIOS_TESTE_AGENTE.map((c) => ({ cenario: c.cenario, status: 'aprovado' as const }));
    expect(aprovacaoDosTestes(completo)).toBe('aprovado');
    const comReprovado = completo.map((t, i) => (i === 0 ? { ...t, status: 'reprovado' as const } : t));
    expect(aprovacaoDosTestes(comReprovado)).toBe('em_testes');
  });
});

describe('Onboarding: validação de entrada', () => {
  it('iniciar exige clientAccountId uuid e rejeita campo desconhecido', () => {
    expect(() => validar(IniciarSchema, {})).toThrow(BadRequestException);
    expect(() => validar(IniciarSchema, { clientAccountId: 'não-uuid' })).toThrow(BadRequestException);
    const ok = validar(IniciarSchema, { clientAccountId: '3f6b8a1e-aaaa-4bbb-8ccc-1234567890ab', escopo: { trafego: true } });
    expect(ok.clientAccountId).toBe('3f6b8a1e-aaaa-4bbb-8ccc-1234567890ab');
    // chave desconhecida dentro de escopo é rejeitada (strict)
    expect(() => validar(IniciarSchema, { clientAccountId: '3f6b8a1e-aaaa-4bbb-8ccc-1234567890ab', escopo: { hacker: true } })).toThrow(BadRequestException);
  });
});
