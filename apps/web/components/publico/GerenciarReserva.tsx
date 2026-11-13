'use client';

import { useState } from 'react';
import { Confirm } from '@/components/kit';
import { Icon } from '@/components/icons';
import { chamarPublico, type BookingPublico, type ErroChamada, type ReservaPublica } from '@/lib/publico/tipos';
import { CabecalhoMarca, FeitoComKhub, estiloDaMarca } from './FormularioPublico';
import { SeletorHorario, nomeFuso, quandoNoFuso, type Horario } from './SeletorHorario';

const STATUS: Record<string, string> = {
  agendado: 'Reservado',
  confirmado: 'Confirmado',
  cancelado: 'Cancelado',
  concluido: 'Concluído',
  faltou: 'Não compareceu',
};

/** Remarcar ou cancelar a reserva pelo link enviado na confirmação. */
export function GerenciarReserva({ token, reserva, pagina }: { token: string; reserva: ReservaPublica; pagina: BookingPublico | null }) {
  const [atual, setAtual] = useState(reserva);
  const [modo, setModo] = useState<'ver' | 'remarcar'>('ver');
  const [novo, setNovo] = useState<Horario | null>(null);
  const [confirmarCancelamento, setConfirmarCancelamento] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null);
  const [recarregar, setRecarregar] = useState(0);

  async function cancelar() {
    setOcupado(true);
    try {
      await chamarPublico(`reservas/${token}/cancelar`, { method: 'POST', body: {} });
      setAtual((a) => ({ ...a, status: 'cancelado', podeAlterar: false }));
      setAviso({ tom: 'ok', texto: 'Agendamento cancelado. A empresa foi avisada.' });
    } catch (x) {
      setAviso({ tom: 'erro', texto: (x as ErroChamada).message });
    } finally {
      setOcupado(false);
      setConfirmarCancelamento(false);
    }
  }

  async function remarcar() {
    if (!novo) return;
    setOcupado(true);
    try {
      const r = await chamarPublico<{ inicio: string; fim: string }>(`reservas/${token}/remarcar`, { method: 'POST', body: { inicio: novo.inicio } });
      setAtual((a) => ({ ...a, inicio: r.inicio, fim: r.fim }));
      setModo('ver');
      setNovo(null);
      setAviso({ tom: 'ok', texto: 'Agendamento remarcado.' });
    } catch (x) {
      const err = x as ErroChamada;
      setAviso({ tom: 'erro', texto: err.status === 409 ? 'Esse horário não está mais disponível. Escolha outro.' : err.message });
      setNovo(null);
      setRecarregar((n) => n + 1);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div style={estiloDaMarca(atual.estilo.cor)}>
      <CabecalhoMarca marca={atual.marca.nome}>
        <h1 className="t-display text-2xl sm:text-3xl">{atual.titulo}</h1>
      </CabecalhoMarca>

      {aviso && (
        <p role={aviso.tom === 'erro' ? 'alert' : 'status'} className={aviso.tom === 'erro' ? 'mb-4 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger' : 'mb-4 rounded-md border border-success-border bg-success-soft px-3 py-2 text-sm text-success'}>
          {aviso.texto}
        </p>
      )}

      <div className="rounded-md border border-line bg-surface2 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-faint">{STATUS[atual.status] ?? atual.status}</p>
        <p className="mt-1 font-semibold capitalize text-fg">{quandoNoFuso(atual.inicio, atual.fuso)}</p>
        <p className="mt-0.5 text-sm text-muted">{atual.duracaoMin} min · horário de {nomeFuso(atual.fuso)}</p>
        {atual.local && <p className="mt-1 text-sm text-muted">Local: {atual.local}</p>}
      </div>

      {atual.podeAlterar && modo === 'ver' && (
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <a className="btn h-11 flex-1" href={`/api/public/reservas/${token}/ics`} download="agendamento.ics">
            <Icon name="calendar" size={16} />
            Adicionar ao calendário
          </a>
          {pagina && (
            <button type="button" className="btn h-11 flex-1" onClick={() => { setAviso(null); setModo('remarcar'); }}>
              Remarcar
            </button>
          )}
          <button type="button" className="btn btn-danger h-11 flex-1" onClick={() => setConfirmarCancelamento(true)}>
            Cancelar agendamento
          </button>
        </div>
      )}
      {atual.podeAlterar && !pagina && modo === 'ver' && <p className="mt-3 text-xs text-faint">Para remarcar, fale com {atual.marca.nome}.</p>}
      {!atual.podeAlterar && atual.status !== 'cancelado' && <p className="mt-4 text-sm text-muted">Este agendamento não pode mais ser alterado por aqui.</p>}

      {modo === 'remarcar' && pagina && (
        <div className="mt-6">
          <p className="mb-4 text-sm font-semibold text-fg">Escolha o novo horário</p>
          <SeletorHorario slug={atual.slug} dias={pagina.dias} janela={pagina.janela} fuso={pagina.fuso} selecionado={novo} onEscolher={setNovo} recarregar={recarregar} />
          <div className="mt-6 flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
            <button type="button" className="btn h-11" onClick={() => { setModo('ver'); setNovo(null); }}>
              Voltar
            </button>
            <button type="button" className="btn btn-primary h-11 px-6" style={{ color: 'var(--brand-on, var(--base-0))' }} disabled={!novo || ocupado} aria-busy={ocupado || undefined} onClick={remarcar}>
              {novo ? `Remarcar para ${quandoNoFuso(novo.inicio, pagina.fuso)}` : 'Remarcar'}
            </button>
          </div>
        </div>
      )}

      <Confirm
        open={confirmarCancelamento}
        onClose={() => setConfirmarCancelamento(false)}
        onConfirm={cancelar}
        title="Cancelar este agendamento?"
        description="O horário volta a ficar livre para outras pessoas. Para marcar de novo, use a página de agendamento."
        confirmLabel="Cancelar agendamento"
        cancelLabel="Manter"
        tone="danger"
        loading={ocupado}
      />
      <FeitoComKhub />
    </div>
  );
}
