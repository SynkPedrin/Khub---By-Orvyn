'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { Icon } from '@/components/icons';
import { chamarPublico, contextoDaPagina, type BookingPublico, type ErroChamada, type ReservaFeita } from '@/lib/publico/tipos';
import { CampoPublico, errosLocais, type ValorCampo } from './CampoPublico';
import { CabecalhoMarca, FeitoComKhub, estiloDaMarca } from './FormularioPublico';
import { SeletorHorario, nomeFuso, quandoNoFuso, type Horario } from './SeletorHorario';

const CONTATO = [
  { id: 'nome', tipo: 'text', rotulo: 'Seu nome', obrigatorio: true, largura: 'inteira' },
  { id: 'telefone', tipo: 'phone', rotulo: 'WhatsApp', obrigatorio: true, largura: 'metade' },
  { id: 'email', tipo: 'email', rotulo: 'E-mail', obrigatorio: false, largura: 'metade' },
] as const;

/**
 * Página pública de agendamento (/b/<slug>): dia → horário → dados →
 * confirmação com .ics gerado no servidor e link para remarcar/cancelar.
 * Prévia (`previa`) no editor: navega, mas não reserva.
 */
export function AgendamentoPublico({ slug, dados, previa = false }: { slug: string; dados: BookingPublico; previa?: boolean }) {
  const idBase = useId();
  const [horario, setHorario] = useState<Horario | null>(null);
  const [etapa, setEtapa] = useState<'escolher' | 'dados' | 'feito'>('escolher');
  const [valores, setValores] = useState<Record<string, ValorCampo>>({});
  const [consentiu, setConsentiu] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [reserva, setReserva] = useState<ReservaFeita | null>(null);
  const [recarregar, setRecarregar] = useState(0);
  const isca = useRef<HTMLInputElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);

  const camposContato = CONTATO.map((c) => ({ ...c }));
  const todos = [...camposContato, ...dados.perguntas];

  async function reservar(e: FormEvent) {
    e.preventDefault();
    if (!horario || previa) return;
    setErroGeral(null);
    const locais = errosLocais(todos, valores);
    if (!consentiu) locais.consentimento = 'É preciso aceitar para continuar';
    setErros(locais);
    if (Object.keys(locais).length) {
      const primeiro = todos.find((c) => locais[c.id]);
      document.getElementById(primeiro ? `${idBase}-${primeiro.id}` : `${idBase}-consentimento`)?.focus();
      return;
    }
    setEnviando(true);
    try {
      const respostas: Record<string, ValorCampo> = {};
      for (const p of dados.perguntas) if (valores[p.id] !== undefined) respostas[p.id] = valores[p.id];
      const r = await chamarPublico<ReservaFeita>(`booking/${slug}/book`, {
        method: 'POST',
        body: {
          inicio: horario.inicio, nome: valores.nome, telefone: valores.telefone, email: valores.email || undefined,
          respostas, consentimento: consentiu, carimbo: dados.carimbo, website: isca.current?.value ?? '', ...contextoDaPagina(),
        },
      });
      setReserva(r);
      setEtapa('feito');
      requestAnimationFrame(() => titulo.current?.focus());
    } catch (x) {
      const err = x as ErroChamada;
      if (err.status === 409) {
        setErroGeral('Esse horário acabou de ser reservado por outra pessoa. Escolha outro.');
        setHorario(null);
        setEtapa('escolher');
        setRecarregar((n) => n + 1);
        return;
      }
      const porCampo: Record<string, string> = {};
      for (const c of err.corpo?.campos ?? []) porCampo[c.campo] = c.erro.charAt(0).toUpperCase() + c.erro.slice(1);
      setErros(porCampo);
      setErroGeral(err.status === 429 ? 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.' : err.message);
    } finally {
      setEnviando(false);
    }
  }

  const resumo = horario && (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-line bg-surface2 px-4 py-3 text-sm">
      <span className="inline-flex items-center gap-2 font-semibold capitalize text-fg">
        <Icon name="calendar" size={16} />
        {quandoNoFuso(horario.inicio, dados.fuso)}
      </span>
      <span className="inline-flex items-center gap-2 text-muted">
        <Icon name="clock" size={16} />
        {dados.duracaoMin} min
      </span>
      {dados.local && (
        <span className="inline-flex items-center gap-2 text-muted">
          <Icon name="mapPin" size={16} />
          {dados.local}
        </span>
      )}
    </div>
  );

  return (
    <div style={estiloDaMarca(dados.estilo.cor)}>
      <CabecalhoMarca marca={dados.marca.nome}>
        <h1 ref={titulo} tabIndex={-1} className="t-display text-2xl outline-none sm:text-3xl">
          {etapa === 'feito' ? 'Agendamento feito' : dados.titulo}
        </h1>
        {etapa !== 'feito' && (
          <>
            {dados.descricao && <p className="mt-2 whitespace-pre-line text-md text-muted">{dados.descricao}</p>}
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              <span className="inline-flex items-center gap-1.5"><Icon name="clock" size={15} />{dados.duracaoMin} min</span>
              {dados.local && <span className="inline-flex items-center gap-1.5"><Icon name="mapPin" size={15} />{dados.local}</span>}
            </p>
          </>
        )}
      </CabecalhoMarca>

      {erroGeral && etapa !== 'feito' && (
        <p role="alert" className="mb-4 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger">
          {erroGeral}
        </p>
      )}

      {etapa === 'escolher' &&
        (dados.dias.length === 0 ? (
          <div className="state py-10">
            <span className="icon-tile icon-tile-neutral h-11 w-11 rounded-lg"><Icon name="calendar" size={21} /></span>
            <p className="t-section mt-1">Sem horários livres agora</p>
            <p className="max-w-sm text-sm text-muted">Todos os horários dos próximos dias estão ocupados. Volte mais tarde ou fale com a empresa.</p>
          </div>
        ) : (
          <>
            <SeletorHorario slug={slug} dias={dados.dias} janela={dados.janela} fuso={dados.fuso} selecionado={horario} onEscolher={setHorario} recarregar={recarregar} />
            <div className="mt-6 flex justify-end border-t border-line pt-4">
              <button type="button" className="btn btn-primary h-11 px-6" style={{ color: 'var(--brand-on, var(--base-0))' }} disabled={!horario} onClick={() => { setErroGeral(null); setEtapa('dados'); }}>
                Continuar
              </button>
            </div>
          </>
        ))}

      {etapa === 'dados' && horario && (
        <form onSubmit={reservar} noValidate>
          {resumo}
          <button type="button" className="mt-2 text-sm font-medium text-muted underline-offset-4 hover:text-fg hover:underline" onClick={() => setEtapa('escolher')}>
            Trocar horário
          </button>
          <div className="mt-5 grid grid-cols-2 gap-4">
            {todos.map((c) => (
              <CampoPublico
                key={c.id}
                campo={c}
                idBase={idBase}
                valor={valores[c.id]}
                erro={erros[c.id]}
                desabilitado={enviando}
                onChange={(v) => {
                  setValores((s) => ({ ...s, [c.id]: v }));
                  if (erros[c.id]) setErros((s) => ({ ...s, [c.id]: '' }));
                }}
              />
            ))}
            <CampoPublico
              campo={{ id: 'consentimento', tipo: 'consentimento', rotulo: `Autorizo ${dados.marca.nome} a usar meus dados para este agendamento e para falar comigo sobre ele, conforme a LGPD.`, obrigatorio: true, largura: 'inteira' }}
              idBase={idBase}
              valor={consentiu}
              erro={erros.consentimento}
              desabilitado={enviando}
              onChange={(v) => { setConsentiu(v === true); if (erros.consentimento) setErros((s) => ({ ...s, consentimento: '' })); }}
            />
          </div>
          <div aria-hidden className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
            <label htmlFor={`${idBase}-website`}>Site</label>
            <input ref={isca} id={`${idBase}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
          </div>
          <button type="submit" className="btn btn-primary mt-6 h-11 w-full text-base" style={{ color: 'var(--brand-on, var(--base-0))' }} disabled={enviando || previa} aria-busy={enviando || undefined}>
            {enviando ? 'Agendando' : 'Confirmar agendamento'}
          </button>
          {previa && <p className="mt-2 text-center text-xs text-faint">Pré-visualização: a reserva fica desativada aqui.</p>}
        </form>
      )}

      {etapa === 'feito' && reserva && (
        <div role="status" aria-live="polite">
          {reserva.reserva ? (
            <>
              <div className="flex items-start gap-3 rounded-md border border-success-border bg-success-soft p-4">
                <span className="icon-tile icon-tile-success h-10 w-10 shrink-0 rounded-full"><Icon name="check" size={18} /></span>
                <div>
                  <p className="font-semibold capitalize text-fg">{quandoNoFuso(reserva.reserva.inicio, reserva.reserva.fuso)}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    {reserva.reserva.status === 'confirmado' ? 'Horário confirmado.' : 'Horário reservado. A equipe vai confirmar com você.'} Horário de {nomeFuso(reserva.reserva.fuso)}.
                  </p>
                  {reserva.reserva.local && <p className="mt-1 text-sm text-muted">Local: {reserva.reserva.local}</p>}
                </div>
              </div>
              {reserva.token && (
                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                  <a className="btn btn-primary h-11 flex-1" style={{ color: 'var(--brand-on, var(--base-0))' }} href={`/api/public/reservas/${reserva.token}/ics`} download="agendamento.ics">
                    <Icon name="calendar" size={16} />
                    Adicionar ao calendário
                  </a>
                  <a className="btn h-11 flex-1" href={`/b/${slug}/gerenciar/${reserva.token}`}>
                    Remarcar ou cancelar
                  </a>
                </div>
              )}
              <p className="mt-3 text-xs text-faint">Guarde o link de remarcar ou cancelar: ele é o seu acesso a este agendamento.</p>
            </>
          ) : (
            <p className="text-sm text-muted">Recebemos seu pedido.</p>
          )}
        </div>
      )}
      <FeitoComKhub />
    </div>
  );
}
