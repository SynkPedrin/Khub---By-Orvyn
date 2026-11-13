'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Icon } from '@/components/icons';
import { Input } from '@/components/ui';
import { Button, Confirm, Modal, Tabs, Textarea, SkeletonDetail, SkeletonRows, useToast } from '@/components/kit';
import { PageShell, PageHeader } from '@/components/revenue/Page';
import { EmptyState, ErrorState } from '@/components/revenue/States';
import { ProgressoDisparo, StatusDisparoBadge } from '@/components/disparos/ListaDisparos';
import { ApiError, providerLabel } from '@/lib/api-error';
import { useAuth } from '@/lib/auth';
import { numero, percentual } from '@/lib/format';
import { disparos, motivoDaPausa, ROTULO_DESTINATARIO, DIAS_SEMANA, type Destinatario, type Disparo, type StatusDestinatario } from '@/lib/disparos';

type FiltroDest = 'todos' | StatusDestinatario;

function erroLegivel(e: unknown, padrao: string): string {
  if (e instanceof ApiError) {
    const cfg = e.configRequired;
    if (cfg) return `Conecte ${providerLabel(cfg.provider)} para continuar.`;
    return e.message || padrao;
  }
  return padrao;
}

export default function DisparoDetalhePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const aprovador = ['owner', 'admin'].includes(user?.role ?? '');
  const [d, setD] = useState<Disparo | null>(null);
  const [erro, setErro] = useState(false);
  const [acao, setAcao] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<'cancelar' | 'excluir' | null>(null);
  const [rejeitando, setRejeitando] = useState(false);
  const [motivo, setMotivo] = useState('');

  const carregar = useCallback(() => {
    disparos.obter(id).then((x) => { setD(x); setErro(false); }).catch(() => setErro(true));
  }, [id]);
  useEffect(() => { carregar(); }, [carregar]);

  // Progresso ao vivo enquanto há lote para sair.
  const vivo = d?.status === 'enviando' || d?.status === 'agendado';
  useEffect(() => {
    if (!vivo) return;
    const t = setInterval(carregar, 5000);
    return () => clearInterval(t);
  }, [vivo, carregar]);

  const executar = async (nome: string, fn: () => Promise<Disparo | { ok: boolean }>, sucesso: string) => {
    setAcao(nome);
    try {
      const r = await fn();
      if ('id' in r) setD({ ...d!, ...r });
      toast.success(sucesso);
      carregar();
      return true;
    } catch (e) {
      toast.error('Não foi possível concluir', { description: erroLegivel(e, 'Tente de novo em instantes.') });
      return false;
    } finally {
      setAcao(null);
    }
  };

  if (erro) return <PageShell><ErrorState description="Disparo não encontrado ou sem acesso." onRetry={carregar} /></PageShell>;
  if (!d) return <PageShell><SkeletonDetail label="Carregando disparo" /></PageShell>;

  const t = d.totais;
  const motivoPausa = motivoDaPausa(d);
  const precisaConectar = d.pausaMotivo === 'config_required' || d.pausaMotivo === 'canal_desconectado';
  const j = d.janela;

  return (
    <PageShell>
      <PageHeader
        title={d.nome}
        subtitle={`${d.canal === 'whatsapp' ? 'WhatsApp' : 'E-mail'} · criado em ${new Date(d.createdAt).toLocaleString('pt-BR')}${d.criadoPorTipo === 'nyro' ? ' · preparado pela Nyro' : ''}`}
        actions={<Link href="/campanhas" className="btn btn-ghost btn-sm"><Icon name="arrowLeft" size={15} /> Campanhas</Link>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusDisparoBadge status={d.status} />
        {d.status === 'aguardando_aprovacao' && aprovador && (
          <>
            <Button icon="check" loading={acao === 'aprovar'} onClick={() => void executar('aprovar', () => disparos.aprovar(d.id), 'Disparo aprovado')}>Aprovar e congelar a lista</Button>
            <Button variant="ghost" onClick={() => setRejeitando(true)}>Devolver para ajuste</Button>
          </>
        )}
        {d.status === 'aguardando_aprovacao' && !aprovador && <span className="text-sm text-muted">Aguardando um owner ou admin aprovar.</span>}
        {d.status === 'rascunho' && <Link href={`/campanhas/disparos/novo?id=${d.id}`} className="btn btn-sm"><Icon name="edit" size={15} /> Editar</Link>}
        {(d.status === 'agendado' || d.status === 'enviando') && (
          <Button variant="soft" icon="pause" loading={acao === 'pausar'} onClick={() => void executar('pausar', () => disparos.pausar(d.id), 'Disparo pausado')}>Pausar</Button>
        )}
        {d.status === 'pausado' && (
          <Button icon="play" loading={acao === 'retomar'} onClick={() => void executar('retomar', () => disparos.retomar(d.id), 'Disparo retomado')}>Retomar</Button>
        )}
        <div className="ml-auto flex gap-2">
          {['aguardando_aprovacao', 'agendado', 'enviando', 'pausado'].includes(d.status) && (
            <Button variant="danger" icon="close" onClick={() => setConfirmar('cancelar')}>Cancelar disparo</Button>
          )}
          {d.status === 'rascunho' && <Button variant="danger" icon="trash" onClick={() => setConfirmar('excluir')}>Excluir</Button>}
        </div>
      </div>

      {motivoPausa && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning" role="status">
          <Icon name="alert" size={16} />
          <span>{motivoPausa}</span>
          {d.pausaDetalhe?.missing && d.pausaDetalhe.missing.length > 0 && (
            <span className="flex gap-1">{d.pausaDetalhe.missing.map((m) => <code key={m} className="rounded-sm bg-surface3 px-1.5 text-xs text-muted">{m}</code>)}</span>
          )}
          {precisaConectar && (
            <Link href="/configuracoes?tab=integracoes" className="btn btn-sm ml-auto">
              Conectar {providerLabel(d.pausaDetalhe?.provider ?? (d.canal === 'email' ? 'email' : 'evolution'))}
            </Link>
          )}
        </div>
      )}
      {d.rejeitadoMotivo && d.status === 'rascunho' && (
        <p className="mb-4 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning"><strong>Devolvido na aprovação:</strong> {d.rejeitadoMotivo}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { l: 'Destinatários', v: numero(t.destinatarios), s: t.destinatarios ? 'lista congelada' : 'congela ao aprovar' },
          { l: 'Enviados', v: numero(t.enviados), s: `${numero(t.pendentes)} na fila` },
          { l: 'Falhas', v: numero(t.falhas), s: t.enviados + t.falhas ? percentual(t.falhas / (t.enviados + t.falhas)) : '-' },
          { l: 'Respostas (72h)', v: numero(t.respostas), s: t.enviados ? `${percentual(t.respostas / t.enviados)} dos enviados` : '-' },
          { l: 'Fora da lista', v: numero(t.ignorados), s: 'opt-out ou sem canal' },
        ].map((k) => (
          <div key={k.l} className="card p-4">
            <p className="text-xs text-muted">{k.l}</p>
            <p className="mt-1 text-2xl font-semibold tabular text-fg">{k.v}</p>
            <p className="text-xs text-muted">{k.s}</p>
          </div>
        ))}
      </div>

      {t.destinatarios > 0 && (
        <div className="card mt-3 p-4">
          <ProgressoDisparo d={d} />
          {d.proximoLoteEm && vivo && <p className="mt-1 text-xs text-muted">Próximo lote: {new Date(d.proximoLoteEm).toLocaleString('pt-BR')}</p>}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <ListaDestinatarios d={d} vivo={vivo} />
        <aside className="space-y-4">
          <div className="card p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Mensagem</p>
            {d.assunto && <p className="mb-1 text-sm font-semibold text-fg">{d.assunto}</p>}
            <p className="whitespace-pre-wrap break-words text-sm text-fg">{d.mensagem}</p>
          </div>
          <div className="card space-y-1.5 p-4 text-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Ritmo</p>
            <p className="text-fg">{d.loteTamanho} por lote, a cada {d.loteIntervaloSeg >= 60 ? `${Math.round(d.loteIntervaloSeg / 60)} min` : `${d.loteIntervaloSeg} s`}</p>
            <p className="text-muted">{j.dias.map((x) => DIAS_SEMANA[x]).join(', ')}, {String(j.inicio).padStart(2, '0')}:00 às {String(j.fim).padStart(2, '0')}:00</p>
            {d.agendadoPara && <p className="text-muted">Início agendado: {new Date(d.agendadoPara).toLocaleString('pt-BR')}</p>}
            {d.aprovadoEm && <p className="text-muted">Aprovado em {new Date(d.aprovadoEm).toLocaleString('pt-BR')}</p>}
            {d.concluidoEm && <p className="text-muted">Concluído em {new Date(d.concluidoEm).toLocaleString('pt-BR')}</p>}
          </div>
        </aside>
      </div>

      <Confirm
        open={confirmar !== null}
        onClose={() => setConfirmar(null)}
        title={confirmar === 'excluir' ? 'Excluir este rascunho?' : 'Cancelar este disparo?'}
        description={confirmar === 'excluir' ? 'O rascunho some e não dá para desfazer.' : 'Quem ainda está na fila não recebe mais. O que já saiu continua nas conversas. Não dá para desfazer.'}
        confirmLabel={confirmar === 'excluir' ? 'Excluir' : 'Cancelar disparo'}
        cancelLabel="Voltar"
        loading={acao === 'cancelar' || acao === 'excluir'}
        onConfirm={async () => {
          if (confirmar === 'excluir') {
            if (await executar('excluir', () => disparos.remover(d.id), 'Rascunho excluído')) router.push('/campanhas');
          } else await executar('cancelar', () => disparos.cancelar(d.id), 'Disparo cancelado');
          setConfirmar(null);
        }}
      />
      <Modal
        open={rejeitando}
        onClose={() => setRejeitando(false)}
        title="Devolver para ajuste"
        description="O disparo volta a rascunho com o seu comentário. Nada é enviado."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejeitando(false)}>Voltar</Button>
            <Button disabled={!motivo.trim()} loading={acao === 'rejeitar'} onClick={async () => { if (await executar('rejeitar', () => disparos.rejeitar(d.id, motivo.trim()), 'Devolvido para ajuste')) { setRejeitando(false); setMotivo(''); } }}>Devolver</Button>
          </>
        }
      >
        <Textarea rows={4} maxLength={500} showCount value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: troque o horário para depois das 10h e tire a tag de clientes antigos." />
      </Modal>
    </PageShell>
  );
}

function ListaDestinatarios({ d, vivo }: { d: Disparo; vivo: boolean }) {
  const [filtro, setFiltro] = useState<FiltroDest>('todos');
  const [busca, setBusca] = useState('');
  const [itens, setItens] = useState<Destinatario[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  const [mais, setMais] = useState(false);

  const buscar = useCallback(async (append: string | null) => {
    try {
      const r = await disparos.destinatarios(d.id, { status: filtro === 'todos' ? undefined : filtro, busca: busca.trim() || undefined, cursor: append ?? undefined });
      setItens((atual) => (append && atual ? [...atual, ...r.items] : r.items));
      setCursor(r.nextCursor);
      setErro(false);
    } catch {
      setErro(true);
    }
  }, [d.id, filtro, busca]);

  useEffect(() => {
    const t = setTimeout(() => void buscar(null), 300);
    return () => clearTimeout(t);
  }, [buscar]);
  useEffect(() => {
    if (!vivo) return;
    const t = setInterval(() => void buscar(null), 10_000);
    return () => clearInterval(t);
  }, [vivo, buscar]);

  const ps = d.porStatus;
  const itensAbas: { value: FiltroDest; label: string; count?: number }[] = [
    { value: 'todos', label: 'Todos', count: d.totais.destinatarios },
    ...(['pendente', 'enviado', 'respondeu', 'falhou', 'ignorado_optout', 'ignorado_sem_canal'] as StatusDestinatario[]).map((s) => ({ value: s, label: ROTULO_DESTINATARIO[s], count: ps?.[s] })),
  ];

  return (
    <section className="card overflow-hidden p-0" aria-label="Destinatários">
      <div className="space-y-3 px-5 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-fg">Destinatários</h2>
          <div className="ml-auto w-full sm:w-64">
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou contato" aria-label="Buscar destinatário" />
          </div>
        </div>
        <Tabs idBase="dest-abas" label="Filtrar destinatários" value={filtro} onChange={setFiltro} items={itensAbas} />
      </div>
      {erro && <ErrorState description="Não foi possível carregar os destinatários." onRetry={() => void buscar(null)} className="py-8" />}
      {!erro && !itens && <div className="p-5"><SkeletonRows rows={5} label="Carregando destinatários" /></div>}
      {!erro && itens && itens.length === 0 && (
        <EmptyState icon="users" title={d.totais.destinatarios ? 'Ninguém com este filtro' : 'Lista ainda não congelada'} description={d.totais.destinatarios ? undefined : 'Os destinatários aparecem aqui quando o disparo é aprovado ou agendado.'} className="py-8" />
      )}
      {!erro && itens && itens.length > 0 && (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-y border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-2.5 font-semibold">Contato</th>
                <th className="px-3 py-2.5 font-semibold">Situação</th>
                <th className="px-5 py-2.5 font-semibold">Quando</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((x) => (
                <tr key={x.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-2.5">
                    <Link href={`/contatos/${x.contactId}`} className="font-medium text-fg hover:text-brand">{x.nome || 'Contato'}</Link>
                    <p className="text-xs text-muted tabular">{x.destino ?? 'sem canal'}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-fg">{ROTULO_DESTINATARIO[x.status]}</span>
                    {x.erro && <p className="max-w-xs truncate text-xs text-muted" title={x.erro}>{x.erro}</p>}
                  </td>
                  <td className="px-5 py-2.5 text-xs text-muted">
                    {x.respondidoEm ? `respondeu ${new Date(x.respondidoEm).toLocaleString('pt-BR')}` : x.enviadoEm ? new Date(x.enviadoEm).toLocaleString('pt-BR') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cursor && (
            <div className="p-4 text-center">
              <Button variant="soft" size="sm" loading={mais} onClick={async () => { setMais(true); await buscar(cursor); setMais(false); }}>Carregar mais</Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
