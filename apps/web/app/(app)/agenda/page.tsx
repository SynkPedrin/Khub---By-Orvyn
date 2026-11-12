'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { Avatar, cx } from '@/components/ui';
import { PageShell, PageHeader } from '@/components/revenue/Page';
import { SeloDemo } from '@/components/revenue/SeloDemo';
import { EmptyState } from '@/components/revenue/States';
import { AgendaCalendario } from '@/components/agenda/AgendaCalendario';
import { hora } from '@/lib/format';
import { modoDemo } from '@/lib/demo/flag';
import { COMPROMISSOS, EQUIPE, TAREFAS_AGENDA } from '@/lib/demo/dataset';
import type { Compromisso } from '@/lib/revenue/types';

/**
 * AGENDA — reuniões, demos, calls e follow-ups.
 *
 * Grade semanal desenhada em CSS Grid com faixa horária de 08h às 19h. Um
 * compromisso é posicionado por `grid-row` calculado a partir do horário —
 * não por posicionamento absoluto, o que mantém o layout responsivo e a
 * ordem de leitura correta para leitores de tela.
 *
 * Integração com Google/Microsoft Calendar ainda não existe; a arquitetura
 * de provedores já está prevista em `packages/integrations/calendar`.
 */
export default function AgendaPage() {
  const demo = modoDemo();

  return (
    <PageShell className="max-w-none">
      <PageHeader
        title="Agenda"
        subtitle="Organize suas reuniões, demos e follow-ups. Tempo bem investido gera mais receita."
        quote={'"Disciplina hoje,\nmais oportunidades amanhã."'}
        actions={
          <>
            <SeloDemo />
            {/* Q4.2: páginas públicas de agendamento (link para o cliente marcar sozinho). */}
            <Link href="/agenda/paginas" className="btn btn-sm">
              <Icon name="link" size={14} />
              Páginas de agendamento
            </Link>
          </>
        }
      />

      {demo ? <Calendario /> : <AgendaCalendario />}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */

const HORA_INICIO = 8;
const HORA_FIM = 19;
const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function Calendario() {
  const [visao, setVisao] = useState<'dia' | 'semana' | 'mes'>('semana');
  const [selecionado, setSelecionado] = useState<string | null>('ag3');

  const hoje = useMemo(() => new Date(), []);
  const inicioSemana = useMemo(() => {
    const d = new Date(hoje);
    // Segunda-feira como primeiro dia (domingo = 0 no JS).
    const diaSemana = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - diaSemana);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [hoje]);

  const diasDaSemana = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(inicioSemana);
        d.setDate(d.getDate() + i);
        return d;
      }),
    [inicioSemana],
  );

  const compromisso = COMPROMISSOS.find((c) => c.id === selecionado);

  return (
    <div className="grid gap-4 xl:grid-cols-[236px_minmax(0,1fr)] 2xl:grid-cols-[236px_minmax(0,1fr)_296px]">
      {/* Coluna 1 — mini calendário, equipe, tarefas */}
      <div className="min-w-0 space-y-4">
        <MiniCalendario hoje={hoje} />

        <section className="card p-4">
          <h2 className="mb-3 flex items-center justify-between text-[13.5px] font-semibold text-fg">
            Minha equipe
            <Icon name="chevronDown" size={15} className="text-faint" />
          </h2>
          <ul className="space-y-2.5">
            {[EQUIPE.lucas, EQUIPE.mariana, EQUIPE.pedro].map((m, i) => (
              <li key={m.id} className="flex items-center gap-2.5">
                <input type="checkbox" className="checkbox shrink-0" defaultChecked={i < 2} aria-label={`Mostrar agenda de ${m.nome}`} />
                <Avatar name={m.nome} size={24} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{m.nome}</span>
              </li>
            ))}
            <li className="flex items-center gap-2.5">
              <input type="checkbox" className="checkbox shrink-0" aria-label="Mostrar agenda do Time de Vendas" />
              <span className="icon-tile icon-tile-neutral h-6 w-6 rounded-full">
                <Icon name="users" size={12} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-fg">Time de Vendas</span>
            </li>
          </ul>
        </section>

        <section className="card p-4">
          <h2 className="mb-3 flex items-center justify-between text-[13.5px] font-semibold text-fg">
            Minhas tarefas
            <Link href="/leads" className="flex items-center gap-1 text-[12.5px] font-normal text-brand hover:underline">
              Ver todas <Icon name="arrowRight" size={13} />
            </Link>
          </h2>
          <ul className="space-y-3">
            {TAREFAS_AGENDA.map((t) => (
              <li key={t.id} className="flex items-start gap-2.5">
                <input type="checkbox" className="checkbox mt-0.5 shrink-0" defaultChecked={t.concluida} aria-label={t.titulo} />
                <span className={cx('min-w-0 flex-1 text-[12.5px] leading-snug', t.concluida ? 'text-muted line-through' : 'text-fg')}>
                  {t.titulo}
                </span>
                <span className={cx('shrink-0 text-[11.5px] tabular', t.concluida ? 'text-faint' : 'text-muted')}>
                  {hora(t.quando)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Coluna 2 — grade */}
      <section className="card flex min-w-0 flex-col" aria-label="Grade da agenda">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-3">
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-sm">
              Hoje
            </button>
            <button type="button" className="btn btn-icon btn-sm" aria-label="Semana anterior">
              <Icon name="arrowLeft" size={15} />
            </button>
            <button type="button" className="btn btn-icon btn-sm" aria-label="Próxima semana">
              <Icon name="arrowRight" size={15} />
            </button>
            <p className="ml-1 text-[14px] font-semibold text-fg">
              {diasDaSemana[0].getDate()} – {diasDaSemana[6].getDate()} de{' '}
              {diasDaSemana[6].toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
            </p>
          </div>

          <div className="segbar" role="tablist" aria-label="Visualização do calendário">
            {(['dia', 'semana', 'mes'] as const).map((v) => (
              <button key={v} type="button" role="tab" className="seg" aria-selected={visao === v} onClick={() => setVisao(v)}>
                {{ dia: 'Dia', semana: 'Semana', mes: 'Mês' }[v]}
              </button>
            ))}
          </div>
        </header>

        {visao === 'semana' ? (
          <GradeSemana dias={diasDaSemana} hoje={hoje} selecionado={selecionado} onSelecionar={setSelecionado} />
        ) : (
          <div className="p-6">
            <EmptyState
              icon="calendar"
              title={`Visão de ${visao}`}
              description="A visão semanal é a padrão desta versão. Dia e mês entram na sequência."
              action={
                <button type="button" className="btn btn-sm" onClick={() => setVisao('semana')}>
                  Voltar para a semana
                </button>
              }
            />
          </div>
        )}
      </section>

      {/* Coluna 3 — detalhe */}
      <aside className="hidden min-w-0 2xl:block">
        <button type="button" className="btn btn-primary mb-4 w-full">
          <Icon name="plus" size={16} />
          Nova reunião
        </button>
        {compromisso ? (
          <DetalheCompromisso compromisso={compromisso} onFechar={() => setSelecionado(null)} />
        ) : (
          <div className="card">
            <EmptyState icon="calendar" title="Nenhum compromisso selecionado" description="Clique em um evento da grade para ver os detalhes." />
          </div>
        )}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function GradeSemana({
  dias,
  hoje,
  selecionado,
  onSelecionar,
}: {
  dias: Date[];
  hoje: Date;
  selecionado: string | null;
  onSelecionar: (id: string) => void;
}) {
  const horas = Array.from({ length: HORA_FIM - HORA_INICIO + 1 }, (_, i) => HORA_INICIO + i);

  return (
    <div className="min-w-0 overflow-x-auto scrollbar-thin">
      <div className="min-w-[760px]">
        {/* Cabeçalho dos dias */}
        <div className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))] border-b border-line">
          <div aria-hidden />
          {dias.map((d, i) => {
            const ehHoje = d.toDateString() === hoje.toDateString();
            return (
              <div key={i} className="border-l border-line py-2 text-center">
                <p className="text-[11.5px] text-muted">{DIAS_SEMANA[i]}</p>
                <p
                  className={cx(
                    'mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-[14px] font-semibold',
                    ehHoje ? 'bg-brand text-white' : 'text-fg',
                  )}
                >
                  {d.getDate()}
                </p>
              </div>
            );
          })}
        </div>

        {/* Faixas horárias */}
        <div className="relative grid grid-cols-[52px_repeat(7,minmax(0,1fr))]">
          {/* Coluna de horas */}
          <div>
            {horas.map((h) => (
              <div key={h} className="h-14 border-b border-line pr-2 text-right">
                <span className="relative -top-2 text-[11px] tabular text-faint">{String(h).padStart(2, '0')}:00</span>
              </div>
            ))}
          </div>

          {/* Colunas de dias */}
          {dias.map((dia, i) => {
            const doDia = COMPROMISSOS.filter((c) => new Date(c.inicio).toDateString() === dia.toDateString());
            return (
              <div key={i} className="relative border-l border-line">
                {horas.map((h) => (
                  <div key={h} className="h-14 border-b border-line" />
                ))}

                {doDia.map((c) => (
                  <EventoGrade key={c.id} compromisso={c} selecionado={selecionado === c.id} onSelecionar={onSelecionar} />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Um bloco de evento posicionado pelo horário dentro da coluna do dia. */
function EventoGrade({
  compromisso,
  selecionado,
  onSelecionar,
}: {
  compromisso: Compromisso;
  selecionado: boolean;
  onSelecionar: (id: string) => void;
}) {
  const inicio = new Date(compromisso.inicio);
  const fim = new Date(compromisso.fim);

  const ALTURA_HORA = 56; // h-14
  const minutosDesdeInicio = (inicio.getHours() - HORA_INICIO) * 60 + inicio.getMinutes();
  const duracaoMin = Math.max(30, (fim.getTime() - inicio.getTime()) / 60_000);

  // Fora da faixa exibida: não desenha (melhor sumir do que vazar da grade).
  if (inicio.getHours() < HORA_INICIO || inicio.getHours() > HORA_FIM) return null;

  const tom = TOM_EVENTO[compromisso.tipo];

  return (
    <button
      type="button"
      onClick={() => onSelecionar(compromisso.id)}
      className={cx(
        'absolute left-0.5 right-0.5 overflow-hidden rounded-sm border-l-[3px] px-2 py-1 text-left transition',
        tom.classe,
        selecionado && 'ring-2 ring-brand',
      )}
      style={{ top: (minutosDesdeInicio / 60) * ALTURA_HORA, height: (duracaoMin / 60) * ALTURA_HORA - 3 }}
    >
      <span className="flex items-center gap-1">
        <Icon name={tom.icone} size={11} className="shrink-0" />
        <span className="truncate text-[11.5px] font-semibold leading-tight">{compromisso.titulo}</span>
      </span>
      {compromisso.subtitulo && duracaoMin >= 45 && (
        <span className="block truncate text-[10.5px] leading-tight opacity-80">{compromisso.subtitulo}</span>
      )}
      {duracaoMin >= 45 && (
        <span className="block text-[10.5px] tabular leading-tight opacity-70">
          {hora(compromisso.inicio)} – {hora(compromisso.fim)}
        </span>
      )}
    </button>
  );
}

const TOM_EVENTO: Record<Compromisso['tipo'], { classe: string; icone: IconName }> = {
  reuniao: { classe: 'border-l-[#6c2bff] bg-brand-soft text-fg', icone: 'users' },
  call: { classe: 'border-l-[#0284c7] bg-info-soft text-fg', icone: 'phone' },
  demo: { classe: 'border-l-[#6c2bff] bg-brand-soft text-fg', icone: 'video' },
  followup: { classe: 'border-l-[#dc2626] bg-danger-soft text-fg', icone: 'chat' },
  tarefa: { classe: 'border-l-[#b45309] bg-warning-soft text-fg', icone: 'file' },
  interno: { classe: 'border-l-[#047857] bg-success-soft text-fg', icone: 'users' },
  pessoal: { classe: 'border-l-[#8a8c9e] bg-surface2 text-fg', icone: 'clock' },
};

/* ------------------------------------------------------------------ */

function MiniCalendario({ hoje }: { hoje: Date }) {
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  const primeiro = new Date(ano, mes, 1);
  const deslocamento = (primeiro.getDay() + 6) % 7; // segunda como coluna 0
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();

  const celulas: (number | null)[] = [
    ...Array.from({ length: deslocamento }, () => null),
    ...Array.from({ length: diasNoMes }, (_, i) => i + 1),
  ];
  while (celulas.length % 7 !== 0) celulas.push(null);

  return (
    <section className="card p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-[14px] font-bold capitalize text-fg">
          {hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
        </h2>
        <div className="flex gap-0.5">
          <button type="button" className="btn btn-ghost btn-icon btn-sm h-7 w-7" aria-label="Mês anterior">
            <Icon name="arrowLeft" size={14} />
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm h-7 w-7" aria-label="Próximo mês">
            <Icon name="arrowRight" size={14} />
          </button>
        </div>
      </header>

      <table className="w-full" role="grid">
        <thead>
          <tr>
            {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (
              <th key={i} scope="col" className="pb-1.5 text-center text-[11px] font-medium text-faint">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: celulas.length / 7 }, (_, linha) => (
            <tr key={linha}>
              {celulas.slice(linha * 7, linha * 7 + 7).map((dia, col) => (
                <td key={col} className="p-0.5 text-center">
                  {dia && (
                    <span
                      className={cx(
                        'mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[12.5px] tabular',
                        dia === hoje.getDate() ? 'bg-brand font-semibold text-white' : 'text-fg hover:bg-surface2',
                      )}
                      aria-current={dia === hoje.getDate() ? 'date' : undefined}
                    >
                      {dia}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function DetalheCompromisso({ compromisso, onFechar }: { compromisso: Compromisso; onFechar: () => void }) {
  const tom = TOM_EVENTO[compromisso.tipo];

  return (
    <div className="card">
      <div className="flex items-start gap-3 p-4">
        <span className="icon-tile h-10 w-10">
          <Icon name={tom.icone} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-fg">{compromisso.titulo}</p>
          <p className="truncate text-[12.5px] text-muted">{compromisso.subtitulo}</p>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Mais opções">
            <Icon name="dots" size={16} />
          </button>
          <button type="button" onClick={onFechar} className="btn btn-ghost btn-icon btn-sm" aria-label="Fechar detalhes">
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>

      <div className="space-y-4 px-4 pb-4">
        <div className="flex items-start gap-2.5">
          <Icon name="calendar" size={15} className="mt-0.5 shrink-0 text-faint" />
          <div>
            <p className="text-[13px] font-medium capitalize text-fg">
              {new Date(compromisso.inicio).toLocaleDateString('pt-BR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
            <p className="text-[12.5px] text-muted">
              {hora(compromisso.inicio)} – {hora(compromisso.fim)} (
              {Math.round((new Date(compromisso.fim).getTime() - new Date(compromisso.inicio).getTime()) / 3_600_000)}h)
            </p>
          </div>
        </div>

        {compromisso.local && (
          <div className="flex items-start gap-2.5">
            <Icon name="video" size={15} className="mt-0.5 shrink-0 text-faint" />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-fg">Google Meet</p>
              <p className="flex items-center gap-1.5">
                <a href={`https://${compromisso.local.valor}`} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-[12.5px] text-brand hover:underline">
                  {compromisso.local.valor}
                </a>
                <button type="button" aria-label="Copiar link da reunião">
                  <Icon name="file" size={13} className="text-faint" />
                </button>
              </p>
            </div>
          </div>
        )}

        {compromisso.participantes && compromisso.participantes.length > 0 && (
          <div>
            <p className="mb-2 text-[13px] font-semibold text-fg">Participantes ({compromisso.participantes.length})</p>
            <ul className="space-y-2">
              {compromisso.participantes.map((p) => (
                <li key={p.nome} className="flex items-center gap-2.5">
                  <Avatar name={p.nome} size={26} />
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium text-fg">{p.nome}</p>
                    <p className="truncate text-[11px] text-muted">{p.papel ? `${p.papel} · ${p.empresa}` : p.empresa}</p>
                  </div>
                </li>
              ))}
              <li>
                <button type="button" className="flex items-center gap-2.5 text-[12.5px] font-medium text-brand hover:underline">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-brand">
                    <Icon name="plus" size={12} />
                  </span>
                  Adicionar participante
                </button>
              </li>
            </ul>
          </div>
        )}

        {compromisso.descricao && (
          <div>
            <p className="mb-1 text-[13px] font-semibold text-fg">Descrição</p>
            <p className="text-[12.5px] leading-relaxed text-muted">{compromisso.descricao}</p>
          </div>
        )}

        {compromisso.tags && compromisso.tags.length > 0 && (
          <div>
            <p className="mb-1.5 text-[13px] font-semibold text-fg">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {compromisso.tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {compromisso.local?.tipo === 'meet' && (
          <a href={`https://${compromisso.local.valor}`} target="_blank" rel="noopener noreferrer" className="btn btn-primary w-full">
            <Icon name="video" size={15} />
            Entrar na reunião
          </a>
        )}

        <div className="flex gap-2">
          <button type="button" className="btn btn-sm flex-1">
            <Icon name="edit" size={14} />
            Editar
          </button>
          <button type="button" className="btn btn-danger btn-sm flex-1">
            <Icon name="trash" size={14} />
            Cancelar reunião
          </button>
        </div>

        <div className="rounded-md border border-brand-border bg-brand-softer p-3">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-fg">
            <Icon name="ai" size={14} className="text-brand" />
            Sugestão da NICO
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            Prepare um case de uso do seu segmento. Empresas similares tiveram +32% em conversão.
          </p>
          <Link href="/ia" className="mt-2 flex items-center gap-1 text-[12px] font-medium text-brand hover:underline">
            Ver briefing completo <Icon name="arrowRight" size={12} />
          </Link>
        </div>
      </div>
    </div>
  );
}
