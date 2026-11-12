'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button, Confirm, Menu, Modal, SkeletonRows, useToast } from '@/components/kit';
import { Icon } from '@/components/icons';
import { Badge, Input } from '@/components/ui';
import { PageHeader, PageShell } from '@/components/revenue/Page';
import { EmptyState, ErrorState } from '@/components/revenue/States';
import { formularios, mensagemDeErro, type Formulario } from '@/lib/formularios';

const dataCurta = (iso: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso));

/** Formulários (Q4.1): lista, criar e atalhos de compartilhar. */
export default function FormulariosPage() {
  const router = useRouter();
  const toast = useToast();
  const [lista, setLista] = useState<Formulario[] | null>(null);
  const [erro, setErro] = useState(false);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [excluir, setExcluir] = useState<Formulario | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  const carregar = useCallback(() => {
    setErro(false);
    formularios.listar().then(setLista).catch(() => setErro(true));
  }, []);
  useEffect(carregar, [carregar]);

  async function criar(e: FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    setSalvando(true);
    try {
      const f = await formularios.criar({ nome: nome.trim() });
      toast.success('Formulário criado');
      router.push(`/formularios/${f.id}`);
    } catch (x) {
      toast.error(mensagemDeErro(x, 'Não foi possível criar o formulário.'));
      setSalvando(false);
    }
  }

  async function copiarLink(f: Formulario) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/f/${f.slug}`);
      toast.success('Link copiado');
    } catch {
      toast.error('Não foi possível copiar. Abra o formulário e copie pela aba Compartilhar.');
    }
  }

  async function confirmarExclusao() {
    if (!excluir) return;
    setExcluindo(true);
    try {
      await formularios.remover(excluir.id);
      setLista((l) => l?.filter((x) => x.id !== excluir.id) ?? null);
      toast.success('Formulário excluído');
      setExcluir(null);
    } catch (x) {
      toast.error(mensagemDeErro(x, 'Não foi possível excluir.'));
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="Formulários"
        subtitle="Capture leads no seu site ou por link. Cada envio vira contato, sem duplicar."
        actions={<Button variant="primary" icon="plus" onClick={() => { setNome(''); setCriando(true); }}>Novo formulário</Button>}
      />

      {erro ? (
        <ErrorState description="Verifique a conexão e tente de novo." onRetry={carregar} />
      ) : lista === null ? (
        <div className="card p-4"><SkeletonRows rows={4} /></div>
      ) : lista.length === 0 ? (
        <EmptyState
          icon="file"
          title="Nenhum formulário ainda"
          description="Crie o primeiro: nome, e-mail, WhatsApp e consentimento LGPD já vêm prontos."
          action={<Button variant="primary" icon="plus" onClick={() => { setNome(''); setCriando(true); }}>Criar formulário</Button>}
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Formulário</th>
                <th scope="col" className="hidden px-4 py-3 font-semibold sm:table-cell">Status</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Respostas</th>
                <th scope="col" className="hidden px-4 py-3 font-semibold md:table-cell">Atualizado</th>
                <th scope="col" className="w-12 px-2 py-3"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => (
                <tr key={f.id} className="border-b border-line last:border-0 hover:bg-surface2">
                  <td className="px-4 py-3">
                    <Link href={`/formularios/${f.id}`} className="font-semibold text-fg hover:text-brand">{f.nome}</Link>
                    <p className="mt-0.5 truncate text-xs text-faint">/f/{f.slug}</p>
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <Badge tone={f.ativo ? 'green' : 'neutral'}>{f.ativo ? 'Publicado' : 'Pausado'}</Badge>
                  </td>
                  <td className="tabular px-4 py-3 text-right text-fg">{f.totalRespostas}</td>
                  <td className="hidden px-4 py-3 text-muted md:table-cell">{dataCurta(f.updatedAt)}</td>
                  <td className="px-2 py-3 text-right">
                    <Menu
                      label={`Ações de ${f.nome}`}
                      trigger={<Icon name="dots" size={16} />}
                      triggerClassName="btn btn-ghost btn-sm btn-icon"
                      align="end"
                      items={[
                        { id: 'abrir', label: 'Editar', icon: 'edit', onSelect: () => router.push(`/formularios/${f.id}`) },
                        { id: 'respostas', label: 'Ver respostas', icon: 'list', onSelect: () => router.push(`/formularios/${f.id}?aba=respostas`) },
                        { id: 'copiar', label: 'Copiar link', icon: 'link', onSelect: () => void copiarLink(f) },
                        { id: 'ver', label: 'Abrir página pública', icon: 'external', onSelect: () => window.open(`/f/${f.slug}`, '_blank', 'noopener') },
                        { type: 'separator', id: 's' },
                        { id: 'excluir', label: 'Excluir', icon: 'trash', danger: true, onSelect: () => setExcluir(f) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={criando}
        onClose={() => setCriando(false)}
        title="Novo formulário"
        description="Dê um nome interno. Você ajusta campos, aparência e destino em seguida."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCriando(false)}>Cancelar</Button>
            <Button variant="primary" type="submit" form="novo-form" loading={salvando} disabled={!nome.trim()}>Criar e editar</Button>
          </>
        }
      >
        <form id="novo-form" onSubmit={criar}>
          <label htmlFor="nome-form" className="mb-1.5 block text-sm font-medium text-fg">Nome</label>
          <Input id="nome-form" autoFocus maxLength={120} placeholder="Ex.: Contato do site" value={nome} onChange={(e) => setNome(e.target.value)} />
        </form>
      </Modal>

      <Confirm
        open={!!excluir}
        onClose={() => setExcluir(null)}
        onConfirm={confirmarExclusao}
        loading={excluindo}
        title={`Excluir "${excluir?.nome ?? ''}"?`}
        description={`O link público para de funcionar e as ${excluir?.totalRespostas ?? 0} resposta(s) guardadas aqui são apagadas. Os contatos criados continuam no CRM.`}
        confirmLabel="Excluir formulário"
      />
    </PageShell>
  );
}
