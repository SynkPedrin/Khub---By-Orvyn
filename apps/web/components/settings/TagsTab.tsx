'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, Card, Field, Input, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Button as BotaoKit, Confirm, useToast } from '@/components/kit';
import { settingsApi, type AutomacaoComTag, type CruzamentoTags, type PapelTag, type Tag } from '@/lib/settings';
import { ApiError } from '@/lib/api-error';

const CORES_TAG = ['#7B2EFF', '#A855F7', '#C084FC', '#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6', '#64748B'];

const PAPEL: Record<PapelTag, string> = {
  gatilho: 'dispara', adiciona: 'adiciona', remove: 'remove', condicao: 'condição', espera: 'espera', segmento: 'segmento',
};

const msgErro = (e: unknown, padrao: string) =>
  e instanceof ApiError ? ((e.body?.detail as string) || (e.body?.title as string) || padrao) : padrao;

function ChipsAutomacoes({ lista }: { lista: AutomacaoComTag[] }) {
  if (!lista.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {lista.map((a) => (
        <Link key={a.id} href={`/automacoes/${a.id}`} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-fg hover:border-brand-border hover:text-brand" title={`${a.nome} · ${a.status}`}>
          <Icon name="zap" size={11} />
          <span className="max-w-[160px] truncate">{a.nome}</span>
          <span className="text-muted">· {a.papeis.map((p) => PAPEL[p]).join(', ')}</span>
        </Link>
      ))}
    </span>
  );
}

/**
 * Configurações › Tags (ADR-0055): catálogo com o uso real (contatos e
 * automações) e a análise completa catálogo × contatos × automações.
 */
export function TagsTab() {
  const toast = useToast();
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [analise, setAnalise] = useState<CruzamentoTags | null>(null);
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState(CORES_TAG[0]);
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState<{ id: string; nome: string } | null>(null);
  const [excluir, setExcluir] = useState<Tag | null>(null);

  const load = useCallback(() => {
    settingsApi.tags().then(setTags).catch(() => setTags([]));
    settingsApi.cruzamentoTags().then(setAnalise).catch(() => setAnalise(null));
  }, []);
  useEffect(() => { load(); }, [load]);

  const criar = async () => {
    if (!nome.trim()) return;
    setErro(''); setBusy(true);
    try {
      await settingsApi.createTag({ name: nome.trim(), color: cor });
      setNome(''); setCor(CORES_TAG[0]); load();
    } catch (e) {
      setErro(msgErro(e, 'Não consegui criar a tag.'));
    } finally { setBusy(false); }
  };

  const sincronizar = async () => {
    setSincronizando(true);
    try {
      const r = await settingsApi.sincronizarTags();
      toast.success(r.adicionadas.length ? `${r.adicionadas.length} tag(s) adicionadas ao catálogo` : 'O catálogo já estava completo');
      load();
    } catch (e) {
      toast.error(msgErro(e, 'Não consegui sincronizar as tags.'));
    } finally { setSincronizando(false); }
  };

  const renomear = async () => {
    if (!editando?.nome.trim()) return;
    try {
      const r = await settingsApi.updateTag(editando.id, { name: editando.nome.trim() });
      const revisar = r.automacoesParaRevisar?.length ?? 0;
      toast.success('Tag renomeada', {
        description: `${(r.contatosAtualizados ?? 0).toLocaleString('pt-BR')} contato(s) atualizados.${revisar ? ` Revise ${revisar} automação(ões) que usavam o nome antigo.` : ''}`,
      });
      setEditando(null);
      load();
    } catch (e) {
      toast.error(msgErro(e, 'Não consegui renomear a tag.'));
    }
  };

  const remover = async () => {
    if (!excluir) return;
    try {
      await settingsApi.deleteTag(excluir.id);
      setExcluir(null);
      load();
    } catch (e) {
      toast.error(msgErro(e, 'Não consegui excluir a tag.'));
    }
  };

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (tags ?? []).filter((x) => !t || x.name.toLowerCase().includes(t)).sort((a, b) => (b.contatos ?? 0) - (a.contatos ?? 0) || a.name.localeCompare(b.name));
  }, [tags, busca]);

  const pendencias = analise
    ? analise.foraDoCatalogoEmContatos.length + analise.foraDoCatalogoEmAutomacoes.length + analise.parecidas.length + analise.gatilhosSemOrigem.length + analise.adicionaERemove.length
    : 0;

  return (
    <div className="space-y-5">
      {/* ---------------- Análise ---------------- */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-fg">Análise das tags</h2>
            <p className="text-xs text-muted">Cruza o catálogo com os contatos e com as automações (rascunho ou publicada).</p>
          </div>
          <BotaoKit variant="secondary" size="sm" icon="refresh" onClick={sincronizar} loading={sincronizando}>
            Sincronizar catálogo
          </BotaoKit>
        </div>

        {!analise && <p className="mt-4 text-sm text-muted">Analisando…</p>}
        {analise && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['No catálogo', analise.totais.catalogo],
                ['Em contatos', analise.totais.emContatos],
                ['Em automações', analise.totais.emAutomacoes],
                ['Contatos com tag', analise.totais.contatosComTag],
              ].map(([r, v]) => (
                <div key={r as string} className="rounded-xl border border-line px-3 py-2.5">
                  <p className="text-[11px] text-muted">{r}</p>
                  <p className="text-xl font-semibold tabular text-fg">{Number(v).toLocaleString('pt-BR')}</p>
                </div>
              ))}
            </div>

            {pendencias === 0 && !analise.semUso.length && (
              <p className="mt-4 flex items-center gap-2 rounded-xl bg-success/10 px-3 py-2 text-sm text-success"><Icon name="check" size={15} /> Catálogo, contatos e automações estão consistentes.</p>
            )}

            <div className="mt-4 space-y-3">
              {analise.foraDoCatalogoEmContatos.length > 0 && (
                <Achado tom="alerta" titulo={`${analise.foraDoCatalogoEmContatos.length} tag(s) em contatos fora do catálogo`} texto="Vieram de importação ou integração e não aparecem para escolher. Use Sincronizar catálogo.">
                  <span className="flex flex-wrap gap-1">{analise.foraDoCatalogoEmContatos.map((t) => <span key={t.tag} className="pill">{t.tag} · {t.contatos.toLocaleString('pt-BR')}</span>)}</span>
                </Achado>
              )}
              {analise.foraDoCatalogoEmAutomacoes.length > 0 && (
                <Achado tom="alerta" titulo={`${analise.foraDoCatalogoEmAutomacoes.length} tag(s) usadas em automação fora do catálogo`} texto="Ninguém consegue marcar um contato com elas pela tela, então o gatilho pode nunca disparar. Use Sincronizar catálogo.">
                  {analise.foraDoCatalogoEmAutomacoes.map((t) => (
                    <div key={t.tag} className="flex flex-wrap items-center gap-2"><span className="pill">{t.tag}</span><ChipsAutomacoes lista={t.automacoes} /></div>
                  ))}
                </Achado>
              )}
              {analise.gatilhosSemOrigem.length > 0 && (
                <Achado tom="erro" titulo="Gatilho de tag que nada alimenta" texto="Automação ativa dispara por uma tag que nenhuma automação adiciona e nenhum contato tem hoje. Só dispara se alguém marcar à mão.">
                  {analise.gatilhosSemOrigem.map((t) => (
                    <div key={t.tag} className="flex flex-wrap items-center gap-2"><span className="pill">{t.tag}</span><ChipsAutomacoes lista={t.automacoes} /></div>
                  ))}
                </Achado>
              )}
              {analise.adicionaERemove.length > 0 && (
                <Achado tom="alerta" titulo="Tag que uma automação adiciona e outra remove" texto="Pode criar vai e volta (o gatilho dispara de novo a cada adição). Confira se é intencional.">
                  {analise.adicionaERemove.map((t) => (
                    <div key={t.tag} className="space-y-1">
                      <span className="pill">{t.tag}</span>
                      <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted">adiciona: <ChipsAutomacoes lista={t.adicionam} /></div>
                      <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted">remove: <ChipsAutomacoes lista={t.removem} /></div>
                    </div>
                  ))}
                </Achado>
              )}
              {analise.parecidas.length > 0 && (
                <Achado tom="alerta" titulo="Tags parecidas (mesma ideia, escrita diferente)" texto="Ex.: metaads × meta-ads. Filtros e gatilhos tratam como tags diferentes. Renomeie uma para a outra para unificar.">
                  {analise.parecidas.map((p) => <span key={p.grupo.join('|')} className="pill">{p.grupo.join(' × ')} · {p.contatos.toLocaleString('pt-BR')} contatos</span>)}
                </Achado>
              )}
              {analise.semUso.length > 0 && (
                <Achado tom="neutro" titulo={`${analise.semUso.length} tag(s) sem uso`} texto="Estão no catálogo, mas nenhum contato tem e nenhuma automação usa.">
                  <span className="flex flex-wrap gap-1">{analise.semUso.map((t) => <span key={t} className="pill">{t}</span>)}</span>
                </Achado>
              )}
            </div>
          </>
        )}
      </Card>

      {/* ---------------- Nova tag ---------------- */}
      <Card className="p-6">
        <h2 className="font-bold text-fg">Nova tag</h2>
        <p className="text-xs text-muted">Tags organizam contatos e disparam automações. Tag digitada num contato ou numa automação também entra aqui automaticamente.</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1"><Field label="Nome"><Input value={nome} maxLength={40} onChange={(e) => setNome(e.target.value)} placeholder="cliente-vip" onKeyDown={(e) => { if (e.key === 'Enter') criar(); }} /></Field></div>
          <div>
            <p className="mb-1 text-xs font-semibold text-muted">Cor</p>
            <div className="flex flex-wrap gap-1.5">
              {CORES_TAG.map((c) => (
                <button key={c} onClick={() => setCor(c)} className={cx('h-7 w-7 rounded-full transition-transform', cor === c ? 'ring-2 ring-offset-2 ring-offset-surface' : 'hover:scale-110')} style={{ background: c, boxShadow: cor === c ? `0 0 0 2px ${c}` : undefined }} aria-label={c} />
              ))}
            </div>
          </div>
          <Button onClick={criar} disabled={busy || !nome.trim()}><Icon name="plus" size={16} /> Criar tag</Button>
        </div>
        {erro && <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">{erro}</p>}
      </Card>

      {/* ---------------- Catálogo ---------------- */}
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <h2 className="font-bold text-fg">Tags do CRM</h2>
          <div className="relative ml-auto w-full sm:w-64">
            <Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input h-9 pl-8 text-sm" placeholder="Buscar tag" aria-label="Buscar tag" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
        </div>
        <div className="divide-y divide-line">
          {filtradas.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              {editando?.id === t.id ? (
                <span className="flex items-center gap-1.5">
                  <input className="input h-8 w-48 text-sm" autoFocus maxLength={40} value={editando.nome} onChange={(e) => setEditando({ id: t.id, nome: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void renomear(); if (e.key === 'Escape') setEditando(null); }} aria-label="Novo nome da tag" />
                  <BotaoKit size="sm" variant="primary" onClick={() => void renomear()}>Salvar</BotaoKit>
                  <button className="text-xs text-muted hover:text-fg" onClick={() => setEditando(null)}>Cancelar</button>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white" style={{ background: t.color }}>{t.name}</span>
              )}
              {t.descricao && <span className="truncate text-xs text-muted">{t.descricao}</span>}
              <ChipsAutomacoes lista={t.automacoes ?? []} />
              <span className="ml-auto text-xs tabular text-muted">{(t.contatos ?? t.usos).toLocaleString('pt-BR')} contato(s)</span>
              <button onClick={() => setEditando({ id: t.id, nome: t.name })} className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-fg" aria-label={`Renomear ${t.name}`}><Icon name="edit" size={14} /></button>
              <button onClick={() => setExcluir(t)} className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-red-500" aria-label={`Excluir ${t.name}`}><Icon name="close" size={14} /></button>
            </div>
          ))}
          {tags && filtradas.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted">{busca ? 'Nenhuma tag com esse nome.' : 'Nenhuma tag ainda. Crie a primeira acima.'}</p>}
          {!tags && <p className="px-5 py-8 text-center text-sm text-muted">Carregando…</p>}
        </div>
      </Card>

      <Confirm
        open={!!excluir}
        onClose={() => setExcluir(null)}
        onConfirm={remover}
        title={`Excluir a tag "${excluir?.name ?? ''}" do catálogo?`}
        description={
          excluir
            ? `Ela deixa de aparecer para escolher. ${(excluir.contatos ?? 0) > 0 ? `${(excluir.contatos ?? 0).toLocaleString('pt-BR')} contato(s) continuam com a tag (ela volta a aparecer em "fora do catálogo"). ` : ''}${excluir.automacoes?.length ? `${excluir.automacoes.length} automação(ões) ainda usam esta tag.` : ''}`
            : undefined
        }
        confirmLabel="Excluir"
      />
    </div>
  );
}

function Achado({ tom, titulo, texto, children }: { tom: 'erro' | 'alerta' | 'neutro'; titulo: string; texto: string; children: React.ReactNode }) {
  return (
    <div className={cx('space-y-2 rounded-xl border px-4 py-3', tom === 'erro' ? 'border-danger-border bg-danger-soft' : tom === 'alerta' ? 'border-warning-border bg-warning-soft' : 'border-line bg-surface2')}>
      <p className={cx('flex items-center gap-1.5 text-sm font-semibold', tom === 'erro' ? 'text-danger' : tom === 'alerta' ? 'text-warning' : 'text-fg')}>
        <Icon name={tom === 'neutro' ? 'info' : 'alert'} size={14} /> {titulo}
      </p>
      <p className="text-xs text-muted">{texto}</p>
      {children}
    </div>
  );
}
