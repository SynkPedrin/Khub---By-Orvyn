import { ChunkingService, estimateTokens } from './chunking.service';

describe('ChunkingService (R1.1)', () => {
  const svc = new ChunkingService();

  const md = [
    '# Playbook',
    '',
    'Intro do playbook com contexto geral.',
    '',
    '## Tabela de preços',
    '',
    '| Procedimento | Valor |',
    '| --- | --- |',
    '| Consulta | R$ 300 |',
    '| Retorno | R$ 0 |',
    '| Exame | R$ 500 |',
    '',
    '## Código',
    '',
    '```ts',
    'const x = 1;',
    'const y = 2;',
    '```',
    '',
    'Parágrafo final de encerramento.',
  ].join('\n');

  it('não corta tabela ao meio', () => {
    const chunks = svc.chunk(md, { maxTokens: 600, overlap: 0.15 });
    const full = chunks.filter((c) => c.conteudo.includes('| Procedimento | Valor |'));
    expect(full.length).toBe(1);
    // as 3 linhas de dados devem estar juntas no MESMO chunk
    const c = full[0];
    expect(c.conteudo).toContain('| Consulta | R$ 300 |');
    expect(c.conteudo).toContain('| Retorno | R$ 0 |');
    expect(c.conteudo).toContain('| Exame | R$ 500 |');
  });

  it('não corta bloco de código ao meio', () => {
    const chunks = svc.chunk(md);
    const code = chunks.filter((c) => c.conteudo.includes('```ts'));
    expect(code.length).toBe(1);
    expect(code[0].conteudo).toContain('const x = 1;');
    expect(code[0].conteudo).toContain('const y = 2;');
    expect(code[0].conteudo).toContain('```');
  });

  it('gera breadcrumb a partir dos headings', () => {
    const chunks = svc.chunk(md);
    const tableChunk = chunks.find((c) => c.conteudo.includes('Procedimento'))!;
    expect(tableChunk.breadcrumb).toContain('Playbook');
    expect(tableChunk.breadcrumb).toContain('Tabela de preços');
  });

  it('respeita o teto de tokens (p95 <= 700) em texto longo', () => {
    const paras = Array.from({ length: 60 }, (_, i) => `Parágrafo ${i} com bastante texto de exemplo para somar tokens.`);
    const chunks = svc.chunk(paras.join('\n\n'), { maxTokens: 600, overlap: 0.15 });
    const tokens = chunks.map((c) => c.tokens).sort((a, b) => a - b);
    const p95 = tokens[Math.floor(tokens.length * 0.95)] ?? tokens[tokens.length - 1];
    expect(p95).toBeLessThanOrEqual(700);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('estimateTokens ~ chars/4', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});
