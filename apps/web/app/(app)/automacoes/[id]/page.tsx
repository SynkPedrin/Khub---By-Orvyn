'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Badge, Button } from '@/components/ui';
import { Icon } from '@/components/icons';
import { NoCanvas, ICONE, ACENTO, type DadosNo } from '@/components/automations/NoCanvas';
import { PainelNo } from '@/components/automations/PainelNo';
import { PainelAdicionar } from '@/components/automations/PainelAdicionar';
import { PainelConfig } from '@/components/automations/PainelConfig';
import { TestarAutomacao } from '@/components/automations/TestarAutomacao';
import { automations, type ConfigWorkflow, type Grafo, type MetaNo, type NoGrafo, type Problema, type Ramo, type WorkflowResumo } from '@/lib/automations';
import { ApiError } from '@/lib/api-error';

const tiposNo = { khub: NoCanvas };
const rid = () => Math.random().toString(36).slice(2, 9);

/** Resumo mostrado no card do canvas — o usuário entende o fluxo sem abrir cada nó. */
function resumir(tipo: string, cfg: Record<string, any>): string {
  switch (tipo) {
    case 'gatilho.contato_criado': return cfg.origem ? `origem: ${cfg.origem}` : 'qualquer contato novo';
    case 'gatilho.etapa_mudou': return cfg.stageId ? 'etapa específica' : 'qualquer etapa';
    case 'gatilho.mensagem_recebida': return cfg.contem ? `contém "${cfg.contem}"` : 'qualquer mensagem recebida';
    case 'gatilho.tag_adicionada': return cfg.tag ? `tag "${cfg.tag}"` : 'defina a tag';
    case 'gatilho.negocio_criado': return cfg.stageId ? 'etapa específica' : 'qualquer oportunidade nova';
    case 'gatilho.webhook': return `identifica por ${cfg.identificarPor ?? 'email'}`;
    case 'gatilho.negocio_status': return cfg.status ? `quando ${cfg.status}` : 'ganho ou perdido';
    case 'controle.esperar': return `${cfg.duracao ?? '?'} ${cfg.unidade ?? ''}`;
    case 'controle.esperar_resposta': return `até ${cfg.duracao ?? 1} ${cfg.unidade ?? 'dias'}`;
    case 'controle.encerrar': return cfg.motivo || 'termina o fluxo aqui';
    case 'controle.condicao': return `${(cfg.ramos ?? []).length} ramo(s)`;
    case 'controle.split': return `${(cfg.ramos ?? []).length} variantes`;
    case 'controle.drip': return cfg.porJanela ? `${cfg.porJanela} por ${cfg.janela ?? 'hora'}` : 'defina o lote';
    case 'controle.ir_para': return cfg.alvoNoId ? 'pula no fluxo' : 'escolha o destino';
    case 'acao.enviar_sms': return cfg.texto ? `"${String(cfg.texto).slice(0, 40)}…"` : 'escreva a mensagem';
    case 'acao.notificar_equipe': return cfg.telefone ? `para ${String(cfg.telefone)}` : 'informe o WhatsApp da equipe';
    case 'acao.adicionar_tag': return cfg.tag ? `+ ${cfg.tag}` : 'defina a tag';
    case 'acao.remover_tag': return cfg.tag ? `− ${cfg.tag}` : 'defina a tag';
    case 'acao.atualizar_contato': return cfg.campo ? `${cfg.campo} = ${cfg.valor ?? ''}` : 'escolha o campo';
    case 'acao.criar_oportunidade': return cfg.titulo || 'defina o título';
    case 'acao.mover_etapa': return cfg.stageId ? 'move o negócio' : 'escolha a etapa';
    case 'acao.criar_tarefa': return cfg.titulo || 'defina a tarefa';
    case 'acao.criar_nota': return cfg.corpo ? `"${String(cfg.corpo).slice(0, 36)}…"` : 'escreva a nota';
    case 'acao.definir_variavel': return cfg.nome ? `${cfg.nome} = ${String(cfg.valor ?? '').slice(0, 24)}` : 'defina a variável';
    case 'acao.formatar_texto': return cfg.formato ? `${cfg.formato} → ${cfg.salvarEm || 'texto'}` : 'escolha o formato';
    case 'acao.ia': return cfg.tarefa ? `IA: ${cfg.tarefa} → ${cfg.salvarEm || 'ia'}` : 'configure a IA';
    case 'acao.chamar_workflow': return cfg.workflowId ? 'entra em outro fluxo' : 'escolha o fluxo';
    case 'acao.webhook': return cfg.url || 'defina a URL';
    default: return '';
  }
}

/** Saídas do nó: fixas (esperar resposta) ou definidas pelo usuário (If/Else). */
function ramosDoNo(tipo: string, cfg: Record<string, any>, m?: MetaNo): Ramo[] | undefined {
  if (m?.ramosFixos) return m.ramosFixos.map((r) => ({ id: r.id, rotulo: r.rotulo, juncao: 'AND' as const, regras: [] }));
  if (tipo === 'controle.condicao') return (cfg.ramos ?? []) as Ramo[];
  // split: o canvas só precisa de id+rótulo por saída (o peso mora na config)
  if (tipo === 'controle.split') return (cfg.ramos ?? []).map((r: { id: string; rotulo?: string }) => ({ id: r.id, rotulo: r.rotulo ?? 'Variante', juncao: 'AND' as const, regras: [] }));
  return undefined;
}

/** Config inicial de cada tipo: o nó nasce utilizável, não vazio. */
function configPadrao(tipo: string): Record<string, unknown> {
  switch (tipo) {
    case 'controle.esperar': return { duracao: 10, unidade: 'minutos' };
    case 'controle.esperar_resposta': return { duracao: 1, unidade: 'dias' };
    case 'controle.condicao': return { ramos: [{ id: rid(), rotulo: 'Ramo 1', juncao: 'AND', regras: [] }] };
    case 'controle.split': return { ramos: [{ id: rid(), rotulo: 'Variante A', peso: 1 }, { id: rid(), rotulo: 'Variante B', peso: 1 }] };
    case 'controle.drip': return { porJanela: 50, janela: 'hora' };
    case 'acao.criar_tarefa': return { titulo: '', prioridade: 'media', emDias: 0 };
    case 'gatilho.webhook': return { identificarPor: 'email', campo: 'email', seNaoAchar: 'criar' };
    case 'acao.webhook': return { metodo: 'POST' };
    default: return {};
  }
}

function EditorInterno() {
  const { id } = useParams<{ id: string }>();
  const [catalogo, setCatalogo] = useState<MetaNo[]>([]);
  const [nome, setNome] = useState('');
  const [status, setStatus] = useState('rascunho');
  const [versaoAtiva, setVersaoAtiva] = useState<number | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [novaTag, setNovaTag] = useState('');
  const [menu, setMenu] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<DadosNo>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [problemas, setProblemas] = useState<Problema[]>([]);
  const [salvando, setSalvando] = useState<'salvo' | 'salvando' | 'erro'>('salvo');
  const [aviso, setAviso] = useState('');
  const [rf, setRf] = useState<ReactFlowInstance | null>(null);
  const [adicionar, setAdicionar] = useState<'gatilho' | 'passo' | null>(null);
  const [mostrarConfig, setMostrarConfig] = useState(false);
  const [testando, setTestando] = useState(false);
  const [config, setConfig] = useState<ConfigWorkflow | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [fluxos, setFluxos] = useState<WorkflowResumo[]>([]);
  const wrapper = useRef<HTMLDivElement>(null);
  const carregado = useRef(false);

  const meta = useCallback((tipo: string) => catalogo.find((c) => c.tipo === tipo), [catalogo]);

  // ---- carga ----
  useEffect(() => {
    Promise.all([automations.catalogo(), automations.obter(id)])
      .then(([cat, wf]) => {
        setCatalogo(cat);
        setNome(wf.nome);
        setStatus(wf.status);
        setVersaoAtiva(wf.versaoAtiva);
        setTags(wf.tags ?? []);
        setConfig(wf.config);
        setWebhookUrl(wf.webhookUrl);
        const g = wf.grafo;
        // Configs ANTES de setNodes: o autosave dispara quando `nodes` muda e
        // serializa configs.current. Ordem errada aqui apagava a config de
        // todos os nós ao ABRIR o editor (bug que destruiu fluxos importados).
        configs.current = {};
        for (const n of g.nos) configs.current[n.id] = { config: n.config, rotulo: n.rotulo, aoFalhar: n.aoFalhar };
        setNodes(g.nos.map((n) => paraNode(n, cat)));
        setEdges(g.arestas.map((a) => paraEdge(a)));
        pularSaveDaCarga.current = true;
        carregado.current = true;
      })
      .catch(() => setAviso('Não consegui carregar o workflow.'));
    automations.listar().then((l) => setFluxos(l.filter((f) => f.id !== id && f.status === 'ativo'))).catch(() => setFluxos([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const paraNode = (n: NoGrafo, cat: MetaNo[]): Node<DadosNo> => {
    const m = cat.find((c) => c.tipo === n.tipo);
    return {
      id: n.id,
      type: 'khub',
      position: n.posicao,
      data: {
        tipo: n.tipo,
        nome: n.rotulo || m?.nome || n.tipo,
        categoria: m?.categoria ?? 'acao',
        resumo: resumir(n.tipo, n.config),
        ramos: ramosDoNo(n.tipo, n.config, m),
        provider: m?.provider,
      },
    };
  };
  const paraEdge = (a: { id: string; de: string; para: string; ramo?: string }): Edge => ({
    id: a.id, source: a.de, target: a.para, sourceHandle: a.ramo ?? null, animated: true,
    style: { stroke: 'var(--brand)', strokeWidth: 1.5 },
  });

  // configs vivem fora do node.data (o canvas só mostra o resumo)
  const configs = useRef<Record<string, { config: Record<string, unknown>; rotulo?: string; aoFalhar?: 'parar' | 'seguir' }>>({});
  const pularSaveDaCarga = useRef(false);
  const montarGrafo = useCallback((): Grafo => ({
    nos: nodes.map((n) => ({
      id: n.id,
      tipo: n.data.tipo,
      rotulo: configs.current[n.id]?.rotulo,
      posicao: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      config: configs.current[n.id]?.config ?? {},
      aoFalhar: configs.current[n.id]?.aoFalhar,
    })),
    arestas: edges.map((e) => ({ id: e.id, de: e.source, para: e.target, ramo: e.sourceHandle ?? undefined })),
  }), [nodes, edges]);

  // ---- autosave (rascunho; nunca toca na versão publicada) ----
  useEffect(() => {
    if (!carregado.current) return;
    if (pularSaveDaCarga.current) {
      pularSaveDaCarga.current = false;
      return;
    }
    setSalvando('salvando');
    const t = setTimeout(() => {
      automations.salvar(id, montarGrafo())
        .then(() => setSalvando('salvo'))
        .catch(() => setSalvando('erro'));
    }, 700);
    return () => clearTimeout(t);
  }, [nodes, edges, id, montarGrafo]);

  // ---- drag & drop da paleta ----
  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const tipo = e.dataTransfer.getData('application/khub-no');
    if (!tipo || !rf || !wrapper.current) return;
    const m = meta(tipo);
    if (!m) return;

    const bounds = wrapper.current.getBoundingClientRect();
    const posicao = rf.project({ x: e.clientX - bounds.left, y: e.clientY - bounds.top });
    criarNo(tipo, posicao);
  }, [rf, meta]);

  /** Cria o nó já configurado e selecionado — e, quando veio do painel, já
   *  conectado ao último nó, para o usuário não precisar arrastar a linha. */
  const criarNo = useCallback((tipo: string, posicao?: { x: number; y: number }, ligarDe?: string) => {
    const m = meta(tipo);
    if (!m) return;
    const novoId = `n${rid()}`;
    const config = configPadrao(tipo);
    configs.current[novoId] = { config };

    const pos = posicao ?? proximaPosicao(ligarDe);
    setNodes((ns) => [...ns, {
      id: novoId, type: 'khub', position: pos,
      data: { tipo, nome: m.nome, categoria: m.categoria, resumo: resumir(tipo, config), ramos: ramosDoNo(tipo, config, m), provider: m.provider },
    }]);
    if (ligarDe) {
      setEdges((es) => addEdge({ source: ligarDe, target: novoId, sourceHandle: null, targetHandle: null, id: `e${rid()}`, animated: true, style: { stroke: 'var(--brand)', strokeWidth: 1.5 } }, es));
    }
    setSelecionado(novoId);
    setAdicionar(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, setNodes, setEdges]);

  /** Coloca o nó novo à direita do último — canvas não vira pilha no (0,0). */
  const proximaPosicao = (ligarDe?: string): { x: number; y: number } => {
    const ancora = ligarDe ? nodes.find((n) => n.id === ligarDe) : nodes[nodes.length - 1];
    if (!ancora) return { x: 80, y: 160 };
    return { x: ancora.position.x + 300, y: ancora.position.y };
  };

  const onConnect = useCallback((c: Connection) => {
    setEdges((es) => addEdge({ ...c, id: `e${rid()}`, animated: true, style: { stroke: 'var(--brand)', strokeWidth: 1.5 } }, es));
  }, [setEdges]);

  // ---- painel do nó ----
  const noSelecionado = useMemo(() => {
    const n = nodes.find((x) => x.id === selecionado);
    if (!n) return null;
    const m = meta(n.data.tipo);
    if (!m) return null;
    const c = configs.current[n.id] ?? { config: {} };
    return { no: { id: n.id, tipo: n.data.tipo, rotulo: c.rotulo, posicao: n.position, config: c.config, aoFalhar: c.aoFalhar } as NoGrafo, meta: m };
  }, [nodes, selecionado, meta]);

  const mudarConfig = (config: Record<string, unknown>, extra?: { rotulo?: string; aoFalhar?: 'parar' | 'seguir' }) => {
    if (!selecionado) return;
    const atual = configs.current[selecionado] ?? { config: {} };
    configs.current[selecionado] = { config, rotulo: extra?.rotulo ?? atual.rotulo, aoFalhar: extra?.aoFalhar ?? atual.aoFalhar };
    setNodes((ns) => ns.map((n) => {
      if (n.id !== selecionado) return n;
      const m = meta(n.data.tipo);
      return {
        ...n,
        data: {
          ...n.data,
          nome: configs.current[selecionado].rotulo || m?.nome || n.data.tipo,
          resumo: resumir(n.data.tipo, config),
          ramos: ramosDoNo(n.data.tipo, config, m),
        },
      };
    }));
  };

  const excluirNo = () => {
    if (!selecionado) return;
    setNodes((ns) => ns.filter((n) => n.id !== selecionado));
    setEdges((es) => es.filter((e) => e.source !== selecionado && e.target !== selecionado));
    delete configs.current[selecionado];
    setSelecionado(null);
  };

  // ---- testar ----
  // O teste roda o RASCUNHO (Q1.3): grava o canvas antes, senão a última edição
  // ainda estaria no debounce do autosave e o teste rodaria a versão anterior.
  const abrirTeste = async () => {
    setAviso('');
    try {
      await automations.salvar(id, montarGrafo());
      setSalvando('salvo');
      setTestando(true);
    } catch {
      setSalvando('erro');
      setAviso('Não consegui salvar o rascunho para testar. Tente de novo.');
    }
  };

  // ---- publicar ----
  const publicar = async () => {
    setAviso('');
    try {
      await automations.salvar(id, montarGrafo());
      const r = await automations.publicar(id);
      setProblemas([]);
      setStatus('ativo');
      setVersaoAtiva(r.versao);
      setAviso(`Publicado: versão ${r.versao} no ar.`);
    } catch (e) {
      const corpo = e instanceof ApiError ? (e.body as { problemas?: Problema[] }) : null;
      if (corpo?.problemas) {
        setProblemas(corpo.problemas);
        setAviso('Corrija os problemas antes de publicar.');
      } else {
        setAviso('Não consegui publicar.');
      }
    }
  };

  const alternarStatus = async () => {
    const novo = status === 'ativo' ? 'pausado' : 'ativo';
    try { await automations.status(id, novo); setStatus(novo); } catch { setAviso('Publique o workflow antes de ativar.'); }
  };

  // marca no canvas os nós com problema
  useEffect(() => {
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, problema: problemas.find((p) => p.noId === n.id)?.problema } })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemas]);

  const temGatilho = nodes.some((n) => n.data.categoria === 'gatilho');
  const paleta = (cat: string) => catalogo.filter((c) => c.categoria === cat);
  /** Liga o nó novo no que está selecionado ou, na falta, no último criado. */
  const ultimoNoId = (): string | undefined => selecionado ?? nodes[nodes.length - 1]?.id;

  // ---- tags ----
  const salvarTags = (proximas: string[]) => { setTags(proximas); automations.renomear(id, { tags: proximas }).catch(() => undefined); };
  const addTag = () => {
    const t = novaTag.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 24);
    if (t && !tags.includes(t)) salvarTags([...tags, t]);
    setNovaTag('');
  };
  const removeTag = (t: string) => salvarTags(tags.filter((x) => x !== t));

  return (
    // Popup em tela cheia: cobre a sidebar/ilha do app. Fecha voltando à lista.
    <div className="fixed inset-0 z-[70] flex flex-col bg-bg">
      {/* Ilha central — o cristal é o "centro de opções" (abre o menu) */}
      <div className="relative z-30 flex justify-center pt-3">
        <div
          className="glass crystal-edge flex items-center gap-5 rounded-[1.7rem] px-5 py-2"
          style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,.4), 0 0 0 1px color-mix(in srgb, var(--brand) 26%, transparent), 0 18px 44px -18px var(--glow)' }}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: status === 'ativo' ? '#10B981' : status === 'pausado' ? '#B7791F' : 'var(--muted)', boxShadow: status === 'ativo' ? '0 0 8px #10B981' : undefined }} />
          <button onClick={() => setMenu((v) => !v)} className="crystal-logo grid place-items-center" aria-label="Menu do fluxo" aria-expanded={menu}>
            <Image src="/logo.png" alt="Opções" width={44} height={44} unoptimized className="h-11 w-11 object-contain" />
          </button>
          <button onClick={() => setMenu((v) => !v)} className="grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:text-brand" aria-label="Mais opções">
            <Icon name="dots" size={18} />
          </button>
        </div>

        {/* Popup do centro de opções */}
        {menu && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
            <div className="frost absolute top-[70px] z-30 w-60 rounded-2xl p-1.5" style={{ boxShadow: '0 24px 60px -18px var(--glow)' }}>
              {[
                { i: 'plus' as const, t: temGatilho ? 'Adicionar ação' : 'Adicionar gatilho', on: () => setAdicionar(temGatilho ? 'passo' : 'gatilho') },
                { i: 'check' as const, t: 'Publicar', on: publicar, destaque: true },
                { i: status === 'ativo' ? ('close' as const) : ('sparkles' as const), t: status === 'ativo' ? 'Pausar fluxo' : 'Ativar fluxo', on: alternarStatus },
                { i: 'settings' as const, t: 'Configurações do fluxo', on: () => { setMostrarConfig(true); setSelecionado(null); } },
              ].map((o) => (
                <button key={o.t} onClick={() => { o.on(); setMenu(false); }} className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-brand/10 ${o.destaque ? 'font-semibold text-brand' : 'text-fg'}`}>
                  <Icon name={o.i} size={16} className={o.destaque ? 'text-brand' : 'text-muted'} /> {o.t}
                </button>
              ))}
              <Link href={`/automacoes/${id}/execucoes`} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-fg transition-colors hover:bg-brand/10" onClick={() => setMenu(false)}>
                <Icon name="trend" size={16} className="text-muted" /> Ver execuções
              </Link>
            </div>
          </>
        )}
      </div>

      {/* Header do "window": KHUB + nome + tags | status/autosave + X */}
      <div className="z-10 -mt-5 shrink-0 px-3">
        <div
          className="glass mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-2.5 gap-y-2 rounded-[1.4rem] px-3.5 py-2"
          style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,.35), 0 0 0 1px color-mix(in srgb, var(--brand) 20%, transparent), 0 14px 40px -20px var(--glow)' }}
        >
          <span className="flex shrink-0 items-center gap-1.5 pr-0.5 text-xs font-bold tracking-[0.16em] text-fg">
            <span className="grid h-5 w-5 place-items-center rounded-md" style={{ boxShadow: 'inset 0 0 0 1px color-mix(in srgb,var(--brand) 40%,transparent)' }}><Icon name="dashboard" size={12} className="text-brand" /></span>
            KHUB
          </span>
          {/* Nome completo (ocupa o espaço livre) */}
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onBlur={() => automations.renomear(id, { nome }).catch(() => undefined)}
            placeholder="Nome da automação"
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold tracking-tight text-fg outline-none placeholder:text-muted"
          />

          {/* Direita: tags · salvo · configuração · publicar · fechar */}
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-brand/12 py-0.5 pl-2 pr-1 text-[11px] font-semibold text-brand">
                  #{t}
                  <button onClick={() => removeTag(t)} className="grid h-4 w-4 place-items-center rounded-full hover:bg-brand/20" aria-label={`Remover ${t}`}><Icon name="close" size={11} /></button>
                </span>
              ))}
              <input value={novaTag} onChange={(e) => setNovaTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} onBlur={addTag} placeholder="+ tag" className="w-14 bg-transparent text-[11px] text-fg outline-none placeholder:text-muted" />
            </div>
            <span className="text-[11px] text-muted">{salvando === 'salvando' ? 'salvando…' : salvando === 'erro' ? '⚠ não salvou' : '✓ salvo'}</span>
            <button
              onClick={() => { setMostrarConfig((v) => !v); setSelecionado(null); }}
              className={`grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-white/40 dark:hover:bg-white/10 ${mostrarConfig ? 'text-brand' : 'text-muted'}`}
              title="Configuração da automação" aria-label="Configuração"
            >
              <Icon name="settings" size={17} />
            </button>
            <button
              type="button"
              onClick={abrirTeste}
              className="btn btn-soft btn-sm"
              title="Rodar o fluxo com um contato de teste, sem esperar o gatilho"
            >
              <Icon name="play" size={15} /> Testar
            </button>
            <Button onClick={publicar} className="!px-3.5 text-sm"><Icon name="check" size={15} /> Publicar</Button>
            <Link href="/automacoes" className="grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-white/40 hover:text-fg dark:hover:bg-white/10" aria-label="Fechar editor"><Icon name="close" size={18} /></Link>
          </div>
        </div>
      </div>

      {aviso && (
        <div className="border-b border-line bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
          {aviso}
          {problemas.length > 0 && (
            <ul className="mt-1 list-inside list-disc">
              {problemas.map((p, i) => <li key={i}>{p.problema}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 p-3 pt-0">
        {/* Paleta — painel acrílico arredontado, arraste para o canvas */}
        <aside className="glass crystal-edge flex w-60 shrink-0 flex-col overflow-hidden rounded-3xl">
          <p className="px-4 pb-2 pt-4 text-[11px] text-muted">Arraste um nó para o canvas.</p>
          <div className="flex-1 space-y-4 overflow-y-auto px-3 pb-3 scrollbar-thin">
            {(['gatilho', 'controle', 'acao'] as const).map((cat) => (
              <div key={cat}>
                <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: ACENTO[cat] }}>
                  {cat === 'gatilho' ? 'Gatilhos' : cat === 'controle' ? 'Controle' : 'Ações'}
                </p>
                <div className="space-y-1">
                  {paleta(cat).map((m) => (
                    <div
                      key={m.tipo}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData('application/khub-no', m.tipo); e.dataTransfer.effectAllowed = 'move'; }}
                      title={m.descricao}
                      className="group flex cursor-grab items-center gap-2.5 rounded-xl border border-line/60 bg-surface/50 px-2.5 py-2 text-xs font-medium text-fg transition hover:border-brand/50 hover:bg-brand/5 active:cursor-grabbing"
                    >
                      <span
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                        style={{
                          color: ACENTO[cat],
                          background: `color-mix(in srgb, ${ACENTO[cat]} 13%, transparent)`,
                          boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${ACENTO[cat]} 30%, transparent)`,
                        }}
                      >
                        <Icon name={ICONE[m.tipo] ?? 'sparkles'} size={14} />
                      </span>
                      <span className="truncate">{m.nome}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Canvas */}
        <div ref={wrapper} className="relative min-w-0 flex-1" onDrop={onDrop} onDragOver={onDragOver}>
          {/* Adicionar — flutuante no canto (como no mockup) */}
          <button
            onClick={() => setAdicionar(temGatilho ? 'passo' : 'gatilho')}
            className="btn btn-primary absolute right-4 top-4 z-10 !gap-1.5 !rounded-full !px-3.5 !py-1.5 !text-xs font-semibold"
          >
            <Icon name="plus" size={14} /> Adicionar
          </button>

          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setRf}
            nodeTypes={tiposNo}
            onNodeClick={(_, n) => setSelecionado(n.id)}
            onPaneClick={() => setSelecionado(null)}
            fitView
            proOptions={{ hideAttribution: false }}
            defaultEdgeOptions={{ animated: true, style: { stroke: 'var(--brand)', strokeWidth: 2 } }}
            connectionLineStyle={{ stroke: 'var(--brand)', strokeWidth: 2 }}
          >
            <Background gap={18} size={1.4} color="color-mix(in srgb, var(--brand) 22%, transparent)" />
            {/* zoom in/out + fit to screen vêm daqui; minimap para fluxo grande */}
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!bg-surface2" nodeColor={() => 'var(--brand)'} />
          </ReactFlow>

          {/* Canvas vazio não pode ser uma tela em branco: ele ensina o começo. */}
          {carregado.current && nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="pointer-events-auto max-w-sm text-center">
                <div className="text-3xl">⚡</div>
                <p className="mt-2 font-bold text-fg">Todo fluxo começa com um gatilho</p>
                <p className="mx-auto mt-1 text-sm text-muted">
                  O gatilho é o “quando”: contato novo, mensagem no WhatsApp, negócio mudando de etapa.
                  Depois você encaixa as ações.
                </p>
                <Button className="mt-4" onClick={() => setAdicionar('gatilho')}>
                  <Icon name="plus" size={15} /> Escolher um gatilho
                </Button>
                <p className="mt-2 text-[11px] text-muted">ou arraste um da paleta à esquerda</p>
              </div>
            </div>
          )}
        </div>

        {/* Painel do nó */}
        {noSelecionado && (
          <PainelNo
            no={noSelecionado.no}
            meta={noSelecionado.meta}
            onMudar={mudarConfig}
            onExcluir={excluirNo}
            onFechar={() => setSelecionado(null)}
            outrosNos={nodes.filter((n) => n.id !== selecionado).map((n) => ({ id: n.id, rotulo: n.data.nome }))}
            outrosFluxos={fluxos.map((f) => ({ id: f.id, nome: f.nome }))}
          />
        )}

        {/* Configurações do fluxo (fora do canvas) */}
        {mostrarConfig && config && (
          <PainelConfig
            config={config}
            webhookUrl={webhookUrl}
            temGatilhoWebhook={nodes.some((n) => n.data.tipo === 'gatilho.webhook')}
            onSalvar={async (patch) => {
              await automations.configurar(id, patch);
              setConfig((c) => (c ? { ...c, ...patch } : c));
            }}
            onGerarWebhook={async () => {
              const r = await automations.gerarWebhook(id);
              setWebhookUrl(r.url);
            }}
            onFechar={() => setMostrarConfig(false)}
          />
        )}

        {/* Teste com contato real: o run aparece passo a passo no modal */}
        {testando && (
          <TestarAutomacao
            workflowId={id}
            rotulos={Object.fromEntries(nodes.map((n) => [n.id, configs.current[n.id]?.rotulo ?? n.data.nome]))}
            onFechar={() => setTestando(false)}
          />
        )}

        {/* Painel "Adicionar" com busca (o jeito rápido; a paleta continua para arrastar) */}
        {adicionar && (
          <PainelAdicionar
            catalogo={catalogo}
            modo={adicionar}
            onEscolher={(tipo) => criarNo(tipo, undefined, adicionar === 'passo' ? ultimoNoId() : undefined)}
            onFechar={() => setAdicionar(null)}
          />
        )}
      </div>
    </div>
  );
}

export default function EditorPage() {
  return (
    <ReactFlowProvider>
      <EditorInterno />
    </ReactFlowProvider>
  );
}
