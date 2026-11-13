import { aplicarPoliticaDeCusto } from './anthropic.provider';

const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

describe('política de custo da Anthropic (crédito limitado em produção)', () => {
  it('sem variáveis, não muda nada', () => {
    expect(aplicarPoliticaDeCusto('claude-sonnet-5', 'high', env({}))).toEqual({ modelo: 'claude-sonnet-5', effort: 'high' });
    expect(aplicarPoliticaDeCusto('claude-opus-5-5', undefined, env({}))).toEqual({ modelo: 'claude-opus-5-5', effort: undefined });
  });

  it('ANTHROPIC_MODEL_FORCE troca qualquer modelo pedido', () => {
    const e = env({ ANTHROPIC_MODEL_FORCE: 'claude-haiku-5-5' });
    expect(aplicarPoliticaDeCusto('claude-opus-5-5', 'medium', e).modelo).toBe('claude-haiku-5-5');
    expect(aplicarPoliticaDeCusto('claude-sonnet-5', undefined, e).modelo).toBe('claude-haiku-5-5');
  });

  it('valor inválido em ANTHROPIC_MODEL_FORCE é ignorado (nunca manda lixo para a API)', () => {
    expect(aplicarPoliticaDeCusto('claude-sonnet-5', 'low', env({ ANTHROPIC_MODEL_FORCE: 'gpt 4; drop' })).modelo).toBe('claude-sonnet-5');
  });

  it('ANTHROPIC_EFFORT_MAX corta esforço acima do teto e preenche quando nada foi pedido', () => {
    const e = env({ ANTHROPIC_EFFORT_MAX: 'low' });
    expect(aplicarPoliticaDeCusto('claude-haiku-5-5', 'high', e).effort).toBe('low');
    expect(aplicarPoliticaDeCusto('claude-haiku-5-5', undefined, e).effort).toBe('low');
    expect(aplicarPoliticaDeCusto('claude-haiku-5-5', 'medium', env({ ANTHROPIC_EFFORT_MAX: 'high' })).effort).toBe('medium');
  });
});
