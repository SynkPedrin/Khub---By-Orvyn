import { agenteUnico, encolherAnexos, rotaPorPalavras } from './nyro.service';

describe('Memória e contexto da NICO', () => {
  it('encolherAnexos reduz arquivo antigo ao início e preserva o resto da mensagem', () => {
    const msg = `resuma isso\n\n[aviso]\n\n<anexo nome="plano.pdf" tipo="pdf">\n${'a'.repeat(5000)}\n</anexo>`;
    const r = encolherAnexos(msg, 1200);
    expect(r.length).toBeLessThan(1700);
    expect(r).toContain('resuma isso');
    expect(r).toContain('<anexo nome="plano.pdf" resumido=');
    expect(r).toContain('reanexe');
  });

  it('anexo pequeno passa intacto', () => {
    const msg = '<anexo nome="a.md" tipo="md">\ncurto\n</anexo>';
    expect(encolherAnexos(msg, 1200)).toBe(msg);
  });
});

describe('Modo de agente', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it('com Claude é agente único; com Ollama local segue roteado (modelo pequeno se perde com ~40 tools)', () => {
    delete process.env.NICO_AGENTE_UNICO;
    process.env.AI_PROVIDER = 'ollama';
    delete process.env.NICO_PROVEDOR;
    expect(agenteUnico()).toBe(false);
    process.env.NICO_PROVEDOR = 'anthropic';
    expect(agenteUnico()).toBe(true);
    process.env.AI_PROVIDER = 'anthropic';
    delete process.env.NICO_PROVEDOR;
    expect(agenteUnico()).toBe(true);
  });

  it('NICO_AGENTE_UNICO força nos dois sentidos', () => {
    process.env.AI_PROVIDER = 'ollama';
    process.env.NICO_AGENTE_UNICO = '1';
    expect(agenteUnico()).toBe(true);
    process.env.AI_PROVIDER = 'anthropic';
    process.env.NICO_AGENTE_UNICO = '0';
    expect(agenteUnico()).toBe(false);
  });

  it('roteamento por palavras manda copy, finanças e prompt para o lugar certo', () => {
    expect(rotaPorPalavras('escreve um roteiro de reels')).toBe('growth');
    expect(rotaPorPalavras('quantas cobranças vencidas eu tenho?')).toBe('growth');
    expect(rotaPorPalavras('melhora o prompt do agente')).toBe('configuracao');
  });
});
