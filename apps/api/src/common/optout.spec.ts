import { ehPedidoDeOptOut } from './optout';

describe('opt-out na mensagem do contato', () => {
  it.each([
    'STOP', 'parar', 'Sair', 'descadastrar',
    'para de me mandar mensagem', 'Parem de enviar essas mensagens por favor',
    'não me mande mais nada', 'Não quero mais receber mensagens', 'não quero receber',
    'me tira dessa lista', 'remove meu número da lista', 'cancelar as mensagens',
  ])('marca opt-out: %s', (t) => expect(ehPedidoDeOptOut(t)).toBe(true));

  it.each([
    'Cancelar meu horário de amanhã', 'cancela a escova de sexta', 'Não quero sexta, prefiro sábado',
    'não quero fazer luzes agora', 'Parar de pintar o cabelo faz mal?', 'quero sair do horário das 9h',
    'remover esmalte em gel tem custo?', 'ok', 'obrigada', 'não',
  ])('NÃO marca opt-out: %s', (t) => expect(ehPedidoDeOptOut(t)).toBe(false));
});
