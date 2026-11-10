'use client';

import { ApiError } from './api-error';

/**
 * Cliente HTTP com renovação de sessão.
 *
 * Existe para corrigir um LOOP DE REDIRECIONAMENTO INFINITO e para acabar com
 * dez cópias da mesma lógica espalhadas por `lib/*.ts`.
 *
 * ## O bug que isto corrige
 *
 * Quando o cookie `khub_refresh` existe mas não pode ser validado (expirado,
 * revogado, ou API fora do ar), acontecia isto:
 *
 *   1. a chamada responde 401
 *   2. o cliente tenta `/api/auth/refresh` → falha
 *   3. o cliente faz `location.href = '/login'`  ← SEM limpar o cookie
 *   4. o middleware vê o cookie presente e trata `/login` como rota pública
 *      para quem já está logado → devolve para `/`
 *   5. a página monta, chama a API de novo → volta ao passo 1
 *
 * O navegador entra em recarga perpétua, o servidor toma uma enxurrada de
 * requisições, e o usuário NUNCA alcança a tela de login para se recuperar.
 *
 * A correção é o passo 3: encerrar a sessão de verdade antes de sair.
 * `/api/auth/logout` apaga os cookies no servidor e ignora falha da API
 * (`.catch`), então funciona mesmo com o backend indisponível. Sem cookie, o
 * middleware deixa `/login` renderizar e o ciclo se fecha.
 */

/**
 * Renovação compartilhada.
 *
 * Numa carga de página, vários componentes chamam a API ao mesmo tempo e todos
 * recebem 401 juntos. Sem isto, cada um dispara o próprio `/api/auth/refresh` —
 * eram 2 a 6 chamadas idênticas por carga no log. Agora a primeira cria a
 * promessa e as demais esperam nela.
 */
let renovacaoEmCurso: Promise<boolean> | null = null;

function renovarSessao(): Promise<boolean> {
  renovacaoEmCurso ??= fetch('/api/auth/refresh', { method: 'POST' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      // Libera para a próxima vez que um 401 aparecer.
      renovacaoEmCurso = null;
    });
  return renovacaoEmCurso;
}

/**
 * Encerra a sessão e leva para o login.
 *
 * `encerrando` impede que dez chamadas falhando em paralelo disparem dez
 * logouts e dez navegações concorrentes.
 */
let encerrando = false;

async function encerrarSessao(): Promise<void> {
  if (typeof window === 'undefined' || encerrando) return;
  encerrando = true;

  // Apaga os cookies no servidor. Sem isto o middleware devolve /login para /
  // e o loop recomeça.
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);

  // `replace` e não `href`: a página expirada não deve ficar no histórico,
  // senão o botão Voltar recria o ciclo.
  window.location.replace('/login');
}

/**
 * Executa uma chamada autenticada.
 *
 * Em 401: tenta renovar a sessão uma vez e repete. Se a renovação falhar,
 * encerra a sessão e vai para o login — e lança, para que quem chamou não
 * siga processando uma resposta que não existe.
 */
export async function chamarApi<T>(url: string, opts?: RequestInit): Promise<T> {
  const executar = () => fetch(url, { headers: { 'content-type': 'application/json' }, ...opts });

  let r = await executar();

  if (r.status === 401) {
    if (await renovarSessao()) {
      r = await executar();
    } else {
      void encerrarSessao();
      throw new ApiError(401, { title: 'Sessão expirada' });
    }
  }

  if (!r.ok) throw new ApiError(r.status, await r.json().catch(() => ({})));
  return r.json() as Promise<T>;
}

/**
 * Cria um cliente preso a um prefixo de rota.
 *
 * Ex.: `const req = clienteApi('/api/v1/agenda/')` → `req('eventos')`.
 */
export function clienteApi(prefixo: string) {
  return <T>(caminho: string, opts?: RequestInit): Promise<T> => chamarApi<T>(`${prefixo}${caminho}`, opts);
}
