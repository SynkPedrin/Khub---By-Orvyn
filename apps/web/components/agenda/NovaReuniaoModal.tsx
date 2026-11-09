'use client';

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Card } from '@/components/ui';
import { Icon } from '@/components/icons';
import { agenda, type Compromisso } from '@/lib/agenda';
import { duracao as formatarDuracao, hora } from '@/lib/format';
import { chaveDia, horaInput, mensagemErro, montarData } from './agenda-utils';

const DURACOES = [15, 30, 45, 60, 90, 120, 180];

/** Próxima hora cheia a partir de agora, no dia sugerido. */
function horarioSugerido(diaSugerido: Date): { dia: string; horario: string } {
  const agora = new Date();
  if (chaveDia(diaSugerido) !== chaveDia(agora)) return { dia: chaveDia(diaSugerido), horario: '09:00' };
  const d = new Date(agora);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  // Passou da meia-noite: sugere amanhã às 9h em vez de um horário estranho.
  if (chaveDia(d) !== chaveDia(agora)) {
    const amanha = new Date(agora);
    amanha.setDate(amanha.getDate() + 1);
    return { dia: chaveDia(amanha), horario: '09:00' };
  }
  return { dia: chaveDia(d), horario: horaInput(d) };
}

type Erros = Partial<Record<'titulo' | 'dia' | 'horario', string>>;

export function NovaReuniaoModal({
  diaSugerido,
  onClose,
  onCreated,
}: {
  diaSugerido: Date;
  onClose: () => void;
  onCreated: (c: Compromisso) => void;
}) {
  const inicial = useMemo(() => horarioSugerido(diaSugerido), [diaSugerido]);
  const [titulo, setTitulo] = useState('');
  const [dia, setDia] = useState(inicial.dia);
  const [horario, setHorario] = useState(inicial.horario);
  const [minutos, setMinutos] = useState(60);
  const [local, setLocal] = useState('');
  const [notas, setNotas] = useState('');
  const [erros, setErros] = useState<Erros>({});
  const [erroApi, setErroApi] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Esc fecha, exceto durante o envio (o resultado precisa chegar à lista).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !salvando) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, salvando]);

  const inicio = montarData(dia, horario);
  const fim = inicio ? new Date(inicio.getTime() + minutos * 60_000) : null;

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (salvando) return;
    const novos: Erros = {};
    if (!titulo.trim()) novos.titulo = 'Informe um título para a reunião.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) novos.dia = 'Escolha a data.';
    if (!/^\d{2}:\d{2}$/.test(horario)) novos.horario = 'Escolha o horário de início.';
    else if (!inicio && !novos.dia) novos.horario = 'Data ou horário inválido.';
    setErros(novos);
    setErroApi(null);
    if (Object.keys(novos).length > 0 || !inicio || !fim) return;

    setSalvando(true);
    try {
      const criado = await agenda.criar({
        titulo: titulo.trim(),
        inicio: inicio.toISOString(),
        fim: fim.toISOString(),
        ...(local.trim() ? { local: local.trim() } : {}),
        ...(notas.trim() ? { notas: notas.trim() } : {}),
      });
      onCreated(criado);
    } catch (err) {
      setErroApi(mensagemErro(err, 'criar a reunião'));
      setSalvando(false);
    }
  };

  return (
    <div
      className="lg-backdrop fixed inset-0 z-50 flex items-center justify-center px-4"
      onClick={() => {
        if (!salvando) onClose();
      }}
    >
      <Card
        className="lg-sheet max-h-[calc(100dvh-32px)] w-full max-w-md animate-scale-in overflow-y-auto p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nova-reuniao-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={salvar} className="space-y-4" noValidate>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="nova-reuniao-titulo" className="t-section">
                Nova reunião
              </h2>
              <p className="mt-0.5 text-[13px] text-muted">Fica registrada na agenda de toda a equipe.</p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm shrink-0"
              onClick={onClose}
              disabled={salvando}
              aria-label="Fechar"
            >
              <Icon name="close" size={16} />
            </button>
          </div>

          <Campo id="nr-titulo" label="Título" erro={erros.titulo}>
            <input
              id="nr-titulo"
              className="input"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex.: Demo com a Clínica Vida"
              maxLength={200}
              autoFocus
              aria-invalid={!!erros.titulo}
              aria-describedby={erros.titulo ? 'nr-titulo-erro' : undefined}
            />
          </Campo>

          <div className="grid grid-cols-2 gap-3">
            <Campo id="nr-dia" label="Data" erro={erros.dia}>
              <input
                id="nr-dia"
                type="date"
                className="input"
                value={dia}
                onChange={(e) => setDia(e.target.value)}
                aria-invalid={!!erros.dia}
                aria-describedby={erros.dia ? 'nr-dia-erro' : undefined}
              />
            </Campo>
            <Campo id="nr-horario" label="Início" erro={erros.horario}>
              <input
                id="nr-horario"
                type="time"
                className="input"
                value={horario}
                onChange={(e) => setHorario(e.target.value)}
                aria-invalid={!!erros.horario}
                aria-describedby={erros.horario ? 'nr-horario-erro' : undefined}
              />
            </Campo>
          </div>

          <Campo id="nr-duracao" label="Duração">
            <select id="nr-duracao" className="select" value={minutos} onChange={(e) => setMinutos(Number(e.target.value))}>
              {DURACOES.map((m) => (
                <option key={m} value={m}>
                  {formatarDuracao(m)}
                </option>
              ))}
            </select>
            {fim && inicio && (
              <span className="mt-1 block text-xs text-muted">
                {chaveDia(fim) === chaveDia(inicio) ? `Termina às ${hora(fim)}` : `Termina às ${hora(fim)} do dia seguinte`}
              </span>
            )}
          </Campo>

          <Campo id="nr-local" label="Local ou link (opcional)">
            <input
              id="nr-local"
              className="input"
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              placeholder="Endereço ou https://meet.google.com/..."
              maxLength={200}
            />
          </Campo>

          <Campo id="nr-notas" label="Notas (opcional)">
            <textarea
              id="nr-notas"
              className="textarea"
              rows={3}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Pauta, contexto ou o que preparar"
              maxLength={1000}
            />
          </Campo>

          {erroApi && (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
              <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
              <span>{erroApi}</span>
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={salvando}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={salvando} aria-busy={salvando}>
              {salvando ? 'Salvando…' : 'Criar reunião'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function Campo({ id, label, erro, children }: { id: string; label: string; erro?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-fg">
        {label}
      </label>
      {children}
      {erro && (
        <span id={`${id}-erro`} className="mt-1 block text-xs text-danger">
          {erro}
        </span>
      )}
    </div>
  );
}
