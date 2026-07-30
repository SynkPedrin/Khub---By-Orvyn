import { TOOLS } from './tools';

/**
 * O que a Nyro sabe fazer, em português, para a UI mostrar antes de conectar a
 * chave. Deriva do catálogo real: promessa aqui é sempre uma tool que existe.
 */
export const CATALOGO_PUBLICO = TOOLS.map((t) => ({
  nome: t.nome,
  descricao: t.descricao,
  precisaAprovacao: t.sensibilidade === 'sensivel',
}));
