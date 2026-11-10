import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** Dados que acompanham UMA requisição (ou job) por toda a stack, sem prop-drill. */
export interface RequestStore {
  correlationId: string;
  tenantId?: string;
}

const als = new AsyncLocalStorage<RequestStore>();

/** Roda `fn` com um contexto isolado (usado pelo middleware e pelos workers). */
export function runWithContext<T>(store: RequestStore, fn: () => T): T {
  return als.run(store, fn);
}

/** Contexto atual (ou undefined fora de uma requisição/job). */
export function currentContext(): RequestStore | undefined {
  return als.getStore();
}

/** Correlation-id atual; gera um se ainda não há contexto (ex.: boot). */
export function correlationId(): string {
  return als.getStore()?.correlationId ?? randomUUID();
}
