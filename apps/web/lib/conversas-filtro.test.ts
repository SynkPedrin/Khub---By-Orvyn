import { describe, expect, it } from 'vitest';
import { FILTRO_INICIAL, alternarEtiqueta, canaisDaColuna, filtrarBusca, mesmoFiltro, queryDaLista } from './conversas-filtro';

describe('queryDaLista', () => {
  it('filtro inicial não manda nada', () => expect(queryDaLista(FILTRO_INICIAL)).toBe(''));
  it('canal, status e etiqueta viram parâmetros (codificados)', () => {
    expect(queryDaLista({ canal: 'E-mail', status: 'aguardando', etiqueta: 'Sem resposta' })).toBe('canal=E-mail&status=aguardando&etiqueta=Sem+resposta');
  });
});

describe('alternarEtiqueta / mesmoFiltro', () => {
  it('clicar de novo desliga (sem caixa)', () => {
    const f = alternarEtiqueta(FILTRO_INICIAL, 'VIP');
    expect(f.etiqueta).toBe('VIP');
    expect(alternarEtiqueta(f, 'vip').etiqueta).toBeNull();
  });
  it('mesmoFiltro ignora caixa da etiqueta', () => {
    expect(mesmoFiltro({ ...FILTRO_INICIAL, etiqueta: 'VIP' }, { ...FILTRO_INICIAL, etiqueta: 'vip' })).toBe(true);
    expect(mesmoFiltro(FILTRO_INICIAL, { ...FILTRO_INICIAL, canal: 'Instagram' })).toBe(false);
  });
});

describe('filtrarBusca', () => {
  const lista = [
    { nome: 'João Araújo', ultimaPrevia: 'Quero orçamento', contato: { telefone: '+55 (11) 99876-5432', empresa: 'Padaria Sol' }, etiquetas: ['Lead'] },
    { nome: 'Marina', ultimaPrevia: null, contato: null, etiquetas: ['Cliente VIP'] },
  ];
  it('sem acento e sem caixa', () => expect(filtrarBusca(lista, 'joao araujo')).toHaveLength(1));
  it('empresa e etiqueta', () => {
    expect(filtrarBusca(lista, 'padaria')[0].nome).toBe('João Araújo');
    expect(filtrarBusca(lista, 'vip')[0].nome).toBe('Marina');
  });
  it('telefone só a partir de 4 dígitos', () => {
    expect(filtrarBusca(lista, '9876')).toHaveLength(1);
    expect(filtrarBusca(lista, '98')).toHaveLength(0);
  });
  it('busca vazia devolve a lista', () => expect(filtrarBusca(lista, '  ')).toBe(lista));
});

describe('canaisDaColuna', () => {
  it('sem contagens ainda: nada e sem CTA', () => expect(canaisDaColuna(null)).toEqual({ canais: [], semNenhumConectado: false }));
  it('nenhum canal conectado: liga o "Conectar"', () => {
    expect(canaisDaColuna({ canais: { WhatsApp: 0 }, conectados: [] })).toEqual({ canais: [], semNenhumConectado: true });
  });
  it('lista conectados e canais com conversa, na ordem fixa; Messenger conectado cobre Facebook', () => {
    const r = canaisDaColuna({ canais: { WhatsApp: 12, Instagram: 0, Facebook: 2, YouTube: 0, 'E-mail': 3 }, conectados: ['WhatsApp', 'Messenger'] });
    expect(r.canais.map((c) => c.canal)).toEqual(['WhatsApp', 'Messenger', 'Facebook', 'E-mail']);
    expect(r.canais.find((c) => c.canal === 'Facebook')?.conectado).toBe(true);
    expect(r.canais.find((c) => c.canal === 'E-mail')?.conectado).toBe(false);
    expect(r.semNenhumConectado).toBe(false);
  });
  it('canal antigo fora da ordem fixa aparece se tiver conversa', () => {
    expect(canaisDaColuna({ canais: { LinkedIn: 1 }, conectados: ['WhatsApp'] }).canais.map((c) => c.canal)).toEqual(['WhatsApp', 'LinkedIn']);
  });
});
