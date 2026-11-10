'use client';

import { ApiError } from '@/lib/api-error';

/** Rótulos dos campos do CRM, para traduzir os erros do class-validator. */
const CAMPOS: Record<string, string> = {
  nome: 'Nome',
  email: 'E-mail',
  telefone: 'Telefone',
  empresa: 'Empresa',
  tag: 'Tag',
  valorEstimado: 'Valor estimado',
  titulo: 'Título',
  stageId: 'Etapa',
  contactId: 'Contato',
  valor: 'Valor',
  origem: 'Origem',
};

/**
 * Converte qualquer falha de chamada ao CRM em uma frase em português.
 *
 * O class-validator responde em inglês ("nome must be shorter than..."); a
 * primeira palavra de cada mensagem é o nome do campo, então mostramos só os
 * campos que precisam de correção, com o rótulo que o usuário vê no formulário.
 */
export function mensagemErroCrm(e: unknown): string {
  if (!(e instanceof ApiError)) {
    return 'Sem conexão com o servidor. Verifique sua internet e tente de novo.';
  }

  const erros = Array.isArray(e.body?.errors) ? (e.body.errors as unknown[]).map(String) : [];

  switch (true) {
    case e.status === 400 || e.status === 422: {
      const campos = Array.from(new Set(erros.map((m) => CAMPOS[m.split(' ')[0] ?? '']).filter(Boolean)));
      if (campos.length > 0) return `Confira ${campos.length > 1 ? 'os campos' : 'o campo'}: ${campos.join(', ')}.`;
      const titulo = typeof e.body?.title === 'string' ? e.body.title : '';
      if (titulo && !/exception|bad request|unprocessable/i.test(titulo)) return titulo;
      return 'Alguns dados estão inválidos. Confira o formulário e tente de novo.';
    }
    case e.status === 401:
      return 'Sua sessão expirou. Entre novamente para continuar.';
    case e.status === 403:
      return 'Você não tem permissão para fazer isso.';
    case e.status === 404:
      return 'Registro não encontrado. Ele pode ter sido removido.';
    case e.status === 409:
      return 'Já existe um registro com esses dados.';
    case e.status === 429:
      return 'Muitas tentativas seguidas. Aguarde um instante e tente de novo.';
    case e.status >= 500:
      return 'O servidor não conseguiu concluir agora. Tente novamente em instantes.';
    default:
      return `Não foi possível salvar (erro ${e.status}).`;
  }
}

/** Lê um valor monetário digitado ("1.500,50", "1500.5", "") como número. */
export function lerValor(texto: string): number | null | 'invalido' {
  const t = texto.trim();
  if (!t) return null;
  const normalizado = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normalizado);
  if (!Number.isFinite(n) || n < 0) return 'invalido';
  return n;
}
