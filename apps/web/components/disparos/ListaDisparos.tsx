'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/icons';
import { Badge } from '@/components/ui';
import { Tabs, SkeletonRows } from '@/components/kit';
import { EmptyState, ErrorState } from '@/components/revenue/States';
import { numero } from '@/lib/format';
import { disparos, ROTULO_STATUS, TOM_STATUS, type Disparo, type Limites, type StatusDisparo } from '@/lib/disparos';

type Aba = 'todos' | 'andamento' | 'aprovacao' | 'rascunhos' | 'encerrados';
const FILTRO: Record<Aba, StatusDisparo[] | null> = {
  todos: null,
  andamento: ['agendado', 'enviando', 'pausado'],
  aprovacao: ['aguardando_aprovacao'],
  rascunhos: ['rascunho'],
  encerrados: ['concluido', 'cancelado'],
};

/** Barra de progresso do disparo: o que já foi resolvido sobre o total congelado. */
export function ProgressoDisparo({ d, className }: { d: Pick<Disparo, 'totais'>; className?: string }) {
  const t = d.totais;
  const feitos = t.enviados + t.falhas + t.ignorados;
  const pct = t.destinatarios ? Math.round((feitos / t.destinatarios) * 100) : 0;
  return (
    <div className={className}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progresso do disparo">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted tabular">{numero(feitos)} de {numero(t.destinatarios)} · {pct}%</p>
    </div>
  );
}

export function StatusDisparoBadge({ status }: { status: StatusDisparo }) {
  return <Badge tone={TOM_STATUS[status]}>{ROTULO_STATUS[status]}</Badge>;
}

/** Aviso do limite diário por tenant (protege o número de WhatsApp). */
export function AvisoLimiteDiario({ limites }: { limites: Limites | null }) {
  if (!limites) return null;
  const usados = limites.usadosHoje.whatsapp;
  const limite = limites.diario.whatsapp;
  const perto = usados >= limite * 0.8;
  return (
    <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${perto ? 'bg-warning-soft text-warning' : 'bg-surface2 text-muted'}`}>
      <Icon name="shield" size={14} className="mt-0.5 shrink-0" />
      <p>
        Para proteger o seu número, o WhatsApp tem limite de <strong className="tabular">{numero(limite)}</strong> envios por dia nesta conta.
        Hoje já saíram <strong className="tabular">{numero(usados)}</strong>. O que passar disso continua no dia seguinte, dentro da janela.
      </p>
    </div>
  );
}

/** Aba "Disparos" de /campanhas: lista com status e métricas. */
export function ListaDisparos() {
  const [lista, setLista] = useState<Disparo[] | null>(null);
  const [limites, setLimites] = useState<Limites | null>(null);
  const [erro, setErro] = useState(false);
  const [aba, setAba] = useState<Aba>('todos');

  const carregar = useCallback(() => {
    setErro(false);
    disparos.listar().then(setLista).catch(() => setErro(true));
    disparos.limites().then(setLimites).catch(() => setLimites(null));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  // Atualiza sozinho enquanto algo está saindo.
  const ativo = lista?.some((d) => d.status === 'enviando' || d.status === 'agendado');
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(() => { disparos.listar().then(setLista).catch(() => undefined); }, 8000);
    return () => clearInterval(t);
  }, [ativo]);

  const contagem = useMemo(() => {
    const c = {} as Record<Aba, number>;
    for (const a of Object.keys(FILTRO) as Aba[]) c[a] = (lista ?? []).filter((d) => !FILTRO[a] || FILTRO[a]!.includes(d.status)).length;
    return c;
  }, [lista]);
  const visiveis = (lista ?? []).filter((d) => !FILTRO[aba] || FILTRO[aba]!.includes(d.status));

  const novo = (
    <Link href="/campanhas/disparos/novo" className="btn btn-primary btn-sm">
      <Icon name="plus" size={15} />
      Novo disparo
    </Link>
  );

  return (
    <section className="card overflow-hidden p-0" aria-label="Disparos em massa">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <span className="icon-tile h-9 w-9 rounded-lg"><Icon name="send" size={18} /></span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg">Disparos em massa</h2>
          <p className="text-xs text-muted">WhatsApp ou e-mail para um segmento, em lotes, dentro da janela e com aprovação.</p>
        </div>
        <div className="ml-auto">{novo}</div>
      </div>

      <div className="space-y-3 px-5 pt-4">
        <AvisoLimiteDiario limites={limites} />
        <Tabs
          idBase="disparos-abas"
          label="Filtrar disparos"
          value={aba}
          onChange={setAba}
          items={[
            { value: 'todos', label: 'Todos', count: contagem.todos },
            { value: 'andamento', label: 'Em andamento', count: contagem.andamento },
            { value: 'aprovacao', label: 'Aguardando aprovação', count: contagem.aprovacao },
            { value: 'rascunhos', label: 'Rascunhos', count: contagem.rascunhos },
            { value: 'encerrados', label: 'Encerrados', count: contagem.encerrados },
          ]}
        />
      </div>

      {erro && <ErrorState description="Não foi possível carregar os disparos." onRetry={carregar} className="py-10" />}
      {!erro && !lista && <div className="p-5"><SkeletonRows rows={4} label="Carregando disparos" /></div>}
      {!erro && lista && visiveis.length === 0 && (
        <EmptyState
          icon="send"
          title={lista.length ? 'Nenhum disparo nesta aba' : 'Nenhum disparo ainda'}
          description={lista.length ? 'Troque de aba para ver os outros.' : 'Monte o primeiro: escolha o canal, escreva a mensagem, defina o segmento e o ritmo. Disparos grandes passam por aprovação.'}
          action={lista.length ? undefined : novo}
          className="py-10"
        />
      )}
      {!erro && visiveis.length > 0 && (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-y border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-2.5 font-semibold">Disparo</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold">Progresso</th>
                <th className="px-3 py-2.5 text-right font-semibold">Enviados</th>
                <th className="px-3 py-2.5 text-right font-semibold">Falhas</th>
                <th className="px-5 py-2.5 text-right font-semibold">Respostas</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((d) => (
                <tr key={d.id} className="border-b border-line last:border-0 hover:bg-surface2">
                  <td className="px-5 py-3">
                    <Link href={d.status === 'rascunho' ? `/campanhas/disparos/novo?id=${d.id}` : `/campanhas/disparos/${d.id}`} className="font-medium text-fg hover:text-brand">
                      {d.nome}
                    </Link>
                    <p className="flex items-center gap-1.5 text-xs text-muted">
                      <Icon name={d.canal === 'whatsapp' ? 'whatsapp' : 'mail'} size={12} />
                      {d.canal === 'whatsapp' ? 'WhatsApp' : 'E-mail'}
                      {d.criadoPorTipo === 'nyro' && <span className="text-brand">· preparado pela Nyro</span>}
                      <span>· {new Date(d.createdAt).toLocaleDateString('pt-BR')}</span>
                    </p>
                  </td>
                  <td className="px-3 py-3"><StatusDisparoBadge status={d.status} /></td>
                  <td className="min-w-40 px-3 py-3">{d.totais.destinatarios > 0 ? <ProgressoDisparo d={d} /> : <span className="text-xs text-muted">Audiência ainda não congelada</span>}</td>
                  <td className="px-3 py-3 text-right tabular text-fg">{numero(d.totais.enviados)}</td>
                  <td className="px-3 py-3 text-right tabular text-fg">{numero(d.totais.falhas)}</td>
                  <td className="px-5 py-3 text-right tabular font-semibold text-brand">{numero(d.totais.respostas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
