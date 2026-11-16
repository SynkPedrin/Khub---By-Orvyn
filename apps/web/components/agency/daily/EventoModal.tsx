'use client';

import { useEffect, useState } from 'react';
import { Button, Confirm, Modal, Select, Switch, Textarea, useToast } from '@/components/kit';
import { Avatar, Field, Input, cx } from '@/components/ui';
import { daily, ymd, type ItemCalendario } from '@/lib/agency-daily';
import { useDaily } from './DailyContext';

type Evento = Extract<ItemCalendario, { origem: 'evento' }>;

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const juntar = (dia: string, hora: string) => {
  const [y, m, d] = dia.split('-').map(Number);
  const [h, min] = hora.split(':').map(Number);
  return new Date(y, m - 1, d, h || 0, min || 0);
};

/** Criar/editar compromisso da agência (reunião, gravação, call). `evento` null + `dia` = novo. */
export function EventoModal({ aberto, evento, dia, onClose, onSalvo }: { aberto: boolean; evento: Evento | null; dia: string | null; onClose: () => void; onSalvo: () => void }) {
  const { base } = useDaily();
  const toast = useToast();
  const [titulo, setTitulo] = useState('');
  const [data, setData] = useState('');
  const [inicio, setInicio] = useState('09:00');
  const [fim, setFim] = useState('10:00');
  const [diaInteiro, setDiaInteiro] = useState(false);
  const [local, setLocal] = useState('');
  const [cliente, setCliente] = useState('');
  const [notas, setNotas] = useState('');
  const [participantes, setParticipantes] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [excluir, setExcluir] = useState(false);
  const pode = !!base?.podeEditar;

  useEffect(() => {
    if (!aberto) return;
    if (evento) {
      const i = new Date(evento.inicio);
      setTitulo(evento.titulo);
      setData(ymd(i));
      setInicio(hhmm(i));
      setFim(evento.fim ? hhmm(new Date(evento.fim)) : hhmm(new Date(i.getTime() + 3_600_000)));
      setDiaInteiro(evento.diaInteiro);
      setLocal(evento.local ?? '');
      setCliente(evento.cliente?.id ?? '');
      setNotas(evento.notas ?? '');
      setParticipantes(evento.participantes.map((p) => p.id));
    } else {
      setTitulo('');
      setData(dia ?? ymd(new Date()));
      setInicio('09:00');
      setFim('10:00');
      setDiaInteiro(false);
      setLocal('');
      setCliente('');
      setNotas('');
      setParticipantes(base?.eu ? [base.eu] : []);
    }
  }, [aberto, evento, dia, base?.eu]);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titulo.trim() || !data) return;
    const ini = diaInteiro ? juntar(data, '12:00') : juntar(data, inicio);
    const fimData = diaInteiro ? null : juntar(data, fim);
    if (fimData && fimData < ini) {
      toast.error('O fim precisa ser depois do início');
      return;
    }
    setSalvando(true);
    const corpo = {
      titulo: titulo.trim(),
      inicioEm: ini.toISOString(),
      fimEm: fimData ? fimData.toISOString() : null,
      diaInteiro,
      local: local.trim() || null,
      notas: notas.trim() || null,
      clientId: cliente || null,
      participantes,
    };
    try {
      if (evento) await daily.atualizarEvento(evento.id, corpo);
      else await daily.criarEvento(corpo);
      toast.success(evento ? 'Evento atualizado' : 'Evento criado');
      onSalvo();
      onClose();
    } catch (err) {
      toast.error('Não foi possível salvar', { description: err instanceof Error ? err.message : '' });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <>
      <Modal
        open={aberto}
        onClose={onClose}
        size="md"
        title={evento ? (pode ? 'Editar evento' : 'Evento') : 'Novo evento'}
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            {evento && pode ? <Button variant="ghost" icon="trash" onClick={() => setExcluir(true)}>Excluir</Button> : <span />}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>{pode ? 'Cancelar' : 'Fechar'}</Button>
              {pode && <Button type="submit" form="evento-daily" loading={salvando} disabled={!titulo.trim()}>Salvar</Button>}
            </div>
          </div>
        }
      >
        <form id="evento-daily" onSubmit={salvar} className="space-y-3">
          <fieldset disabled={!pode} className="space-y-3">
            <Field label="Título">
              <Input autoFocus value={titulo} maxLength={200} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Gravação na clínica, Reunião de pauta" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <Field label="Dia">
                <Input type="date" value={data} onChange={(e) => setData(e.target.value)} required />
              </Field>
              {!diaInteiro && (
                <>
                  <Field label="Início">
                    <Input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} />
                  </Field>
                  <Field label="Fim">
                    <Input type="time" value={fim} onChange={(e) => setFim(e.target.value)} />
                  </Field>
                </>
              )}
            </div>
            <Switch checked={diaInteiro} onChange={setDiaInteiro} label="Dia inteiro" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Cliente">
                <Select value={cliente} onChange={setCliente} placeholder="Interno (sem cliente)" options={(base?.clientes ?? []).map((c) => ({ value: c.id, label: c.nome }))} />
              </Field>
              <Field label="Local ou link">
                <Input value={local} maxLength={300} onChange={(e) => setLocal(e.target.value)} placeholder="Endereço ou link da call" />
              </Field>
            </div>
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-fg">Participantes</p>
              <div className="flex flex-wrap gap-1.5">
                {(base?.membros ?? []).map((m) => {
                  const ligado = participantes.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={ligado}
                      onClick={() => setParticipantes((l) => (ligado ? l.filter((x) => x !== m.id) : [...l, m.id]))}
                      className={cx('inline-flex h-8 items-center gap-1.5 rounded-full border pl-1 pr-3 text-xs font-medium transition', ligado ? 'border-brand-border bg-brand-soft text-brand' : 'border-line text-muted hover:bg-surface2')}
                    >
                      <Avatar name={m.nome} size={22} /> {m.id === base?.eu ? `${m.nome} (você)` : m.nome}
                    </button>
                  );
                })}
              </div>
            </div>
            <Field label="Notas">
              <Textarea value={notas} rows={3} maxLength={5000} onChange={(e) => setNotas(e.target.value)} placeholder="Pauta, roteiro, o que levar…" />
            </Field>
          </fieldset>
        </form>
      </Modal>
      <Confirm
        open={excluir}
        onClose={() => setExcluir(false)}
        title="Excluir este evento?"
        description="Ele some do calendário de todos os participantes."
        onConfirm={async () => {
          if (!evento) return;
          try {
            await daily.removerEvento(evento.id);
            toast.success('Evento excluído');
            setExcluir(false);
            onSalvo();
            onClose();
          } catch (err) {
            toast.error('Não foi possível excluir', { description: err instanceof Error ? err.message : '' });
          }
        }}
      />
    </>
  );
}
