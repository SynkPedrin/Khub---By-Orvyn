'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { Aviso, BotaoGrande, Cabecalho, Esqueleto, Folha, Vazio, diaSP, fmtDiaSemana, fmtHora, useAtualizarAoVoltar, useVibrar } from '@/components/mobile/ui';
import { agenda, type Compromisso, type StatusAgenda } from '@/lib/agenda';
import { ApiError } from '@/lib/api-error';

/** Brasil sem horário de verão: o dia de São Paulo é sempre UTC-3. */
const OFFSET = '-03:00';
const inicioDoDia = (dia: string) => new Date(`${dia}T00:00:00${OFFSET}`);
const somarDias = (dia: string, n: number) => diaSP(new Date(inicioDoDia(dia).getTime() + n * 86400000 + 12 * 3600000));
const isoLocal = (dia: string, hora: string) => new Date(`${dia}T${hora}:00${OFFSET}`).toISOString();
const horaSP = (iso: string) => fmtHora(iso);

const COR: Record<StatusAgenda, string> = {
  agendado: 'var(--brand)',
  confirmado: 'var(--success)',
  concluido: 'var(--text-3)',
  cancelado: 'var(--danger)',
  faltou: 'var(--warning)',
};
const ROTULO: Record<StatusAgenda, string> = { agendado: 'Agendado', confirmado: 'Confirmado', concluido: 'Concluído', cancelado: 'Cancelado', faltou: 'Faltou' };
const SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function erroDe(e: unknown, padrao: string) {
  if (e instanceof ApiError && typeof e.body?.title === 'string' && e.status < 500) {
    return e.status === 403 ? 'Seu usuário não pode alterar a agenda. Fale com a equipe.' : e.body.title;
  }
  return padrao;
}

function AgendaMobile() {
  const params = useSearchParams();
  const router = useRouter();
  const vibrar = useVibrar();
  const hoje = diaSP(new Date());
  const [dia, setDia] = useState(params.get('dia') ?? hoje);
  // Semana (domingo a sábado) do dia escolhido.
  const domingo = useMemo(() => somarDias(dia, -new Date(`${dia}T12:00:00Z`).getUTCDay()), [dia]);
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => somarDias(domingo, i)), [domingo]);
  const [lista, setLista] = useState<Compromisso[] | null>(null);
  const [aberto, setAberto] = useState<Compromisso | null>(null);
  const [novo, setNovo] = useState(false);
  const [remarcar, setRemarcar] = useState(false);
  const [form, setForm] = useState({ titulo: '', dia: hoje, hora: '09:00', duracao: 60, notas: '' });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(() => {
    agenda
      .compromissos({ de: inicioDoDia(domingo).toISOString(), ate: new Date(inicioDoDia(somarDias(domingo, 7)).getTime() - 1).toISOString() })
      .then((l) => setLista(l.sort((a, b) => a.inicio.localeCompare(b.inicio))))
      .catch(() => setLista([]));
  }, [domingo]);
  useEffect(() => { setLista(null); carregar(); }, [carregar]);
  useAtualizarAoVoltar(carregar);

  // Link da tela inicial: abre direto o compromisso.
  useEffect(() => {
    const c = params.get('c');
    if (c && lista) {
      const achado = lista.find((x) => x.id === c);
      if (achado) setAberto(achado);
      router.replace(`/m/agenda?dia=${dia}`, { scroll: false });
    }
  }, [lista, params, router, dia]);

  const doDia = (lista ?? []).filter((c) => diaSP(new Date(c.inicio)) === dia);
  const contagem = (d: string) => (lista ?? []).filter((c) => diaSP(new Date(c.inicio)) === d && c.status !== 'cancelado').length;

  const mudarStatus = async (c: Compromisso, status: StatusAgenda) => {
    setOcupado(true); setErro('');
    try {
      const atualizado = await agenda.status(c.id, status);
      vibrar();
      setAberto({ ...c, ...atualizado });
      carregar();
    } catch (e) {
      setErro(erroDe(e, 'Não foi possível atualizar.'));
    } finally {
      setOcupado(false);
    }
  };

  const salvarNovo = async () => {
    if (!form.titulo.trim()) return setErro('Dê um nome ao compromisso.');
    setOcupado(true); setErro('');
    try {
      const inicio = isoLocal(form.dia, form.hora);
      const fim = new Date(new Date(inicio).getTime() + form.duracao * 60000).toISOString();
      await agenda.criar({ titulo: form.titulo.trim(), inicio, fim, ...(form.notas.trim() ? { notas: form.notas.trim() } : {}) });
      vibrar();
      setNovo(false);
      setDia(form.dia);
      setForm((f) => ({ ...f, titulo: '', notas: '' }));
      carregar();
    } catch (e) {
      setErro(erroDe(e, 'Não foi possível salvar. Confira o horário.'));
    } finally {
      setOcupado(false);
    }
  };

  const salvarRemarcacao = async () => {
    if (!aberto) return;
    setOcupado(true); setErro('');
    try {
      const dur = new Date(aberto.fim).getTime() - new Date(aberto.inicio).getTime();
      const inicio = isoLocal(form.dia, form.hora);
      const atualizado = await agenda.atualizar(aberto.id, { inicio, fim: new Date(new Date(inicio).getTime() + dur).toISOString() });
      vibrar();
      setRemarcar(false);
      setAberto({ ...aberto, ...atualizado });
      setDia(form.dia);
      carregar();
    } catch (e) {
      setErro(erroDe(e, 'Não foi possível remarcar. O horário pode estar ocupado.'));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div>
      <Cabecalho
        titulo="Agenda"
        sub={fmtDiaSemana(new Date(inicioDoDia(dia).getTime() + 12 * 3600000).toISOString())}
        acao={
          dia !== hoje ? (
            <button type="button" onClick={() => setDia(hoje)} className="mt-1 h-9 rounded-full bg-surface2 px-4 text-sm font-semibold">Hoje</button>
          ) : undefined
        }
      />

      {/* Semana */}
      <div className="mb-5 flex items-center gap-1">
        <button type="button" aria-label="Semana anterior" onClick={() => setDia(somarDias(dia, -7))} className="grid h-10 w-8 shrink-0 place-items-center text-muted">
          <Icon name="chevronRight" size={18} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <div className="grid flex-1 grid-cols-7 gap-1">
          {dias.map((d, i) => {
            const sel = d === dia;
            const n = contagem(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDia(d)}
                aria-pressed={sel}
                className={cx('flex flex-col items-center rounded-2xl py-2 transition', sel ? 'bg-brand text-[#0b0b0b]' : d === hoje ? 'bg-surface2 text-fg' : 'text-muted')}
              >
                <span className="text-[11px] font-semibold">{SEMANA[i]}</span>
                <span className="text-[17px] font-bold">{Number(d.slice(8))}</span>
                <span className={cx('mt-0.5 h-1.5 w-1.5 rounded-full', n ? (sel ? 'bg-[#0b0b0b]' : 'bg-brand') : 'bg-transparent')} />
              </button>
            );
          })}
        </div>
        <button type="button" aria-label="Próxima semana" onClick={() => setDia(somarDias(dia, 7))} className="grid h-10 w-8 shrink-0 place-items-center text-muted">
          <Icon name="chevronRight" size={18} />
        </button>
      </div>

      {lista === null ? (
        <Esqueleto linhas={3} />
      ) : doDia.length === 0 ? (
        <Vazio icone="calendar" titulo="Dia livre" texto="Nenhum compromisso neste dia." />
      ) : (
        <ul className="space-y-2">
          {doDia.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => { setErro(''); setAberto(c); }} className={cx('flex w-full items-center gap-3 rounded-2xl bg-surface p-3.5 text-left active:scale-[0.99]', (c.status === 'cancelado' || c.status === 'concluido') && 'opacity-60')}>
                <span className="w-14 shrink-0 text-center">
                  <span className="block text-[15px] font-bold">{horaSP(c.inicio)}</span>
                  <span className="block text-[11px] text-muted">{horaSP(c.fim)}</span>
                </span>
                <span className="h-10 w-1 shrink-0 rounded-full" style={{ background: COR[c.status] }} />
                <span className="min-w-0 flex-1">
                  <span className={cx('block truncate text-sm font-semibold', c.status === 'cancelado' && 'line-through')}>{c.contatoNome || c.titulo}</span>
                  <span className="block truncate text-xs text-muted">
                    {[c.servicoNome, c.profissionalNome].filter(Boolean).join(' · ') || c.titulo} · {ROTULO[c.status]}
                  </span>
                </span>
                <Icon name="chevronRight" size={16} className="text-faint" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Novo compromisso */}
      <button
        type="button"
        aria-label="Novo compromisso"
        onClick={() => { setErro(''); setForm((f) => ({ ...f, dia })); setNovo(true); }}
        className="fixed right-5 z-30 grid h-14 w-14 place-items-center rounded-full bg-brand text-[#0b0b0b] shadow-xl active:scale-95"
        style={{ bottom: 'calc(5.25rem + env(safe-area-inset-bottom))' }}
      >
        <Icon name="plus" size={26} />
      </button>

      <Folha aberta={novo} onFechar={() => setNovo(false)} titulo="Novo compromisso">
        <div className="space-y-3">
          <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} maxLength={200} placeholder="Ex.: Consulta — Maria Silva" className="input h-12 w-full rounded-2xl text-[15px]" />
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={form.dia} onChange={(e) => setForm({ ...form, dia: e.target.value })} className="input h-12 w-full rounded-2xl text-[15px]" aria-label="Dia" />
            <input type="time" value={form.hora} onChange={(e) => setForm({ ...form, hora: e.target.value })} className="input h-12 w-full rounded-2xl text-[15px]" aria-label="Hora" />
          </div>
          <div className="flex gap-2" role="group" aria-label="Duração">
            {[30, 60, 90, 120].map((m) => (
              <button key={m} type="button" onClick={() => setForm({ ...form, duracao: m })} className={cx('h-10 flex-1 rounded-xl text-sm font-semibold', form.duracao === m ? 'bg-fg text-bg' : 'bg-surface2 text-muted')}>
                {({ 30: '30 min', 60: '1 h', 90: '1h30', 120: '2 h' } as Record<number, string>)[m]}
              </button>
            ))}
          </div>
          <textarea value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} rows={2} maxLength={1000} placeholder="Observações (opcional)" className="input w-full resize-none rounded-2xl text-[15px]" />
          {erro && <Aviso texto={erro} />}
          <BotaoGrande disabled={ocupado} onClick={salvarNovo}>{ocupado ? 'Salvando…' : 'Salvar na agenda'}</BotaoGrande>
        </div>
      </Folha>

      <Folha aberta={Boolean(aberto) && !remarcar} onFechar={() => setAberto(null)} titulo={aberto?.contatoNome || aberto?.titulo || 'Compromisso'}>
        {aberto && (
          <div className="space-y-4">
            <div className="space-y-2 rounded-2xl bg-surface2 p-4 text-sm">
              <p className="flex items-center gap-2"><Icon name="clock" size={15} className="text-muted" /> {`${fmtDiaSemana(aberto.inicio)}, ${horaSP(aberto.inicio)}–${horaSP(aberto.fim)}`}</p>
              {aberto.servicoNome && <p className="flex items-center gap-2"><Icon name="briefcase" size={15} className="text-muted" /> {aberto.servicoNome}{aberto.profissionalNome ? ` · ${aberto.profissionalNome}` : ''}</p>}
              {aberto.contatoTelefone && (
                <a href={`https://wa.me/${aberto.contatoTelefone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 font-semibold text-brand">
                  <Icon name="whatsapp" size={15} /> {aberto.contatoTelefone}
                </a>
              )}
              {aberto.local && <p className="flex items-center gap-2"><Icon name="mapPin" size={15} className="text-muted" /> {aberto.local}</p>}
              {aberto.notas && <p className="whitespace-pre-wrap text-muted">{aberto.notas}</p>}
              <p className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: COR[aberto.status] }} /> {ROTULO[aberto.status]}</p>
            </div>
            {erro && <Aviso texto={erro} />}
            {(aberto.status === 'agendado' || aberto.status === 'confirmado') && (
              <div className="grid grid-cols-2 gap-2">
                {aberto.status === 'agendado' && <BotaoGrande disabled={ocupado} onClick={() => mudarStatus(aberto, 'confirmado')}><Icon name="check" size={18} /> Confirmar</BotaoGrande>}
                <BotaoGrande disabled={ocupado} tom={aberto.status === 'agendado' ? 'neutro' : 'brand'} onClick={() => mudarStatus(aberto, 'concluido')}><Icon name="check2" size={18} /> Concluir</BotaoGrande>
                <BotaoGrande disabled={ocupado} tom="neutro" onClick={() => { setErro(''); setForm((f) => ({ ...f, dia: diaSP(new Date(aberto.inicio)), hora: horaSP(aberto.inicio) })); setRemarcar(true); }}><Icon name="calendar" size={18} /> Remarcar</BotaoGrande>
                <BotaoGrande disabled={ocupado} tom="neutro" onClick={() => mudarStatus(aberto, 'faltou')}>Faltou</BotaoGrande>
                <BotaoGrande disabled={ocupado} tom="perigo" className="col-span-2" onClick={() => { if (window.confirm('Cancelar este compromisso?')) void mudarStatus(aberto, 'cancelado'); }}>Cancelar compromisso</BotaoGrande>
              </div>
            )}
            {(aberto.status === 'cancelado' || aberto.status === 'faltou' || aberto.status === 'concluido') && (
              <BotaoGrande tom="neutro" disabled={ocupado} onClick={() => mudarStatus(aberto, 'agendado')}><Icon name="refresh" size={18} /> Voltar para agendado</BotaoGrande>
            )}
          </div>
        )}
      </Folha>

      <Folha aberta={remarcar} onFechar={() => setRemarcar(false)} titulo="Remarcar">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={form.dia} onChange={(e) => setForm({ ...form, dia: e.target.value })} className="input h-12 w-full rounded-2xl text-[15px]" aria-label="Novo dia" />
            <input type="time" value={form.hora} onChange={(e) => setForm({ ...form, hora: e.target.value })} className="input h-12 w-full rounded-2xl text-[15px]" aria-label="Nova hora" />
          </div>
          {erro && <Aviso texto={erro} />}
          <BotaoGrande disabled={ocupado} onClick={salvarRemarcacao}>{ocupado ? 'Salvando…' : 'Salvar novo horário'}</BotaoGrande>
          <BotaoGrande tom="neutro" onClick={() => setRemarcar(false)}>Voltar</BotaoGrande>
        </div>
      </Folha>
    </div>
  );
}

export default function AgendaMobilePage() {
  return (
    <Suspense fallback={<Esqueleto linhas={3} />}>
      <AgendaMobile />
    </Suspense>
  );
}
