'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { Avatar, cx } from '@/components/ui';
import { Button, Confirm, Drawer, Menu, Select, SkeletonDetail, Switch, Textarea, useToast } from '@/components/kit';
import {
  APROVACAO,
  APROVACAO_ORDEM,
  PLATAFORMA,
  PLATAFORMA_ORDEM,
  PRIORIDADE,
  PRIORIDADE_ORDEM,
  STATUS,
  STATUS_ORDEM,
  TIPO,
  TIPO_ORDEM,
  codigo,
  daily,
  ehConteudo,
  prazoDoDia,
  ymd,
  type PatchTarefa,
  type TarefaDetalhe,
} from '@/lib/agency-daily';
import { useDaily } from './DailyContext';
import { Concluir, Pessoa, Ponto, Prazo } from './pecas';

const paraLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${ymd(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', '');

/** Gaveta de detalhe: edição inline, salva cada campo ao sair dele (como no KROMA/ClickUp). */
export function TarefaDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { base, recarregar, abrirTarefa, novaTarefa } = useDaily();
  const toast = useToast();
  const [t, setT] = useState<TarefaDetalhe | null>(null);
  const [erro, setErro] = useState(false);
  const [excluir, setExcluir] = useState(false);
  const pode = !!base?.podeEditar;

  const carregar = useCallback(() => {
    if (!id) return;
    setErro(false);
    daily.detalhe(id).then(setT).catch(() => setErro(true));
  }, [id]);

  useEffect(() => {
    setT(null);
    carregar();
  }, [carregar]);

  const salvar = async (patch: PatchTarefa) => {
    if (!t || !pode) return;
    try {
      setT(await daily.atualizar(t.id, patch));
      recarregar();
    } catch (e) {
      toast.error('Não foi possível salvar', { description: e instanceof Error ? e.message : 'Tente novamente.' });
      carregar();
    }
  };

  const copiarLink = async () => {
    await navigator.clipboard?.writeText(window.location.href).catch(() => undefined);
    toast.success('Link copiado');
  };

  if (!id) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      width="sm:max-w-2xl"
      ariaLabel={t ? `Tarefa ${codigo(t.numero)}` : 'Tarefa'}
      title={
        t ? (
          <span className="flex items-center gap-2 text-sm font-medium text-muted">
            <span className="font-mono">{codigo(t.numero)}</span>
            {t.cliente && <span className="truncate">· {t.cliente.nome}</span>}
            {t.arquivada && <span className="pill pill-warning">Arquivada</span>}
          </span>
        ) : (
          'Tarefa'
        )
      }
      headerActions={
        t && (
          <Menu
            label="Mais ações"
            align="end"
            trigger={<Icon name="dots" size={18} />}
            triggerClassName="btn btn-ghost btn-sm btn-icon"
            items={[
              { id: 'link', label: 'Copiar link', icon: 'link', onSelect: () => void copiarLink() },
              ...(pode
                ? [
                    { id: 'arquivar', label: t.arquivada ? 'Restaurar' : 'Arquivar', icon: 'folder' as const, onSelect: () => void salvar({ arquivada: !t.arquivada }) },
                    { id: 'excluir', label: 'Excluir de vez', icon: 'trash' as const, danger: true, onSelect: () => setExcluir(true) },
                  ]
                : []),
            ]}
          />
        )
      }
    >
      {erro ? (
        <div className="py-10 text-center text-sm text-muted">
          Não foi possível abrir esta tarefa. Ela pode ter sido excluída ou você não tem acesso a este cliente.
        </div>
      ) : !t ? (
        <SkeletonDetail />
      ) : (
        <div className="space-y-6">
          {t.parent && (
            <button type="button" onClick={() => abrirTarefa(t.parent!.id)} className="inline-flex items-center gap-1 text-xs text-muted hover:text-brand">
              <Icon name="undo" size={12} /> Subtarefa de <span className="font-medium">{t.parent.titulo}</span>
            </button>
          )}

          <div className="flex items-start gap-3">
            <div className="pt-2">
              <Concluir feita={t.status === 'concluida'} disabled={!pode} onClick={() => salvar({ status: t.status === 'concluida' ? 'a_fazer' : 'concluida' })} />
            </div>
            <TituloEditavel key={t.id} valor={t.titulo} disabled={!pode} onSalvar={(titulo) => salvar({ titulo })} />
          </div>

          <dl className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-sm">
            <Rotulo icone="target">Status</Rotulo>
            <dd>
              <Select size="sm" disabled={!pode} value={t.status} onChange={(status) => salvar({ status })} options={STATUS_ORDEM.map((s) => ({ value: s, label: STATUS[s].label }))} aria-label="Status" />
            </dd>
            <Rotulo icone="user">Responsável</Rotulo>
            <dd>
              <Select
                size="sm"
                disabled={!pode}
                value={t.responsavel?.id ?? ''}
                placeholder="Ninguém"
                onChange={(v) => salvar({ responsavelId: v || null })}
                options={(base?.membros ?? []).map((m) => ({ value: m.id, label: m.id === base?.eu ? `${m.nome} (você)` : m.nome }))}
                aria-label="Responsável"
              />
            </dd>
            <Rotulo icone="building">Cliente</Rotulo>
            <dd>
              <Select
                size="sm"
                disabled={!pode}
                value={t.cliente?.id ?? ''}
                placeholder="Interno (sem cliente)"
                onChange={(v) => salvar({ clientId: v || null })}
                options={(base?.clientes ?? []).map((c) => ({ value: c.id, label: c.nome }))}
                aria-label="Cliente"
              />
            </dd>
            <Rotulo icone="tag">Tipo</Rotulo>
            <dd>
              <Select size="sm" disabled={!pode} value={t.tipo} onChange={(tipo) => salvar({ tipo })} options={TIPO_ORDEM.map((x) => ({ value: x, label: TIPO[x].label }))} aria-label="Tipo" />
            </dd>
            <Rotulo icone="flame">Prioridade</Rotulo>
            <dd>
              <Select size="sm" disabled={!pode} value={t.prioridade} onChange={(prioridade) => salvar({ prioridade })} options={PRIORIDADE_ORDEM.map((p) => ({ value: p, label: PRIORIDADE[p].label }))} aria-label="Prioridade" />
            </dd>
            <Rotulo icone="clock">Início</Rotulo>
            <dd>
              <input type="date" className="input h-8 max-w-[200px]" disabled={!pode} value={t.inicioEm ? ymd(new Date(t.inicioEm)) : ''} onChange={(e) => salvar({ inicioEm: prazoDoDia(e.target.value) })} aria-label="Início" />
            </dd>
            <Rotulo icone="calendar">Prazo</Rotulo>
            <dd className="flex items-center gap-3">
              <input type="date" className="input h-8 max-w-[200px]" disabled={!pode} value={t.prazoEm ? ymd(new Date(t.prazoEm)) : ''} onChange={(e) => salvar({ prazoEm: prazoDoDia(e.target.value) })} aria-label="Prazo" />
              <Prazo tarefa={t} compacto />
            </dd>
          </dl>

          <Bloco titulo="Descrição">
            <TextoEditavel
              key={`d-${t.id}`}
              valor={t.descricao ?? ''}
              disabled={!pode}
              rows={4}
              max={20000}
              placeholder="Contexto, links do briefing, o que precisa ser entregue…"
              onSalvar={(descricao) => salvar({ descricao: descricao || null })}
            />
          </Bloco>

          {ehConteudo(t.tipo) && <SecaoConteudo t={t} pode={pode} salvar={salvar} />}

          {!t.parent && (
            <Bloco
              titulo={`Subtarefas${t.filhas.length ? ` · ${t.filhas.filter((f) => f.status === 'concluida').length}/${t.filhas.length}` : ''}`}
              acao={pode && <Button size="sm" variant="ghost" icon="plus" onClick={() => novaTarefa({ parentId: t.id, clientId: t.cliente?.id ?? null })}>Subtarefa</Button>}
            >
              {t.filhas.length === 0 ? (
                <p className="text-xs text-faint">Divida a entrega em partes menores, cada uma com responsável e prazo.</p>
              ) : (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {t.filhas.map((f) => (
                    <li key={f.id} className="flex items-center gap-2.5 px-3 py-2">
                      <Concluir
                        feita={f.status === 'concluida'}
                        disabled={!pode}
                        onClick={async () => {
                          await daily.atualizar(f.id, { status: f.status === 'concluida' ? 'a_fazer' : 'concluida' }).catch(() => undefined);
                          carregar();
                          recarregar();
                        }}
                      />
                      <button type="button" onClick={() => abrirTarefa(f.id)} className={cx('min-w-0 flex-1 truncate text-left text-sm hover:text-brand', f.status === 'concluida' && 'text-faint line-through')}>
                        {f.titulo}
                      </button>
                      <Prazo tarefa={f} compacto />
                      <Pessoa pessoa={f.responsavel} tamanho={20} />
                    </li>
                  ))}
                </ul>
              )}
            </Bloco>
          )}

          <Checklist t={t} pode={pode} onMudou={(itens) => { setT({ ...t, itens }); recarregar(); }} />

          <Comentarios t={t} pode={pode} onMudou={(conversa) => { setT({ ...t, conversa }); recarregar(); }} />

          <p className="text-[11.5px] text-faint">
            Criada {t.criador ? `por ${t.criador.nome} ` : ''}em {quando(t.createdAt)} · atualizada {quando(t.updatedAt)}
          </p>
        </div>
      )}

      <Confirm
        open={excluir}
        onClose={() => setExcluir(false)}
        title="Excluir esta tarefa de vez?"
        description="Subtarefas, checklist e comentários também são apagados. Para só tirar da frente, use Arquivar."
        confirmLabel="Excluir"
        onConfirm={async () => {
          if (!t) return;
          try {
            await daily.excluir(t.id);
            toast.success('Tarefa excluída');
            setExcluir(false);
            recarregar();
            onClose();
          } catch (e) {
            toast.error('Não foi possível excluir', { description: e instanceof Error ? e.message : '' });
          }
        }}
      />
    </Drawer>
  );
}

function Rotulo({ icone, children }: { icone: Parameters<typeof Icon>[0]['name']; children: React.ReactNode }) {
  return (
    <dt className="inline-flex items-center gap-2 text-[13px] text-muted">
      <Icon name={icone} size={14} /> {children}
    </dt>
  );
}

function Bloco({ titulo, acao, children }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="t-label">{titulo}</h3>
        {acao}
      </div>
      {children}
    </section>
  );
}

function TituloEditavel({ valor, disabled, onSalvar }: { valor: string; disabled: boolean; onSalvar: (v: string) => void }) {
  const [v, setV] = useState(valor);
  const confirmar = () => {
    const limpo = v.trim();
    if (!limpo) return setV(valor);
    if (limpo !== valor) onSalvar(limpo);
  };
  return (
    <textarea
      aria-label="Título"
      value={v}
      disabled={disabled}
      maxLength={200}
      rows={1}
      onChange={(e) => setV(e.target.value.replace(/\n/g, ' '))}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      className="min-w-0 flex-1 resize-none rounded-lg bg-transparent px-1 py-1 text-xl font-semibold leading-snug text-fg outline-none [field-sizing:content] hover:bg-surface2 focus:bg-surface2"
    />
  );
}

function TextoEditavel({ valor, disabled, rows, max, placeholder, onSalvar }: { valor: string; disabled: boolean; rows: number; max: number; placeholder: string; onSalvar: (v: string) => void }) {
  const [v, setV] = useState(valor);
  return (
    <Textarea
      value={v}
      disabled={disabled}
      rows={rows}
      maxLength={max}
      showCount={max <= 5000}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() !== valor.trim() && onSalvar(v.trim())}
    />
  );
}

function SecaoConteudo({ t, pode, salvar }: { t: TarefaDetalhe; pode: boolean; salvar: (p: PatchTarefa) => Promise<void> }) {
  const aprovacao = t.aprovacao ?? 'em_producao';
  const semLegenda = t.exigeLegenda && !t.legenda?.trim();
  return (
    <section className="card-inset space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="t-label">Studio · conteúdo</h3>
        {semLegenda ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-warning"><Icon name="alert" size={13} /> Sem legenda</span>
        ) : t.exigeLegenda ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-success"><Icon name="check" size={13} /> Legenda pronta</span>
        ) : null}
      </div>

      <div>
        <p className="mb-1.5 text-xs text-muted">Aprovação</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Aprovação">
          {APROVACAO_ORDEM.map((a) => {
            const ativo = a === aprovacao;
            return (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={ativo}
                disabled={!pode}
                onClick={() => !ativo && salvar({ aprovacao: a })}
                className={cx('inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition disabled:cursor-not-allowed', ativo ? 'border-brand-border bg-brand-soft text-brand' : 'border-line text-muted hover:bg-surface2')}
              >
                <Ponto tom={APROVACAO[a].tom} /> {APROVACAO[a].label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs text-muted">Plataformas</p>
          <div className="flex flex-wrap gap-1.5">
            {PLATAFORMA_ORDEM.map((p) => {
              const ligado = t.plataformas.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={ligado}
                  disabled={!pode}
                  onClick={() => salvar({ plataformas: ligado ? t.plataformas.filter((x) => x !== p) : [...t.plataformas, p] })}
                  className={ligado ? 'pill pill-brand' : 'pill'}
                >
                  {PLATAFORMA[p].label}
                </button>
              );
            })}
          </div>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs text-muted">Publicação planejada</span>
          <input
            type="datetime-local"
            className="input h-9"
            disabled={!pode}
            value={paraLocal(t.publicarEm)}
            onChange={(e) => salvar({ publicarEm: e.target.value ? new Date(e.target.value).toISOString() : null })}
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-xs text-muted">Objetivo</span>
        <CampoLinha key={`o-${t.id}`} valor={t.objetivo ?? ''} disabled={!pode} max={500} placeholder="Ex.: gerar agendamentos para avaliação" onSalvar={(objetivo) => salvar({ objetivo: objetivo || null })} />
      </label>
      <div>
        <span className="mb-1.5 block text-xs text-muted">Legenda</span>
        <TextoEditavel key={`l-${t.id}`} valor={t.legenda ?? ''} disabled={!pode} rows={5} max={5000} placeholder="Texto que vai no post" onSalvar={(legenda) => salvar({ legenda: legenda || null })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs text-muted">Hashtags</span>
          <CampoLinha key={`h-${t.id}`} valor={t.hashtags ?? ''} disabled={!pode} max={1000} placeholder="#marca #campanha" onSalvar={(hashtags) => salvar({ hashtags: hashtags || null })} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs text-muted">Chamada (CTA)</span>
          <CampoLinha key={`c-${t.id}`} valor={t.cta ?? ''} disabled={!pode} max={300} placeholder="Agende pelo link da bio" onSalvar={(cta) => salvar({ cta: cta || null })} />
        </label>
      </div>
      <Switch checked={t.exigeLegenda} disabled={!pode} onChange={(exigeLegenda) => salvar({ exigeLegenda })} label="Exige legenda" description="Desligue para conteúdos sem texto (ex.: criativo de anúncio com copy à parte)." layout="row" />
    </section>
  );
}

function CampoLinha({ valor, disabled, max, placeholder, onSalvar }: { valor: string; disabled: boolean; max: number; placeholder: string; onSalvar: (v: string) => void }) {
  const [v, setV] = useState(valor);
  return (
    <input className="input h-9" value={v} disabled={disabled} maxLength={max} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() !== valor.trim() && onSalvar(v.trim())} />
  );
}

function Checklist({ t, pode, onMudou }: { t: TarefaDetalhe; pode: boolean; onMudou: (itens: TarefaDetalhe['itens']) => void }) {
  const toast = useToast();
  const [novo, setNovo] = useState('');
  const feitos = t.itens.filter((i) => i.feito).length;
  const adicionar = async (e: React.FormEvent) => {
    e.preventDefault();
    const texto = novo.trim();
    if (!texto) return;
    try {
      const item = await daily.adicionarItem(t.id, texto);
      onMudou([...t.itens, item]);
      setNovo('');
    } catch (err) {
      toast.error('Não foi possível adicionar', { description: err instanceof Error ? err.message : '' });
    }
  };
  const alternar = async (id: string, feito: boolean) => {
    onMudou(t.itens.map((i) => (i.id === id ? { ...i, feito } : i)));
    await daily.atualizarItem(id, { feito }).catch(() => toast.error('Não foi possível marcar o item'));
  };
  const remover = async (id: string) => {
    onMudou(t.itens.filter((i) => i.id !== id));
    await daily.removerItem(id).catch(() => toast.error('Não foi possível remover o item'));
  };
  return (
    <Bloco titulo={`Checklist${t.itens.length ? ` · ${feitos}/${t.itens.length}` : ''}`}>
      {t.itens.length > 0 && (
        <>
          <div className="mb-2 h-1 overflow-hidden rounded-full bg-surface3">
            <div className="h-full rounded-full bg-success transition-all" style={{ width: `${Math.round((feitos / t.itens.length) * 100)}%` }} />
          </div>
          <ul className="mb-2 space-y-1">
            {t.itens.map((i) => (
              <li key={i.id} className="group flex items-center gap-2.5 rounded-lg px-1 py-1 hover:bg-surface2">
                <input type="checkbox" className="checkbox" checked={i.feito} disabled={!pode} onChange={(e) => alternar(i.id, e.target.checked)} aria-label={i.texto} />
                <span className={cx('min-w-0 flex-1 text-sm', i.feito && 'text-faint line-through')}>{i.texto}</span>
                {pode && (
                  <button type="button" onClick={() => remover(i.id)} aria-label={`Remover ${i.texto}`} className="text-faint opacity-0 transition hover:text-danger group-hover:opacity-100 focus:opacity-100">
                    <Icon name="close" size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {pode && (
        <form onSubmit={adicionar} className="flex gap-2">
          <input className="input h-9" value={novo} maxLength={300} onChange={(e) => setNovo(e.target.value)} placeholder="Adicionar item e Enter" aria-label="Novo item do checklist" />
        </form>
      )}
    </Bloco>
  );
}

function Comentarios({ t, pode, onMudou }: { t: TarefaDetalhe; pode: boolean; onMudou: (c: TarefaDetalhe['conversa']) => void }) {
  const toast = useToast();
  const { base } = useDaily();
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const podeApagar = (meu: boolean) => meu || base?.role === 'owner' || base?.role === 'admin';
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      const c = await daily.comentar(t.id, texto.trim());
      onMudou([...t.conversa, c]);
      setTexto('');
    } catch (err) {
      toast.error('Não foi possível comentar', { description: err instanceof Error ? err.message : '' });
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Bloco titulo={`Comentários${t.conversa.length ? ` · ${t.conversa.length}` : ''}`}>
      {t.conversa.length > 0 && (
        <ul className="mb-3 space-y-3">
          {t.conversa.map((c) => (
            <li key={c.id} className="group flex gap-2.5">
              <Avatar name={c.autor?.nome ?? '?'} size={28} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-fg">{c.autor?.nome ?? 'Ex-membro'}</span>
                  <span className="text-faint">{quando(c.createdAt)}</span>
                  {podeApagar(c.meu) && (
                    <button
                      type="button"
                      className="ml-auto text-faint opacity-0 transition hover:text-danger group-hover:opacity-100 focus:opacity-100"
                      aria-label="Apagar comentário"
                      onClick={async () => {
                        onMudou(t.conversa.filter((x) => x.id !== c.id));
                        await daily.removerComentario(c.id).catch(() => toast.error('Não foi possível apagar'));
                      }}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words rounded-xl rounded-tl-sm bg-surface2 px-3 py-2 text-sm text-fg">{c.corpo}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {pode && (
        <form onSubmit={enviar} className="flex items-end gap-2">
          <Textarea
            value={texto}
            rows={2}
            maxLength={5000}
            placeholder="Escreva um comentário (Ctrl+Enter envia)"
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void enviar(e);
            }}
            aria-label="Novo comentário"
          />
          <Button type="submit" size="sm" icon="send" loading={enviando} disabled={!texto.trim()}>Enviar</Button>
        </form>
      )}
    </Bloco>
  );
}

