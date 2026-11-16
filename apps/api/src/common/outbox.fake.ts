/**
 * Dublê para specs: imita no `$queryRaw` o INSERT … ON CONFLICT DO NOTHING e a
 * releitura que `registrarNoOutbox` faz no Postgres (unique tenant+dedupe_key).
 * Só testes importam isto.
 */
export interface LinhaFake { id: string; tenantId: string; kind: string; dedupeKey: string; payload: unknown; status: string; createdAt: Date }

export function outboxFake(opts: { statusExistente?: string } = {}) {
  const linhas = new Map<string, LinhaFake>();
  let n = 0;
  const queryRaw = async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const sql = strings.join('?');
    if (/INSERT INTO outbox_events/.test(sql)) {
      const [tenantId, kind, dedupeKey, json] = v as [string, string, string, string];
      const k = `${tenantId}|${dedupeKey}`;
      if (linhas.has(k)) return [];
      const l: LinhaFake = { id: `ob${++n}`, tenantId, kind, dedupeKey, payload: JSON.parse(json), status: 'pending', createdAt: new Date() };
      linhas.set(k, l);
      return [{ id: l.id, status: l.status }];
    }
    if (/SELECT id, status FROM outbox_events/.test(sql)) {
      const [tenantId, dedupeKey] = v as [string, string];
      const l = linhas.get(`${tenantId}|${dedupeKey}`);
      return l ? [{ id: l.id, status: opts.statusExistente ?? l.status }] : [];
    }
    throw new Error(`outboxFake: SQL inesperado: ${sql.slice(0, 80)}`);
  };
  /** Pré-grava uma linha (ex.: evento que já chegou antes). */
  const semear = (l: Omit<LinhaFake, 'id' | 'createdAt'> & { id?: string; createdAt?: Date }) =>
    linhas.set(`${l.tenantId}|${l.dedupeKey}`, { id: l.id ?? `ob${++n}`, createdAt: l.createdAt ?? new Date(), ...l } as LinhaFake);
  return { linhas, queryRaw, semear };
}
