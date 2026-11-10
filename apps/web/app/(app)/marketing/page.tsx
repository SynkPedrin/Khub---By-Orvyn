'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, cx } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { marketplace, type TemplateResumo, type TemplateDetalhe } from '@/lib/marketplace';

interface Doc { slug: string; title: string; excerpt: string; words: number }

// Base de conhecimento que alimenta a Nyro (não os docs internos de engenharia).
const KB = 'RAG/conhecimento/';
/** Categoria amigável a partir do caminho; null = não faz parte da base pública. */
function categoriaDoc(slug: string): string | null {
  if (!slug.startsWith(KB)) return null;
  const rest = slug.slice(KB.length);
  if ((rest.split('/').pop() ?? '').startsWith('_')) return null; // pula _INDICE
  if (rest.startsWith('global/marketing/')) return 'Marketing';
  if (rest.startsWith('global/operacao/')) return 'Operação';
  if (rest.startsWith('global/')) return 'Vendas & Growth';
  if (rest.startsWith('juridico/')) return 'Jurídico';
  if (rest.startsWith('contabil/')) return 'Contábil';
  if (rest.startsWith('medico/')) return 'Saúde';
  return 'Outros';
}
const ORDEM_CAT = ['Marketing', 'Vendas & Growth', 'Operação', 'Jurídico', 'Contábil', 'Saúde', 'Outros'];

const href = (slug: string) => '/conhecimento/' + slug.split('/').map(encodeURIComponent).join('/');
/** Mensagem pronta para a Nyro aplicar o material no negócio do cliente. */
const nyroHref = (title: string) =>
  '/nyro?q=' + encodeURIComponent(`Li o material "${title}" na Biblioteca. Como aplico isso na minha empresa, na prática? Traga um passo a passo pro meu nicho.`);

const REQ_ROTULO: Record<string, string> = { stevo: 'WhatsApp', email: 'E-mail (SMTP)', anthropic: 'IA (Claude)', meta: 'Meta Ads' };

/** Divisor de seção — a "régua" que separa Automação de Base de marketing. */
function Divisor({ icon, titulo, sub, contagem }: { icon: IconName; titulo: string; sub: string; contagem?: number | string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white shadow-brand" style={{ background: 'linear-gradient(135deg, var(--brand-bright), var(--brand-deep))' }}>
        <Icon name={icon} size={20} />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight text-fg">{titulo}</h2>
          {contagem !== undefined && <span className="rounded-full bg-surface3 px-2 py-0.5 text-[11px] font-semibold text-muted">{contagem}</span>}
        </div>
        <p className="text-xs text-muted">{sub}</p>
      </div>
      <span className="ml-2 hidden h-px flex-1 bg-line sm:block" />
    </div>
  );
}

export default function BibliotecaPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [templates, setTemplates] = useState<TemplateResumo[] | null>(null);
  const [instalando, setInstalando] = useState<string | null>(null);
  const [erroTpl, setErroTpl] = useState(false);
  const [erroDocs, setErroDocs] = useState(false);
  // Modal de binding: quando o template tem variáveis, coleta os valores antes de instalar.
  const [bind, setBind] = useState<{ tpl: TemplateDetalhe; valores: Record<string, string> } | null>(null);

  const carregar = () => {
    setErroTpl(false); setErroDocs(false);
    fetch('/api/cerebro').then((r) => r.ok ? r.json() : Promise.reject()).then((d) => setDocs(d.docs ?? [])).catch(() => { setDocs([]); setErroDocs(true); });
    marketplace.listar().then(setTemplates).catch(() => { setTemplates([]); setErroTpl(true); });
  };

  useEffect(() => { carregar(); }, []);

  // Clique em Instalar: se o template tem variáveis, abre o modal de binding;
  // senão instala direto.
  const abrirInstalar = async (t: TemplateResumo) => {
    setInstalando(t.id);
    try {
      const det = await marketplace.obter(t.id);
      if (det.variables?.length) {
        const valores = Object.fromEntries(det.variables.map((v) => [v.chave, v.default ?? '']));
        setBind({ tpl: det, valores });
        setInstalando(null);
      } else {
        const r = await marketplace.instalar(t.id);
        router.push(`/automacoes/${r.workflowId}`);
      }
    } catch { setInstalando(null); }
  };

  const confirmarInstalar = async () => {
    if (!bind) return;
    setInstalando(bind.tpl.id);
    try {
      const r = await marketplace.instalar(bind.tpl.id, bind.valores);
      setBind(null);
      router.push(`/automacoes/${r.workflowId}`);
    } catch { setInstalando(null); }
  };

  // Toda a base de conhecimento, agrupada por categoria (a "Base de marketing").
  const porCategoria = useMemo(() => {
    const m = new Map<string, Doc[]>();
    for (const d of docs ?? []) {
      const cat = categoriaDoc(d.slug);
      if (!cat) continue;
      const arr = m.get(cat) ?? [];
      arr.push(d);
      m.set(cat, arr);
    }
    return [...m.entries()].sort((a, b) => {
      const ia = ORDEM_CAT.indexOf(a[0]); const ib = ORDEM_CAT.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }, [docs]);
  const totalDocs = useMemo(() => porCategoria.reduce((n, [, l]) => n + l.length, 0), [porCategoria]);

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-8 px-4 py-6 lg:px-8 lg:py-8">
      {/* Hero com o papel de parede KHUB (branco, roxo e verde) e véu claro à esquerda, onde vive o texto. */}
      <section className="card relative overflow-hidden p-8" style={{ backgroundImage: "linear-gradient(90deg, rgba(255,255,255,.92) 0%, rgba(255,255,255,.7) 55%, rgba(255,255,255,.15) 100%), url('/khub-fundo.jpg')", backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <div className="relative flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-brand">
          <Icon name="knowledge" size={15} /> Biblioteca
        </div>
        <h1 className="t-display relative mt-2">Biblioteca</h1>
        <p className="relative mt-2 max-w-2xl text-sm text-muted sm:text-base">
          Tudo que a NICO usa para pensar e agir, em dois lugares: <strong className="text-fg">automações prontas</strong> para instalar em um
          clique e a <strong className="text-fg">base de marketing</strong>, os frameworks que ela consulta ao raciocinar sobre a sua estratégia.
          Em cada material, um clique pergunta à NICO <em>como usar aquilo na sua empresa</em>.
        </p>
        <div className="relative mt-5 flex flex-wrap gap-2">
          <Link href="/marketing/ads" className="btn btn-primary"><Icon name="marketing" size={16} /> Gerenciador de Anúncios</Link>
          <Link href="/nyro" className="btn inline-flex items-center gap-1.5"><Icon name="sparkles" size={16} /> Perguntar à NICO</Link>
          <Link href="/automacoes" className="btn inline-flex items-center gap-1.5"><Icon name="sparkles" size={16} /> Minhas automações</Link>
        </div>
      </section>

      {/* ===================== DIVISÃO 1 · AUTOMAÇÃO ===================== */}
      <section className="space-y-4">
        <Divisor icon="sparkles" titulo="Automação" sub="Fluxos prontos para instalar em um clique, a NICO configura o resto." contagem={templates?.length ?? '…'} />
        {!templates && !erroTpl && <p className="text-sm text-muted">Carregando os templates…</p>}
        {erroTpl && (
          <p className="rounded-xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">
            Não consegui carregar os templates. <button onClick={carregar} className="font-semibold underline">Tentar de novo</button>
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates?.map((t) => (
            <Card key={t.id} className="flex h-full flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="font-bold text-fg">{t.name}</p>
                {t.featured && <span className="rounded-full bg-brand/12 px-2 py-0.5 text-2xs font-bold text-brand">★ destaque</span>}
              </div>
              <p className="mt-1.5 line-clamp-3 flex-1 text-sm text-muted">{t.description}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-2xs">
                <span className="rounded-full bg-surface3 px-2 py-0.5 font-semibold text-muted">{t.category}</span>
                {t.requirements.map((r) => (
                  <span key={r} className="rounded-full bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-400">requer {REQ_ROTULO[r] ?? r}</span>
                ))}
              </div>
              <button onClick={() => abrirInstalar(t)} disabled={instalando === t.id} className="btn btn-soft mt-3 w-full text-sm">
                {instalando === t.id ? 'Instalando…' : <><Icon name="plus" size={15} /> Instalar</>}
              </button>
            </Card>
          ))}
          {templates && templates.length === 0 && <p className="text-sm text-muted">Nenhum template ainda.</p>}
        </div>
      </section>

      {/* ===================== DIVISÃO 2 · BASE DE MARKETING ===================== */}
      <section className="space-y-6">
        <Divisor icon="marketing" titulo="Base de marketing" sub="A inteligência da NICO, frameworks, playbooks e operação que ela recupera ao pensar." contagem={totalDocs || '…'} />
        {!docs && !erroDocs && <p className="text-sm text-muted">Carregando a inteligência da NICO…</p>}
        {erroDocs && (
          <p className="rounded-xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">
            Não consegui carregar a base. <button onClick={carregar} className="font-semibold underline">Tentar de novo</button>
          </p>
        )}
        {docs && !erroDocs && totalDocs === 0 && <p className="text-sm text-muted">Base de conhecimento vazia.</p>}

        {porCategoria.map(([cat, list]) => (
          <div key={cat} className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-muted">{cat}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((d) => (
                <Card key={d.slug} className="flex h-full flex-col p-4">
                  <p className="font-bold text-fg">{d.title}</p>
                  <p className="mt-1.5 line-clamp-3 flex-1 text-sm text-muted">{d.excerpt}</p>
                  <p className="mt-2 text-[11px] text-muted">{d.words.toLocaleString('pt-BR')} palavras</p>
                  <div className="mt-3 flex flex-col gap-2">
                    <Link href={nyroHref(d.title)} className="btn btn-primary w-full text-[13px]">
                      <Icon name="sparkles" size={15} /> Como usar isso na minha empresa?
                    </Link>
                    <Link href={href(d.slug)} className={cx('inline-flex items-center justify-center gap-1 text-xs font-semibold text-brand hover:underline')}>
                      Abrir material <Icon name="chevronRight" size={13} />
                    </Link>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Modal de binding — liga as variáveis do template aos dados do tenant */}
      {bind && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="lg-backdrop absolute inset-0" onClick={() => setBind(null)} />
          <div className="lg-sheet relative w-full max-w-md animate-scale-in p-6">
            <h2 className="text-lg font-bold text-fg">Personalizar “{bind.tpl.name}”</h2>
            <p className="mt-1 text-xs text-muted">Ajuste os campos abaixo, eles entram no fluxo antes de instalar.</p>
            <div className="mt-4 space-y-3">
              {bind.tpl.variables.map((v) => (
                <div key={v.chave}>
                  <label className="mb-1 block text-xs font-semibold text-muted">{v.label}{v.obrigatorio && ' *'}</label>
                  {v.tipo === 'texto' && (bind.valores[v.chave]?.length ?? 0) > 40 ? (
                    <textarea
                      value={bind.valores[v.chave] ?? ''}
                      onChange={(e) => setBind({ ...bind, valores: { ...bind.valores, [v.chave]: e.target.value } })}
                      rows={3}
                      className="input min-h-[4.5rem] resize-y"
                    />
                  ) : (
                    <input
                      value={bind.valores[v.chave] ?? ''}
                      onChange={(e) => setBind({ ...bind, valores: { ...bind.valores, [v.chave]: e.target.value } })}
                      inputMode={v.tipo === 'numero' ? 'numeric' : undefined}
                      className="input"
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setBind(null)} className="btn btn-ghost text-sm">Cancelar</button>
              <button
                onClick={confirmarInstalar}
                disabled={instalando === bind.tpl.id || bind.tpl.variables.some((v) => v.obrigatorio && !bind.valores[v.chave]?.trim())}
                className="btn btn-primary text-sm"
              >
                {instalando === bind.tpl.id ? 'Instalando…' : <><Icon name="plus" size={15} /> Instalar</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
