'use client';

import { useCallback, useEffect, useState, type InputHTMLAttributes } from 'react';
import { Icon } from '@/components/icons';
import { Badge } from '@/components/ui';
import { Button, Confirm, Modal, Select, SkeletonRows, Switch, Tabs, Textarea, useToast } from '@/components/kit';
import { EmptyState, ErrorState } from '@/components/revenue/States';
import { numero } from '@/lib/format';
import {
  FONTES_LINK,
  FORMULARIO_VAZIO,
  ROTULO_CONFIANCA,
  ROTULO_FONTE_LINK,
  montarDadosLink,
  linksRastreados,
  periodoDias,
  rotuloFonte,
  validarFormularioLink,
  type ErrosFormularioLink,
  type FormularioLink,
  type LinkRastreado,
  type MetricasCampanhas,
  type PeriodoMetrica,
} from '@/lib/links-rastreados';

/** Copia com fallback para navegadores sem clipboard API. */
async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

const msgErro = (e: unknown) => (e instanceof Error ? e.message : 'Tente novamente.');

/** '2026-11-24' → '24/11/2026' (sem depender de fuso: a data já é civil). */
function diaBr(dia: string): string {
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

/**
 * Aba "Links rastreados" de /campanhas: CRUD dos links wa.me por campanha
 * (db/080) e, logo abaixo, as métricas de atribuição por fonte × campanha
 * (db/066) — os dois lados da mesma história ficam juntos.
 */
export function LinksRastreados() {
  const toast = useToast();
  const [lista, setLista] = useState<LinkRastreado[] | null>(null);
  const [erro, setErro] = useState(false);
  const [modal, setModal] = useState<{ editando: LinkRastreado | null } | null>(null);
  const [excluindo, setExcluindo] = useState<LinkRastreado | null>(null);
  const [removendo, setRemovendo] = useState(false);

  const carregar = useCallback(() => {
    setErro(false);
    linksRastreados.listar().then(setLista).catch(() => setErro(true));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const copiar = async (l: LinkRastreado) => {
    if (!l.urlWhatsapp) return;
    const ok = await copiarTexto(l.urlWhatsapp);
    if (ok) toast.success('Link copiado.', { description: 'Cole no botão de ação do anúncio.' });
    else toast.error('Não foi possível copiar.', { description: 'Selecione e copie o link manualmente.' });
  };

  const alternarAtivo = async (l: LinkRastreado, ativo: boolean) => {
    setLista((xs) => xs?.map((x) => (x.id === l.id ? { ...x, ativo } : x)) ?? xs);
    try {
      const atualizado = await linksRastreados.atualizar(l.id, { ativo });
      setLista((xs) => xs?.map((x) => (x.id === l.id ? atualizado : x)) ?? xs);
    } catch (e) {
      setLista((xs) => xs?.map((x) => (x.id === l.id ? { ...x, ativo: l.ativo } : x)) ?? xs);
      toast.error('Não foi possível atualizar o link.', { description: msgErro(e) });
    }
  };

  const remover = async () => {
    if (!excluindo) return;
    setRemovendo(true);
    try {
      await linksRastreados.remover(excluindo.id);
      setLista((xs) => xs?.filter((x) => x.id !== excluindo.id) ?? xs);
      toast.success('Link excluído.', { description: 'Os leads que já entraram por ele continuam com a origem gravada.' });
      setExcluindo(null);
    } catch (e) {
      toast.error('Não foi possível excluir o link.', { description: msgErro(e) });
    } finally {
      setRemovendo(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Como usar: texto curto, uma vez, antes da lista. */}
      <div className="card flex gap-3 p-4">
        <span className="icon-tile h-9 w-9 shrink-0 rounded-lg"><Icon name="link" size={18} /></span>
        <div className="min-w-0 text-[13px] leading-relaxed text-muted">
          <p className="font-semibold text-fg">Um link wa.me para cada campanha ou anúncio</p>
          <p className="mt-0.5">
            Crie o link aqui e cole no botão de ação do anúncio (Meta, Google, TikTok ou post orgânico). Quando o lead
            clicar, o WhatsApp abre com o texto inicial já preenchido; ao mandar a primeira mensagem, a origem dele é
            gravada como <strong className="text-fg">confirmada</strong> e entra nas métricas abaixo.
          </p>
        </div>
      </div>

      <section className="card overflow-hidden p-0" aria-label="Links rastreados de WhatsApp">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
          <span className="icon-tile h-9 w-9 rounded-lg"><Icon name="whatsapp" size={18} /></span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-fg">Links rastreados de WhatsApp</h2>
            <p className="text-xs text-muted">Cada link conta os leads que chegaram por ele.</p>
          </div>
          <div className="ml-auto">
            <Button variant="primary" size="sm" icon="plus" onClick={() => setModal({ editando: null })}>
              Novo link
            </Button>
          </div>
        </div>

        {erro && <ErrorState description="Não foi possível carregar os links rastreados." onRetry={carregar} className="py-10" />}
        {!erro && !lista && <SkeletonRows rows={3} />}
        {!erro && lista?.length === 0 && (
          <EmptyState
            icon="link"
            title="Nenhum link rastreado ainda"
            description="Crie o primeiro link wa.me da sua campanha: quando o lead mandar a primeira mensagem, a origem fica gravada como confirmada."
            action={
              <Button variant="primary" size="sm" icon="plus" onClick={() => setModal({ editando: null })}>
                Criar primeiro link
              </Button>
            }
            className="py-10"
          />
        )}
        {!erro && lista && lista.length > 0 && (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-2.5 font-semibold">Campanha</th>
                  <th className="px-3 py-2.5 font-semibold">Fonte</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Leads</th>
                  <th className="px-3 py-2.5 font-semibold">Link wa.me</th>
                  <th className="px-3 py-2.5 font-semibold">Ativo</th>
                  <th className="px-5 py-2.5 text-right font-semibold"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {lista.map((l) => (
                  <tr key={l.id} className="border-b border-line last:border-0 hover:bg-surface2">
                    <td className="max-w-72 px-5 py-3">
                      <p className="font-medium text-fg">{l.campanha}</p>
                      <p className="text-xs text-muted">
                        <code className="font-mono">{l.codigo}</code>
                        {l.conjunto && <span> · {l.conjunto}</span>}
                        {l.criativo && <span> · {l.criativo}</span>}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-faint" title={l.textoInicial}>“{l.textoInicial}”</p>
                    </td>
                    <td className="px-3 py-3"><Badge tone="neutral">{ROTULO_FONTE_LINK[l.fonte] ?? l.fonte}</Badge></td>
                    <td className="px-3 py-3 text-right tabular text-[15px] font-bold text-brand">{numero(l.leads)}</td>
                    <td className="px-3 py-3">
                      {l.urlWhatsapp ? (
                        <Button size="sm" icon="copy" onClick={() => void copiar(l)} aria-label={`Copiar link de ${l.campanha}`}>
                          Copiar link
                        </Button>
                      ) : (
                        <p className="flex max-w-64 items-start gap-1.5 text-xs text-warning">
                          <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
                          {l.aviso ?? 'WhatsApp não conectado.'}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Switch
                        checked={l.ativo}
                        onChange={(v) => void alternarAtivo(l, v)}
                        label={<span className="sr-only">{l.ativo ? `Desativar ${l.campanha}` : `Ativar ${l.campanha}`}</span>}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" iconOnly icon="edit" aria-label={`Editar ${l.campanha}`} onClick={() => setModal({ editando: l })} />
                        <Button size="sm" variant="ghost" iconOnly icon="trash" aria-label={`Excluir ${l.campanha}`} onClick={() => setExcluindo(l)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <MetricasCampanhas />

      {modal && (
        <FormularioLinkModal
          editando={modal.editando}
          onClose={() => setModal(null)}
          onSalvo={(l) => {
            setLista((xs) => {
              if (!xs) return xs;
              return modal.editando ? xs.map((x) => (x.id === l.id ? l : x)) : [l, ...xs];
            });
            setModal(null);
          }}
        />
      )}

      <Confirm
        open={!!excluindo}
        onClose={() => setExcluindo(null)}
        onConfirm={remover}
        loading={removendo}
        title={`Excluir o link de "${excluindo?.campanha}"?`}
        description="O link para de funcionar como rastreador: mensagens novas não casam mais com ele. Os leads que já entraram continuam com a origem gravada."
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Formulário de criação / edição                                      */
/* ------------------------------------------------------------------ */

function FormularioLinkModal({
  editando,
  onClose,
  onSalvo,
}: {
  editando: LinkRastreado | null;
  onClose: () => void;
  onSalvo: (l: LinkRastreado) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<FormularioLink>(
    editando
      ? { campanha: editando.campanha, fonte: editando.fonte, conjunto: editando.conjunto ?? '', criativo: editando.criativo ?? '', textoInicial: editando.textoInicial }
      : FORMULARIO_VAZIO,
  );
  const [erros, setErros] = useState<ErrosFormularioLink>({});
  const [salvando, setSalvando] = useState(false);

  const set = (campo: keyof FormularioLink) => (v: string) => {
    setForm((f) => ({ ...f, [campo]: v }));
    setErros((e) => ({ ...e, [campo]: undefined }));
  };

  const salvar = async () => {
    const falhas = validarFormularioLink(form);
    setErros(falhas);
    if (Object.values(falhas).some(Boolean)) return;
    setSalvando(true);
    try {
      const dados = montarDadosLink(form);
      const salvo = editando ? await linksRastreados.atualizar(editando.id, dados) : await linksRastreados.criar(dados);
      toast.success(editando ? 'Link atualizado.' : 'Link criado.', {
        description: salvo.urlWhatsapp ? 'Copie o link wa.me e cole no anúncio.' : salvo.aviso ?? undefined,
      });
      onSalvo(salvo);
    } catch (e) {
      toast.error('Não foi possível salvar o link.', { description: msgErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={editando ? 'Editar link rastreado' : 'Novo link rastreado'}
      description={editando ? `Código ${editando.codigo} (não pode ser alterado: ele já circula nos anúncios).` : 'O código do link é gerado a partir do nome da campanha.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button variant="primary" loading={salvando} onClick={() => void salvar()}>
            {editando ? 'Salvar alterações' : 'Criar link'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <CampoTexto id="lr-campanha" rotulo="Campanha" valor={form.campanha} onChange={set('campanha')} erro={erros.campanha}
          placeholder="Ex.: Black November 2026" maxLength={160} required />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-fg">Fonte do anúncio</span>
          <Select
            aria-label="Fonte do anúncio"
            aria-invalid={!!erros.fonte}
            value={form.fonte}
            onChange={set('fonte')}
            options={FONTES_LINK.map((f) => ({ value: f, label: ROTULO_FONTE_LINK[f] }))}
          />
          {erros.fonte && <ErroCampo>{erros.fonte}</ErroCampo>}
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto id="lr-conjunto" rotulo="Conjunto (opcional)" valor={form.conjunto} onChange={set('conjunto')} erro={erros.conjunto}
            placeholder="Ex.: Lookalike compradores" maxLength={160} />
          <CampoTexto id="lr-criativo" rotulo="Criativo (opcional)" valor={form.criativo} onChange={set('criativo')} erro={erros.criativo}
            placeholder="Ex.: Vídeo depoimento 30s" maxLength={160} />
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-fg">Texto inicial</span>
          <Textarea
            aria-label="Texto inicial"
            aria-invalid={!!erros.textoInicial}
            value={form.textoInicial}
            onChange={(e) => set('textoInicial')(e.target.value)}
            maxLength={400}
            showCount
            placeholder="Olá! Vi o anúncio da Black November e quero agendar"
          />
          <span className="mt-1 block text-xs text-muted">
            É a mensagem que o lead envia ao clicar no anúncio. Use um texto único por campanha: é ele que identifica a origem.
          </span>
          {erros.textoInicial && <ErroCampo>{erros.textoInicial}</ErroCampo>}
        </label>
      </div>
    </Modal>
  );
}

function CampoTexto({ id, rotulo, valor, onChange, erro, ...rest }: {
  id: string;
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  erro?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'id'>) {
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 block text-sm font-medium text-fg">{rotulo}</span>
      <input id={id} className="input" value={valor} onChange={(e) => onChange(e.target.value)} aria-invalid={!!erro} {...rest} />
      {erro && <ErroCampo>{erro}</ErroCampo>}
    </label>
  );
}

function ErroCampo({ children }: { children: string }) {
  return <span role="alert" className="mt-1 block text-xs text-danger">{children}</span>;
}

/* ------------------------------------------------------------------ */
/* Métricas por campanha (atribuição, db/066)                          */
/* ------------------------------------------------------------------ */

function MetricasCampanhas() {
  const [periodo, setPeriodo] = useState<'7' | '30' | '90'>('30');
  const [dados, setDados] = useState<MetricasCampanhas | null>(null);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(() => {
    setErro(false);
    const { de, ate } = periodoDias(Number(periodo) as PeriodoMetrica);
    linksRastreados.metricas(de, ate).then(setDados).catch(() => setErro(true));
  }, [periodo]);
  useEffect(() => { carregar(); }, [carregar]);

  return (
    <section className="card overflow-hidden p-0" aria-label="Métricas por campanha">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <span className="icon-tile h-9 w-9 rounded-lg"><Icon name="chart" size={18} /></span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg">Métricas por campanha</h2>
          <p className="text-xs text-muted">
            Contatos novos no período, por fonte e campanha.
            {dados && dados.total > 0 && <> {numero(dados.total)} no total · {diaBr(dados.de)} a {diaBr(dados.ate)}.</>}
          </p>
        </div>
        <div className="ml-auto">
          <Tabs
            idBase="metricas-periodo"
            label="Período das métricas"
            variant="segmented"
            value={periodo}
            onChange={setPeriodo}
            items={[
              { value: '7', label: '7 dias' },
              { value: '30', label: '30 dias' },
              { value: '90', label: '90 dias' },
            ]}
          />
        </div>
      </div>

      {erro && <ErrorState description="Não foi possível carregar as métricas." onRetry={carregar} className="py-10" />}
      {!erro && !dados && <SkeletonRows rows={3} />}
      {!erro && dados && dados.campanhas.length === 0 && (
        <EmptyState
          icon="chart"
          title={`Nenhum contato novo com origem nos últimos ${periodo} dias`}
          description="Quando um lead chegar por um link rastreado, anúncio ou formulário, a origem aparece aqui com o nível de confiança."
          className="py-10"
        />
      )}
      {!erro && dados && dados.campanhas.length > 0 && (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-2.5 font-semibold">Fonte</th>
                <th className="px-3 py-2.5 font-semibold">Campanha</th>
                <th className="px-3 py-2.5 text-right font-semibold">Total</th>
                <th className="px-3 py-2.5 text-right font-semibold">{ROTULO_CONFIANCA.confirmada}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{ROTULO_CONFIANCA.provavel}</th>
                <th className="px-5 py-2.5 text-right font-semibold">{ROTULO_CONFIANCA.desconhecida}</th>
              </tr>
            </thead>
            <tbody>
              {dados.campanhas.map((m) => (
                <tr key={`${m.fonte}::${m.campanha ?? ''}`} className="border-b border-line last:border-0 hover:bg-surface2">
                  <td className="px-5 py-2.5"><Badge tone="neutral">{rotuloFonte(m.fonte)}</Badge></td>
                  <td className="px-3 py-2.5 text-fg">{m.campanha ?? <span className="text-faint">Sem campanha</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular font-semibold text-fg">{numero(m.total)}</td>
                  <td className="px-3 py-2.5 text-right tabular text-success">{numero(m.confirmada)}</td>
                  <td className="px-3 py-2.5 text-right tabular text-warning">{numero(m.provavel)}</td>
                  <td className="px-5 py-2.5 text-right tabular text-muted">{numero(m.desconhecida)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
