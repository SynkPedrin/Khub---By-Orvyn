import { formatarListaGhl, previaLegivel } from './formato-lista-ghl';

const CRUA = '#list|Oii, Ana! Seja muito bem-vinda ao Studio da Beleza! 💕|ntes de continuarmos, conta pra gente: você já é nossa cliente ou conheceu o nosso Studio pelo Google ou pelo Instagram?|É um prazer ter você por aqui!/VER OPÇÕES |OPÇÕES|Instagram*Vi um Anúncio no Instagram ou Facebook id1/Google Vim pelo Site*id2/Já sou cliente*Já conheço o espaço e o atendimento id3/IndicaçãoMe indicaram e quero conhecer melhor!*id4';

describe('formatarListaGhl (lista interativa importada do GHL)', () => {
  it('vira texto legível com as opções em tópicos', () => {
    // Nota: "|ntes" é fiel ao payload — a pipeline do GHL comeu o "A" de
    // "Antes" ao enviar (a config do workflow tem o texto certo).
    expect(formatarListaGhl(CRUA)).toBe(
      'Oii, Ana! Seja muito bem-vinda ao Studio da Beleza! 💕\n' +
        'tes de continuarmos, conta pra gente: você já é nossa cliente ou conheceu o nosso Studio pelo Google ou pelo Instagram?\n' +
        'É um prazer ter você por aqui!\n\n' +
        '• Instagram — Vi um Anúncio no Instagram ou Facebook\n' +
        '• Google Vim pelo Site\n' +
        '• Já sou cliente — Já conheço o espaço e o atendimento\n' +
        '• IndicaçãoMe indicaram e quero conhecer melhor!',
    );
  });

  it('texto comum passa intacto', () => {
    expect(formatarListaGhl('Bom dia!')).toBe('Bom dia!');
    expect(formatarListaGhl('#lista|parecido mas não é')).toBe('#lista|parecido mas não é');
  });

  it('lista sem bloco de opções devolve só o texto', () => {
    expect(formatarListaGhl('#list|Só texto|nnova linha')).toBe('Só texto\nnova linha');
  });

  it('prévia de uma linha para a lista de conversas', () => {
    expect(previaLegivel(CRUA)).toBe('Oii, Ana! Seja muito bem-vinda ao Studio da Beleza! 💕');
    expect(previaLegivel('normal')).toBe('normal');
  });
});
