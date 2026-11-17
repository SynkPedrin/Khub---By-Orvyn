/**
 * Pedido de opt-out ("não quero mais receber mensagens") na mensagem do contato.
 *
 * Antes era `^(stop|parar|sair|cancelar|remover|não quero)`: "Cancelar meu
 * horário de amanhã" e "Não quero sexta, prefiro sábado" marcavam opt-out PARA
 * SEMPRE (a IA nunca mais respondia), enquanto "para de me mandar mensagem"
 * passava batido. Agora: palavra-comando sozinha OU frase explícita sobre
 * receber mensagens. Na dúvida NÃO marca — tirar alguém do atendimento por
 * engano é pior que uma mensagem a mais, que a pessoa pode recusar de novo.
 */
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

const COMANDO_SOZINHO = /^(stop|parar|pare|sair|descadastrar|descadastra|remover|unsubscribe)$/;
const FRASES = [
  /\b(para|pare|parem|parar) de (me )?(mandar|enviar|encher)\b/,
  /\bnao (me )?(mande|mandem|envie|enviem|manda|envia) mais\b/,
  /\bnao quero (mais )?(receber|ser contatad\w*|que me (mandem|enviem|chamem))\b/,
  /\b(me )?(tira|tire|remove|remova|exclui|exclua|retira|retire) (meu (numero|contato)|eu)? ?(da|dessa|desta|do|dessa) (lista|cadastro|contato\w*|grupo)\b/,
  /\bnao (quero|desejo) mais (mensagens?|contato|receber)\b/,
  /\b(cancelar|cancela|cancele) (as |essas |estas )?(mensagens|notificacoes|inscricao|envios)\b/,
];

export function ehPedidoDeOptOut(texto: string): boolean {
  const t = norm(texto);
  if (!t) return false;
  if (COMANDO_SOZINHO.test(t)) return true;
  return FRASES.some((re) => re.test(t));
}
