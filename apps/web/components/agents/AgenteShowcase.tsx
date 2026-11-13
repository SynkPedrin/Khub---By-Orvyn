'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { Avatar, cx } from '@/components/ui';

/**
 * Vitrine animada do agente — mesma linguagem da demo da LP (conversa +
 * fluxo operacional + CRM), rodando em loop no topo de /agentes.
 * Dados simulados e rotulados como demonstração.
 */

const MENSAGENS: Array<{ de: 'cliente' | 'agente'; texto: string; hora: string }> = [
  { de: 'cliente', texto: 'Olá! Gostaria de agendar uma avaliação para esta semana.', hora: '09:41' },
  { de: 'agente', texto: 'Olá! Claro. Vou conferir os horários disponíveis para você.', hora: '09:41' },
  { de: 'agente', texto: 'Temos terça às 14h e quarta às 10h. Qual funciona melhor?', hora: '09:42' },
  { de: 'cliente', texto: 'Quarta às 10h, por favor.', hora: '09:42' },
  { de: 'agente', texto: 'Perfeito! Seu horário ficou reservado para quarta às 10h.', hora: '09:43' },
];

const ETAPAS: Array<{ titulo: string; detalhe: string; tag: 'CONVERSA' | 'AGENTE' | 'CRM' }> = [
  { titulo: 'Mensagem recebida', detalhe: 'Canal: WhatsApp', tag: 'CONVERSA' },
  { titulo: 'Identificar intenção', detalhe: 'Intenção: agendar avaliação', tag: 'AGENTE' },
  { titulo: 'Consultar base de conhecimento', detalhe: 'Avaliação · 40 min', tag: 'AGENTE' },
  { titulo: 'Consultar agenda', detalhe: '2 horários livres nesta semana', tag: 'AGENTE' },
  { titulo: 'Apresentar horários', detalhe: 'Ter 14:00 · Qua 10:00', tag: 'CONVERSA' },
  { titulo: 'Cliente escolhe', detalhe: 'Qua 10:00', tag: 'CONVERSA' },
  { titulo: 'Criar agendamento', detalhe: 'Qua 10:00 · Avaliação', tag: 'CRM' },
  { titulo: 'Atualizar CRM', detalhe: 'Novo contato → Agendamento', tag: 'CRM' },
  { titulo: 'Registrar atendimento', detalhe: 'Histórico salvo na ficha', tag: 'CRM' },
];

/** Em qual etapa cada mensagem aparece. */
const MSG_NA_ETAPA = [0, 1, 4, 5, 7];
const PASSO_MS = 1050;
const PAUSA_FINAL_MS = 3200;

export function AgenteShowcase() {
  const [etapa, setEtapa] = useState(0);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setEtapa(ETAPAS.length); // estado final, sem loop
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const tick = (atual: number) => {
      if (atual >= ETAPAS.length) {
        timer = setTimeout(() => { setEtapa(0); tick(0); }, PAUSA_FINAL_MS);
      } else {
        timer = setTimeout(() => { setEtapa(atual + 1); tick(atual + 1); }, PASSO_MS);
      }
    };
    tick(0);
    return () => clearTimeout(timer);
  }, []);

  const mensagensVisiveis = MENSAGENS.filter((_, i) => etapa > MSG_NA_ETAPA[i]);
  const concluido = etapa >= ETAPAS.length;

  return (
    <section aria-label="Demonstração simulada: agente de IA atendendo" className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <p className="text-[13px] font-semibold text-fg">
          Assista um agente trabalhar
          <span className="ml-2 font-normal text-muted">— da mensagem ao CRM, sem ninguém copiar e colar</span>
        </p>
        <span className="pill">Demonstração simulada</span>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_1.15fr_1fr] lg:p-5">
        {/* Conversa */}
        <div className="card-inset flex min-h-[380px] flex-col p-4">
          <div className="flex items-center gap-2.5 border-b border-line pb-3">
            <Avatar name="Mariana Costa" size={30} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-fg">Mariana Costa</p>
              <p className="text-[11px] text-faint">WhatsApp · 09:41</p>
            </div>
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="absolute inset-0 animate-pulse-dot rounded-full bg-lime" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-lime" />
            </span>
          </div>
          <div className="mt-3 flex flex-1 flex-col justify-end gap-2">
            {mensagensVisiveis.map((m, i) => (
              <div
                key={i}
                className={cx(
                  'animate-fade-in max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-snug',
                  m.de === 'agente'
                    ? 'self-end rounded-br-md bg-brand/15 text-fg shadow-[inset_0_0_0_1px_var(--brand-border)]'
                    : 'self-start rounded-bl-md bg-surface3 text-fg',
                )}
              >
                {m.texto}
                <span className="mt-1 block text-right text-[10px] text-faint">{m.hora}</span>
              </div>
            ))}
            {!concluido && etapa > 0 && etapa < ETAPAS.length && mensagensVisiveis.length < MENSAGENS.length && (
              <div className="flex items-center gap-1.5 self-end rounded-2xl bg-brand/10 px-3.5 py-2.5">
                {[0, 1, 2].map((d) => (
                  <span key={d} className="h-1.5 w-1.5 animate-typing rounded-full bg-brand" style={{ animationDelay: `${d * 0.18}s` }} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Fluxo operacional */}
        <div className="card-inset flex min-h-[380px] flex-col p-4">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <p className="text-[13px] font-semibold text-fg">Fluxo operacional do agente</p>
            <span className="text-[11px] tabular text-faint">{Math.min(etapa, ETAPAS.length)}/{ETAPAS.length}</span>
          </div>
          <ol className="relative mt-3 flex-1 space-y-1">
            {/* trilho vertical */}
            <span aria-hidden className="absolute bottom-2 left-[13px] top-2 w-px bg-white/[0.08]" />
            <span
              aria-hidden
              className="absolute left-[13px] top-2 w-px bg-brand transition-[height] duration-700 ease-out"
              style={{ height: `${(Math.min(etapa, ETAPAS.length) / ETAPAS.length) * 92}%` }}
            />
            {ETAPAS.map((e, i) => {
              const feita = i < etapa;
              const ativa = i === etapa;
              return (
                <li key={e.titulo} className={cx('relative flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors', ativa && 'bg-brand/[0.07]')}>
                  <span
                    className={cx(
                      'relative grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border transition-all duration-500',
                      feita ? 'border-brand bg-brand text-[#0e1a04]' : ativa ? 'border-brand text-brand' : 'border-white/15 text-transparent',
                    )}
                  >
                    <Icon name="check2" size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cx('block truncate text-[13px] transition-colors', feita || ativa ? 'font-medium text-fg' : 'text-faint')}>{e.titulo}</span>
                    <span className={cx('block truncate text-[11px] transition-colors', feita || ativa ? 'text-muted' : 'text-faint/60')}>{e.detalhe}</span>
                  </span>
                  <span className={cx('pill shrink-0 !h-5 text-[10px]', feita ? 'pill-brand' : 'opacity-40')}>{e.tag}</span>
                </li>
              );
            })}
          </ol>
          <div
            className={cx(
              'mt-3 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 transition-all duration-500',
              concluido ? 'border-brand/50 bg-brand/10 opacity-100' : 'border-line opacity-40',
            )}
          >
            <span className={cx('grid h-6 w-6 place-items-center rounded-full', concluido ? 'bg-brand text-[#0e1a04]' : 'bg-surface3 text-faint')}>
              <Icon name="check2" size={13} />
            </span>
            <p className="text-[13px] font-semibold text-fg">
              Agendamento criado
              <span className="ml-2 font-normal text-muted">Qua 10:00 · Mariana Costa</span>
            </p>
          </div>
        </div>

        {/* CRM e agenda */}
        <div className="card-inset flex min-h-[380px] flex-col p-4">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <p className="text-[13px] font-semibold text-fg">CRM e agenda</p>
            <span className="text-[11px] text-faint">tempo real</span>
          </div>

          <div className={cx('mt-3 rounded-xl border p-3 transition-all duration-500', etapa > 6 ? 'border-brand/40 bg-brand/[0.06]' : 'border-line')}>
            <div className="flex items-center gap-2.5">
              <Avatar name="Mariana Costa" size={28} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-fg">Mariana Costa</p>
                <p className="text-[11px] text-faint">{etapa > 6 ? 'Qua · 10:00 · Avaliação' : 'Novo contato'}</p>
              </div>
              {etapa > 6 && <span className="pill pill-brand">Agendado</span>}
            </div>
          </div>

          {/* Mini agenda da semana */}
          <div className="mt-3 rounded-xl border border-line p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-faint">Agenda · esta semana</p>
            <div className="grid grid-cols-5 gap-1.5">
              {['Seg', 'Ter', 'Qua', 'Qui', 'Sex'].map((d) => (
                <span key={d} className="text-center text-[10px] text-faint">{d}</span>
              ))}
              {Array.from({ length: 15 }, (_, i) => {
                const reservado = i === 7; // Qua, segunda linha
                return (
                  <span
                    key={i}
                    className={cx(
                      'h-6 rounded-md border transition-all duration-500',
                      reservado && etapa > 6
                        ? 'border-brand bg-brand/80 shadow-[0_0_14px_-2px_var(--brand)]'
                        : 'border-white/[0.06] bg-white/[0.03]',
                    )}
                  />
                );
              })}
            </div>
          </div>

          <ul className="mt-3 space-y-1.5 text-[12px]">
            {[
              { texto: 'Agendamento criado · Qua 10:00', aparece: 7 },
              { texto: 'CRM atualizado · Agendamento', aparece: 8 },
              { texto: 'Atendimento registrado', aparece: 9 },
            ].map((a) => (
              <li
                key={a.texto}
                className={cx(
                  'flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-all duration-500',
                  etapa >= a.aparece ? 'bg-brand/[0.06] text-fg opacity-100' : 'text-faint opacity-35',
                )}
              >
                <span className={cx('h-1.5 w-1.5 rounded-full', etapa >= a.aparece ? 'bg-brand' : 'bg-white/15')} />
                {a.texto}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
