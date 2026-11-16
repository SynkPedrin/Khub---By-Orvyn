'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Field, Input, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Button, Confirm, Modal, Select, SkeletonLines, SkeletonRows, useToast } from '@/components/kit';
import {
  googleApi,
  mensagemErroGoogle,
  type CapacidadesGoogle,
  type ContaGtm,
  type ContainerGtm,
  type DetalheWorkspace,
  type WorkspaceGtm,
} from '@/lib/google';
import { AvisoErro, AvisoInfo, Secao } from './comum';

const SEVERIDADE: Record<'alta' | 'media' | 'baixa', { rotulo: string; tom: 'amber' | 'brand' | 'neutral'; classe: string }> = {
  alta: { rotulo: 'alta', tom: 'amber', classe: 'text-danger' },
  media: { rotulo: 'média', tom: 'brand', classe: 'text-amber-600 dark:text-amber-400' },
  baixa: { rotulo: 'baixa', tom: 'neutral', classe: 'text-muted' },
};

/** Nomes legíveis dos IDs de tipo de tag mais comuns (tabela oficial do GTM). */
const TIPO_TAG: Record<string, string> = {
  googtag: 'Google tag',
  gaawc: 'Google tag (GA4)',
  gaawe: 'Evento do GA4',
  awct: 'Conversão do Google Ads',
  sp: 'Remarketing do Google Ads',
  gclidw: 'Vinculador de conversões',
  flc: 'Floodlight (contador)',
  fls: 'Floodlight (vendas)',
  html: 'HTML personalizado',
  img: 'Imagem personalizada',
};
const tipoTag = (t: string) => TIPO_TAG[t] ?? (t.startsWith('cvt_') ? 'Modelo da comunidade' : t);

export function AbaTagManager({ capacidades, admin, onPedirEscrita }: { capacidades: CapacidadesGoogle; admin: boolean; onPedirEscrita: () => void }) {
  const toast = useToast();
  const [contas, setContas] = useState<ContaGtm[] | null>(null);
  const [containers, setContainers] = useState<ContainerGtm[] | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceGtm[] | null>(null);
  const [conta, setConta] = useState('');
  const [container, setContainer] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [detalhe, setDetalhe] = useState<DetalheWorkspace | null>(null);
  const [snippet, setSnippet] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Criar Google tag
  const [formTag, setFormTag] = useState<{ aberto: boolean; idMedicao: string; nome: string; acionadorId: string }>({ aberto: false, idMedicao: '', nome: '', acionadorId: '' });
  const [confirmarTag, setConfirmarTag] = useState(false);
  // Publicar
  const [formPub, setFormPub] = useState<{ aberto: boolean; nome: string; notas: string }>({ aberto: false, nome: '', notas: '' });
  const [confirmarPub, setConfirmarPub] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const falhar = (e: unknown, padrao: string) => setErro(mensagemErroGoogle(e, padrao));

  const carregarContas = useCallback(() => {
    setErro(null);
    setContas(null);
    googleApi.gtm.contas().then((c) => {
      setContas(c);
      if (c.length === 1) setConta(c[0]!.path);
    }).catch((e) => { setContas([]); falhar(e, 'Não consegui listar as contas do Tag Manager.'); });
  }, []);

  useEffect(() => { if (capacidades.tagManager) carregarContas(); }, [capacidades.tagManager, carregarContas]);

  useEffect(() => {
    setContainers(null); setContainer(''); setWorkspaces(null); setWorkspace(''); setDetalhe(null); setSnippet(null);
    if (!conta) return;
    googleApi.gtm.containers(conta).then((c) => {
      setContainers(c);
      if (c.length === 1) setContainer(c[0]!.path);
    }).catch((e) => { setContainers([]); falhar(e, 'Não consegui listar os contêineres.'); });
  }, [conta]);

  useEffect(() => {
    setWorkspaces(null); setWorkspace(''); setDetalhe(null); setSnippet(null);
    if (!container) return;
    googleApi.gtm.workspaces(container).then((w) => {
      setWorkspaces(w);
      if (w.length) setWorkspace(w[0]!.path);
    }).catch((e) => { setWorkspaces([]); falhar(e, 'Não consegui listar os espaços de trabalho.'); });
    googleApi.gtm.snippet(container).then((s) => setSnippet(s.snippet ?? s.containerConfig)).catch(() => setSnippet(null));
  }, [container]);

  const carregarWorkspace = useCallback(() => {
    if (!workspace) return;
    setCarregando(true); setErro(null);
    googleApi.gtm.workspace(workspace).then(setDetalhe).catch((e) => { setDetalhe(null); falhar(e, 'Não consegui ler o espaço de trabalho.'); }).finally(() => setCarregando(false));
  }, [workspace]);

  useEffect(() => { setDetalhe(null); carregarWorkspace(); }, [carregarWorkspace]);

  const acionadoresPagina = useMemo(() => (detalhe?.acionadores ?? []).filter((a) => a.tipo === 'pageview'), [detalhe]);
  const nomeAcionador = useMemo(() => new Map((detalhe?.acionadores ?? []).map((a) => [a.triggerId, a.nome])), [detalhe]);
  const idValido = /^G-[A-Z0-9]+$/i.test(formTag.idMedicao.trim());

  const criarTag = async () => {
    setEnviando(true);
    try {
      const r = await googleApi.gtm.criarGoogleTag({
        workspace,
        idMedicao: formTag.idMedicao.trim().toUpperCase(),
        nome: formTag.nome.trim() || undefined,
        acionadorId: formTag.acionadorId || undefined,
      });
      toast.success('Google tag criada no espaço de trabalho.', { description: r.acionadorCriado ? `Também criei o acionador "${r.acionadorCriado.nome}". Publique para valer no site.` : 'Publique para valer no site.' });
      setConfirmarTag(false);
      setFormTag({ aberto: false, idMedicao: '', nome: '', acionadorId: '' });
      carregarWorkspace();
    } catch (e) {
      toast.error(mensagemErroGoogle(e, 'Não consegui criar a tag.'));
      setConfirmarTag(false);
    } finally {
      setEnviando(false);
    }
  };

  const publicar = async () => {
    setEnviando(true);
    try {
      const r = await googleApi.gtm.publicar({ workspace, nome: formPub.nome.trim() || undefined, notas: formPub.notas.trim() || undefined });
      toast.success('Contêiner publicado.', { description: r.versaoId ? `Versão ${r.versaoId} está no ar.` : undefined });
      setConfirmarPub(false);
      setFormPub({ aberto: false, nome: '', notas: '' });
      // A publicação pode gerar um espaço de trabalho novo (newWorkspacePath).
      if (container) googleApi.gtm.workspaces(container).then((w) => { setWorkspaces(w); setWorkspace(r.novoWorkspace && w.some((x) => x.path === r.novoWorkspace) ? r.novoWorkspace : w[0]?.path ?? ''); }).catch(() => undefined);
    } catch (e) {
      toast.error(mensagemErroGoogle(e, 'Não consegui publicar.'));
      setConfirmarPub(false);
    } finally {
      setEnviando(false);
    }
  };

  const copiarSnippet = async () => {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      toast.success('Código copiado.');
    } catch {
      toast.error('Não consegui copiar. Selecione o texto e copie manualmente.');
    }
  };

  if (!capacidades.tagManager) {
    return <AvisoInfo>A conta Google conectada não autorizou o Tag Manager. Reconecte em Integrações e marque a permissão do Tag Manager.</AvisoInfo>;
  }

  const r = detalhe?.diagnostico.resumo;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Conta">
          <Select value={conta} onChange={setConta} placeholder={contas === null ? 'Carregando…' : contas.length ? 'Escolha a conta' : 'Nenhuma conta'} disabled={!contas?.length} options={(contas ?? []).map((c) => ({ value: c.path, label: c.nome }))} />
        </Field>
        <Field label="Contêiner">
          <Select value={container} onChange={setContainer} placeholder={!conta ? 'Escolha a conta antes' : containers === null ? 'Carregando…' : containers.length ? 'Escolha o contêiner' : 'Nenhum contêiner'} disabled={!containers?.length} options={(containers ?? []).map((c) => ({ value: c.path, label: `${c.nome}${c.publicId ? ` (${c.publicId})` : ''}` }))} />
        </Field>
        <Field label="Espaço de trabalho">
          <Select value={workspace} onChange={setWorkspace} placeholder={!container ? 'Escolha o contêiner antes' : workspaces === null ? 'Carregando…' : 'Escolha'} disabled={!workspaces?.length} options={(workspaces ?? []).map((w) => ({ value: w.path, label: w.nome }))} />
        </Field>
      </div>

      {erro && <AvisoErro mensagem={erro} onTentar={contas?.length ? carregarWorkspace : carregarContas} />}
      {contas?.length === 0 && !erro && <AvisoInfo>A conta Google conectada não tem acesso a nenhuma conta do Tag Manager.</AvisoInfo>}

      {workspace && carregando && !detalhe && <SkeletonRows rows={5} label="Lendo o espaço de trabalho" />}

      {detalhe && r && (
        <>
          <Secao
            titulo="Diagnóstico"
            acao={
              admin ? (
                capacidades.tagManagerEscrita && capacidades.tagManagerPublicar ? (
                  <>
                    {!r.ga4 && <Button size="sm" variant="soft" icon="plus" onClick={() => setFormTag((f) => ({ ...f, aberto: true }))}>Criar Google tag do GA4</Button>}
                    <Button size="sm" variant="primary" icon="upload" disabled={!r.alteracoesPendentes} onClick={() => setFormPub((f) => ({ ...f, aberto: true }))}>Publicar alterações</Button>
                  </>
                ) : (
                  <Button size="sm" variant="soft" icon="lock" onClick={onPedirEscrita}>Permitir edição no Tag Manager</Button>
                )
              ) : null
            }
          >
            <div className="flex flex-wrap gap-2 px-5 pt-4">
              <Badge tone={r.ga4 ? 'green' : 'amber'}>GA4 {r.ga4 ? 'ok' : 'ausente'}</Badge>
              <Badge tone={r.pixelMeta ? 'green' : 'amber'}>Pixel da Meta {r.pixelMeta ? 'ok' : 'ausente'}</Badge>
              <Badge tone={r.conversao ? 'green' : 'amber'}>Conversão {r.conversao ? 'ok' : 'ausente'}</Badge>
              <Badge tone="neutral">{r.ativas} ativa(s) de {r.totalTags}</Badge>
              {detalhe.publicado === true && <Badge tone="green">publicado</Badge>}
              {detalhe.conflitos > 0 && <Badge tone="amber">{detalhe.conflitos} conflito(s) de mesclagem</Badge>}
            </div>
            {detalhe.diagnostico.problemas.length === 0 ? (
              <p className="flex items-center gap-2 px-5 py-4 text-sm text-emerald-600 dark:text-emerald-400"><Icon name="check" size={16} /> Nenhum problema comum encontrado.</p>
            ) : (
              <ul className="divide-y divide-line">
                {detalhe.diagnostico.problemas.map((p) => (
                  <li key={p.codigo} className="flex items-start gap-3 px-5 py-3">
                    <Icon name="alert" size={16} className={cx('mt-0.5 shrink-0', SEVERIDADE[p.severidade].classe)} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-fg">{p.titulo}</p>
                      <p className="text-xs text-muted">{p.detalhe}</p>
                    </div>
                    <Badge tone={SEVERIDADE[p.severidade].tom}>{SEVERIDADE[p.severidade].rotulo}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Secao>

          <div className="grid gap-5 xl:grid-cols-3">
            <Secao titulo={`Tags (${detalhe.tags.length})`} className="xl:col-span-2">
              <div className="divide-y divide-line">
                {detalhe.tags.map((t) => (
                  <div key={t.path} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-fg">{t.nome}</p>
                      <p className="text-[11px] text-muted">
                        {tipoTag(t.tipo)} · {t.acionadores.length ? t.acionadores.map((id) => nomeAcionador.get(id) ?? `acionador ${id}`).join(', ') : 'sem acionador'}
                      </p>
                    </div>
                    {t.pausada && <Badge tone="neutral">pausada</Badge>}
                    {t.url && <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-brand" aria-label={`Abrir ${t.nome} no Tag Manager`}><Icon name="external" size={14} /></a>}
                  </div>
                ))}
                {!detalhe.tags.length && <p className="px-5 py-8 text-center text-sm text-muted">Nenhuma tag neste espaço de trabalho.</p>}
              </div>
            </Secao>
            <div className="space-y-5">
              <Secao titulo={`Acionadores (${detalhe.acionadores.length})`}>
                <ul className="max-h-72 divide-y divide-line overflow-y-auto">
                  {detalhe.acionadores.map((a) => (
                    <li key={a.path} className="px-5 py-2 text-sm"><span className="font-medium text-fg">{a.nome}</span> <span className="text-[11px] text-muted">· {a.tipo}</span></li>
                  ))}
                  {!detalhe.acionadores.length && <li className="px-5 py-6 text-center text-sm text-muted">Nenhum acionador.</li>}
                </ul>
              </Secao>
              <Secao titulo={`Não publicado (${r.alteracoesPendentes})`}>
                <ul className="max-h-60 divide-y divide-line overflow-y-auto">
                  {detalhe.alteracoes.filter((a) => a.status !== 'none').map((a, i) => (
                    <li key={`${a.entidade}-${a.nome}-${i}`} className="px-5 py-2 text-sm"><span className="font-medium text-fg">{a.nome}</span> <span className="text-[11px] text-muted">· {a.entidade} {a.status === 'added' ? 'adicionado' : a.status === 'deleted' ? 'removido' : 'alterado'}</span></li>
                  ))}
                  {!r.alteracoesPendentes && <li className="px-5 py-6 text-center text-sm text-muted">Tudo publicado.</li>}
                </ul>
              </Secao>
            </div>
          </div>
        </>
      )}

      {container && (
        <Secao titulo="Código de instalação do contêiner" acao={snippet ? <Button size="sm" variant="ghost" icon="copy" onClick={copiarSnippet}>Copiar</Button> : null}>
          {snippet ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all bg-surface2 px-5 py-4 font-mono text-[11px] text-fg">{snippet}</pre>
          ) : (
            <SkeletonLines lines={3} className="px-5 py-4" label="Carregando código" />
          )}
        </Secao>
      )}

      <Modal
        open={formTag.aberto}
        onClose={() => setFormTag((f) => ({ ...f, aberto: false }))}
        title="Criar Google tag do GA4"
        description="A tag entra no espaço de trabalho e só vai para o site quando você publicar."
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormTag((f) => ({ ...f, aberto: false }))}>Cancelar</Button>
            <Button variant="primary" disabled={!idValido} onClick={() => setConfirmarTag(true)}>Revisar e criar</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="ID de medição do GA4" hint="Formato G-XXXXXXXXXX, no GA4 em Administrador > Fluxos de dados.">
            <Input value={formTag.idMedicao} onChange={(e) => setFormTag({ ...formTag, idMedicao: e.target.value })} placeholder="G-XXXXXXXXXX" autoFocus />
          </Field>
          <Field label="Nome da tag (opcional)">
            <Input value={formTag.nome} onChange={(e) => setFormTag({ ...formTag, nome: e.target.value })} placeholder="Google tag GA4" maxLength={200} />
          </Field>
          <Field label="Acionador">
            <Select
              value={formTag.acionadorId}
              onChange={(v) => setFormTag({ ...formTag, acionadorId: v })}
              placeholder="Criar acionador novo: Todas as páginas"
              options={acionadoresPagina.map((a) => ({ value: a.triggerId, label: a.nome }))}
            />
          </Field>
        </div>
      </Modal>

      <Confirm
        open={confirmarTag}
        onClose={() => setConfirmarTag(false)}
        onConfirm={criarTag}
        loading={enviando}
        tone="primary"
        confirmLabel="Criar tag"
        title="Criar a Google tag no Tag Manager?"
        description={`Vou criar a tag ${formTag.idMedicao.trim().toUpperCase()} no espaço de trabalho selecionado${formTag.acionadorId ? '' : ' e um acionador "Todas as páginas"'}. A ação fica registrada na auditoria.`}
      />

      <Modal
        open={formPub.aberto}
        onClose={() => setFormPub((f) => ({ ...f, aberto: false }))}
        title="Publicar alterações"
        description={`${r?.alteracoesPendentes ?? 0} alteração(ões) vão para o site assim que publicadas.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormPub((f) => ({ ...f, aberto: false }))}>Cancelar</Button>
            <Button variant="primary" onClick={() => setConfirmarPub(true)}>Revisar e publicar</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Nome da versão (opcional)">
            <Input value={formPub.nome} onChange={(e) => setFormPub({ ...formPub, nome: e.target.value })} maxLength={200} placeholder="Ex.: GA4 e pixel" />
          </Field>
          <Field label="Notas (opcional)">
            <Input value={formPub.notas} onChange={(e) => setFormPub({ ...formPub, notas: e.target.value })} maxLength={2000} />
          </Field>
        </div>
      </Modal>

      <Confirm
        open={confirmarPub}
        onClose={() => setConfirmarPub(false)}
        onConfirm={publicar}
        loading={enviando}
        tone="primary"
        confirmLabel="Publicar"
        title="Publicar no site agora?"
        description="O Tag Manager cria uma versão nova e a coloca no ar imediatamente para todos os visitantes do site. A ação fica registrada na auditoria."
      />
    </div>
  );
}
