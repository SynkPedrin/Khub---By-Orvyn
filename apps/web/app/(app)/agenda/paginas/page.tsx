'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button, Confirm, Menu, Modal, SkeletonRows, useToast } from '@/components/kit';
import { Icon } from '@/components/icons';
import { Badge, Input } from '@/components/ui';
import { PageHeader, PageShell } from '@/components/revenue/Page';
import { EmptyState, ErrorState } from '@/components/revenue/States';
import { mensagemDeErro } from '@/lib/formularios';
import { paginasAgendamento, type PaginaAgendamento } from '@/lib/paginas-agendamento';

/** Páginas de agendamento público (Q4.2): lista, criar e atalhos. */
export default function PaginasAgendamentoPage() {
  const router = useRouter();
  const toast = useToast();
  const [lista, setLista] = useState<PaginaAgendamento[] | null>(null);
  const [erro, setErro] = useState(false);
  const [criando, setCriando] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [excluir, setExcluir] = useState<PaginaAgendamento | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  const carregar = useCallback(() => {
    setErro(false);
    paginasAgendamento.listar().then(setLista).catch(() => setErro(true));
  }, []);
  useEffect(carregar, [carregar]);

  async function criar(e: FormEvent) {
    e.preventDefault();
    if (!titulo.trim()) return;
    setSalvando(true);
    try {
      const p = await paginasAgendamento.criar({ titulo: titulo.trim() });
      toast.success('Página criada');
      router.push(`/agenda/paginas/${p.id}`);
    } catch (x) {
      toast.error(mensagemDeErro(x, 'Não foi possível criar a página.'));
      setSalvando(false);
    }
  }

  async function copiar(p: PaginaAgendamento) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/b/${p.slug}`);
      toast.success('Link copiado');
    } catch {
      toast.error('Não foi possível copiar o link.');
    }
  }

  async function confirmarExclusao() {
    if (!excluir) return;
    setExcluindo(true);
    try {
      await paginasAgendamento.remover(excluir.id);
      setLista((l) => l?.filter((x) => x.id !== excluir.id) ?? null);
      toast.success('Página excluída');
      setExcluir(null);
    } catch (x) {
      toast.error(mensagemDeErro(x, 'Não foi possível excluir.'));
    } finally {
      setExcluindo(false);
    }
  }

  const abrirCriar = () => { setTitulo(''); setCriando(true); };

  return (
    <PageShell>
      <PageHeader
        title="Páginas de agendamento"
        subtitle="Seu cliente escolhe o horário sozinho, só entre os horários livres de verdade da agenda."
        actions={
          <>
            <Link href="/agenda" className="btn"><Icon name="calendar" size={16} />Agenda</Link>
            <Button variant="primary" icon="plus" onClick={abrirCriar}>Nova página</Button>
          </>
        }
      />

      {erro ? (
        <ErrorState onRetry={carregar} />
      ) : lista === null ? (
        <div className="card p-4"><SkeletonRows rows={3} /></div>
      ) : lista.length === 0 ? (
        <EmptyState icon="calendar" title="Nenhuma página de agendamento" description="Crie uma página para consulta, demonstração ou visita e compartilhe o link." action={<Button variant="primary" icon="plus" onClick={abrirCriar}>Criar página</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {lista.map((p) => (
            <article key={p.id} className="card flex flex-col p-5">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/agenda/paginas/${p.id}`} className="block truncate text-md font-semibold text-fg hover:text-brand">{p.titulo}</Link>
                  <p className="truncate text-xs text-faint">/b/{p.slug}</p>
                </div>
                <Menu
                  label={`Ações de ${p.titulo}`}
                  trigger={<Icon name="dots" size={16} />}
                  triggerClassName="btn btn-ghost btn-sm btn-icon"
                  align="end"
                  items={[
                    { id: 'editar', label: 'Editar', icon: 'edit', onSelect: () => router.push(`/agenda/paginas/${p.id}`) },
                    { id: 'copiar', label: 'Copiar link', icon: 'link', onSelect: () => void copiar(p) },
                    { id: 'abrir', label: 'Abrir página pública', icon: 'external', onSelect: () => window.open(`/b/${p.slug}`, '_blank', 'noopener') },
                    { type: 'separator', id: 's' },
                    { id: 'excluir', label: 'Excluir', icon: 'trash', danger: true, onSelect: () => setExcluir(p) },
                  ]}
                />
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge tone={p.ativo ? 'green' : 'neutral'}>{p.ativo ? 'Publicada' : 'Pausada'}</Badge>
                <span className="inline-flex items-center gap-1"><Icon name="clock" size={13} />{p.duracaoMin} min</span>
                <span className="inline-flex items-center gap-1"><Icon name="users" size={13} />{p.responsaveis.length ? `${p.responsaveis.length} na equipe` : 'Agenda geral'}</span>
                <span className="tabular inline-flex items-center gap-1"><Icon name="check" size={13} />{p.totalReservas} reserva(s)</span>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={criando}
        onClose={() => setCriando(false)}
        title="Nova página de agendamento"
        description="Começa com segunda a sexta, das 9h às 18h, 30 minutos. Ajuste tudo em seguida."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCriando(false)}>Cancelar</Button>
            <Button variant="primary" type="submit" form="nova-pagina" loading={salvando} disabled={!titulo.trim()}>Criar e editar</Button>
          </>
        }
      >
        <form id="nova-pagina" onSubmit={criar}>
          <label htmlFor="titulo-pagina" className="mb-1.5 block text-sm font-medium text-fg">Título</label>
          <Input id="titulo-pagina" autoFocus maxLength={120} placeholder="Ex.: Consulta de avaliação" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        </form>
      </Modal>

      <Confirm
        open={!!excluir}
        onClose={() => setExcluir(null)}
        onConfirm={confirmarExclusao}
        loading={excluindo}
        title={`Excluir "${excluir?.titulo ?? ''}"?`}
        description="O link público para de funcionar. Os compromissos já marcados continuam na agenda."
        confirmLabel="Excluir página"
      />
    </PageShell>
  );
}
