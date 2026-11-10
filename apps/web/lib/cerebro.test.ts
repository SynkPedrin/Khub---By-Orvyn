// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { slugVisivel, vaultInternoLiberado } from './cerebro';

const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

describe('visibilidade do vault (BUG-028: cliente lia PRD, Bugs e revisão de segurança)', () => {
  it('em produção, documento interno fica invisível', () => {
    const prod = env({ NODE_ENV: 'production' });
    expect(vaultInternoLiberado(prod)).toBe(false);
    expect(slugVisivel('Bugs', prod)).toBe(false);
    expect(slugVisivel('PRD', prod)).toBe(false);
    expect(slugVisivel('RAG/RAG', prod)).toBe(false);
  });

  it('em produção, a base de conhecimento de produto continua visível', () => {
    const prod = env({ NODE_ENV: 'production' });
    expect(slugVisivel('RAG/conhecimento/global/marketing/funil-de-demanda', prod)).toBe(true);
  });

  it('prefixo parecido não vaza (RAG/conhecimento-interno)', () => {
    expect(slugVisivel('RAG/conhecimento-interno/segredo', env({ NODE_ENV: 'production' }))).toBe(false);
  });

  it('desenvolvimento libera o interno; a flag explícita manda nos dois sentidos', () => {
    expect(vaultInternoLiberado(env({ NODE_ENV: 'development' }))).toBe(true);
    expect(vaultInternoLiberado(env({ NODE_ENV: 'development', KHUB_VAULT_INTERNO: '0' }))).toBe(false);
    expect(vaultInternoLiberado(env({ NODE_ENV: 'production', KHUB_VAULT_INTERNO: '1' }))).toBe(true);
  });
});
