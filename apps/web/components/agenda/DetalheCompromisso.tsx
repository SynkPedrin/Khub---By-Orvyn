'use client';

import Link from 'next/link';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, Confirm, useFocusTrap } from '@/components/kit';
import { Icon, type IconName } from '@/components/icons';
import { cx } from '@/components/ui';
import type { Compromisso, StatusAgenda } from '@/lib/agenda';
import { duracao, hora } from '@/lib/format';
import { STATUS_LABEL, STATUS_PILL, TIPO_LABEL, TIPO_TOM, chaveDia, ehLink, rotuloDia } from './agenda-utils';

export interface AcoesDetalhe {
  onStatus: (c: Compromisso, s: StatusAgenda) => Promise<void>;
  onReagendar: (c: Compromisso) => void;
  onExcluir: (c: Compromisso) => Promise<void>;
  onSincronizar: (c: Compromisso) => Promise<'ok' | 'conectar' | 'erro'>;
}

/** Âncora: o retângulo do evento clicado (posiciona o cartão ao lado dele). */
export function DetalheCompromisso({
  c,
  ancora,
  nomeContato,
  nomeResponsavel,
  onFechar,
  acoes,
}: {
  c: Compromisso;
  ancora: DOMRect | null;
  nomeContato: string | null | undefined;
  nomeResponsavel: string | null;
  onFechar: () => void;
  acoes: AcoesDetalhe;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<'cancelar' | 'excluir' | null>(null);
  const [conectar, setConectar] = useState(false);
  useFocusTrap(ref, !confirmar, { onEsc: onFechar });

  // Lado do evento que tiver espaço; no celular vira folha inferior (CSS).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !ancora || window.innerWidth < 640) {
      setPos(null);
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const margem = 12;
    let left = ancora.right + 8;
    if (left + w > window.innerWidth - margem) left = ancora.left - w - 8;
    if (left < margem) left = Math.min(Math.max(margem, ancora.left), window.innerWidth - w - margem);
    const top = Math.min(Math.max(margem, ancora.top), window.innerHeight - h - margem);
    setPos({ top, left });
  }, [ancora, c.id]);

  const ini = new Date(c.inicio);
  const fim = new Date(c.fim);
  const minutos = Math.round((+fim - +ini) / 60_000);
  const tom = TIPO_TOM[c.tipo] ?? TIPO_TOM.outro;
  const ativo = c.status === 'agendado' || c.status === 'confirmado';
  const comecou = +ini <= Date.now();

  const executar = async (chave: string, fn: () => Promise<unknown>) => {
    if (ocupado) return;
    setOcupado(chave);
    try {
      await fn();
    } finally {
      setOcupado(null);
    }
  };

  const status = (s: StatusAgenda) => executar(s, () => acoes.onStatus(c, s));

  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-dropdown" onMouseDown={onFechar} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="detalhe-compromisso-titulo"
        className={cx(
          'card fixed z-dropdown flex max-h-[min(560px,calc(100dvh-24px))] flex-col overflow-hidden shadow-xl animate-scale-in',
          'max-sm:inset-x-0 max-sm:bottom-0 max-sm:rounded-b-none sm:w-[360px]',
        )}
        style={pos ? { top: pos.top, left: pos.left } : undefined}
      >
        <div className={cx('flex items-start gap-3 border-l-4 p-4', tom.barra)}>
          <span className="icon-tile h-9 w-9 shrink-0">
            <Icon name={tom.icone} size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p id="detalhe-compromisso-titulo" className={cx('break-words text-md font-semibold', c.status === 'cancelado' ? 'text-muted line-through' : 'text-fg')}>
              {c.titulo}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className={STATUS_PILL[c.status]}>{STATUS_LABEL[c.status]}</span>
              <span className="text-xs text-muted">{TIPO_LABEL[c.tipo] ?? 'Compromisso'}</span>
            </div>
          </div>
          <button type="button" onClick={onFechar} className="btn btn-ghost btn-icon btn-sm shrink-0" aria-label="Fechar detalhes">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
          <Linha icone="calendar">
            <p className="text-sm font-medium text-fg">{rotuloDia(ini)}</p>
            <p className="text-sm tabular text-muted">
              {hora(ini)} às {hora(fim)}
              {chaveDia(ini) !== chaveDia(fim) && ' (dia seguinte)'} · {duracao(minutos)}
            </p>
          </Linha>

          {c.local && (
            <Linha icone={ehLink(c.local) ? 'video' : 'mapPin'}>
              {ehLink(c.local) ? (
                <a href={c.local.trim()} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-brand hover:underline">
                  {c.local.trim().replace(/^https?:\/\//i, '')}
                </a>
              ) : (
                <p className="break-words text-sm text-fg">{c.local}</p>
              )}
            </Linha>
          )}

          <Linha icone="user">
            {c.contactId ? (
              <Link href={`/contatos/${c.contactId}`} className="text-sm font-medium text-brand hover:underline">
                {nomeContato ?? (nomeContato === null ? 'Abrir contato' : 'Carregando contato…')}
              </Link>
            ) : (
              <p className="text-sm text-muted">Sem contato vinculado</p>
            )}
            <p className="text-xs text-muted">Responsável: {nomeResponsavel ?? 'agenda geral'}</p>
          </Linha>

          {(c.lembreteEnviadoEm || c.confirmadoEm || c.faltouEm) && (
            <Linha icone="bell">
              {c.lembreteEnviadoEm && <p className="text-xs text-muted">Lembrete disparado em {rotuloCurto(c.lembreteEnviadoEm)}</p>}
              {c.confirmadoEm && <p className="text-xs text-muted">Confirmado em {rotuloCurto(c.confirmadoEm)}</p>}
              {c.faltouEm && <p className="text-xs text-muted">Falta registrada em {rotuloCurto(c.faltouEm)}</p>}
            </Linha>
          )}

          {c.notas && <p className="whitespace-pre-line break-words rounded-md bg-surface2 p-2.5 text-sm text-muted">{c.notas}</p>}

          {conectar && (
            <div className="rounded-md border border-brand-border bg-brand-softer p-3 text-sm">
              <p className="text-fg">O Google Calendar ainda não está conectado nesta conta.</p>
              <Link href="/configuracoes?aba=integracoes" className="mt-1 inline-flex items-center gap-1 font-medium text-brand hover:underline">
                Conectar Google Calendar <Icon name="arrowRight" size={13} />
              </Link>
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-line p-3">
          <div className="grid grid-cols-2 gap-2">
            {c.status === 'agendado' && (
              <Button size="sm" variant="primary" icon="check" loading={ocupado === 'confirmado'} onClick={() => void status('confirmado')}>
                Confirmar
              </Button>
            )}
            {ativo && (
              <Button size="sm" variant="soft" icon="check" loading={ocupado === 'concluido'} onClick={() => void status('concluido')}>
                Concluir
              </Button>
            )}
            {ativo && (
              <Button size="sm" icon="alert" loading={ocupado === 'faltou'} onClick={() => void status('faltou')} title={comecou ? undefined : 'O compromisso ainda não começou'}>
                Marcar falta
              </Button>
            )}
            <Button size="sm" icon="calendar" onClick={() => acoes.onReagendar(c)}>
              Reagendar
            </Button>
            {!ativo && (
              <Button size="sm" icon="refresh" loading={ocupado === 'agendado'} onClick={() => void status('agendado')}>
                Reativar
              </Button>
            )}
            {c.contactId && (
              <Link href={`/contatos/${c.contactId}`} className="btn btn-sm">
                <Icon name="user" size={14} />
                Abrir contato
              </Link>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              size="sm"
              variant="ghost"
              icon="google"
              loading={ocupado === 'sync'}
              onClick={() =>
                void executar('sync', async () => {
                  const r = await acoes.onSincronizar(c);
                  setConectar(r === 'conectar');
                })
              }
            >
              Google Calendar
            </Button>
            <div className="flex gap-1">
              {ativo && (
                <Button size="sm" variant="ghost" onClick={() => setConfirmar('cancelar')}>
                  Cancelar
                </Button>
              )}
              <Button size="sm" variant="ghost" icon="trash" iconOnly aria-label="Excluir compromisso" onClick={() => setConfirmar('excluir')} />
            </div>
          </div>
        </div>
      </div>

      <Confirm
        open={confirmar === 'cancelar'}
        onClose={() => setConfirmar(null)}
        onConfirm={async () => {
          await acoes.onStatus(c, 'cancelado');
          setConfirmar(null);
        }}
        title="Cancelar este compromisso?"
        description="O horário fica livre e o gatilho Agendamento cancelado dispara as automações ligadas a ele."
        confirmLabel="Cancelar compromisso"
        cancelLabel="Manter"
      />
      <Confirm
        open={confirmar === 'excluir'}
        onClose={() => setConfirmar(null)}
        onConfirm={async () => {
          await acoes.onExcluir(c);
          setConfirmar(null);
        }}
        title="Excluir da agenda?"
        description="O compromisso some do histórico. Para manter o registro, prefira cancelar."
        confirmLabel="Excluir"
      />
    </>,
    document.body,
  );
}

function rotuloCurto(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hora(d)}`;
}

function Linha({ icone, children }: { icone: IconName; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon name={icone} size={15} className="mt-0.5 shrink-0 text-faint" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
