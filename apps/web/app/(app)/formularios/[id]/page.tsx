'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Select, SkeletonDetail, Switch, TabPanel, Tabs, Textarea, useToast } from '@/components/kit';
import { Icon } from '@/components/icons';
import { Input } from '@/components/ui';
import { PageShell } from '@/components/revenue/Page';
import { ErrorState } from '@/components/revenue/States';
import { Construtor } from '@/components/formularios/Construtor';
import { RespostasFormulario } from '@/components/formularios/RespostasFormulario';
import { CampoCodigo } from '@/components/formularios/CampoCodigo';
import { useAuth } from '@/lib/auth';
import { crm } from '@/lib/crm';
import { customFields, type CampoDef } from '@/lib/custom-fields';
import { codigosDeCompartilhar, formularios, mensagemDeErro, type Formulario } from '@/lib/formularios';

type Aba = 'construtor' | 'aparencia' | 'compartilhar' | 'respostas';

/** Construtor do formulário (Q4.1): campos, aparência/destino, compartilhar e respostas. */
export default function EditorFormularioPage({ params }: { params: { id: string } }) {
  const toast = useToast();
  const { user } = useAuth();
  const [salvo, setSalvo] = useState<Formulario | null>(null);
  const [rascunho, setRascunho] = useState<Formulario | null>(null);
  const [erro, setErro] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [aba, setAba] = useState<Aba>('construtor');
  const [defs, setDefs] = useState<CampoDef[]>([]);
  const [origem, setOrigem] = useState('');

  const carregar = useCallback(() => {
    setErro(false);
    formularios.obter(params.id).then((f) => { setSalvo(f); setRascunho(f); }).catch(() => setErro(true));
  }, [params.id]);

  useEffect(() => {
    carregar();
    customFields.list('contact').then(setDefs).catch(() => setDefs([]));
    setOrigem(window.location.origin);
    const pedida = new URLSearchParams(window.location.search).get('aba');
    if (pedida === 'respostas' || pedida === 'compartilhar' || pedida === 'aparencia') setAba(pedida);
  }, [carregar]);

  const sujo = useMemo(() => !!salvo && !!rascunho && JSON.stringify(salvo) !== JSON.stringify(rascunho), [salvo, rascunho]);

  // Alteração não salva: o navegador avisa antes de sair.
  useEffect(() => {
    if (!sujo) return;
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [sujo]);

  const mudar = (p: Partial<Formulario>) => setRascunho((r) => (r ? { ...r, ...p } : r));

  async function salvar(extra?: Partial<Formulario>) {
    if (!rascunho) return;
    const alvo = { ...rascunho, ...extra };
    setSalvando(true);
    try {
      const f = await formularios.atualizar(alvo.id, {
        nome: alvo.nome, slug: alvo.slug, campos: alvo.campos.map((c) => ({ ...c, opcoes: c.opcoes?.map((o) => o.trim()).filter(Boolean) })),
        estilo: Object.fromEntries(Object.entries(alvo.estilo).filter(([, v]) => typeof v === 'string' && v.trim() !== '')),
        ativo: alvo.ativo, tag: alvo.tag?.trim() || null, stageId: alvo.stageId,
      });
      setSalvo(f);
      setRascunho(f);
      toast.success('Formulário salvo');
    } catch (x) {
      toast.error(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }

  if (erro) return <PageShell><ErrorState description="O formulário não foi encontrado ou a conexão falhou." onRetry={carregar} /></PageShell>;
  if (!rascunho || !salvo) return <PageShell><SkeletonDetail /></PageShell>;

  const codigos = codigosDeCompartilhar(origem, salvo.slug);

  return (
    <PageShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/formularios" className="btn btn-ghost btn-sm btn-icon" aria-label="Voltar para formulários">
            <Icon name="arrowLeft" size={16} />
          </Link>
          <div className="min-w-0">
            <label htmlFor="nome-formulario" className="sr-only">Nome do formulário</label>
            <input id="nome-formulario" value={rascunho.nome} maxLength={120} onChange={(e) => mudar({ nome: e.target.value })} className="t-display w-full min-w-0 bg-transparent text-2xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]" />
            <p className="text-xs text-faint">{salvo.totalRespostas} resposta(s) · /f/{salvo.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Switch label={rascunho.ativo ? 'Publicado' : 'Pausado'} checked={rascunho.ativo} onChange={(v) => mudar({ ativo: v })} />
          <a className="btn btn-sm" href={`/f/${salvo.slug}`} target="_blank" rel="noopener noreferrer"><Icon name="external" size={14} />Abrir</a>
          <Button variant="primary" loading={salvando} disabled={!sujo} onClick={() => void salvar()}>{sujo ? 'Salvar alterações' : 'Salvo'}</Button>
        </div>
      </div>

      <Tabs<Aba>
        idBase="form"
        label="Seções do formulário"
        value={aba}
        onChange={setAba}
        className="mb-5"
        items={[
          { value: 'construtor', label: 'Construtor' },
          { value: 'aparencia', label: 'Aparência e destino' },
          { value: 'compartilhar', label: 'Compartilhar' },
          { value: 'respostas', label: 'Respostas', count: salvo.totalRespostas },
        ]}
      />

      <TabPanel idBase="form" value="construtor" active={aba === 'construtor'}>
        <Construtor nome={rascunho.nome} campos={rascunho.campos} estilo={rascunho.estilo} marca={user?.empresa ?? 'Sua empresa'} defsCustom={defs} onChange={(campos) => mudar({ campos })} />
      </TabPanel>

      <TabPanel idBase="form" value="aparencia" active={aba === 'aparencia'}>
        <AparenciaDestino form={rascunho} onChange={mudar} />
      </TabPanel>

      <TabPanel idBase="form" value="compartilhar" active={aba === 'compartilhar'}>
        <div className="grid gap-5 lg:grid-cols-2">
          {!salvo.ativo && (
            <p role="status" className="rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-sm text-warning lg:col-span-2">
              O formulário está pausado: o link mostra a página de não encontrado até você publicar.
            </p>
          )}
          <CampoCodigo titulo="Link público" descricao="Para WhatsApp, bio do Instagram, e-mail ou QR code." valor={codigos.link} />
          <CampoCodigo titulo="Script (recomendado)" descricao="Cole no site onde o formulário deve aparecer. Ajusta a altura sozinho e leva as UTM da página." valor={codigos.script} />
          <CampoCodigo titulo="Iframe" descricao="Para construtores de site que não aceitam script." valor={codigos.iframe} />
          <section className="card p-4">
            <h2 className="mb-2 text-sm font-semibold text-fg">Link do site com o formulário</h2>
            <p className="text-sm text-muted">
              Em uma URL com <code className="rounded bg-surface2 px-1">?utm_source=...</code>, a origem do lead vai junto com a resposta e aparece na aba Respostas e na exportação.
            </p>
          </section>
        </div>
      </TabPanel>

      <TabPanel idBase="form" value="respostas" active={aba === 'respostas'}>
        <RespostasFormulario form={salvo} />
      </TabPanel>
    </PageShell>
  );
}

function AparenciaDestino({ form, onChange }: { form: Formulario; onChange: (p: Partial<Formulario>) => void }) {
  const [funis, setFunis] = useState<{ id: string; nome: string }[]>([]);
  const [funil, setFunil] = useState('');
  const [etapas, setEtapas] = useState<{ id: string; nome: string }[]>([]);
  const estilo = form.estilo;
  const mudarEstilo = (p: Partial<Formulario['estilo']>) => onChange({ estilo: { ...estilo, ...p } });

  useEffect(() => {
    crm.pipeline().then((p) => {
      setFunis(p.pipelines ?? []);
      // Descobre o funil da etapa salva (ou usa o principal).
      const daEtapa = p.stages.some((s) => s.id === form.stageId);
      setFunil(daEtapa || !form.stageId ? p.pipelineId ?? '' : '');
      setEtapas(p.stages.map((s) => ({ id: s.id, nome: s.nome })));
    }).catch(() => setFunis([]));
    // só no carregamento
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const escolherFunil = (id: string) => {
    setFunil(id);
    onChange({ stageId: null });
    if (id) crm.pipeline(id).then((p) => setEtapas(p.stages.map((s) => ({ id: s.id, nome: s.nome })))).catch(() => setEtapas([]));
    else setEtapas([]);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-fg">Aparência</h2>
        <div>
          <label htmlFor="f-titulo" className="mb-1.5 block text-sm font-medium text-fg">Título na página</label>
          <Input id="f-titulo" maxLength={160} placeholder={form.nome} value={estilo.titulo ?? ''} onChange={(e) => mudarEstilo({ titulo: e.target.value })} />
        </div>
        <div>
          <label htmlFor="f-desc" className="mb-1.5 block text-sm font-medium text-fg">Descrição</label>
          <Textarea id="f-desc" rows={3} maxLength={1000} showCount value={estilo.descricao ?? ''} onChange={(e) => mudarEstilo({ descricao: e.target.value })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="f-botao" className="mb-1.5 block text-sm font-medium text-fg">Texto do botão</label>
            <Input id="f-botao" maxLength={40} placeholder="Enviar" value={estilo.textoBotao ?? ''} onChange={(e) => mudarEstilo({ textoBotao: e.target.value })} />
          </div>
          <div>
            <label htmlFor="f-cor" className="mb-1.5 block text-sm font-medium text-fg">Cor da marca</label>
            <div className="flex gap-2">
              <input type="color" aria-label="Escolher cor" className="h-[38px] w-12 shrink-0 cursor-pointer rounded-md border border-line bg-transparent" value={estilo.cor ?? '#000000'} onChange={(e) => mudarEstilo({ cor: e.target.value })} />
              <Input id="f-cor" maxLength={7} placeholder="Padrão KHUB" value={estilo.cor ?? ''} onChange={(e) => mudarEstilo({ cor: e.target.value })} />
            </div>
          </div>
        </div>
        <div>
          <label htmlFor="f-logo" className="mb-1.5 block text-sm font-medium text-fg">Endereço do logotipo</label>
          <Input id="f-logo" type="url" maxLength={500} placeholder="https://..." value={estilo.logoUrl ?? ''} onChange={(e) => mudarEstilo({ logoUrl: e.target.value })} />
          <p className="mt-1 text-xs text-muted">Sem logotipo, a página mostra o nome da sua empresa.</p>
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-fg">Depois do envio</h2>
        <div>
          <label htmlFor="f-sucesso" className="mb-1.5 block text-sm font-medium text-fg">Mensagem de sucesso</label>
          <Textarea id="f-sucesso" rows={2} maxLength={500} placeholder="Recebemos suas informações. Obrigado!" value={estilo.mensagemSucesso ?? ''} onChange={(e) => mudarEstilo({ mensagemSucesso: e.target.value })} />
        </div>
        <div>
          <label htmlFor="f-redir" className="mb-1.5 block text-sm font-medium text-fg">Redirecionar para (opcional)</label>
          <Input id="f-redir" type="url" maxLength={500} placeholder="https://seusite.com/obrigado" value={estilo.redirecionarUrl ?? ''} onChange={(e) => mudarEstilo({ redirecionarUrl: e.target.value })} />
        </div>
        <div>
          <label htmlFor="f-tag" className="mb-1.5 block text-sm font-medium text-fg">Tag aplicada no contato</label>
          <Input id="f-tag" maxLength={40} placeholder="Ex.: Site" value={form.tag ?? ''} onChange={(e) => onChange({ tag: e.target.value || null })} />
          <p className="mt-1 text-xs text-muted">Tag nova dispara as automações de tag adicionada.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="f-funil" className="mb-1.5 block text-sm font-medium text-fg">Criar negócio no funil</label>
            <Select id="f-funil" value={funil} placeholder="Não criar negócio" options={funis.map((f) => ({ value: f.id, label: f.nome }))} onChange={escolherFunil} />
          </div>
          <div>
            <label htmlFor="f-etapa" className="mb-1.5 block text-sm font-medium text-fg">Etapa</label>
            <Select id="f-etapa" value={form.stageId ?? ''} placeholder="Escolha a etapa" disabled={!funil} options={etapas.map((s) => ({ value: s.id, label: s.nome }))} onChange={(v) => onChange({ stageId: v || null })} />
          </div>
        </div>
        <div>
          <label htmlFor="f-slug" className="mb-1.5 block text-sm font-medium text-fg">Endereço do link</label>
          <div className="flex items-center gap-1 text-sm text-muted">
            <span className="shrink-0">/f/</span>
            <Input id="f-slug" maxLength={64} value={form.slug} onChange={(e) => onChange({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
          </div>
          <p className="mt-1 text-xs text-muted">Trocar o endereço desativa o link antigo.</p>
        </div>
      </section>
    </div>
  );
}
