'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button, Select, Switch, Textarea, useToast } from '@/components/kit';
import { Icon } from '@/components/icons';
import { cx, Input } from '@/components/ui';
import { PageShell } from '@/components/revenue/Page';
import { CampoCodigo } from '@/components/formularios/CampoCodigo';
import { CampoPublico } from '@/components/publico/CampoPublico';
import { estiloDaMarca } from '@/components/publico/FormularioPublico';
import { useAuth } from '@/lib/auth';
import { campoNovo, mensagemDeErro } from '@/lib/formularios';
import { DIAS, FUSOS, TIPOS_COMPROMISSO, horariosDaGrade, linkPublico, type DiaSemana, type Faixa, type PaginaAgendamento, type PaginaPatch } from '@/lib/paginas-agendamento';
import { ROTULO_TIPO, type CampoView, type TipoCampoPublico } from '@/lib/publico/tipos';
import { settingsApi, type Member } from '@/lib/settings';

const num = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));
const TIPOS_PERGUNTA: TipoCampoPublico[] = ['text', 'textarea', 'select', 'multiselect', 'checkbox', 'date', 'number'];

/**
 * Editor da página de agendamento (Q4.2) com pré-visualização, compartilhado
 * entre a página da equipe (`/agenda/paginas/[id]`) e a página pessoal
 * (`/agenda/meu-link`, CAL-PESSOAL). No modo `pessoal` a seção "Quem atende"
 * sai: a reserva cai sempre na agenda do dono, imposto pelo servidor.
 */
export function EditorPaginaAgendamento({
  inicial,
  voltarHref,
  pessoal = false,
  onSalvar,
}: {
  inicial: PaginaAgendamento;
  voltarHref: string;
  pessoal?: boolean;
  onSalvar: (patch: PaginaPatch) => Promise<PaginaAgendamento>;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const [salva, setSalva] = useState<PaginaAgendamento>(inicial);
  const [p, setP] = useState<PaginaAgendamento>(inicial);
  const [salvando, setSalvando] = useState(false);
  const [membros, setMembros] = useState<Member[] | null>(null);
  const [origem, setOrigem] = useState('');

  useEffect(() => {
    setOrigem(window.location.origin);
    if (!pessoal) settingsApi.members().then((r) => setMembros(r.members)).catch(() => setMembros([]));
  }, [pessoal]);

  const sujo = useMemo(() => JSON.stringify(p) !== JSON.stringify(salva), [p, salva]);
  useEffect(() => {
    if (!sujo) return;
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [sujo]);

  const mudar = (patch: Partial<PaginaAgendamento>) => setP((x) => ({ ...x, ...patch }));

  async function salvar() {
    setSalvando(true);
    try {
      const horarios = Object.fromEntries(Object.entries(p.horarios).filter(([, f]) => f && f.length));
      const x = await onSalvar({
        slug: p.slug, titulo: p.titulo, descricao: p.descricao?.trim() || null, duracaoMin: p.duracaoMin, intervaloMin: p.intervaloMin,
        antecedenciaMinHoras: p.antecedenciaMinHoras, janelaDias: p.janelaDias, horarios, fuso: p.fuso,
        ...(pessoal ? {} : { responsaveis: p.responsaveis, distribuicao: p.distribuicao }),
        local: p.local?.trim() || null, tipo: p.tipo, perguntas: p.perguntas.map((q) => ({ ...q, opcoes: q.opcoes?.map((o) => o.trim()).filter(Boolean) })),
        confirmacaoAutomatica: p.confirmacaoAutomatica, estilo: p.estilo.cor ? { cor: p.estilo.cor } : {}, ativo: p.ativo,
      });
      setSalva(x);
      setP(x);
      toast.success('Página salva');
    } catch (e) {
      toast.error(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  }

  const faixasDe = (d: DiaSemana) => p.horarios[d] ?? [];
  const setFaixas = (d: DiaSemana, f: Faixa[]) => mudar({ horarios: { ...p.horarios, [d]: f } });

  return (
    <PageShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={voltarHref} className="btn btn-ghost btn-sm btn-icon" aria-label="Voltar"><Icon name="arrowLeft" size={16} /></Link>
          <div className="min-w-0">
            <label htmlFor="titulo" className="sr-only">Título da página</label>
            <input id="titulo" value={p.titulo} maxLength={120} onChange={(e) => mudar({ titulo: e.target.value })} className="t-display w-full min-w-0 bg-transparent text-2xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]" />
            <p className="text-xs text-faint">{salva.totalReservas} reserva(s) · /b/{salva.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Switch label={p.ativo ? 'Publicada' : 'Pausada'} checked={p.ativo} onChange={(v) => mudar({ ativo: v })} />
          <a className="btn btn-sm" href={`/b/${salva.slug}`} target="_blank" rel="noopener noreferrer"><Icon name="external" size={14} />Abrir</a>
          <Button variant="primary" loading={salvando} disabled={!sujo} onClick={() => void salvar()}>{sujo ? 'Salvar alterações' : 'Salvo'}</Button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-5">
          <section className="card space-y-4 p-5" aria-labelledby="s-basico">
            <h2 id="s-basico" className="text-sm font-semibold text-fg">Sobre o atendimento</h2>
            <div>
              <label htmlFor="desc" className="mb-1.5 block text-sm font-medium text-fg">Descrição</label>
              <Textarea id="desc" rows={3} maxLength={2000} showCount value={p.descricao ?? ''} onChange={(e) => mudar({ descricao: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="duracao" className="mb-1.5 block text-sm font-medium text-fg">Duração (min)</label>
                <Input id="duracao" type="number" min={5} max={480} step={5} value={p.duracaoMin} onChange={(e) => mudar({ duracaoMin: num(e.target.value, 5, 480) })} />
              </div>
              <div>
                <label htmlFor="intervalo" className="mb-1.5 block text-sm font-medium text-fg">Intervalo entre (min)</label>
                <Input id="intervalo" type="number" min={0} max={240} step={5} value={p.intervaloMin} onChange={(e) => mudar({ intervaloMin: num(e.target.value, 0, 240) })} />
              </div>
              <div>
                <label htmlFor="tipo" className="mb-1.5 block text-sm font-medium text-fg">Tipo na agenda</label>
                <Select id="tipo" value={p.tipo} options={TIPOS_COMPROMISSO.map((t) => ({ value: t.value, label: t.label }))} onChange={(v) => mudar({ tipo: v as PaginaAgendamento['tipo'] })} />
              </div>
            </div>
            <div>
              <label htmlFor="local" className="mb-1.5 block text-sm font-medium text-fg">Local ou link da chamada</label>
              <Input id="local" maxLength={300} placeholder="Ex.: Rua das Flores, 100 ou https://meet.google.com/..." value={p.local ?? ''} onChange={(e) => mudar({ local: e.target.value })} />
            </div>
          </section>

          <section className="card space-y-4 p-5" aria-labelledby="s-disp">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="s-disp" className="text-sm font-semibold text-fg">Disponibilidade</h2>
              <div className="w-56">
                <label htmlFor="fuso" className="sr-only">Fuso horário</label>
                <Select id="fuso" size="sm" value={p.fuso} options={FUSOS.some((f) => f.value === p.fuso) ? FUSOS : [...FUSOS, { value: p.fuso, label: p.fuso }]} onChange={(v) => mudar({ fuso: v })} />
              </div>
            </div>
            <ul className="divide-y divide-[var(--border)]">
              {DIAS.map((d) => {
                const faixas = faixasDe(d.key);
                const aberto = faixas.length > 0;
                return (
                  <li key={d.key} className="flex flex-wrap items-start gap-3 py-3">
                    <div className="w-32 pt-1.5">
                      <Switch label={d.nome} checked={aberto} onChange={(v) => setFaixas(d.key, v ? [{ de: '09:00', ate: '18:00' }] : [])} />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      {!aberto && <span className="pt-1.5 text-sm text-faint">Fechado</span>}
                      {faixas.map((f, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-2">
                          <input type="time" aria-label={`${d.nome}: início da faixa ${i + 1}`} className="input w-28" value={f.de} step={300} onChange={(e) => setFaixas(d.key, faixas.map((x, j) => (j === i ? { ...x, de: e.target.value } : x)))} />
                          <span className="text-sm text-muted">até</span>
                          <input type="time" aria-label={`${d.nome}: fim da faixa ${i + 1}`} className="input w-28" value={f.ate} step={300} onChange={(e) => setFaixas(d.key, faixas.map((x, j) => (j === i ? { ...x, ate: e.target.value } : x)))} />
                          <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Remover faixa ${i + 1} de ${d.nome}`} onClick={() => setFaixas(d.key, faixas.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></button>
                        </div>
                      ))}
                      {aberto && faixas.length < 6 && (
                        <button type="button" className="self-start text-xs font-medium text-brand hover:underline" onClick={() => setFaixas(d.key, [...faixas, { de: '14:00', ate: '18:00' }])}>
                          Adicionar faixa
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card space-y-4 p-5" aria-labelledby="s-regras">
            <h2 id="s-regras" className="text-sm font-semibold text-fg">Regras</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="antecedencia" className="mb-1.5 block text-sm font-medium text-fg">Antecedência mínima (horas)</label>
                <Input id="antecedencia" type="number" min={0} max={720} value={p.antecedenciaMinHoras} onChange={(e) => mudar({ antecedenciaMinHoras: num(e.target.value, 0, 720) })} />
              </div>
              <div>
                <label htmlFor="janela" className="mb-1.5 block text-sm font-medium text-fg">Agenda aberta para os próximos (dias)</label>
                <Input id="janela" type="number" min={1} max={180} value={p.janelaDias} onChange={(e) => mudar({ janelaDias: num(e.target.value, 1, 180) })} />
              </div>
            </div>
            <Switch layout="row" label="Confirmar automaticamente" description="Ligado: o horário já nasce confirmado. Desligado: fica como agendado até a equipe confirmar." checked={p.confirmacaoAutomatica} onChange={(v) => mudar({ confirmacaoAutomatica: v })} />
          </section>

          {pessoal ? (
            <section className="card space-y-1.5 p-5" aria-labelledby="s-pessoal">
              <h2 id="s-pessoal" className="flex items-center gap-2 text-sm font-semibold text-fg"><Icon name="user" size={15} />Sua página pessoal</h2>
              <p className="text-sm text-muted">
                As reservas deste link caem sempre na <strong>sua</strong> agenda — e aparecem na visão da equipe com você de responsável.
                Os horários que você bloquear na agenda (reuniões, visitas) somem daqui automaticamente.
              </p>
            </section>
          ) : (
            <section className="card space-y-4 p-5" aria-labelledby="s-equipe">
              <h2 id="s-equipe" className="text-sm font-semibold text-fg">Quem atende</h2>
              {membros === null ? (
                <p className="text-sm text-muted">Carregando a equipe</p>
              ) : membros.length === 0 ? (
                <p className="text-sm text-muted">Não foi possível listar a equipe (só administradores veem os membros). Sem responsáveis, a página usa a agenda geral.</p>
              ) : (
                <fieldset>
                  <legend className="mb-2 text-sm text-muted">Sem ninguém marcado, a página usa a agenda geral (qualquer compromisso bloqueia o horário).</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {membros.map((m) => {
                      const marcado = p.responsaveis.includes(m.identityId);
                      return (
                        <label key={m.identityId} className={cx('flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm', marcado ? 'border-brand bg-brand-softer' : 'border-line')}>
                          <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={marcado} onChange={(e) => mudar({ responsaveis: e.target.checked ? [...p.responsaveis, m.identityId] : p.responsaveis.filter((x) => x !== m.identityId) })} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-fg">{m.nome || m.email}</span>
                            {m.nome && <span className="block truncate text-xs text-faint">{m.email}</span>}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              )}
              {p.responsaveis.length > 1 && (
                <div>
                  <span className="mb-1.5 block text-sm font-medium text-fg">Distribuição</span>
                  <div className="segbar" role="radiogroup" aria-label="Distribuição entre responsáveis">
                    {([['round_robin', 'Revezamento'], ['fixo', 'Sempre o primeiro']] as const).map(([v, l]) => (
                      <button key={v} type="button" role="radio" aria-checked={p.distribuicao === v} className={cx('seg', p.distribuicao === v && 'bg-[var(--seg-thumb)] text-fg shadow-sm')} onClick={() => mudar({ distribuicao: v })}>{l}</button>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-muted">Revezamento: cada reserva vai para o próximo da fila que estiver livre no horário.</p>
                </div>
              )}
            </section>
          )}

          <section className="card space-y-4 p-5" aria-labelledby="s-perguntas">
            <div className="flex items-center justify-between gap-3">
              <h2 id="s-perguntas" className="text-sm font-semibold text-fg">Perguntas extras</h2>
              <Select<TipoCampoPublico | ''>
                size="sm"
                aria-label="Adicionar pergunta"
                value=""
                placeholder="Adicionar pergunta"
                options={TIPOS_PERGUNTA.map((t) => ({ value: t, label: ROTULO_TIPO[t] }))}
                onChange={(t) => {
                  if (!t || p.perguntas.length >= 15) return;
                  // Pergunta extra não alimenta campo do contato: vai para as notas do compromisso.
                  const { id, tipo, rotulo, obrigatorio, largura, opcoes } = campoNovo(t, p.perguntas);
                  mudar({ perguntas: [...p.perguntas, { id, tipo, rotulo, obrigatorio, largura, ...(opcoes ? { opcoes } : {}) }] });
                }}
                className="w-48"
              />
            </div>
            <p className="text-xs text-muted">Nome, WhatsApp e e-mail já são pedidos. As respostas vão para as notas do compromisso.</p>
            {p.perguntas.length === 0 ? (
              <p className="text-sm text-faint">Nenhuma pergunta extra.</p>
            ) : (
              <ul className="space-y-3">
                {p.perguntas.map((q, i) => (
                  <li key={q.id} className="rounded-md border border-line p-3">
                    <PerguntaEditor
                      pergunta={q}
                      onChange={(patch) => mudar({ perguntas: p.perguntas.map((x, j) => (j === i ? { ...x, ...patch } : x)) })}
                      onRemover={() => mudar({ perguntas: p.perguntas.filter((_, j) => j !== i) })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card space-y-4 p-5" aria-labelledby="s-link">
            <h2 id="s-link" className="text-sm font-semibold text-fg">Link e cor</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="slug" className="mb-1.5 block text-sm font-medium text-fg">Endereço</label>
                <div className="flex items-center gap-1 text-sm text-muted">
                  <span>/b/</span>
                  <Input id="slug" maxLength={64} value={p.slug} onChange={(e) => mudar({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
                </div>
              </div>
              <div>
                <label htmlFor="cor" className="mb-1.5 block text-sm font-medium text-fg">Cor da marca</label>
                <div className="flex gap-2">
                  <input type="color" aria-label="Escolher cor" className="h-[38px] w-12 shrink-0 cursor-pointer rounded-md border border-line bg-transparent" value={p.estilo.cor ?? '#000000'} onChange={(e) => mudar({ estilo: { cor: e.target.value } })} />
                  <Input id="cor" maxLength={7} placeholder="Padrão KHUB" value={p.estilo.cor ?? ''} onChange={(e) => mudar({ estilo: e.target.value ? { cor: e.target.value } : {} })} />
                </div>
              </div>
            </div>
            <CampoCodigo titulo="Link público" descricao={pessoal ? 'Este é o SEU link: envie para o cliente agendar direto com você.' : 'Envie no WhatsApp, coloque no site ou na bio.'} valor={linkPublico(origem, salva.slug)} />
          </section>
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start" aria-label="Pré-visualização">
          <PreviaPagina pagina={p} marca={user?.empresa ?? 'Sua empresa'} />
        </aside>
      </div>
    </PageShell>
  );
}

function PerguntaEditor({ pergunta, onChange, onRemover }: { pergunta: CampoView; onChange: (p: Partial<CampoView>) => void; onRemover: () => void }) {
  const temOpcoes = pergunta.tipo === 'select' || pergunta.tipo === 'multiselect';
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded bg-surface2 px-2 py-0.5 text-2xs font-semibold text-muted">{ROTULO_TIPO[pergunta.tipo]}</span>
        <Input aria-label="Pergunta" maxLength={300} value={pergunta.rotulo} onChange={(e) => onChange({ rotulo: e.target.value })} />
        <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Remover "${pergunta.rotulo}"`} onClick={onRemover}><Icon name="trash" size={14} /></button>
      </div>
      {temOpcoes && (
        <Textarea aria-label="Opções (uma por linha)" rows={3} placeholder="Uma opção por linha" value={(pergunta.opcoes ?? []).join('\n')} onChange={(e) => onChange({ opcoes: e.target.value.split('\n').map((o) => o.slice(0, 80)) })} />
      )}
      <Switch label="Obrigatória" checked={pergunta.obrigatorio} onChange={(v) => onChange({ obrigatorio: v })} />
    </div>
  );
}

/** Prévia da página pública: grade da semana (sem consultar a agenda) e o formulário. */
function PreviaPagina({ pagina, marca }: { pagina: PaginaAgendamento; marca: string }) {
  const dias = DIAS.filter((d) => (pagina.horarios[d.key] ?? []).length > 0);
  return (
    <div className="card p-5" style={estiloDaMarca(pagina.estilo.cor)}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">Pré-visualização</p>
      <span className="eyebrow">{marca}</span>
      <h3 className="t-display mt-3 text-xl">{pagina.titulo || 'Sem título'}</h3>
      {pagina.descricao && <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-muted">{pagina.descricao}</p>}
      <p className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1"><Icon name="clock" size={13} />{pagina.duracaoMin} min</span>
        {pagina.local && <span className="inline-flex items-center gap-1"><Icon name="mapPin" size={13} />{pagina.local}</span>}
      </p>
      <div className="mt-4 space-y-3">
        {dias.length === 0 ? (
          <p className="rounded-md border border-dashed border-line p-3 text-sm text-muted">Nenhum dia aberto: a página não terá horários.</p>
        ) : (
          dias.map((d) => {
            const h = horariosDaGrade(pagina, d.key);
            return (
              <div key={d.key}>
                <p className="mb-1.5 text-xs font-semibold text-fg">{d.nome}</p>
                <div className="flex flex-wrap gap-1.5">
                  {h.slice(0, 12).map((x) => <span key={x} className="tabular rounded-md border border-line px-2 py-1 text-xs text-fg">{x}</span>)}
                  {h.length > 12 && <span className="px-1 py-1 text-xs text-faint">mais {h.length - 12}</span>}
                  {h.length === 0 && <span className="text-xs text-warning">A faixa é menor que a duração</span>}
                </div>
              </div>
            );
          })
        )}
      </div>
      {pagina.perguntas.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4">
          {pagina.perguntas.map((q) => <CampoPublico key={q.id} campo={q} idBase="previa-ag" valor={undefined} onChange={() => undefined} desabilitado />)}
        </div>
      )}
      <p className="mt-4 text-xs text-faint">Na página publicada, só aparecem os horários livres de verdade, já descontando a agenda, a antecedência mínima e o intervalo.</p>
    </div>
  );
}
