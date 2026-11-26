'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, Field, Input } from '@/components/ui';
import { Icon } from '@/components/icons';
import { SkeletonRows } from '@/components/kit';
import { ImagemProtegida, StatusPill, fmtDataHora, fmtRelativo } from '@/components/mobile/ui';
import { ApiError } from '@/lib/api-error';
import {
  aprovacoes,
  prepararArquivo,
  ROTULO_STATUS_EQUIPE,
  ROTULO_TIPO,
  urlArquivo,
  type AprovacaoDetalhe,
  type AprovacaoResumo,
  type DadosAprovacao,
  type ResumoAprovacoes,
  type StatusAprovacao,
  type TipoAprovacao,
} from '@/lib/aprovacoes';

type Filtro = 'todas' | 'rascunhos' | 'pendente' | 'ajustes' | 'aprovado' | 'recusado';
const FILTROS: { key: Filtro; label: string; resumo?: keyof ResumoAprovacoes }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'rascunhos', label: 'Rascunhos', resumo: 'rascunhos' },
  { key: 'pendente', label: 'Aguardando cliente', resumo: 'pendente' },
  { key: 'ajustes', label: 'Ajustes pedidos', resumo: 'ajustes' },
  { key: 'aprovado', label: 'Aprovadas', resumo: 'aprovado' },
  { key: 'recusado', label: 'Recusadas', resumo: 'recusado' },
];
const CANAIS = ['Instagram', 'Facebook', 'TikTok', 'YouTube', 'LinkedIn', 'WhatsApp', 'Site', 'Anúncio'];
const ACAO: Record<string, string> = { aprovado: 'aprovou', ajustes: 'pediu ajustes', recusado: 'recusou', reenviado: 'enviou nova versão' };

const vazio = (): DadosAprovacao => ({ tipo: 'arte', titulo: '', descricao: '', conteudo: '', legenda: '', linkExterno: '', canal: 'Instagram', publicarEm: '', prazoEm: '' });
const paraInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const deInput = (v: string | null | undefined) => (v ? new Date(v).toISOString() : null);
const msgErro = (e: unknown, padrao: string) => (e instanceof ApiError && typeof e.body?.title === 'string' && e.status < 500 ? (e.status === 403 ? 'Seu usuário não tem permissão para isto.' : e.body.title) : padrao);

function AprovacoesPagina() {
  const params = useSearchParams();
  const router = useRouter();
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState<AprovacaoResumo[] | null>(null);
  const [resumo, setResumo] = useState<ResumoAprovacoes | null>(null);
  const [aberta, setAberta] = useState<string | null>(params.get('id'));
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(() => {
    const status: StatusAprovacao[] | undefined = filtro === 'todas' || filtro === 'rascunhos' ? undefined : [filtro];
    aprovacoes
      .listar({ status, busca: busca.trim() || undefined })
      .then((l) => setLista(filtro === 'rascunhos' ? l.filter((x) => !x.enviadaEm) : filtro === 'todas' ? l : l.filter((x) => x.enviadaEm)))
      .catch(() => setErro('Não foi possível carregar as aprovações.'));
    aprovacoes.resumo().then(setResumo).catch(() => undefined);
  }, [filtro, busca]);
  useEffect(() => { const t = setTimeout(carregar, busca ? 250 : 0); return () => clearTimeout(t); }, [carregar, busca]);
  useEffect(() => { const id = params.get('id'); if (id) setAberta(id); }, [params]);

  const fechar = () => { setAberta(null); setCriando(false); if (params.get('id')) router.replace('/aprovacoes', { scroll: false }); };
  const equipe = resumo?.equipe ?? false;

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-5 px-4 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="t-display">Aprovações</h1>
          <p className="text-sm text-muted">Artes e roteiros enviados ao cliente. Ele aprova pelo app no celular e recebe um aviso a cada peça nova.</p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/baixar" target="_blank" rel="noreferrer" className="btn btn-ghost"><Icon name="download" size={16} /> App do cliente</a>
          {equipe && <Button onClick={() => { setAberta(null); setCriando(true); }}><Icon name="plus" size={16} /> Nova peça</Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {FILTROS.filter((f) => equipe || f.key !== 'rascunhos').map((f) => {
            const n = f.resumo && resumo ? Number(resumo[f.resumo]) : 0;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => { setLista(null); setFiltro(f.key); }}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${filtro === f.key ? 'bg-brand text-on-brand' : 'bg-surface2 text-muted hover:text-fg'}`}
              >
                {f.label}
                {n > 0 && <span className={`rounded-full px-1.5 text-[10px] ${filtro === f.key ? 'bg-black/15' : 'bg-surface3'}`}>{n}</span>}
              </button>
            );
          })}
        </div>
        <label className="ml-auto flex w-full items-center gap-2 rounded-xl border border-line bg-surface px-3 sm:w-64">
          <Icon name="search" size={15} className="text-muted" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar peça" aria-label="Buscar peça" className="h-9 w-full bg-transparent text-sm outline-none" />
        </label>
      </div>

      {erro && <p role="alert" className="text-sm text-danger">{erro}</p>}

      {!lista ? (
        <Card className="p-2"><SkeletonRows rows={5} label="Carregando aprovações" /></Card>
      ) : lista.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-14 text-center">
          <span className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand"><Icon name="check2" size={26} /></span>
          <p className="font-semibold">Nenhuma peça aqui</p>
          <p className="mt-1 max-w-sm text-sm text-muted">{equipe ? 'Crie uma peça, anexe a arte ou escreva o roteiro e envie. O cliente recebe o aviso no celular.' : 'Quando a equipe enviar uma peça, ela aparece aqui.'}</p>
          {equipe && <Button className="mt-4" onClick={() => setCriando(true)}><Icon name="plus" size={16} /> Nova peça</Button>}
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {lista.map((p) => (
            <button key={p.id} type="button" onClick={() => { setCriando(false); setAberta(p.id); }} className="card group overflow-hidden p-0 text-left transition hover:border-brand-border">
              <div className="relative aspect-[4/3] w-full bg-surface2">
                {p.capaId && p.capaMime?.startsWith('image/') ? (
                  <ImagemProtegida src={urlArquivo(p.id, p.capaId)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full overflow-hidden px-4 pb-4 pt-12 text-[13px] leading-relaxed text-muted">
                    <Icon name={p.tipo === 'roteiro' ? 'note' : p.tipo === 'video' ? 'video' : 'file'} size={22} className="mb-2 hidden text-brand" />
                    <p className="line-clamp-5 whitespace-pre-line">{p.trecho ?? 'Sem conteúdo ainda.'}</p>
                  </div>
                )}
                <span className="absolute left-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-bold text-white">{ROTULO_TIPO[p.tipo]}{p.versao > 1 ? ` · v${p.versao}` : ''}</span>
              </div>
              <div className="space-y-2 p-4">
                <p className="line-clamp-1 font-semibold">{p.titulo}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {p.enviadaEm ? <StatusPill status={p.status} rotulos={ROTULO_STATUS_EQUIPE} /> : <span className="rounded-full bg-surface3 px-2.5 py-1 text-[11px] font-bold text-muted">Rascunho</span>}
                  {p.canal && <span className="text-[11px] text-muted">{p.canal}</span>}
                  {p.qtdComentarios > 0 && <span className="flex items-center gap-1 text-[11px] text-muted"><Icon name="chat" size={12} />{p.qtdComentarios}</span>}
                </div>
                <p className="text-[11px] text-faint">{p.prazoEm && p.status === 'pendente' ? `Prazo ${fmtDataHora(p.prazoEm)}` : `Atualizado ${fmtRelativo(p.updatedAt)}`}{p.criadoPorNome ? ` · ${p.criadoPorNome}` : ''}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {(aberta || criando) && <Painel id={criando ? null : aberta} equipe={equipe} onFechar={fechar} onMudou={carregar} onCriada={(id) => { setCriando(false); setAberta(id); }} />}
    </div>
  );
}

/** Painel lateral: cria/edita a peça (equipe) e mostra o histórico; quem é cliente responde. */
function Painel({ id, equipe, onFechar, onMudou, onCriada }: { id: string | null; equipe: boolean; onFechar: () => void; onMudou: () => void; onCriada: (id: string) => void }) {
  const [det, setDet] = useState<AprovacaoDetalhe | null>(null);
  const [form, setForm] = useState<DadosAprovacao>(vazio());
  const [salvando, setSalvando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [subindo, setSubindo] = useState(0);
  const [msgEnvio, setMsgEnvio] = useState('');
  const [comentario, setComentario] = useState('');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const arquivoRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    if (!id) { setDet(null); setForm(vazio()); return; }
    try {
      const d = await aprovacoes.detalhe(id);
      setDet(d);
      setForm({ tipo: d.tipo, titulo: d.titulo, descricao: d.descricao ?? '', conteudo: d.conteudo ?? '', legenda: d.legenda ?? '', linkExterno: d.linkExterno ?? '', canal: d.canal ?? '', publicarEm: paraInput(d.publicarEm), prazoEm: paraInput(d.prazoEm) });
    } catch {
      setErro('Peça não encontrada.');
    }
  }, [id]);
  useEffect(() => { setErro(''); setOk(''); void carregar(); }, [carregar]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onFechar]);

  const editavel = equipe && (!det || det.status !== 'aprovado');
  const dados = (): DadosAprovacao => ({
    ...form,
    titulo: form.titulo.trim(),
    publicarEm: deInput(form.publicarEm),
    prazoEm: deInput(form.prazoEm),
    linkExterno: form.linkExterno?.trim() || null,
    canal: form.canal || null,
  });

  const salvar = async (): Promise<string | null> => {
    if (!form.titulo.trim()) { setErro('Dê um título para a peça.'); return null; }
    setSalvando(true); setErro(''); setOk('');
    try {
      if (!id) {
        const r = await aprovacoes.criar(dados());
        onMudou();
        onCriada(r.id);
        return r.id;
      }
      await aprovacoes.atualizar(id, dados());
      setOk('Alterações salvas.');
      onMudou();
      await carregar();
      return id;
    } catch (e) {
      setErro(msgErro(e, 'Não foi possível salvar.'));
      return null;
    } finally {
      setSalvando(false);
    }
  };

  const anexar = async (files: FileList | null) => {
    if (!files?.length) return;
    let alvo = id;
    if (!alvo) { alvo = await salvar(); if (!alvo) return; }
    setErro(''); setOk('');
    for (const f of Array.from(files)) {
      setSubindo((n) => n + 1);
      try {
        await aprovacoes.anexar(alvo, await prepararArquivo(f));
      } catch (e) {
        setErro(e instanceof Error && !(e instanceof ApiError) ? e.message : msgErro(e, `Não foi possível enviar ${f.name}.`));
      } finally {
        setSubindo((n) => n - 1);
      }
    }
    if (arquivoRef.current) arquivoRef.current.value = '';
    onMudou();
    // Peça recém-criada: `id` ainda é o antigo neste fechamento; recarrega pelo id novo.
    if (alvo === id) await carregar();
    else aprovacoes.detalhe(alvo).then(setDet).catch(() => undefined);
  };

  const removerArquivo = async (arquivoId: string) => {
    if (!id) return;
    try { await aprovacoes.removerArquivo(id, arquivoId); await carregar(); onMudou(); } catch (e) { setErro(msgErro(e, 'Não foi possível remover.')); }
  };

  const enviar = async () => {
    if (!id) return;
    setEnviando(true); setErro(''); setOk('');
    try {
      await aprovacoes.atualizar(id, dados());
      const r = await aprovacoes.enviar(id, msgEnvio.trim() || undefined);
      setMsgEnvio('');
      setOk(`Enviado ao cliente${r.versao > 1 ? ` (versão ${r.versao})` : ''}. ${r.celulares > 0 ? `Aviso entregue em ${r.celulares} celular${r.celulares > 1 ? 'es' : ''}.` : 'O cliente ainda não ativou os avisos no celular; ele verá no app e no sino.'}`);
      onMudou();
      await carregar();
    } catch (e) {
      setErro(msgErro(e, 'Não foi possível enviar.'));
    } finally {
      setEnviando(false);
    }
  };

  const remover = async () => {
    if (!id || !window.confirm('Apagar esta peça e o histórico dela?')) return;
    try { await aprovacoes.remover(id); onMudou(); onFechar(); } catch (e) { setErro(msgErro(e, 'Não foi possível apagar.')); }
  };

  const responder = async (acao: 'aprovado' | 'ajustes' | 'recusado') => {
    if (!id) return;
    const texto = acao === 'aprovado' ? comentario : comentario || window.prompt(acao === 'ajustes' ? 'O que precisa mudar?' : 'Motivo da recusa') || '';
    if (acao !== 'aprovado' && !texto.trim()) return;
    try { await aprovacoes.responder(id, acao, texto); setComentario(''); onMudou(); await carregar(); } catch (e) { setErro(msgErro(e, 'Não foi possível responder.')); }
  };

  const comentar = async () => {
    if (!id || !comentario.trim()) return;
    try { await aprovacoes.comentar(id, comentario); setComentario(''); await carregar(); onMudou(); } catch (e) { setErro(msgErro(e, 'Não foi possível comentar.')); }
  };

  const tipo = form.tipo;
  const podeEnviar = equipe && id && det && det.status !== 'aprovado' && !(det.enviadaEm && det.status === 'pendente');

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={id ? 'Peça para aprovação' : 'Nova peça'}>
      <button type="button" aria-label="Fechar" className="lg-backdrop absolute inset-0" onClick={onFechar} />
      <aside className="relative flex h-full w-full max-w-[640px] flex-col overflow-hidden border-l border-line bg-surface shadow-2xl">
        <header className="flex items-start gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">{id ? (det?.enviadaEm ? 'Peça enviada' : 'Rascunho — o cliente ainda não vê') : 'Nova peça'}</p>
            <h2 className="truncate text-lg font-bold">{form.titulo || 'Sem título'}</h2>
            {det && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                {det.enviadaEm && <StatusPill status={det.status} rotulos={ROTULO_STATUS_EQUIPE} />}
                {det.versao > 1 && <span>versão {det.versao}</span>}
                {det.respondidoEm && <span>respondido {fmtRelativo(det.respondidoEm)}{det.respondidoPorNome ? ` por ${det.respondidoPorNome}` : ''}</span>}
              </div>
            )}
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="rounded-lg p-2 text-muted hover:bg-surface2"><Icon name="close" size={18} /></button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {erro && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p>}
          {ok && <p role="status" className="rounded-xl bg-success-soft px-3 py-2 text-sm text-success">{ok}</p>}

          {editavel ? (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Tipo de peça">
                {(['arte', 'roteiro', 'video', 'outro'] as TipoAprovacao[]).map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={tipo === t} onClick={() => setForm({ ...form, tipo: t })} className={`rounded-xl py-2 text-sm font-semibold transition ${tipo === t ? 'bg-brand text-on-brand' : 'bg-surface2 text-muted hover:text-fg'}`}>
                    {ROTULO_TIPO[t]}
                  </button>
                ))}
              </div>
              <Field label="Título"><Input value={form.titulo} maxLength={200} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder={tipo === 'roteiro' ? 'Roteiro — Reels depoimento' : 'Post Black Friday'} autoFocus={!id} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Canal">
                  <select className="input" value={form.canal ?? ''} onChange={(e) => setForm({ ...form, canal: e.target.value })}>
                    <option value="">—</option>
                    {CANAIS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Prazo para o cliente responder"><Input type="datetime-local" value={form.prazoEm ?? ''} onChange={(e) => setForm({ ...form, prazoEm: e.target.value })} /></Field>
              </div>
              <Field label="Publicação prevista (opcional)"><Input type="datetime-local" value={form.publicarEm ?? ''} onChange={(e) => setForm({ ...form, publicarEm: e.target.value })} /></Field>

              {(tipo === 'roteiro' || tipo === 'outro') && (
                <Field label={tipo === 'roteiro' ? 'Roteiro' : 'Texto'} hint="Quebras de linha são mantidas. Use cenas, falas e indicações como preferir.">
                  <textarea className="input min-h-[220px] w-full resize-y font-[inherit] leading-relaxed" maxLength={20000} value={form.conteudo ?? ''} onChange={(e) => setForm({ ...form, conteudo: e.target.value })} placeholder={'CENA 1 — Abertura\nFala: "..."\n\nCENA 2 — ...'} />
                </Field>
              )}
              {(tipo === 'arte' || tipo === 'video' || tipo === 'outro') && (
                <Field label="Legenda (opcional)"><textarea className="input min-h-[90px] w-full resize-y" maxLength={5000} value={form.legenda ?? ''} onChange={(e) => setForm({ ...form, legenda: e.target.value })} /></Field>
              )}
              {(tipo === 'video' || tipo === 'outro' || tipo === 'arte') && (
                <Field label={tipo === 'video' ? 'Link do vídeo' : 'Link externo (opcional)'} hint="Drive, Canva, Frame.io, YouTube… precisa começar com https://">
                  <Input value={form.linkExterno ?? ''} maxLength={1000} onChange={(e) => setForm({ ...form, linkExterno: e.target.value })} placeholder="https://" />
                </Field>
              )}
              <Field label="Observação para o cliente (opcional)"><textarea className="input min-h-[70px] w-full resize-y" maxLength={2000} value={form.descricao ?? ''} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></Field>

              {tipo !== 'roteiro' && (
                <div>
                  <p className="mb-1.5 text-[13px] font-medium">Arquivos {tipo === 'arte' ? '(a arte)' : '(opcional)'}</p>
                  <div
                    className="rounded-2xl border border-dashed border-line p-4 text-center"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); void anexar(e.dataTransfer.files); }}
                  >
                    {det && det.arquivos.length > 0 && (
                      <div className="mb-3 grid grid-cols-3 gap-2">
                        {det.arquivos.map((a) => (
                          <div key={a.id} className="group relative aspect-square overflow-hidden rounded-xl bg-surface2">
                            {a.mime.startsWith('image/') ? (
                              <ImagemProtegida src={urlArquivo(det.id, a.id)} alt={a.nome} className="h-full w-full object-cover" />
                            ) : (
                              <a href={urlArquivo(det.id, a.id)} target="_blank" rel="noreferrer" className="grid h-full place-items-center p-2 text-xs text-muted"><Icon name="file" size={22} />{a.nome}</a>
                            )}
                            <button type="button" onClick={() => removerArquivo(a.id)} aria-label={`Remover ${a.nome}`} className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"><Icon name="close" size={12} /></button>
                          </div>
                        ))}
                      </div>
                    )}
                    <input ref={arquivoRef} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => void anexar(e.target.files)} />
                    <button type="button" onClick={() => arquivoRef.current?.click()} disabled={subindo > 0} className="btn btn-soft mx-auto">
                      <Icon name="upload" size={16} /> {subindo > 0 ? `Enviando ${subindo}…` : 'Anexar imagens ou PDF'}
                    </button>
                    <p className="mt-2 text-xs text-muted">Arraste aqui. Imagens são otimizadas automaticamente (até 10 por peça). Vídeo: use o link.</p>
                  </div>
                </div>
              )}
            </div>
          ) : det ? (
            <div className="space-y-4">
              {det.arquivos.filter((a) => a.mime.startsWith('image/')).map((a) => (
                <ImagemProtegida key={a.id} src={urlArquivo(det.id, a.id)} alt={a.nome} className="w-full rounded-2xl bg-surface2 object-contain" />
              ))}
              {det.arquivos.filter((a) => a.mime === 'application/pdf').map((a) => (
                <a key={a.id} href={urlArquivo(det.id, a.id)} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl bg-surface2 p-3 text-sm"><Icon name="file" size={16} /> {a.nome}</a>
              ))}
              {det.linkExterno && <a href={det.linkExterno} target="_blank" rel="noreferrer noopener" className="flex items-center gap-2 rounded-xl bg-brand-soft p-3 text-sm font-semibold text-brand"><Icon name="external" size={16} /> Abrir material</a>}
              {det.conteudo && <div className="whitespace-pre-wrap rounded-2xl bg-surface2 p-4 text-sm leading-relaxed">{det.conteudo}</div>}
              {det.legenda && <div><p className="mb-1 text-xs font-semibold uppercase text-muted">Legenda</p><p className="whitespace-pre-wrap text-sm">{det.legenda}</p></div>}
              {det.descricao && <p className="whitespace-pre-wrap text-sm text-muted">{det.descricao}</p>}
            </div>
          ) : (
            id && <SkeletonRows rows={4} label="Carregando peça" />
          )}

          {det && (
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Histórico</h3>
              {det.comentarios.length === 0 ? (
                <p className="text-sm text-faint">Sem comentários.</p>
              ) : (
                <ol className="space-y-2">
                  {det.comentarios.map((c) => (
                    <li key={c.id} className="rounded-xl bg-surface2 p-3 text-sm">
                      <p className="text-[13px]"><strong>{c.autorNome || 'Alguém'}</strong> {c.acao && <span className="text-muted">{ACAO[c.acao]}</span>} <span className="text-faint">· v{c.versao} · {fmtRelativo(c.createdAt)}</span></p>
                      {c.texto && <p className="mt-1 whitespace-pre-wrap">{c.texto}</p>}
                    </li>
                  ))}
                </ol>
              )}
              <div className="mt-3 flex gap-2">
                <Input value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={2000} placeholder="Comentário…" onKeyDown={(e) => { if (e.key === 'Enter') void comentar(); }} />
                <Button variant="soft" onClick={comentar} disabled={!comentario.trim()}>Comentar</Button>
              </div>
            </section>
          )}
        </div>

        <footer className="space-y-3 border-t border-line px-6 py-4">
          {equipe ? (
            <>
              {podeEnviar && (
                <Input value={msgEnvio} onChange={(e) => setMsgEnvio(e.target.value)} maxLength={2000} placeholder={det?.enviadaEm ? 'O que mudou nesta versão? (opcional)' : 'Mensagem para o cliente (opcional)'} />
              )}
              <div className="flex flex-wrap items-center gap-2">
                {editavel && <Button variant="ghost" onClick={() => void salvar()} disabled={salvando}>{salvando ? 'Salvando…' : id ? 'Salvar' : 'Criar rascunho'}</Button>}
                {podeEnviar && (
                  <Button onClick={enviar} disabled={enviando}>
                    <Icon name="send" size={16} /> {enviando ? 'Enviando…' : det?.enviadaEm ? 'Enviar nova versão' : 'Enviar para aprovação'}
                  </Button>
                )}
                {det?.enviadaEm && det.status === 'pendente' && <span className="text-sm text-muted">Aguardando o cliente responder.</span>}
                {id && <button type="button" onClick={remover} className="ml-auto rounded-lg p-2 text-muted hover:bg-danger-soft hover:text-danger" aria-label="Apagar peça"><Icon name="trash" size={16} /></button>}
              </div>
            </>
          ) : (
            det?.status === 'pendente' && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => responder('aprovado')}><Icon name="check" size={16} /> Aprovar</Button>
                <Button variant="ghost" onClick={() => responder('ajustes')}>Pedir ajuste</Button>
                <Button variant="ghost" onClick={() => responder('recusado')}>Recusar</Button>
              </div>
            )
          )}
        </footer>
      </aside>
    </div>
  );
}

export default function AprovacoesPage() {
  return (
    <Suspense fallback={null}>
      <AprovacoesPagina />
    </Suspense>
  );
}
