'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/icons';
import { Field, Input, cx } from '@/components/ui';
import { Button, Select, Switch, Textarea, SkeletonDetail, useToast } from '@/components/kit';
import { PageShell, PageHeader } from '@/components/revenue/Page';
import { AvisoLimiteDiario } from '@/components/disparos/ListaDisparos';
import { ApiError, providerLabel } from '@/lib/api-error';
import { numero } from '@/lib/format';
import { crm } from '@/lib/crm';
import { contatos, type ListaSalva } from '@/lib/contatos';
import { customFields, type CampoDef } from '@/lib/custom-fields';
import { settingsApi, type Tag } from '@/lib/settings';
import {
  disparos, DIAS_SEMANA, JANELA_PADRAO,
  type Audiencia, type CanalDisparo, type DadosDisparo, type Janela, type Limites, type Previa, type Segmento,
} from '@/lib/disparos';

const PASSOS = ['Canal e mensagem', 'Segmento', 'Ritmo e agendamento', 'Revisão'] as const;
const INTERVALOS = [
  { value: '30', label: 'a cada 30 segundos' },
  { value: '60', label: 'a cada 1 minuto' },
  { value: '300', label: 'a cada 5 minutos' },
  { value: '900', label: 'a cada 15 minutos' },
  { value: '3600', label: 'a cada 1 hora' },
];
const FUSOS = ['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Rio_Branco', 'America/Noronha'];
const HORAS = Array.from({ length: 25 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }));

interface Rascunho {
  nome: string;
  canal: CanalDisparo;
  mensagem: string;
  assunto: string;
  segmento: Segmento;
  loteTamanho: number;
  loteIntervaloSeg: number;
  janela: Janela;
  agendar: boolean;
  agendadoPara: string; // datetime-local
}

const VAZIO: Rascunho = {
  nome: '', canal: 'whatsapp', mensagem: 'Oi, {{contato.primeiroNome}}! ', assunto: '', segmento: {},
  loteTamanho: 20, loteIntervaloSeg: 60, janela: JANELA_PADRAO, agendar: false, agendadoPara: '',
};

function erroLegivel(e: unknown, padrao: string): string {
  if (e instanceof ApiError) {
    const cfg = e.configRequired;
    if (cfg) return `Conecte ${providerLabel(cfg.provider)} para enviar.`;
    return e.message || padrao;
  }
  return padrao;
}

/** `datetime-local` (hora do navegador) → ISO com fuso. */
const isoDoLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const localDoIso = (v: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function paraApi(r: Rascunho): DadosDisparo & { nome: string; canal: CanalDisparo } {
  return {
    nome: r.nome.trim() || 'Disparo sem nome',
    canal: r.canal,
    mensagem: r.mensagem,
    assunto: r.canal === 'email' ? r.assunto.trim() || null : null,
    segmento: r.segmento,
    loteTamanho: r.loteTamanho,
    loteIntervaloSeg: r.loteIntervaloSeg,
    janela: r.janela,
    agendadoPara: r.agendar ? isoDoLocal(r.agendadoPara) : null,
  };
}

export default function NovoDisparoPage() {
  return (
    <Suspense fallback={<PageShell><SkeletonDetail label="Carregando" /></PageShell>}>
      <Assistente />
    </Suspense>
  );
}

function Assistente() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const [id, setId] = useState<string | null>(sp.get('id'));
  const [r, setR] = useState<Rascunho | null>(sp.get('id') ? null : VAZIO);
  const [passo, setPasso] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [rejeitado, setRejeitado] = useState<string | null>(null);
  const [limites, setLimites] = useState<Limites | null>(null);
  const [audiencia, setAudiencia] = useState<Audiencia | null>(null);
  const [contando, setContando] = useState(false);

  useEffect(() => { disparos.limites().then(setLimites).catch(() => setLimites(null)); }, []);
  useEffect(() => {
    const alvo = sp.get('id');
    if (!alvo) return;
    disparos.obter(alvo).then((d) => {
      if (d.status !== 'rascunho') { router.replace(`/campanhas/disparos/${d.id}`); return; }
      setRejeitado(d.rejeitadoMotivo);
      setR({
        nome: d.nome, canal: d.canal, mensagem: d.mensagem, assunto: d.assunto ?? '', segmento: d.segmento ?? {},
        loteTamanho: d.loteTamanho, loteIntervaloSeg: d.loteIntervaloSeg, janela: d.janela ?? JANELA_PADRAO,
        agendar: !!d.agendadoPara, agendadoPara: localDoIso(d.agendadoPara),
      });
    }).catch(() => { toast.error('Disparo não encontrado'); router.replace('/campanhas'); });
  }, [sp, router, toast]);

  // Contagem ao vivo do segmento (debounce).
  const segChave = r ? JSON.stringify([r.canal, r.segmento]) : '';
  useEffect(() => {
    if (!r) return;
    setContando(true);
    const t = setTimeout(() => {
      disparos.audiencia(r.canal, r.segmento).then(setAudiencia).catch(() => setAudiencia(null)).finally(() => setContando(false));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segChave]);

  if (!r) return <PageShell><SkeletonDetail label="Carregando rascunho" /></PageShell>;
  const set = (p: Partial<Rascunho>) => setR((atual) => (atual ? { ...atual, ...p } : atual));

  const salvar = async (silencioso = false): Promise<string | null> => {
    setSalvando(true);
    try {
      const dados = paraApi(r);
      const d = id ? await disparos.atualizar(id, dados) : await disparos.criar(dados);
      if (!id) { setId(d.id); router.replace(`/campanhas/disparos/novo?id=${d.id}`); }
      if (!silencioso) toast.success('Rascunho salvo');
      return d.id;
    } catch (e) {
      toast.error('Não foi possível salvar', { description: erroLegivel(e, 'Confira os campos e tente de novo.') });
      return null;
    } finally {
      setSalvando(false);
    }
  };

  const enviar = async () => {
    setEnviando(true);
    try {
      const alvo = await salvar(true);
      if (!alvo) return;
      const d = await disparos.enviar(alvo);
      toast.success(d.status === 'aguardando_aprovacao' ? 'Enviado para aprovação' : 'Disparo agendado', {
        description: d.status === 'aguardando_aprovacao' ? 'Um owner ou admin precisa aprovar antes de sair.' : 'Os lotes começam dentro da janela de envio.',
      });
      router.push(`/campanhas/disparos/${d.id}`);
    } catch (e) {
      toast.error('Não foi possível enviar', { description: erroLegivel(e, 'Tente de novo em instantes.') });
    } finally {
      setEnviando(false);
    }
  };

  const podeAvancar = passo === 0
    ? r.nome.trim().length > 0 && r.mensagem.trim().length > 0 && (r.canal === 'whatsapp' || r.assunto.trim().length > 0)
    : passo === 1 ? !!audiencia && audiencia.elegiveis > 0 && !audiencia.acimaDoTeto
    : passo === 2 ? r.janela.dias.length > 0 && r.janela.inicio < r.janela.fim && (!r.agendar || !!r.agendadoPara)
    : true;

  return (
    <PageShell>
      <PageHeader
        title={id ? 'Editar disparo' : 'Novo disparo'}
        subtitle="Mensagem em massa para um segmento, em lotes e dentro da janela de envio."
        actions={<Link href="/campanhas" className="btn btn-ghost btn-sm"><Icon name="arrowLeft" size={15} /> Voltar</Link>}
      />

      {rejeitado && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning" role="status">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          <p><strong>Devolvido na aprovação:</strong> {rejeitado}</p>
        </div>
      )}

      <ol className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Passos do assistente">
        {PASSOS.map((p, i) => (
          <li key={p}>
            <button
              type="button"
              onClick={() => i < passo && setPasso(i)}
              aria-current={i === passo ? 'step' : undefined}
              disabled={i > passo}
              className={cx('flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
                i === passo ? 'border-brand bg-brand-soft font-semibold text-fg' : i < passo ? 'border-line text-fg hover:bg-surface2' : 'border-line text-muted')}
            >
              <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs tabular', i < passo ? 'bg-brand text-white' : 'bg-surface3')}>
                {i < passo ? <Icon name="check" size={13} /> : i + 1}
              </span>
              {p}
            </button>
          </li>
        ))}
      </ol>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="card space-y-5 p-5">
          {passo === 0 && <PassoMensagem r={r} set={set} />}
          {passo === 1 && <PassoSegmento r={r} set={set} audiencia={audiencia} contando={contando} />}
          {passo === 2 && <PassoRitmo r={r} set={set} limites={limites} elegiveis={audiencia?.elegiveis ?? 0} />}
          {passo === 3 && <PassoRevisao r={r} audiencia={audiencia} limites={limites} />}

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            {passo > 0 && <Button variant="ghost" icon="arrowLeft" onClick={() => setPasso(passo - 1)}>Voltar</Button>}
            <Button variant="soft" onClick={() => void salvar()} loading={salvando}>Salvar rascunho</Button>
            <div className="ml-auto" />
            {passo < 3 && <Button iconRight="arrowRight" disabled={!podeAvancar} onClick={() => setPasso(passo + 1)}>Continuar</Button>}
            {passo === 3 && (
              <Button icon="send" loading={enviando} disabled={!audiencia?.elegiveis} onClick={() => void enviar()}>
                {audiencia?.exigeAprovacao ? 'Enviar para aprovação' : r.agendar ? 'Agendar disparo' : 'Iniciar disparo'}
              </Button>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <PreviaMensagem r={r} />
          <ResumoAudiencia audiencia={audiencia} contando={contando} />
        </aside>
      </div>
    </PageShell>
  );
}

/* ------------------------------------------------------------ passo 1 */

function PassoMensagem({ r, set }: { r: Rascunho; set: (p: Partial<Rascunho>) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const inserir = (chave: string) => {
    const el = ref.current;
    const token = `{{${chave}}}`;
    if (!el) { set({ mensagem: r.mensagem + token }); return; }
    const ini = el.selectionStart ?? r.mensagem.length;
    const fim = el.selectionEnd ?? ini;
    set({ mensagem: r.mensagem.slice(0, ini) + token + r.mensagem.slice(fim) });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(ini + token.length, ini + token.length); });
  };
  return (
    <>
      <Field label="Nome do disparo" hint="Só a equipe vê. Ex.: Reativação de clientes de março.">
        <Input value={r.nome} maxLength={120} onChange={(e) => set({ nome: e.target.value })} placeholder="Reativação de clientes" />
      </Field>
      <div>
        <p className="mb-1.5 text-sm font-medium text-fg">Canal</p>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Canal">
          {(['whatsapp', 'email'] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={r.canal === c}
              onClick={() => set({ canal: c })}
              className={cx('flex items-center gap-2 rounded-xl border px-3 py-3 text-sm', r.canal === c ? 'border-brand bg-brand-soft font-semibold text-fg' : 'border-line text-muted hover:bg-surface2')}
            >
              <Icon name={c === 'whatsapp' ? 'whatsapp' : 'mail'} size={16} />
              {c === 'whatsapp' ? 'WhatsApp' : 'E-mail'}
            </button>
          ))}
        </div>
      </div>
      {r.canal === 'email' && (
        <Field label="Assunto">
          <Input value={r.assunto} maxLength={200} onChange={(e) => set({ assunto: e.target.value })} placeholder="{{contato.primeiroNome}}, uma novidade para você" />
        </Field>
      )}
      <div>
        <label htmlFor="msg-disparo" className="mb-1.5 block text-sm font-medium text-fg">Mensagem</label>
        <Textarea id="msg-disparo" ref={ref} rows={7} maxLength={4000} showCount value={r.mensagem} onChange={(e) => set({ mensagem: e.target.value })} />
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Variáveis">
          {[
            { chave: 'contato.primeiroNome', rotulo: 'Primeiro nome' },
            { chave: 'contato.nome', rotulo: 'Nome completo' },
            { chave: 'contato.empresa', rotulo: 'Empresa' },
            { chave: 'contato.email', rotulo: 'E-mail' },
            { chave: 'contato.telefone', rotulo: 'Telefone' },
          ].map((v) => (
            <button key={v.chave} type="button" onClick={() => inserir(v.chave)} className="rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:border-brand hover:text-brand">
              + {v.rotulo}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">Campo personalizado: <code className="rounded-sm bg-surface3 px-1">{'{{contato.campo.chave}}'}</code>. Quem responder “parar” sai da lista automaticamente.</p>
      </div>
    </>
  );
}

function PreviaMensagem({ r }: { r: Rascunho }) {
  const [p, setP] = useState<Previa | null>(null);
  const chave = JSON.stringify([r.canal, r.mensagem, r.assunto, r.segmento]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (!r.mensagem.trim()) { setP(null); return; }
      disparos.previa({ canal: r.canal, mensagem: r.mensagem, assunto: r.assunto || null, segmento: r.segmento }).then(setP).catch(() => setP(null));
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  return (
    <div className="card p-4">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><Icon name="eye" size={13} /> Pré-visualização</p>
      {!p && <p className="text-sm text-muted">Escreva a mensagem para ver como ela chega.</p>}
      {p && (
        <>
          <p className="mb-2 text-xs text-muted">{p.exemplo ? 'Com um contato de exemplo' : `Como chega para ${p.contato?.nome}`}</p>
          {p.assunto && <p className="mb-1 text-sm font-semibold text-fg">{p.assunto}</p>}
          <div className={cx('whitespace-pre-wrap break-words rounded-xl px-3 py-2.5 text-sm text-fg', r.canal === 'whatsapp' ? 'bg-brand-soft' : 'border border-line bg-surface2')}>{p.texto || ' '}</div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ passo 2 */

function PassoSegmento({ r, set, audiencia, contando }: { r: Rascunho; set: (p: Partial<Rascunho>) => void; audiencia: Audiencia | null; contando: boolean }) {
  const [listas, setListas] = useState<ListaSalva[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [etapas, setEtapas] = useState<{ id: string; nome: string }[]>([]);
  const [donos, setDonos] = useState<{ identityId: string; nome: string }[]>([]);
  const [campos, setCampos] = useState<CampoDef[]>([]);
  const [novoCampo, setNovoCampo] = useState({ chave: '', valor: '' });

  useEffect(() => {
    contatos.listas().then(setListas).catch(() => setListas([]));
    settingsApi.tags().then(setTags).catch(() => setTags([]));
    crm.pipeline().then((p) => setEtapas(p.stages.map((s) => ({ id: s.id, nome: s.nome })))).catch(() => setEtapas([]));
    crm.atendentes().then((a) => setDonos(a.map((x) => ({ identityId: x.identityId, nome: x.nome })))).catch(() => setDonos([]));
    customFields.list('contact').then((c) => setCampos(c.filter((x) => !x.arquivado))).catch(() => setCampos([]));
  }, []);

  const f = r.segmento.filtro ?? {};
  const setFiltro = (p: Partial<NonNullable<Segmento['filtro']>>) => {
    const novo: Record<string, unknown> = { ...f, ...p };
    for (const k of Object.keys(novo)) if (novo[k] === '' || novo[k] === undefined) delete novo[k];
    set({ segmento: { ...r.segmento, filtro: Object.keys(novo).length ? (novo as Segmento['filtro']) : undefined } });
  };
  const tagsSel = r.segmento.tags ?? [];
  const alternarTag = (t: string) => {
    const novas = tagsSel.includes(t) ? tagsSel.filter((x) => x !== t) : [...tagsSel, t];
    set({ segmento: { ...r.segmento, tags: novas.length ? novas : undefined } });
  };
  const cf = f.cf ?? {};

  return (
    <>
      <Field label="Lista salva" hint="Opcional. Os filtros dela somam com os de baixo.">
        <Select
          value={r.segmento.viewId ?? ''}
          onChange={(v) => set({ segmento: { ...r.segmento, viewId: v || undefined } })}
          placeholder="Nenhuma"
          options={[{ value: '', label: 'Nenhuma' }, ...listas.map((l) => ({ value: l.id, label: l.minha ? l.nome : `${l.nome} (equipe)` }))]}
        />
      </Field>

      <div>
        <p className="mb-1.5 text-sm font-medium text-fg">Tags <span className="font-normal text-muted">(qualquer uma)</span></p>
        {tags.length === 0 ? <p className="text-xs text-muted">Nenhuma tag cadastrada.</p> : (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <button key={t.id} type="button" aria-pressed={tagsSel.includes(t.name)} onClick={() => alternarTag(t.name)}
                className={cx('rounded-full border px-2.5 py-1 text-xs', tagsSel.includes(t.name) ? 'border-brand bg-brand-soft font-semibold text-fg' : 'border-line text-muted hover:border-brand')}>
                {t.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Etapa do funil">
          <Select value={f.stageId ?? ''} onChange={(v) => setFiltro({ stageId: v || undefined })} placeholder="Qualquer etapa" options={[{ value: '', label: 'Qualquer etapa' }, ...etapas.map((s) => ({ value: s.id, label: s.nome }))]} />
        </Field>
        <Field label="Origem">
          <Input value={f.origem ?? ''} maxLength={80} onChange={(e) => setFiltro({ origem: e.target.value || undefined })} placeholder="Ex.: Instagram" />
        </Field>
        <Field label="Dono">
          <Select value={f.ownerId ?? ''} onChange={(v) => setFiltro({ ownerId: v || undefined })} placeholder="Qualquer dono" options={[{ value: '', label: 'Qualquer dono' }, { value: 'nenhum', label: 'Sem dono' }, ...donos.map((d) => ({ value: d.identityId, label: d.nome }))]} />
        </Field>
      </div>

      {campos.length > 0 && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-fg">Campos personalizados</p>
          {Object.entries(cf).map(([k, v]) => (
            <div key={k} className="mb-1.5 flex items-center gap-2 text-sm">
              <span className="rounded-md bg-surface2 px-2 py-1">{campos.find((c) => c.chave === k)?.rotulo ?? k} = {v}</span>
              <button type="button" className="text-muted hover:text-fg" aria-label={`Remover filtro ${k}`} onClick={() => { const n = { ...cf }; delete n[k]; setFiltro({ cf: Object.keys(n).length ? n : undefined }); }}>
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1">
              <Select value={novoCampo.chave} onChange={(v) => setNovoCampo({ ...novoCampo, chave: v })} placeholder="Escolha o campo" options={campos.map((c) => ({ value: c.chave, label: c.rotulo }))} />
            </div>
            <div className="min-w-40 flex-1">
              <Input value={novoCampo.valor} onChange={(e) => setNovoCampo({ ...novoCampo, valor: e.target.value })} placeholder="Valor" />
            </div>
            <Button variant="soft" size="sm" disabled={!novoCampo.chave || !novoCampo.valor.trim()} onClick={() => { setFiltro({ cf: { ...cf, [novoCampo.chave]: novoCampo.valor.trim() } }); setNovoCampo({ chave: '', valor: '' }); }}>Adicionar</Button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-line p-3 text-sm" aria-live="polite">
        {contando && !audiencia ? <p className="text-muted">Contando contatos…</p> : audiencia ? (
          <p className="text-fg">
            <strong className="tabular text-brand">{numero(audiencia.elegiveis)}</strong> contato(s) vão receber
            {audiencia.total !== audiencia.elegiveis && <span className="text-muted"> de {numero(audiencia.total)} no segmento</span>}.
            {audiencia.acimaDoTeto && <span className="block text-warning">O segmento passa de {numero(audiencia.teto)} contatos. Refine os filtros.</span>}
          </p>
        ) : <p className="text-muted">Não foi possível contar agora.</p>}
      </div>
    </>
  );
}

function ResumoAudiencia({ audiencia, contando }: { audiencia: Audiencia | null; contando: boolean }) {
  return (
    <div className="card p-4" aria-busy={contando}>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><Icon name="users" size={13} /> Audiência agora</p>
      {!audiencia ? <p className="text-sm text-muted">{contando ? 'Contando…' : 'Sem contagem.'}</p> : (
        <>
          <p className="text-2xl font-semibold tabular text-fg">{numero(audiencia.elegiveis)}</p>
          <p className="text-xs text-muted">vão receber</p>
          <dl className="mt-3 space-y-1 text-xs">
            <div className="flex justify-between"><dt className="text-muted">No segmento</dt><dd className="tabular text-fg">{numero(audiencia.total)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Pediram para sair (fora)</dt><dd className="tabular text-fg">{numero(audiencia.optout)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Sem telefone ou e-mail (fora)</dt><dd className="tabular text-fg">{numero(audiencia.semCanal)}</dd></div>
          </dl>
          {audiencia.exigeAprovacao && (
            <p className="mt-3 rounded-lg bg-warning-soft px-2.5 py-2 text-xs text-warning">Acima de {numero(audiencia.aprovacaoAcima)} contatos, um owner ou admin precisa aprovar antes do envio.</p>
          )}
          {audiencia.amostra.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-line pt-2 text-xs text-muted">
              {audiencia.amostra.map((c) => <li key={c.id} className="truncate">{c.nome}</li>)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ passo 3 */

function duracaoEstimada(elegiveis: number, lote: number, intervaloSeg: number, janela: Janela, limiteDia: number): string {
  if (!elegiveis) return '-';
  const lotes = Math.ceil(elegiveis / lote);
  const seg = (lotes - 1) * intervaloSeg;
  const horasJanela = Math.max(janela.fim - janela.inicio, 1);
  const porDiaJanela = Math.floor((horasJanela * 3600) / intervaloSeg + 1) * lote;
  const porDia = Math.min(porDiaJanela, limiteDia);
  const dias = Math.ceil(elegiveis / Math.max(porDia, 1));
  if (dias > 1) return `cerca de ${dias} dias úteis de janela`;
  if (seg < 60) return 'menos de 1 minuto';
  if (seg < 3600) return `cerca de ${Math.ceil(seg / 60)} minutos`;
  return `cerca de ${(seg / 3600).toFixed(1).replace('.', ',')} horas`;
}

function PassoRitmo({ r, set, limites, elegiveis }: { r: Rascunho; set: (p: Partial<Rascunho>) => void; limites: Limites | null; elegiveis: number }) {
  const j = r.janela;
  const setJ = (p: Partial<Janela>) => set({ janela: { ...j, ...p } });
  const limiteDia = limites?.diario[r.canal] ?? 300;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mensagens por lote" hint="Lotes menores são mais seguros para o número.">
          <Input type="number" min={1} max={500} value={r.loteTamanho} onChange={(e) => set({ loteTamanho: Math.min(500, Math.max(1, Number(e.target.value) || 1)) })} />
        </Field>
        <Field label="Intervalo entre lotes">
          <Select value={String(r.loteIntervaloSeg)} onChange={(v) => set({ loteIntervaloSeg: Number(v) })} options={INTERVALOS.some((i) => i.value === String(r.loteIntervaloSeg)) ? INTERVALOS : [...INTERVALOS, { value: String(r.loteIntervaloSeg), label: `a cada ${r.loteIntervaloSeg} segundos` }]} />
        </Field>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-fg">Janela de envio</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dias da semana">
          {DIAS_SEMANA.map((d, i) => (
            <button key={d} type="button" aria-pressed={j.dias.includes(i)} onClick={() => setJ({ dias: j.dias.includes(i) ? j.dias.filter((x) => x !== i) : [...j.dias, i].sort() })}
              className={cx('w-12 rounded-lg border py-1.5 text-xs', j.dias.includes(i) ? 'border-brand bg-brand-soft font-semibold text-fg' : 'border-line text-muted')}>
              {d}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Das"><Select value={String(j.inicio)} onChange={(v) => setJ({ inicio: Number(v) })} options={HORAS.slice(0, 24)} /></Field>
          <Field label="Até"><Select value={String(j.fim)} onChange={(v) => setJ({ fim: Number(v) })} options={HORAS.slice(1)} /></Field>
          <Field label="Fuso"><Select value={j.fuso} onChange={(v) => setJ({ fuso: v })} options={FUSOS.map((f) => ({ value: f, label: f.replace('America/', '').replace('_', ' ') }))} /></Field>
        </div>
        {j.inicio >= j.fim && <p className="mt-1 text-xs text-warning">A hora de início precisa ser antes da hora de fim.</p>}
      </div>

      <div className="space-y-3">
        <Switch checked={r.agendar} onChange={(v) => set({ agendar: v })} label="Agendar o início" description="Desligado: começa assim que for aprovado (ou agora, se não precisar de aprovação)." />
        {r.agendar && (
          <Field label="Começar em">
            <Input type="datetime-local" value={r.agendadoPara} min={localDoIso(new Date().toISOString())} onChange={(e) => set({ agendadoPara: e.target.value })} />
          </Field>
        )}
      </div>

      {r.canal === 'whatsapp' && <AvisoLimiteDiario limites={limites} />}
      <p className="text-sm text-muted">Duração estimada: <strong className="text-fg">{duracaoEstimada(elegiveis, r.loteTamanho, r.loteIntervaloSeg, j, limiteDia)}</strong>.</p>
    </>
  );
}

/* ------------------------------------------------------------ passo 4 */

function PassoRevisao({ r, audiencia, limites }: { r: Rascunho; audiencia: Audiencia | null; limites: Limites | null }) {
  const j = r.janela;
  const emailSemCanal = r.canal === 'email' && limites && !limites.canais.email.configurado;
  const linhas: [string, string][] = useMemo(() => [
    ['Nome', r.nome || 'Disparo sem nome'],
    ['Canal', r.canal === 'whatsapp' ? 'WhatsApp' : 'E-mail'],
    ['Destinatários agora', audiencia ? `${numero(audiencia.elegiveis)} contato(s)` : '-'],
    ['Ritmo', `${r.loteTamanho} por lote, ${INTERVALOS.find((i) => i.value === String(r.loteIntervaloSeg))?.label ?? `a cada ${r.loteIntervaloSeg} segundos`}`],
    ['Janela', `${j.dias.map((d) => DIAS_SEMANA[d]).join(', ')}, das ${String(j.inicio).padStart(2, '0')}:00 às ${String(j.fim).padStart(2, '0')}:00 (${j.fuso.replace('America/', '').replace('_', ' ')})`],
    ['Início', r.agendar && r.agendadoPara ? new Date(r.agendadoPara).toLocaleString('pt-BR') : 'Assim que liberado'],
  ], [r, audiencia, j]);
  return (
    <>
      <dl className="divide-y divide-line rounded-xl border border-line">
        {linhas.map(([k, v]) => (
          <div key={k} className="flex flex-wrap justify-between gap-2 px-4 py-2.5 text-sm">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right font-medium text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      <ul className="space-y-1.5 text-sm text-muted">
        <li className="flex gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-brand" /> A lista de destinatários é congelada na aprovação: quem entrar no segmento depois não recebe.</li>
        <li className="flex gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-brand" /> Quem pediu para sair, ou não tem {r.canal === 'whatsapp' ? 'telefone' : 'e-mail'}, fica de fora.</li>
        <li className="flex gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-brand" /> Dá para pausar, retomar ou cancelar a qualquer momento.</li>
      </ul>
      {audiencia?.exigeAprovacao && (
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">Este disparo passa de {numero(audiencia.aprovacaoAcima)} contatos: vai para aprovação de um owner ou admin antes de sair.</p>
      )}
      {emailSemCanal && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          <Icon name="lock" size={15} />
          O envio de e-mail não está configurado.
          <Link href="/configuracoes?tab=integracoes" className="btn btn-sm ml-auto">Conectar {providerLabel('email')}</Link>
        </div>
      )}
    </>
  );
}
