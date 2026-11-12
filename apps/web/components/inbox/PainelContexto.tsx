'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { Skeleton } from '@/components/kit';
import { ErrorState } from '@/components/revenue/States';
import { brl } from '@/lib/crm';
import { agenda, type Compromisso } from '@/lib/agenda';
import { inbox, type ContextoConversa } from '@/lib/inbox';

const dataCurta = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function Secao({ titulo, icone, children, acao }: { titulo: string; icone: IconName; children: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3.5 last:border-b-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          <Icon name={icone} size={13} /> {titulo}
        </h3>
        {acao}
      </div>
      {children}
    </section>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
      <span className="shrink-0 text-muted">{rotulo}</span>
      <span className="min-w-0 truncate text-right text-fg">{valor}</span>
    </div>
  );
}

/**
 * Painel lateral de contexto do Inbox (Q2.5): quem é o contato, o negócio
 * aberto (etapa e valor), próximas tarefas e compromissos, com atalhos para o
 * perfil. Compromissos vêm da API da Agenda (outro módulo), filtrados pelo
 * contato da conversa.
 */
export function PainelContexto({ conversationId, versao, onContexto }: { conversationId: string; versao: number; onContexto?: (c: ContextoConversa | null) => void }) {
  const [ctx, setCtx] = useState<ContextoConversa | null>(null);
  const [compromissos, setCompromissos] = useState<Compromisso[] | null>(null);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(async () => {
    setErro(false);
    try {
      const c = await inbox.contexto(conversationId);
      setCtx(c);
      onContexto?.(c);
      if (c.contato) {
        const de = new Date().toISOString();
        const ate = new Date(Date.now() + 90 * 864e5).toISOString();
        const lista = await agenda.compromissos({ de, ate }).catch(() => [] as Compromisso[]);
        setCompromissos(
          lista
            .filter((x) => x.contactId === c.contato!.id && x.status !== 'cancelado')
            .sort((a, b) => a.inicio.localeCompare(b.inicio))
            .slice(0, 3),
        );
      } else setCompromissos([]);
    } catch {
      setErro(true);
      onContexto?.(null);
    }
  }, [conversationId, onContexto]);

  useEffect(() => {
    setCtx(null);
    setCompromissos(null);
    void carregar();
  }, [carregar, versao]);

  if (erro) {
    return (
      <div className="p-4">
        <ErrorState title="Não consegui carregar o contexto" description="Tente de novo em instantes." onRetry={() => void carregar()} />
      </div>
    );
  }
  if (!ctx) {
    return (
      <div className="space-y-4 p-4" aria-busy="true">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const c = ctx.contato;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      <Secao
        titulo="Contato"
        icone="user"
        acao={c ? <Link href={`/contatos/${c.id}`} className="text-xs font-medium text-brand hover:underline">Abrir perfil</Link> : undefined}
      >
        {c ? (
          <>
            <p className="mb-1.5 truncate text-base font-semibold text-fg">{c.nome}</p>
            <Linha rotulo="Telefone" valor={c.telefone ? <span className="tabular">{c.telefone}</span> : <span className="text-muted">Sem telefone</span>} />
            {c.email && <Linha rotulo="E-mail" valor={c.email} />}
            {c.empresa && <Linha rotulo="Empresa" valor={c.empresa} />}
            <Linha rotulo="Origem" valor={c.origem ?? <span className="text-muted">Não informada</span>} />
            <Linha rotulo="Dono" valor={c.dono?.nome ?? <span className="text-muted">Sem dono</span>} />
            {c.tags.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Tags">
                {c.tags.map((t) => (
                  <li key={t} className="pill">
                    <Icon name="tag" size={11} /> {t}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">Conversa sem contato vinculado.</p>
        )}
      </Secao>

      <Secao titulo="Pipeline e etapa" icone="briefcase">
        {ctx.negocios.length === 0 ? (
          <p className="text-sm text-muted">Nenhum negócio aberto com este contato.</p>
        ) : (
          <ul className="space-y-2">
            {ctx.negocios.map((d) => (
              <li key={d.id}>
                <Link href={`/pipeline?deal=${d.id}`} className="block rounded-xl border border-line px-3 py-2 transition-colors hover:bg-[var(--fill-4)]">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-fg">{d.titulo}</span>
                    <span className="shrink-0 text-sm font-semibold text-fg tabular">{brl(d.valor)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={d.cor ? { background: d.cor } : undefined} aria-hidden />
                    <span className="truncate">{d.etapa}{d.funil ? ` · ${d.funil}` : ''}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao titulo="Próximos compromissos" icone="calendar" acao={<Link href="/agenda" className="text-xs font-medium text-brand hover:underline">Agenda</Link>}>
        {compromissos === null ? (
          <Skeleton className="h-10 w-full" />
        ) : compromissos.length === 0 ? (
          <p className="text-sm text-muted">Nada agendado.</p>
        ) : (
          <ul className="space-y-1.5">
            {compromissos.map((x) => (
              <li key={x.id} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-fg">{x.titulo}</span>
                <span className="shrink-0 text-xs text-muted tabular">{dataCurta(x.inicio)}</span>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao titulo="Tarefas" icone="check" acao={<Link href="/tarefas" className="text-xs font-medium text-brand hover:underline">Ver todas</Link>}>
        {ctx.tarefas.length === 0 ? (
          <p className="text-sm text-muted">Sem tarefas pendentes.</p>
        ) : (
          <ul className="space-y-1.5">
            {ctx.tarefas.map((t) => (
              <li key={t.id} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-fg">{t.titulo}</span>
                {t.dueAt && <span className="shrink-0 text-xs text-muted tabular">{dataCurta(t.dueAt)}</span>}
              </li>
            ))}
          </ul>
        )}
      </Secao>

      {/* Dados do Lead (Conversas, db/063): observações e atividades do contato. */}
      <Secao
        titulo="Observações"
        icone="note"
        acao={c ? <Link href={`/contatos/${c.id}`} className="text-xs font-medium text-brand hover:underline">Adicionar</Link> : undefined}
      >
        {!ctx.observacoes?.length ? (
          <p className="text-sm text-muted">Nenhuma observação sobre este contato.</p>
        ) : (
          <ul className="space-y-2">
            {ctx.observacoes.map((n) => (
              <li key={n.id} className="rounded-xl bg-[var(--fill-4)] px-3 py-2">
                <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm text-fg">{n.corpo}</p>
                <p className="mt-1 text-xs text-muted">{n.autor ? `${n.autor}, ` : ''}{dataCurta(n.criadaEm)}</p>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao
        titulo="Atividades recentes"
        icone="history"
        acao={c ? <Link href={`/contatos/${c.id}`} className="text-xs font-medium text-brand hover:underline">Ver todas</Link> : undefined}
      >
        {!ctx.atividades?.length ? (
          <p className="text-sm text-muted">Sem atividade registrada.</p>
        ) : (
          <ul className="space-y-2">
            {ctx.atividades.map((a) => (
              <li key={a.id} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-3)]" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-fg">{a.acao}</span>
                  <span className="block text-xs text-muted">{a.ator ? `${a.ator}, ` : ''}{dataCurta(a.criadaEm)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Secao>
    </div>
  );
}
