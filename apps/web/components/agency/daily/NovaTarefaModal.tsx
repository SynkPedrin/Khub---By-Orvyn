'use client';

import { useEffect, useState } from 'react';
import { Button, Modal, Select, useToast } from '@/components/kit';
import { Field, Input } from '@/components/ui';
import {
  PLATAFORMA,
  PLATAFORMA_ORDEM,
  PRIORIDADE,
  PRIORIDADE_ORDEM,
  STATUS,
  STATUS_ORDEM,
  TIPO,
  TIPO_ORDEM,
  daily,
  ehConteudo,
  prazoDoDia,
  type NovaTarefa,
  type Plataforma,
  type Prioridade,
  type Status,
  type Tipo,
} from '@/lib/agency-daily';
import { useDaily } from './DailyContext';

/** Criação rápida: o essencial em uma tela; o resto se completa na gaveta da tarefa. */
export function NovaTarefaModal({ padrao, onClose }: { padrao: Partial<NovaTarefa> | null; onClose: () => void }) {
  const { base, recarregar, abrirTarefa } = useDaily();
  const toast = useToast();
  const [titulo, setTitulo] = useState('');
  const [tipo, setTipo] = useState<Tipo>('outro');
  const [status, setStatus] = useState<Status>('a_fazer');
  const [prioridade, setPrioridade] = useState<Prioridade>('normal');
  const [cliente, setCliente] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [prazo, setPrazo] = useState('');
  const [publicar, setPublicar] = useState('');
  const [plataformas, setPlataformas] = useState<Plataforma[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [abrirDepois, setAbrirDepois] = useState(false);

  useEffect(() => {
    if (!padrao) return;
    setTitulo(padrao.titulo ?? '');
    setTipo(padrao.tipo ?? 'outro');
    setStatus(padrao.status ?? 'a_fazer');
    setPrioridade(padrao.prioridade ?? 'normal');
    setCliente(padrao.clientId ?? '');
    setResponsavel(padrao.responsavelId ?? base?.eu ?? '');
    setPrazo(padrao.prazoEm ? padrao.prazoEm.slice(0, 10) : '');
    setPublicar('');
    setPlataformas(padrao.plataformas ?? (padrao.tipo && ehConteudo(padrao.tipo) ? ['instagram'] : []));
    setAbrirDepois(false);
  }, [padrao, base?.eu]);

  const conteudo = ehConteudo(tipo);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titulo.trim()) return;
    setSalvando(true);
    try {
      const t = await daily.criar({
        titulo: titulo.trim(),
        tipo,
        status,
        prioridade,
        clientId: cliente || null,
        responsavelId: responsavel || null,
        parentId: padrao?.parentId ?? null,
        prazoEm: prazoDoDia(prazo),
        ...(conteudo ? { plataformas, publicarEm: publicar ? new Date(publicar).toISOString() : null } : {}),
      });
      toast.success(`Tarefa #${t.numero} criada`);
      recarregar();
      onClose();
      if (abrirDepois) abrirTarefa(t.id);
    } catch (err) {
      toast.error('Não foi possível criar', { description: err instanceof Error ? err.message : 'Tente novamente.' });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      open={!!padrao}
      onClose={onClose}
      title={padrao?.parentId ? 'Nova subtarefa' : conteudo ? 'Novo conteúdo' : 'Nova tarefa'}
      size="md"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <label className="inline-flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" className="checkbox" checked={abrirDepois} onChange={(e) => setAbrirDepois(e.target.checked)} />
            Abrir para detalhar depois
          </label>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" form="nova-tarefa-daily" loading={salvando} disabled={!titulo.trim()}>Criar</Button>
          </div>
        </div>
      }
    >
      <form id="nova-tarefa-daily" onSubmit={salvar} className="space-y-3">
        <Field label="Título">
          <Input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} placeholder={conteudo ? 'Ex.: Reel de bastidores da clínica' : 'Ex.: Revisar campanha de Black Friday'} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo">
            <Select value={tipo} onChange={(v) => { setTipo(v); if (ehConteudo(v) && !plataformas.length) setPlataformas(['instagram']); }} options={TIPO_ORDEM.map((t) => ({ value: t, label: TIPO[t].label }))} />
          </Field>
          <Field label="Cliente">
            <Select value={cliente} onChange={setCliente} placeholder="Interno (sem cliente)" options={(base?.clientes ?? []).map((c) => ({ value: c.id, label: c.nome }))} />
          </Field>
          <Field label="Responsável">
            <Select value={responsavel} onChange={setResponsavel} placeholder="Ninguém" options={(base?.membros ?? []).map((m) => ({ value: m.id, label: m.id === base?.eu ? `${m.nome} (você)` : m.nome }))} />
          </Field>
          <Field label="Prazo de entrega">
            <Input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          </Field>
          <Field label="Status">
            <Select value={status} onChange={setStatus} options={STATUS_ORDEM.map((s) => ({ value: s, label: STATUS[s].label }))} />
          </Field>
          <Field label="Prioridade">
            <Select value={prioridade} onChange={setPrioridade} options={PRIORIDADE_ORDEM.map((p) => ({ value: p, label: PRIORIDADE[p].label }))} />
          </Field>
        </div>
        {conteudo && (
          <div className="card-inset space-y-3 p-3">
            <p className="t-label">Conteúdo</p>
            <div className="flex flex-wrap gap-1.5">
              {PLATAFORMA_ORDEM.map((p) => {
                const ligado = plataformas.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={ligado}
                    onClick={() => setPlataformas((l) => (ligado ? l.filter((x) => x !== p) : [...l, p]))}
                    className={ligado ? 'pill pill-brand' : 'pill'}
                  >
                    {PLATAFORMA[p].label}
                  </button>
                );
              })}
            </div>
            <Field label="Publicação planejada" hint="Diferente do prazo de entrega: é quando o post vai ao ar.">
              <Input type="datetime-local" value={publicar} onChange={(e) => setPublicar(e.target.value)} />
            </Field>
          </div>
        )}
      </form>
    </Modal>
  );
}
