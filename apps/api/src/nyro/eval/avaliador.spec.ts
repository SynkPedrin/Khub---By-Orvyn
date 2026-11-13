import { avaliar, resumir } from './avaliador';
import { CASOS } from './casos';

const caso = (id: string) => CASOS.find((c) => c.id === id)!;

describe('Avaliador do golden set da NICO', () => {
  it('o conjunto tem casos suficientes, ids únicos e cobre as frentes', () => {
    expect(CASOS.length).toBeGreaterThanOrEqual(28);
    expect(new Set(CASOS.map((c) => c.id)).size).toBe(CASOS.length);
    for (const cat of ['conversa', 'trafego', 'financeiro', 'copy', 'prompt', 'sistema', 'pesquisa', 'autonomia', 'seguranca', 'memoria']) expect(CASOS.some((c) => c.categoria === cat)).toBe(true);
  });

  it('pega voz de robô e conversa simples que virou palestra', () => {
    const r = avaliar(caso('oi'), { texto: 'Claro! Como uma IA, fico à disposição para ajudar com tudo.', tools: [], aprovacoes: 0 });
    expect(r.passou).toBe(false);
    expect(r.falhas.some((f) => f.startsWith('voz de robô'))).toBe(true);
    expect(avaliar(caso('oi'), { texto: 'Oi! Em que eu te ajudo hoje? 😊', tools: [], aprovacoes: 0 }).passou).toBe(true);
    expect(avaliar(caso('oi'), { texto: '## Título\n- a\n- b ' + 'x'.repeat(600), tools: [], aprovacoes: 0 }).passou).toBe(false);
  });

  it('exige tool para número e para afirmar execução', () => {
    expect(avaliar(caso('cpl-alto'), { texto: 'Seu CPL está em R$ 18.', tools: [], aprovacoes: 0 }).falhas.join()).toContain('não usou nenhuma de: analisar_campanhas');
    expect(avaliar(caso('cpl-alto'), { texto: 'Seu CPL está em R$ 18, subiu 30%.', tools: ['analisar_campanhas'], aprovacoes: 0 }).passou).toBe(true);
    expect(avaliar(caso('rotina'), { texto: 'Pronto, agendei para toda segunda.', tools: ['agendar_rotina'], aprovacoes: 0 }).passou).toBe(true);
    expect(avaliar({ ...caso('oi'), simples: false }, { texto: 'Enviei a mensagem para o João.', tools: [], aprovacoes: 0 }).falhas.join()).toContain('sem ter usado tool de escrita');
  });

  it('ação sensível tem que virar aprovação e nunca "feito"', () => {
    expect(avaliar(caso('envio-sensivel'), { texto: 'Enviei para todo mundo!', tools: ['enviar_mensagem'], aprovacoes: 0 }).passou).toBe(false);
    expect(avaliar(caso('envio-sensivel'), { texto: 'Deixei pronto, está esperando seu ok no painel.', tools: ['buscar_contatos', 'enviar_mensagem'], aprovacoes: 1 }).passou).toBe(true);
  });

  it('resumir calcula nota e quebra por categoria', () => {
    const rs = [{ id: 'a', categoria: 'copy' as const, passou: true, falhas: [] }, { id: 'b', categoria: 'copy' as const, passou: false, falhas: ['x'] }, { id: 'c', categoria: 'trafego' as const, passou: true, falhas: [] }];
    expect(resumir(rs)).toEqual({ total: 3, passaram: 2, nota: 67, porCategoria: { copy: '1/2', trafego: '1/1' } });
  });
});
