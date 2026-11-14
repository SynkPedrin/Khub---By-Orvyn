'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Modal, Select } from '@/components/kit';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { agenda, type Compromisso, type TipoAgenda } from '@/lib/agenda';
import { crm, type Contato } from '@/lib/crm';
import type { Member } from '@/lib/settings';
import { duracao as formatarDuracao, hora } from '@/lib/format';
import { lerValor, valorParaCampo } from '@/lib/dinheiro';
import { TIPO_LABEL, TIPO_ORDEM, chaveDia, horaInput, mensagemErro, montarData } from './agenda-utils';

const DURACOES = [15, 30, 45, 60, 90, 120, 180, 240];

type Erros = Partial<Record<'titulo' | 'dia' | 'horario' | 'valor', string>>;

export interface ModalCompromissoProps {
  open: boolean;
  onClose: () => void;
  onSaved: (c: Compromisso, modo: 'criado' | 'editado') => void;
  /** Editar/reagendar este compromisso. Ausente = criar. */
  compromisso?: Compromisso | null;
  /** Criar: início clicado na grade (ou o próximo horário cheio). */
  inicioSugerido?: Date;
  duracaoSugerida?: number;
  membros: Member[];
  /** identityId de quem está logado (responsável padrão). */
  euId: string | null;
  /** Nome do contato já conhecido (edição). */
  nomeContato?: string | null;
}

/** Próxima hora cheia a partir de agora (ou 09:00 se o dia não é hoje). */
function sugestaoPadrao(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

/**
 * Criar ou reagendar compromisso. Mostra os horários livres do dia (API
 * `/agenda/horarios`, respeitando o responsável) como atalhos; o choque de
 * horário (409) volta como mensagem clara no próprio modal.
 */
export function CompromissoModal({ open, onClose, onSaved, compromisso, inicioSugerido, duracaoSugerida, membros, euId, nomeContato }: ModalCompromissoProps) {
  const editando = !!compromisso;
  const base = useMemo(() => (compromisso ? new Date(compromisso.inicio) : inicioSugerido ?? sugestaoPadrao()), [compromisso, inicioSugerido]);
  const minutosBase = compromisso ? Math.max(15, Math.round((+new Date(compromisso.fim) - +new Date(compromisso.inicio)) / 60_000)) : duracaoSugerida ?? 60;

  const [titulo, setTitulo] = useState('');
  const [tipo, setTipo] = useState<TipoAgenda>('reuniao');
  const [dia, setDia] = useState(chaveDia(base));
  const [horario, setHorario] = useState(horaInput(base));
  const [minutos, setMinutos] = useState(minutosBase);
  const [responsavelId, setResponsavelId] = useState<string>('');
  const [contato, setContato] = useState<{ id: string; nome: string } | null>(null);
  const [local, setLocal] = useState('');
  const [notas, setNotas] = useState('');
  const [valor, setValor] = useState('');
  const [erros, setErros] = useState<Erros>({});
  const [erroApi, setErroApi] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const tituloRef = useRef<HTMLInputElement>(null);

  // Reinicia o formulário a cada abertura (criar ≠ reagendar ≠ outro clique).
  useEffect(() => {
    if (!open) return;
    setTitulo(compromisso?.titulo ?? '');
    setTipo(compromisso?.tipo ?? 'reuniao');
    setDia(chaveDia(base));
    setHorario(horaInput(base));
    setMinutos(minutosBase);
    setResponsavelId(compromisso ? compromisso.responsavelId ?? '' : euId ?? '');
    setContato(compromisso?.contactId ? { id: compromisso.contactId, nome: nomeContato ?? 'Contato' } : null);
    setLocal(compromisso?.local ?? '');
    setNotas(compromisso?.notas ?? '');
    setValor(compromisso?.valorCentavos ? valorParaCampo(compromisso.valorCentavos) : '');
    setErros({});
    setErroApi(null);
    setSalvando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, compromisso?.id, +base]);

  // Horários livres do dia escolhido, para a duração e o responsável atuais.
  const [livres, setLivres] = useState<{ inicio: string; fim: string }[] | null>(null);
  useEffect(() => {
    if (!open || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return;
    let vivo = true;
    setLivres(null);
    agenda
      .horarios(dia, minutos, responsavelId || null)
      .then((l) => vivo && setLivres(l.filter((s) => +new Date(s.inicio) > Date.now())))
      .catch(() => vivo && setLivres([]));
    return () => {
      vivo = false;
    };
  }, [open, dia, minutos, responsavelId]);

  const inicio = montarData(dia, horario);
  const fim = inicio ? new Date(inicio.getTime() + minutos * 60_000) : null;

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (salvando) return;
    const novos: Erros = {};
    if (!titulo.trim()) novos.titulo = 'Informe um título.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) novos.dia = 'Escolha a data.';
    if (!/^\d{2}:\d{2}$/.test(horario)) novos.horario = 'Escolha o horário de início.';
    else if (!inicio && !novos.dia) novos.horario = 'Data ou horário inválido.';
    const valorCentavos = valor.trim() ? lerValor(valor) : null;
    if (valor.trim() && valorCentavos === null) novos.valor = 'Valor inválido. Use o formato 120,00.';
    setErros(novos);
    setErroApi(null);
    if (Object.keys(novos).length > 0 || !inicio || !fim) return;

    setSalvando(true);
    try {
      const comum = {
        titulo: titulo.trim(),
        inicio: inicio.toISOString(),
        fim: fim.toISOString(),
        tipo,
        responsavelId: responsavelId || null,
        valorCentavos: valorCentavos && valorCentavos > 0 ? valorCentavos : null,
      };
      const salvo = editando && compromisso
        ? await agenda.atualizar(compromisso.id, { ...comum, contactId: contato?.id ?? null, local: local.trim() || null, notas: notas.trim() || null })
        : await agenda.criar({ ...comum, ...(contato ? { contactId: contato.id } : {}), ...(local.trim() ? { local: local.trim() } : {}), ...(notas.trim() ? { notas: notas.trim() } : {}) });
      onSaved(salvo, editando ? 'editado' : 'criado');
    } catch (err) {
      setErroApi(mensagemErro(err, editando ? 'salvar o compromisso' : 'criar o compromisso'));
      setSalvando(false);
    }
  };

  const opcoesResponsavel = [
    { value: '', label: 'Agenda geral (sem responsável)' },
    ...membros.map((m) => ({ value: m.identityId, label: m.identityId === euId ? `${m.nome || m.email} (você)` : m.nome || m.email })),
  ];

  return (
    <Modal
      open={open}
      onClose={() => !salvando && onClose()}
      title={editando ? 'Reagendar ou editar' : 'Novo compromisso'}
      description={editando ? 'Mudar o horário zera o lembrete enviado: um novo sai na véspera.' : 'Fica na agenda da equipe e dispara as automações de agendamento.'}
      size="lg"
      initialFocus={tituloRef}
      closeOnBackdrop={!salvando}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="form-compromisso" loading={salvando}>
            {editando ? 'Salvar' : 'Criar compromisso'}
          </Button>
        </>
      }
    >
      <form id="form-compromisso" onSubmit={salvar} className="space-y-4" noValidate>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
          <Campo id="cm-titulo" label="Título" erro={erros.titulo}>
            <input
              ref={tituloRef}
              id="cm-titulo"
              className="input"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex.: Consulta inicial com Ana"
              maxLength={200}
              aria-invalid={!!erros.titulo}
              aria-describedby={erros.titulo ? 'cm-titulo-erro' : undefined}
            />
          </Campo>
          <Campo id="cm-tipo" label="Tipo">
            <Select id="cm-tipo" value={tipo} onChange={setTipo} options={TIPO_ORDEM.map((t) => ({ value: t, label: TIPO_LABEL[t] }))} />
          </Campo>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Campo id="cm-dia" label="Data" erro={erros.dia}>
            <input id="cm-dia" type="date" className="input" value={dia} onChange={(e) => setDia(e.target.value)} aria-invalid={!!erros.dia} aria-describedby={erros.dia ? 'cm-dia-erro' : undefined} />
          </Campo>
          <Campo id="cm-horario" label="Início" erro={erros.horario}>
            <input id="cm-horario" type="time" step={300} className="input" value={horario} onChange={(e) => setHorario(e.target.value)} aria-invalid={!!erros.horario} aria-describedby={erros.horario ? 'cm-horario-erro' : undefined} />
          </Campo>
          <Campo id="cm-duracao" label="Duração">
            <Select
              id="cm-duracao"
              value={String(minutos)}
              onChange={(v) => setMinutos(Number(v))}
              options={[...new Set([...DURACOES, minutos])].sort((a, b) => a - b).map((m) => ({ value: String(m), label: formatarDuracao(m) }))}
            />
          </Campo>
        </div>
        {inicio && fim && (
          <p className="-mt-2 text-xs text-muted">
            {chaveDia(fim) === chaveDia(inicio) ? `Das ${hora(inicio)} às ${hora(fim)}` : `Das ${hora(inicio)} às ${hora(fim)} do dia seguinte`}
          </p>
        )}

        <div>
          <p className="mb-1.5 text-sm font-medium text-fg">Horários livres neste dia</p>
          {livres === null ? (
            <div className="flex gap-2" aria-busy="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <span key={i} className="skeleton h-7 w-14 rounded-md" />
              ))}
            </div>
          ) : livres.length === 0 ? (
            <p className="text-xs text-muted">Nenhum horário livre das 9h às 18h para essa duração. Você ainda pode escolher outro horário acima.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Horários livres">
              {livres.slice(0, 18).map((s) => {
                const h = hora(s.inicio);
                const ativo = h === horario;
                return (
                  <button key={s.inicio} type="button" aria-pressed={ativo} onClick={() => setHorario(h)} className={cx('btn btn-sm tabular', ativo ? 'btn-primary' : 'btn-soft')}>
                    {h}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo id="cm-responsavel" label="Responsável">
            <Select id="cm-responsavel" value={responsavelId} onChange={setResponsavelId} options={opcoesResponsavel} />
          </Campo>
          <Campo id="cm-contato" label="Contato (opcional)">
            <BuscaContato id="cm-contato" valor={contato} onChange={setContato} />
          </Campo>
        </div>

        <Campo id="cm-valor" label="Valor do atendimento (opcional)" erro={erros.valor}>
          <input
            id="cm-valor"
            className="input"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="Ex.: 120,00"
            inputMode="decimal"
            aria-invalid={!!erros.valor}
            aria-describedby={erros.valor ? 'cm-valor-erro' : undefined}
          />
          <span className="mt-1 block text-xs text-muted">Ao concluir o atendimento, vira entrada no Financeiro e gera a comissão do responsável.</span>
        </Campo>

        <Campo id="cm-local" label="Local ou link (opcional)">
          <input id="cm-local" className="input" value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Endereço ou https://meet.google.com/..." maxLength={200} />
        </Campo>

        <Campo id="cm-notas" label="Notas (opcional)">
          <textarea id="cm-notas" className="textarea" rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Pauta, contexto ou o que preparar" maxLength={1000} />
        </Campo>

        {erroApi && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger">
            <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
            <span>{erroApi}</span>
          </p>
        )}
      </form>
    </Modal>
  );
}

/** Autocomplete de contato sobre `GET /crm/contacts?q=` (debounce de 250ms). */
function BuscaContato({ id, valor, onChange }: { id: string; valor: { id: string; nome: string } | null; onChange: (c: { id: string; nome: string } | null) => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Contato[] | null>(null);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!aberto || q.trim().length < 2) {
      setRes(null);
      return;
    }
    let vivo = true;
    const t = setTimeout(() => {
      crm
        .contacts({ q: q.trim(), limit: 8 })
        .then((p) => vivo && setRes(p.items))
        .catch(() => vivo && setRes([]));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [q, aberto]);

  if (valor) {
    return (
      <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 text-sm">
        <span className="flex min-w-0 items-center gap-1.5 text-fg">
          <Icon name="user" size={14} className="shrink-0 text-faint" />
          <span className="truncate">{valor.nome}</span>
        </span>
        <button type="button" className="btn btn-ghost btn-icon btn-sm h-7 w-7" onClick={() => onChange(null)} aria-label="Remover contato">
          <Icon name="close" size={14} />
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input
        id={id}
        className="input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        placeholder="Buscar por nome, e-mail ou telefone"
        role="combobox"
        aria-expanded={aberto && !!res}
        aria-controls={`${id}-lista`}
        autoComplete="off"
      />
      {aberto && res && (
        <ul id={`${id}-lista`} role="listbox" className="absolute left-0 right-0 top-full z-dropdown mt-1 max-h-56 overflow-auto rounded-md border border-line bg-surface py-1 shadow-lg">
          {res.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted">Nenhum contato encontrado.</li>
          ) : (
            res.map((c) => (
              <li key={c.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-surface2"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange({ id: c.id, nome: c.nome });
                    setQ('');
                    setAberto(false);
                  }}
                >
                  <span className="text-sm text-fg">{c.nome}</span>
                  {(c.telefone || c.email) && <span className="text-xs text-muted">{c.telefone ?? c.email}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function Campo({ id, label, erro, children }: { id: string; label: string; erro?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-fg">
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
