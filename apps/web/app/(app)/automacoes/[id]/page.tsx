'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
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
import { cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Button, Confirm, Menu, SkeletonLines, Tooltip, useToast, type MenuEntry } from '@/components/kit';
import { ErrorState } from '@/components/revenue/States';
import { NoCanvas, type DadosNo } from '@/components/automations/NoCanvas';
import { PainelNo } from '@/components/automations/PainelNo';
import { configPadraoMotor, ramosMotor, resumirMotor } from '@/lib/automations-motor';
import { PainelAdicionar } from '@/components/automations/PainelAdicionar';
import { TestarAutomacao } from '@/components/automations/TestarAutomacao';
import { ModoSimples } from '@/components/automations/ModoSimples';
import { ArestaInserir } from '@/components/automations/editor/ArestaInserir';
import { NoNota, type DadosNota } from '@/components/automations/editor/NoNota';
import { NoAdicionarGatilho, TIPO_ADICIONAR_GATILHO } from '@/components/automations/editor/NoAdicionarGatilho';
import { PaletaNos, MIME_NO, MIME_NOTA } from '@/components/automations/editor/PaletaNos';
import { ConfigFluxo } from '@/components/automations/editor/ConfigFluxo';
import { HistoricoVersoes } from '@/components/automations/editor/HistoricoVersoes';
import { MoverParaPasta } from '@/components/automations/editor/MoverParaPasta';
import { AjudaAtalhos } from '@/components/automations/editor/AjudaAtalhos';
import { EditorProvider } from '@/components/automations/editor/contexto';
import {
  automations,
  type ConfigWorkflow, type EstatisticasFluxo, type Grafo, type MetaNo, type NoGrafo, type NotaGrafo,
  type Problema, type Ramo, type VersaoDetalhe, type VersaoResumo, type WorkflowResumo,
} from '@/lib/automations';
import {
  ALTURA_LINHA, PASSO_COLUNA, colar, comandoDaTecla, desfazer, excluir, inserirEntre, novoHistorico,
  organizarHorizontal, pareceVertical, primeiroPasso, recortar, refazer, registrar, type Comando, type Recorte,
} from '@/lib/automations-editor';
import { ApiError } from '@/lib/api-error';

const tiposNo = { khub: NoCanvas, nota: NoNota, [TIPO_ADICIONAR_GATILHO]: NoAdicionarGatilho };
const tiposAresta = { khub: ArestaInserir };
const ehGatilhoTipo = (tipo: string) => tipo.startsWith('gatilho.');
const rid = () => Math.random().toString(36).slice(2, 9);

/** Resumo mostrado no card do canvas — o usuário entende o fluxo sem abrir cada nó. */
function resumir(tipo: string, cfg: Record<string, any>): string {
  const motor = resumirMotor(tipo, cfg); // Q3.1/Q3.2
  if (motor !== undefined) return motor;
  switch (tipo) {
    case 'gatilho.contato_criado': return cfg.origem ? `origem: ${cfg.origem}` : 'qualquer contato novo';
    case 'gatilho.etapa_mudou': return cfg.stageId ? 'etapa específica' : 'qualquer etapa';
    case 'gatilho.mensagem_recebida': return cfg.contem ? `contém "${cfg.contem}"` : 'qualquer mensagem recebida';
    case 'gatilho.tag_adicionada': return cfg.tag ? `tag "${cfg.tag}"` : 'defina a tag';
    case 'gatilho.negocio_criado': return cfg.stageId ? 'etapa específica' : 'qualquer oportunidade nova';
    case 'gatilho.webhook': return `identifica por ${cfg.identificarPor ?? 'email'}`;
    case 'gatilho.negocio_status': return cfg.status ? `quando ${cfg.status}` : 'ganho ou perdido';
    case 'gatilho.agendamento_criado':
    case 'gatilho.agendamento_confirmado':
    case 'gatilho.faltou':
    case 'gatilho.agendamento_cancelado':
    case 'gatilho.lembrete_agendamento':
      return [cfg.tipo ? `tipo ${cfg.tipo}` : '', cfg.responsavelId ? 'responsável específico' : ''].filter(Boolean).join(' · ') || 'qualquer compromisso';
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
    case 'acao.pedir_avaliacao': return `por ${cfg.canal === 'email' ? 'e-mail' : 'WhatsApp'}`;
    default: return '';
  }
}

/** Saídas do nó: fixas (esperar resposta) ou definidas pelo usuário (If/Else). */
function ramosDoNo(tipo: string, cfg: Record<string, any>, m?: MetaNo): Ramo[] | undefined {
  const motor = ramosMotor(tipo, cfg); // "Esperar até": duas saídas só no modo evento
  if (motor !== undefined) return motor ?? undefined;
  if (m?.ramosFixos) return m.ramosFixos.map((r) => ({ id: r.id, rotulo: r.rotulo, juncao: 'AND' as const, regras: [] }));
  if (tipo === 'controle.condicao') return (cfg.ramos ?? []) as Ramo[];
  // split: o canvas só precisa de id+rótulo por saída (o peso mora na config)
  if (tipo === 'controle.split') return (cfg.ramos ?? []).map((r: { id: string; rotulo?: string }) => ({ id: r.id, rotulo: r.rotulo ?? 'Variante', juncao: 'AND' as const, regras: [] }));
  return undefined;
}

/** Config inicial de cada tipo: o nó nasce utilizável, não vazio. */
function configPadrao(tipo: string): Record<string, unknown> {
  const motor = configPadraoMotor(tipo); // Q3.1/Q3.2
  if (motor) return motor;
  switch (tipo) {
    case 'controle.esperar': return { duracao: 10, unidade: 'minutos' };
    case 'controle.esperar_resposta': return { duracao: 1, unidade: 'dias' };
    case 'controle.condicao': return { ramos: [{ id: rid(), rotulo: 'Ramo 1', juncao: 'AND', regras: [] }] };
    case 'controle.split': return { ramos: [{ id: rid(), rotulo: 'Variante A', peso: 1 }, { id: rid(), rotulo: 'Variante B', peso: 1 }] };
    case 'controle.drip': return { porJanela: 50, janela: 'hora' };
    case 'acao.criar_tarefa': return { titulo: '', prioridade: 'media', emDias: 0 };
    case 'gatilho.webhook': return { identificarPor: 'email', campo: 'email', seNaoAchar: 'criar' };
    case 'acao.webhook': return { metodo: 'POST' };
    case 'acao.pedir_avaliacao': return { canal: 'whatsapp' };
    default: return {};
  }
}

type CfgNo = { config: Record<string, unknown>; rotulo?: string; aoFalhar?: 'parar' | 'seguir' };
type NoRF = Node<DadosNo | DadosNota>;
const ehNota = (n: Node): n is Node<DadosNota> => n.type === 'nota';
/** Só nós `khub` são passos do fluxo ("+ Adicionar gatilho" é interface e nunca vai para o grafo). */
const ehPasso = (n: Node): n is Node<DadosNo> => n.type === 'khub';

/** Organiza na horizontal (estilo GHL) usando a ordem de saídas declarada por cada nó. */
function organizarComCatalogo(g: Grafo, cat: MetaNo[]): Grafo {
  return organizarHorizontal(g, {
    ordemRamos: (noId) => {
      const n = g.nos.find((x) => x.id === noId);
      return n ? (ramosDoNo(n.tipo, n.config, cat.find((c) => c.tipo === n.tipo)) ?? []).map((r) => r.id) : [];
    },
  });
}
/** Fluxo salvo no layout antigo (de cima para baixo) abre já na horizontal; só grava quando a pessoa mexer. */
const naHorizontal = (g: Grafo, cat: MetaNo[]): Grafo => (pareceVertical(g) ? organizarComCatalogo(g, cat) : g);

/** Área de transferência do editor: vive no módulo, então cola também em OUTRO fluxo da mesma aba. */
let areaTransferencia: Recorte | null = null;

const STATUS_FLUXO: Record<string, { rotulo: string; classe: string }> = {
  rascunho: { rotulo: 'Rascunho', classe: '' },
  ativo: { rotulo: 'Publicado', classe: 'pill-success' },
  pausado: { rotulo: 'Pausado', classe: 'pill-warning' },
};

/** Canvas → grafo da API. Notas vão para `notas`, nunca para `nos` (o motor as ignora). */
function grafoDe(nodes: NoRF[], edges: Edge[], cfgs: Record<string, CfgNo>): Grafo {
  return {
    nos: nodes.filter(ehPasso).map((n) => ({
      id: n.id,
      tipo: n.data.tipo,
      rotulo: cfgs[n.id]?.rotulo,
      posicao: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      config: cfgs[n.id]?.config ?? {},
      aoFalhar: cfgs[n.id]?.aoFalhar,
    })),
    arestas: edges.map((e) => ({ id: e.id, de: e.source, para: e.target, ramo: e.sourceHandle ?? undefined })),
    notas: nodes.filter(ehNota).map((n) => ({
      id: n.id,
      texto: n.data.texto,
      posicao: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      ...(n.data.tom && n.data.tom !== 'neutro' ? { tom: n.data.tom } : {}),
    })),
  };
}

const paraEdge = (a: { id: string; de: string; para: string; ramo?: string }): Edge => ({
  id: a.id, source: a.de, target: a.para, sourceHandle: a.ramo ?? null, type: 'khub',
});

function EditorInterno() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [catalogo, setCatalogo] = useState<MetaNo[]>([]);
  const [nome, setNome] = useState('');
  const nomeSalvo = useRef('');
  const [status, setStatus] = useState('rascunho');
  const [versaoAtiva, setVersaoAtiva] = useState<number | null>(null);
  const [naoPublicado, setNaoPublicado] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [pasta, setPasta] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<DadosNo | DadosNota>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [problemas, setProblemas] = useState<Problema[]>([]);
  const [salvando, setSalvando] = useState<'salvo' | 'salvando' | 'erro'>('salvo');
  const [pronto, setPronto] = useState(false);
  const [erroCarga, setErroCarga] = useState(false);
  const [rf, setRf] = useState<ReactFlowInstance | null>(null);
  const [adicionar, setAdicionar] = useState<null | { modo: 'gatilho' | 'passo'; arestaId?: string }>(null);
  const [painel, setPainel] = useState<null | 'config' | 'versoes' | 'ajuda' | 'pasta'>(null);
  const [confirmarExcluir, setConfirmarExcluir] = useState(false);
  const [restaurando, setRestaurando] = useState<VersaoResumo | null>(null);
  const [ocupado, setOcupado] = useState<null | 'validar' | 'publicar' | 'status' | 'excluir' | 'duplicar' | 'restaurar' | 'testar'>(null);
  const [testando, setTestando] = useState(false);
  // Simples: conversa com a NICO. Avançado: o canvas. `?modo=simples` abre direto na conversa.
  const parametros = useSearchParams();
  const [modo, setModo] = useState<'simples' | 'avancado'>(parametros?.get('modo') === 'simples' ? 'simples' : 'avancado');
  const [config, setConfig] = useState<ConfigWorkflow | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [webhookAssinado, setWebhookAssinado] = useState(false);
  const [fluxos, setFluxos] = useState<WorkflowResumo[]>([]);
  const [paletaAberta, setPaletaAberta] = useState(true);
  const [periodo, setPeriodo] = useState<'off' | '7' | '30'>('off');
  const [stats, setStats] = useState<EstatisticasFluxo | null>(null);
  const [leitura, setLeitura] = useState<VersaoDetalhe | null>(null);
  const [revisaoVersoes, setRevisaoVersoes] = useState(0);
  const [historico, setHistorico] = useState(() => novoHistorico<Grafo>());
  const wrapper = useRef<HTMLDivElement>(null);
  // configs vivem fora do node.data (o canvas só mostra o resumo)
  const configs = useRef<Record<string, CfgNo>>({});
  /** Assinatura do último grafo salvo. `null` = adotar o próximo como base sem salvar (carga/restauração). */
  const ultimoSalvo = useRef<string | null>(null);
  const rascunhoGuardado = useRef<Grafo | null>(null);
  const colagens = useRef(0);

  const meta = useCallback((tipo: string) => catalogo.find((c) => c.tipo === tipo), [catalogo]);
  const somenteLeitura = leitura !== null;

  const paraNode = useCallback((n: NoGrafo, cat: MetaNo[], selecionar?: Set<string>): NoRF => {
    const m = cat.find((c) => c.tipo === n.tipo);
    return {
      id: n.id,
      type: 'khub',
      position: n.posicao,
      selected: selecionar?.has(n.id) ?? false,
      data: {
        tipo: n.tipo,
        nome: n.rotulo || m?.nome || n.tipo,
        categoria: m?.categoria ?? 'acao',
        resumo: resumir(n.tipo, n.config),
        ramos: ramosDoNo(n.tipo, n.config, m),
        provider: m?.provider,
        config: n.config,
        descricao: m?.descricao,
      },
    };
  }, []);
  const paraNota = (n: NotaGrafo, selecionar?: Set<string>): NoRF => ({
    id: n.id, type: 'nota', position: n.posicao, selected: selecionar?.has(n.id) ?? false,
    data: { texto: n.texto, tom: n.tom },
  });

  /** Põe um grafo inteiro no canvas (carga, desfazer, colar, organizar, versão). */
  const aplicarGrafo = useCallback((g: Grafo, cat: MetaNo[], selecionar?: Set<string>) => {
    // Configs ANTES de setNodes: o autosave serializa configs.current quando
    // `nodes` muda. Ordem errada aqui apagava a config de todos os nós ao
    // ABRIR o editor (bug que destruiu fluxos importados).
    const novas: Record<string, CfgNo> = {};
    for (const n of g.nos) novas[n.id] = { config: n.config, rotulo: n.rotulo, aoFalhar: n.aoFalhar };
    configs.current = novas;
    setNodes([...g.nos.map((n) => paraNode(n, cat, selecionar)), ...(g.notas ?? []).map((n) => paraNota(n, selecionar))]);
    setEdges(g.arestas.map(paraEdge));
  }, [paraNode, setNodes, setEdges]);

  // ---- carga ----
  const carregar = useCallback(() => {
    setErroCarga(false);
    Promise.all([automations.catalogo(), automations.obter(id)])
      .then(([cat, wf]) => {
        setCatalogo(cat);
        setNome(wf.nome);
        nomeSalvo.current = wf.nome;
        setStatus(wf.status);
        setVersaoAtiva(wf.versaoAtiva);
        setNaoPublicado(wf.temRascunho && wf.versaoAtiva !== null);
        setTags(wf.tags ?? []);
        setPasta(wf.pasta ?? null);
        setConfig(wf.config);
        setWebhookUrl(wf.webhookUrl);
        setWebhookAssinado(!!wf.webhookAssinado);
        ultimoSalvo.current = null;
        aplicarGrafo(naHorizontal(wf.grafo, cat), cat);
        setPronto(true);
      })
      .catch(() => setErroCarga(true));
    automations.listar().then((l) => setFluxos(l.filter((f) => f.id !== id))).catch(() => setFluxos([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { carregar(); }, [carregar]);
  // Enquadra o fluxo uma vez, quando o grafo e o React Flow estão prontos.
  const enquadrado = useRef(false);
  useEffect(() => {
    if (!pronto || !rf || enquadrado.current) return;
    enquadrado.current = true;
    setTimeout(() => rf.fitView({ padding: 0.1, maxZoom: 1 }), 50);
  }, [pronto, rf]);

  // paleta: aberta em tela larga, recolhida em tela estreita; a preferência fica no navegador
  useEffect(() => {
    try {
      const pref = localStorage.getItem('khub:paleta');
      setPaletaAberta(pref ? pref === 'aberta' : window.matchMedia('(min-width: 1280px)').matches);
    } catch {
      setPaletaAberta(true);
    }
  }, []);
  const alternarPaleta = () => setPaletaAberta((v) => {
    try { localStorage.setItem('khub:paleta', v ? 'recolhida' : 'aberta'); } catch { /* armazenamento bloqueado */ }
    return !v;
  });

  const montarGrafo = useCallback((): Grafo => grafoDe(nodes, edges, configs.current), [nodes, edges]);
  const assinatura = useMemo(() => JSON.stringify(montarGrafo()), [montarGrafo]);

  // ---- autosave (rascunho; nunca toca na versão publicada) ----
  // Compara a assinatura do grafo: selecionar ou medir nó não grava nada.
  useEffect(() => {
    if (!pronto || somenteLeitura) return;
    if (ultimoSalvo.current === null) {
      ultimoSalvo.current = assinatura;
      return;
    }
    if (ultimoSalvo.current === assinatura) return;
    setSalvando('salvando');
    const t = setTimeout(() => {
      const enviado = assinatura;
      automations.salvar(id, JSON.parse(enviado) as Grafo)
        .then(() => {
          ultimoSalvo.current = enviado;
          setSalvando('salvo');
          setNaoPublicado(true);
        })
        .catch(() => setSalvando('erro'));
    }, 700);
    return () => clearTimeout(t);
  }, [assinatura, id, pronto, somenteLeitura]);

  /** Grava já (antes de testar, publicar, validar, duplicar). */
  const salvarAgora = useCallback(async () => {
    const g = montarGrafo();
    await automations.salvar(id, g);
    const s = JSON.stringify(g);
    if (ultimoSalvo.current !== s) setNaoPublicado(true);
    ultimoSalvo.current = s;
    setSalvando('salvo');
  }, [id, montarGrafo]);

  // ---- desfazer / refazer ----
  const registrarAntes = useCallback((chave?: string) => {
    if (somenteLeitura) return;
    const antes = montarGrafo();
    setHistorico((h) => registrar(h, antes, { chave }));
  }, [montarGrafo, somenteLeitura]);

  const desfazerAcao = () => {
    const r = desfazer(historico, montarGrafo());
    if (!r) return;
    setHistorico(r.historico);
    aplicarGrafo(r.estado, catalogo);
    setSelecionado(null);
  };
  const refazerAcao = () => {
    const r = refazer(historico, montarGrafo());
    if (!r) return;
    setHistorico(r.historico);
    aplicarGrafo(r.estado, catalogo);
    setSelecionado(null);
  };

  /** Aplica uma mudança estrutural (função pura de `lib/automations-editor`) com passo no desfazer. */
  const mudarGrafo = (fn: (g: Grafo) => Grafo, selecionar?: string[]) => {
    if (somenteLeitura) return;
    const atual = montarGrafo();
    const novo = fn(atual);
    if (novo === atual) return;
    setHistorico((h) => registrar(h, atual));
    aplicarGrafo(novo, catalogo, selecionar ? new Set(selecionar) : undefined);
  };

  // ---- criar / inserir ----
  const novoNo = (tipo: string, posicao: { x: number; y: number }): { no: NoGrafo; ramos: string[] } | null => {
    const m = meta(tipo);
    if (!m) return null;
    const config = configPadrao(tipo);
    return { no: { id: `n${rid()}`, tipo, posicao, config }, ramos: (ramosDoNo(tipo, config, m) ?? []).map((r) => r.id) };
  };

  /**
   * Cria o nó já configurado e selecionado. Vindo do "Adicionar"/paleta, encaixa
   * depois do nó selecionado (ou do último): usa uma saída livre; se a saída já
   * leva a outro nó, insere no meio, sem deixar dois caminhos saindo do mesmo ponto.
   */
  const criarNo = (tipo: string, opts: { posicao?: { x: number; y: number }; ligarDe?: string; arestaId?: string } = {}) => {
    const criado = novoNo(tipo, opts.posicao ?? { x: 80, y: 80 });
    if (!criado) return;
    const { no, ramos } = criado;
    const gerarId = () => `e${rid()}`;
    mudarGrafo((g) => {
      if (opts.arestaId) return inserirEntre(g, opts.arestaId, no, { gerarId, ramosDoNovo: ramos, eixo: 'x' });
      if (ehGatilhoTipo(tipo)) {
        // Gatilho novo (estilo GHL): entra na coluna de gatilhos, embaixo do
        // último, e já leva ao MESMO primeiro passo dos outros gatilhos.
        const gatilhos = g.nos.filter((n) => ehGatilhoTipo(n.tipo));
        const alvo = primeiroPasso(g);
        const alvoNo = alvo ? g.nos.find((n) => n.id === alvo) : undefined;
        const posicao = opts.posicao ?? (gatilhos.length
          ? { x: Math.min(...gatilhos.map((n) => n.posicao.x)), y: Math.max(...gatilhos.map((n) => n.posicao.y)) + ALTURA_LINHA }
          : alvoNo
            ? { x: alvoNo.posicao.x - PASSO_COLUNA, y: alvoNo.posicao.y }
            : { x: 0, y: 0 });
        return {
          ...g,
          nos: [...g.nos, { ...no, posicao }],
          arestas: alvo ? [...g.arestas, { id: gerarId(), de: no.id, para: alvo }] : g.arestas,
        };
      }
      const ancora = opts.ligarDe ? g.nos.find((n) => n.id === opts.ligarDe) : undefined;
      if (!ancora) {
        if (opts.posicao) return { ...g, nos: [...g.nos, no] };
        // sem âncora: à direita de tudo, na altura do primeiro nó
        const posicao = g.nos.length
          ? { x: Math.max(...g.nos.map((n) => n.posicao.x)) + PASSO_COLUNA, y: g.nos[0].posicao.y }
          : { x: 0, y: 0 };
        return { ...g, nos: [...g.nos, { ...no, posicao }] };
      }
      const saidasAncora = ramosDoNo(ancora.tipo, ancora.config, meta(ancora.tipo))?.map((r) => r.id);
      const livres = saidasAncora ? saidasAncora.filter((r) => !g.arestas.some((a) => a.de === ancora.id && a.ramo === r)) : g.arestas.some((a) => a.de === ancora.id && !a.ramo) ? [] : [null];
      // Na horizontal o próximo passo vai à direita; cada ramo livre numa linha própria.
      const indiceRamo = livres[0] && saidasAncora ? Math.max(0, saidasAncora.indexOf(livres[0])) : 0;
      const posDireita = { x: ancora.posicao.x + PASSO_COLUNA, y: ancora.posicao.y + indiceRamo * ALTURA_LINHA };
      if (livres.length) {
        const ramo = livres[0];
        return {
          ...g,
          nos: [...g.nos, { ...no, posicao: opts.posicao ?? posDireita }],
          arestas: [...g.arestas, { id: gerarId(), de: ancora.id, para: no.id, ...(ramo ? { ramo } : {}) }],
        };
      }
      const seguinte = g.arestas.find((a) => a.de === ancora.id && !a.ramo);
      if (seguinte && !saidasAncora) return inserirEntre(g, seguinte.id, no, { gerarId, ramosDoNovo: ramos, eixo: 'x' });
      return { ...g, nos: [...g.nos, { ...no, posicao: opts.posicao ?? { x: posDireita.x, y: posDireita.y + ALTURA_LINHA } }] };
    }, [no.id]);
    setSelecionado(no.id);
    setAdicionar(null);
  };

  const criarNota = (posicao?: { x: number; y: number }) => {
    if (somenteLeitura) return;
    let pos = posicao;
    if (!pos && rf && wrapper.current) {
      const r = wrapper.current.getBoundingClientRect();
      pos = rf.project({ x: r.width / 2 - 112, y: r.height / 2 - 40 });
    }
    const nota: NotaGrafo = { id: `nota${rid()}`, texto: '', posicao: pos ?? { x: 0, y: 0 } };
    mudarGrafo((g) => ({ ...g, notas: [...(g.notas ?? []), nota] }), [nota.id]);
  };

  const mudarNota = useCallback((notaId: string, patch: Partial<Pick<NotaGrafo, 'texto' | 'tom'>>) => {
    registrarAntes(`nota:${notaId}`);
    setNodes((ns) => ns.map((n) => (n.id === notaId && ehNota(n) ? { ...n, data: { ...n.data, ...patch } } : n)));
  }, [registrarAntes, setNodes]);

  const ctxEditor = useMemo(() => ({
    somenteLeitura,
    inserirNaAresta: (arestaId: string) => setAdicionar({ modo: 'passo', arestaId }),
    mudarNota,
    adicionarGatilho: () => setAdicionar({ modo: 'gatilho' }),
  }), [somenteLeitura, mudarNota]);

  // ---- drag & drop da paleta ----
  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!rf || !wrapper.current || somenteLeitura) return;
    const bounds = wrapper.current.getBoundingClientRect();
    const posicao = rf.project({ x: e.clientX - bounds.left, y: e.clientY - bounds.top });
    if (e.dataTransfer.getData(MIME_NOTA)) return criarNota(posicao);
    const tipo = e.dataTransfer.getData(MIME_NO);
    if (tipo) criarNo(tipo, { posicao });
  };

  const onConnect = useCallback((c: Connection) => {
    if (somenteLeitura || !c.source || !c.target) return;
    registrarAntes();
    setEdges((es) => addEdge({ ...c, id: `e${rid()}`, type: 'khub' }, es));
  }, [registrarAntes, setEdges, somenteLeitura]);

  // ---- seleção, copiar, colar, excluir ----
  const idsSelecionados = (): Set<string> => {
    const s = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
    if (!s.size && selecionado) s.add(selecionado);
    return s;
  };

  const copiar = () => {
    const ids = idsSelecionados();
    if (!ids.size) return;
    areaTransferencia = recortar(montarGrafo(), ids);
    colagens.current = 0;
    toast.info(`${ids.size} ${ids.size === 1 ? 'item copiado' : 'itens copiados'}.`, { description: 'Cole com Ctrl+V, aqui ou em outro fluxo.' });
  };
  const colarRecorte = (r: Recorte) => {
    colagens.current += 1;
    const d = 40 * colagens.current;
    const c = colar(r, (p) => `${p}${rid()}`, { x: d, y: d });
    mudarGrafo((g) => ({ ...g, nos: [...g.nos, ...c.nos], arestas: [...g.arestas, ...c.arestas], notas: [...(g.notas ?? []), ...c.notas] }), [...c.nos, ...c.notas].map((n) => n.id));
    setSelecionado(null);
  };
  const colarAcao = () => {
    if (areaTransferencia) colarRecorte(areaTransferencia);
  };
  const duplicarSelecao = () => {
    const ids = idsSelecionados();
    if (!ids.size) return;
    colagens.current = 0;
    colarRecorte(recortar(montarGrafo(), ids));
  };

  const excluirSelecao = (soEstes?: Set<string>) => {
    const ids = soEstes ?? idsSelecionados();
    const arestas = soEstes ? new Set<string>() : new Set(edges.filter((e) => e.selected).map((e) => e.id));
    if (!ids.size && !arestas.size) return;
    mudarGrafo((g) => {
      const semArestas = arestas.size ? { ...g, arestas: g.arestas.filter((a) => !arestas.has(a.id)) } : g;
      return ids.size ? excluir(semArestas, ids, () => `e${rid()}`) : semArestas;
    });
    setProblemas((ps) => ps.filter((p) => !p.noId || !ids.has(p.noId)));
    setSelecionado(null);
  };

  const organizar = () => {
    mudarGrafo((g) => organizarComCatalogo(g, catalogo));
    setTimeout(() => rf?.fitView({ padding: 0.1, duration: 400, maxZoom: 1 }), 60);
  };

  // ---- painel do nó ----
  const noSelecionado = useMemo(() => {
    if (somenteLeitura) return null;
    const n = nodes.find((x) => x.id === selecionado);
    if (!n || !ehPasso(n)) return null;
    const m = meta(n.data.tipo);
    if (!m) return null;
    const c = configs.current[n.id] ?? { config: {} };
    return { no: { id: n.id, tipo: n.data.tipo, rotulo: c.rotulo, posicao: n.position, config: c.config, aoFalhar: c.aoFalhar } as NoGrafo, meta: m };
  }, [nodes, selecionado, meta, somenteLeitura]);

  const mudarConfig = (config: Record<string, unknown>, extra?: { rotulo?: string; aoFalhar?: 'parar' | 'seguir' }) => {
    if (!selecionado || somenteLeitura) return;
    registrarAntes(`config:${selecionado}`);
    const atual = configs.current[selecionado] ?? { config: {} };
    configs.current = { ...configs.current, [selecionado]: { config, rotulo: extra?.rotulo ?? atual.rotulo, aoFalhar: extra?.aoFalhar ?? atual.aoFalhar } };
    setProblemas((ps) => ps.filter((p) => p.noId !== selecionado));
    setNodes((ns) => ns.map((n) => {
      if (n.id !== selecionado || !ehPasso(n)) return n;
      const m = meta(n.data.tipo);
      return {
        ...n,
        data: {
          ...n.data,
          nome: configs.current[selecionado].rotulo || m?.nome || n.data.tipo,
          resumo: resumir(n.data.tipo, config),
          ramos: ramosDoNo(n.data.tipo, config, m),
          config,
        },
      };
    }));
  };

  // ---- atalhos de teclado ----
  const executar = useRef<(c: Comando) => void>(() => undefined);
  executar.current = (c: Comando) => {
    if (c === 'ajuda') return setPainel('ajuda');
    if (c === 'copiar') return copiar();
    if (somenteLeitura) return;
    if (c === 'desfazer') desfazerAcao();
    else if (c === 'refazer') refazerAcao();
    else if (c === 'colar') colarAcao();
    else if (c === 'duplicar') duplicarSelecao();
    else if (c === 'excluir') excluirSelecao();
    else if (c === 'organizar') organizar();
    else if (c === 'nota') criarNota();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const alvo = e.target instanceof HTMLElement ? e.target : null;
      const emCampo = !!alvo && (alvo.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName));
      const noCanvas = !alvo || alvo === document.body || !!wrapper.current?.contains(alvo);
      if (!noCanvas || document.querySelector('[aria-modal="true"]')) return;
      const c = comandoDaTecla({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, emCampo });
      if (!c) return;
      e.preventDefault();
      executar.current(c);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- nome ----
  const salvarNome = async () => {
    const limpo = nome.trim();
    if (!limpo) { setNome(nomeSalvo.current); return; }
    if (limpo === nomeSalvo.current) return;
    try {
      await automations.renomear(id, { nome: limpo });
      nomeSalvo.current = limpo;
      setNome(limpo);
    } catch {
      setNome(nomeSalvo.current);
      toast.error('Não consegui renomear o fluxo.');
    }
  };

  // ---- validar / publicar / pausar / testar ----
  const focarProblema = (ps: Problema[]) => {
    const alvo = ps.find((p) => p.noId)?.noId;
    if (alvo && rf) rf.fitView({ nodes: [{ id: alvo }], padding: 0.6, duration: 400, maxZoom: 1.2 });
  };
  const validar = async () => {
    setOcupado('validar');
    try {
      await salvarAgora();
      const r = await automations.validar(id);
      setProblemas(r.problemas);
      if (r.ok) toast.success('Tudo certo: o fluxo pode ser publicado.');
      else {
        toast.error(`${r.problemas.length} ${r.problemas.length === 1 ? 'problema' : 'problemas'} para corrigir`, { description: r.problemas[0]?.problema });
        focarProblema(r.problemas);
      }
    } catch {
      toast.error('Não consegui validar agora.', { description: 'Tente de novo em instantes.' });
    } finally {
      setOcupado(null);
    }
  };

  const publicar = async () => {
    setOcupado('publicar');
    try {
      await salvarAgora();
      const r = await automations.publicar(id);
      setProblemas([]);
      setStatus('ativo');
      setVersaoAtiva(r.versao);
      setNaoPublicado(false);
      setRevisaoVersoes((x) => x + 1);
      toast.success(`Versão ${r.versao} publicada.`, { description: 'Novos contatos já entram nesta versão.' });
    } catch (e) {
      const corpo = e instanceof ApiError ? (e.body as { problemas?: Problema[] }) : null;
      if (corpo?.problemas?.length) {
        setProblemas(corpo.problemas);
        toast.error('Corrija os problemas antes de publicar.', { description: corpo.problemas[0]?.problema });
        focarProblema(corpo.problemas);
      } else {
        toast.error('Não consegui publicar.');
      }
    } finally {
      setOcupado(null);
    }
  };

  const alternarStatus = async () => {
    const novo = status === 'ativo' ? 'pausado' : 'ativo';
    setOcupado('status');
    try {
      await automations.status(id, novo);
      setStatus(novo);
      toast.success(novo === 'pausado' ? 'Fluxo pausado. Ninguém novo entra e quem está nele espera.' : 'Fluxo ativo de novo.');
    } catch {
      toast.error(novo === 'ativo' ? 'Publique o fluxo antes de ativar.' : 'Não consegui pausar o fluxo.');
    } finally {
      setOcupado(null);
    }
  };

  // O teste roda o RASCUNHO (Q1.3): grava o canvas antes, senão a última edição
  // ainda estaria no debounce do autosave e o teste rodaria a versão anterior.
  const abrirTeste = async () => {
    setOcupado('testar');
    try {
      await salvarAgora();
      setTestando(true);
    } catch {
      setSalvando('erro');
      toast.error('Não consegui salvar o rascunho para testar.', { description: 'Tente de novo.' });
    } finally {
      setOcupado(null);
    }
  };

  // ---- menu do fluxo ----
  const duplicarFluxo = async () => {
    setOcupado('duplicar');
    try {
      await salvarAgora();
      const r = await automations.duplicar(id);
      toast.success(`Cópia criada: ${r.nome}.`, { description: 'Ela nasce em rascunho, sem a URL de webhook do original.' });
      router.push(`/automacoes/${r.id}`);
    } catch {
      toast.error('Não consegui duplicar o fluxo.');
    } finally {
      setOcupado(null);
    }
  };

  const excluirFluxo = async () => {
    setOcupado('excluir');
    try {
      await automations.remover(id);
      toast.success('Fluxo excluído.');
      router.push('/automacoes');
    } catch {
      toast.error('Não consegui excluir o fluxo.');
      setOcupado(null);
    }
  };

  const moverPasta = async (destino: string | null) => {
    try {
      await automations.renomear(id, { pasta: destino });
      setPasta(destino);
      toast.success(destino ? `Movido para "${destino}".` : 'Fluxo fora de pasta.');
    } catch {
      toast.error('Não consegui mover o fluxo.');
      throw new Error('mover');
    }
  };

  const salvarTags = async (proximas: string[]) => {
    await automations.renomear(id, { tags: proximas });
    setTags(proximas);
  };

  // ---- versões ----
  const verVersao = async (v: VersaoResumo) => {
    try {
      const d = await automations.versao(id, v.id);
      if (!leitura) rascunhoGuardado.current = montarGrafo();
      setSelecionado(null);
      setAdicionar(null);
      setLeitura(d);
      aplicarGrafo(naHorizontal(d.grafo, catalogo), catalogo);
      setPainel(null);
      setTimeout(() => rf?.fitView({ padding: 0.1, duration: 300, maxZoom: 1 }), 60);
    } catch {
      toast.error('Não consegui abrir essa versão.');
    }
  };
  const voltarAoRascunho = () => {
    const g = rascunhoGuardado.current;
    rascunhoGuardado.current = null;
    setLeitura(null);
    if (g) aplicarGrafo(g, catalogo);
  };
  const restaurar = async () => {
    const v = restaurando;
    if (!v) return;
    setOcupado('restaurar');
    try {
      const d = leitura?.id === v.id ? leitura : await automations.versao(id, v.id);
      const rascunhoAtual = rascunhoGuardado.current ?? montarGrafo();
      await automations.rollback(id, v.id);
      await automations.salvar(id, d.grafo);
      rascunhoGuardado.current = null;
      setLeitura(null);
      setHistorico((h) => registrar(h, rascunhoAtual));
      ultimoSalvo.current = null;
      aplicarGrafo(d.grafo, catalogo);
      setStatus('ativo');
      setVersaoAtiva(v.versao);
      setNaoPublicado(false);
      setProblemas([]);
      setRevisaoVersoes((x) => x + 1);
      setRestaurando(null);
      toast.success(`Versão ${v.versao} restaurada e no ar.`, { description: 'O rascunho anterior fica no Desfazer (Ctrl+Z).' });
    } catch {
      toast.error('Não consegui restaurar essa versão.');
    } finally {
      setOcupado(null);
    }
  };

  // ---- estatísticas no canvas ----
  useEffect(() => {
    if (periodo === 'off') { setStats(null); return; }
    let vivo = true;
    const desde = new Date(Date.now() - Number(periodo) * 24 * 60 * 60 * 1000).toISOString();
    automations.stats(id, desde)
      .then((s) => vivo && setStats(s))
      .catch(() => { if (vivo) { setStats(null); toast.error('Não consegui carregar as estatísticas.'); } });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo, id]);

  // O canvas mostra os nós decorados (problema da validação + contagem do
  // período) sem gravar a decoração no estado que vai para o autosave.
  const nodesVisiveis = useMemo(() => {
    const decorados = nodes.map((n) => {
      if (!ehPasso(n)) return n;
      const problema = problemas.find((p) => p.noId === n.id)?.problema;
      const s = stats ? (stats.nos[n.id] ?? { concluidos: 0, esperando: 0, erros: 0 }) : undefined;
      if (!problema && !s && !n.data.problema && !n.data.stats) return n;
      return { ...n, data: { ...n.data, problema, stats: s } };
    });
    // "+ Adicionar gatilho" no pé da coluna de gatilhos (estilo GHL). É só
    // interface: fica fora de `nodes`, então nunca vai para o autosave.
    const gatilhos = nodes.filter((n) => ehPasso(n) && ehGatilhoTipo(n.data.tipo));
    if (somenteLeitura || !gatilhos.length) return decorados;
    const altura = (n: NoRF) => n.height ?? 90;
    const base = gatilhos.reduce((a, b) => (b.position.y + altura(b) > a.position.y + altura(a) ? b : a));
    const extra: NoRF = {
      id: '__adicionar_gatilho',
      type: TIPO_ADICIONAR_GATILHO,
      position: { x: Math.min(...gatilhos.map((n) => n.position.x)), y: base.position.y + altura(base) + 24 },
      data: {} as DadosNota,
      // Tamanho fixo: o nó vive fora de `nodes`, então a medição do React Flow
      // (onNodesChange 'dimensions') nunca volta para ele e ele ficava
      // `visibility: hidden` para sempre.
      width: 240,
      height: 46,
      draggable: false,
      selectable: false,
      connectable: false,
    };
    return [...decorados, extra];
  }, [nodes, problemas, stats, somenteLeitura]);

  const passos = nodes.filter(ehPasso);
  const temGatilho = passos.some((n) => n.data.categoria === 'gatilho');
  /** Liga o nó novo no que está selecionado ou, na falta, no último passo. */
  const ultimoNoId = (): string | undefined => (selecionado && passos.some((n) => n.id === selecionado) ? selecionado : passos[passos.length - 1]?.id);
  const pastas = Array.from(new Set(fluxos.map((f) => f.pasta).filter((p): p is string => !!p))).sort((a, b) => a.localeCompare(b));
  const problemasGerais = problemas.filter((p) => !p.noId);
  const st = STATUS_FLUXO[status] ?? STATUS_FLUXO.rascunho;

  if (erroCarga) {
    return (
      <div className="fixed inset-0 z-[45] grid place-items-center bg-bg p-6">
        <ErrorState title="Não consegui abrir este fluxo" description="Ele pode ter sido excluído, ou o servidor não respondeu." onRetry={carregar} />
        <Link href="/automacoes" className="btn btn-ghost btn-sm mt-2"><Icon name="arrowLeft" size={15} /> Voltar para Automações</Link>
      </div>
    );
  }

  const itensMenu: MenuEntry[] = [
    { id: 'dup', label: 'Duplicar fluxo', icon: 'copy', onSelect: () => void duplicarFluxo(), disabled: ocupado === 'duplicar' },
    { id: 'pasta', label: pasta ? `Mover de pasta (${pasta})` : 'Mover para pasta', textValue: 'Mover para pasta', icon: 'folder', onSelect: () => setPainel('pasta') },
    { id: 'versoes', label: 'Histórico de versões', icon: 'history', onSelect: () => setPainel('versoes') },
    { id: 'config', label: 'Configurações do fluxo', icon: 'settings', onSelect: () => setPainel('config') },
    { id: 'exec', label: 'Ver execuções', icon: 'trend', onSelect: () => router.push(`/automacoes/${id}/execucoes`) },
    { id: 'ajuda', label: 'Atalhos do teclado', icon: 'command', onSelect: () => setPainel('ajuda') },
    { type: 'separator', id: 's1' },
    { id: 'excluir', label: 'Excluir fluxo', icon: 'trash', danger: true, onSelect: () => setConfirmarExcluir(true) },
  ];

  return (
    // Ocupa a área de conteúdo (z entre a topbar e os menus/gavetas do kit).
    // No desktop a sidebar fica visível, recolhida no quadrado do KHUB
    // (76px + 12px de cada lado = 100px); no celular, tela cheia.
    <div className="fixed inset-y-0 left-0 right-0 z-[45] flex flex-col bg-bg lg:left-[100px]">
      {/* Barra superior */}
      <header className="shrink-0 px-3 pt-3">
        <div className="glass crystal-edge flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl px-3 py-2">
          <Link href="/automacoes" className="btn btn-ghost btn-sm shrink-0" aria-label="Voltar para a lista de automações">
            <Icon name="arrowLeft" size={15} /> <span className="hidden sm:inline">Automações</span>
          </Link>
          <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onBlur={() => void salvarNome()}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setNome(nomeSalvo.current); e.currentTarget.blur(); } }}
            placeholder="Nome da automação"
            aria-label="Nome da automação"
            maxLength={160}
            className="min-w-[140px] flex-1 rounded-lg bg-transparent px-1.5 py-1 text-base font-semibold tracking-tight text-fg outline-none placeholder:text-muted hover:bg-surface2 focus:bg-surface2"
          />
          <span className={cx('pill shrink-0', st.classe)}>
            {st.rotulo}{versaoAtiva ? <span className="tabular"> · v{versaoAtiva}</span> : null}
          </span>
          {naoPublicado && status !== 'rascunho' && <span className="hidden shrink-0 text-xs text-warning md:inline">Alterações não publicadas</span>}
          <span className="shrink-0 text-xs text-muted" role="status" aria-live="polite">
            {somenteLeitura ? 'Somente leitura' : salvando === 'salvando' ? 'Salvando…' : salvando === 'erro' ? (
              <button type="button" onClick={() => void salvarAgora().catch(() => setSalvando('erro'))} className="font-medium text-danger hover:underline">Não salvou. Tentar de novo</button>
            ) : 'Salvo'}
          </span>

          <div className="segbar shrink-0" role="group" aria-label="Modo do editor">
            <button type="button" className="seg" aria-pressed={modo === 'simples'} onClick={() => setModo('simples')} title="Conversar com a NICO: ela monta e testa">
              <Icon name="sparkles" size={14} /> Simples
            </button>
            <button type="button" className="seg" aria-pressed={modo === 'avancado'} onClick={() => setModo('avancado')} title="Montar no canvas, nó a nó">
              <Icon name="grid" size={14} /> Avançado
            </button>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="ghost" icon="check2" onClick={() => void validar()} loading={ocupado === 'validar'} disabled={somenteLeitura}>
              <span className="hidden lg:inline">Validar</span>
            </Button>
            <Button size="sm" variant="ghost" icon="play" onClick={() => void abrirTeste()} loading={ocupado === 'testar'} disabled={somenteLeitura} title="Rodar o rascunho com um contato de teste, sem esperar o gatilho">
              <span className="hidden lg:inline">Testar</span>
            </Button>
            {versaoAtiva !== null && (
              <Button size="sm" variant="ghost" icon={status === 'ativo' ? 'pause' : 'play'} onClick={() => void alternarStatus()} loading={ocupado === 'status'}>
                <span className="hidden lg:inline">{status === 'ativo' ? 'Pausar' : 'Ativar'}</span>
              </Button>
            )}
            <Button size="sm" variant="primary" icon="send" onClick={() => void publicar()} loading={ocupado === 'publicar'} disabled={somenteLeitura}>
              Publicar
            </Button>
            <Menu label="Mais opções do fluxo" trigger={<Icon name="dots" size={18} />} items={itensMenu} menuClassName="w-60" />
          </div>
        </div>
      </header>

      {somenteLeitura && leitura && (
        <div className="mx-3 mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-info-border bg-info-soft px-3 py-2 text-sm text-fg" role="status">
          <Icon name="eye" size={16} className="text-info" />
          <span className="min-w-0 flex-1">
            Você está vendo a <b>versão {leitura.versao}</b>{leitura.publicadoEm ? `, publicada em ${new Date(leitura.publicadoEm).toLocaleString('pt-BR')}` : ''}. Nada aqui é editável.
          </span>
          <Button size="sm" variant="ghost" onClick={voltarAoRascunho}>Voltar ao rascunho</Button>
          <Button size="sm" variant="primary" icon="history" onClick={() => setRestaurando({ id: leitura.id, versao: leitura.versao, publicadoEm: leitura.publicadoEm ?? '', autor: null, nos: leitura.grafo.nos.length, ativa: false })}>
            Restaurar esta versão
          </Button>
        </div>
      )}

      {problemasGerais.length > 0 && !somenteLeitura && (
        <div className="mx-3 mt-2 flex items-start gap-2 rounded-xl border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          <ul className="min-w-0 flex-1 space-y-0.5">
            {problemasGerais.map((p, i) => <li key={i}>{p.problema}</li>)}
          </ul>
          <button type="button" onClick={() => setProblemas((ps) => ps.filter((p) => p.noId))} className="btn btn-ghost btn-icon btn-sm" aria-label="Dispensar avisos"><Icon name="close" size={14} /></button>
        </div>
      )}

      {modo === 'simples' && (
        <div className="flex min-h-0 flex-1 p-3">
          <ModoSimples
            workflowId={id}
            passosNoCanvas={nodes.filter(ehPasso).length}
            onMontado={(r) => {
              // Fluxo recém-criado ganha o nome que a NICO deu; depois o canvas recarrega o rascunho dela.
              void (async () => {
                if (!nomeSalvo.current.trim() || nomeSalvo.current === 'Nova automação') {
                  await automations.renomear(id, { nome: r.nome, descricao: r.resumo.slice(0, 500) }).catch(() => undefined);
                }
                carregar();
              })();
            }}
          />
        </div>
      )}

      <div className={cx('min-h-0 flex-1 gap-3 p-3', modo === 'simples' ? 'hidden' : 'flex')}>
        <PaletaNos
          catalogo={catalogo}
          aberta={paletaAberta}
          onAlternar={alternarPaleta}
          desabilitada={somenteLeitura}
          onEscolher={(tipo) => criarNo(tipo, { ligarDe: ehGatilhoTipo(tipo) ? undefined : ultimoNoId() })}
          onNota={() => criarNota()}
        />

        {/* Canvas */}
        <div ref={wrapper} className="relative min-w-0 flex-1 overflow-hidden rounded-3xl border border-line bg-surface" onDrop={onDrop} onDragOver={onDragOver}>
          {/* Ferramentas do canvas */}
          <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-1 rounded-full border border-line bg-surface px-1.5 py-1 shadow-sm">
            <Tooltip content="Desfazer (Ctrl+Z)" side="bottom">
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Desfazer" onClick={desfazerAcao} disabled={somenteLeitura || !historico.passado.length}><Icon name="undo" size={16} /></button>
            </Tooltip>
            <Tooltip content="Refazer (Ctrl+Shift+Z)" side="bottom">
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Refazer" onClick={refazerAcao} disabled={somenteLeitura || !historico.futuro.length}><Icon name="redo" size={16} /></button>
            </Tooltip>
            <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
            <Tooltip content="Organizar da esquerda para a direita (Ctrl+Shift+L)" side="bottom">
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Organizar o fluxo" onClick={organizar} disabled={somenteLeitura || !passos.length}><Icon name="layout" size={16} /></button>
            </Tooltip>
            <Tooltip content="Nota de texto (N)" side="bottom">
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Adicionar nota" onClick={() => criarNota()} disabled={somenteLeitura}><Icon name="note" size={16} /></button>
            </Tooltip>
            <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
            <label className="flex items-center gap-1.5 pl-1 text-xs text-muted">
              <Icon name="chart" size={15} />
              <span className="sr-only">Estatísticas no canvas</span>
              <select
                value={periodo}
                onChange={(e) => setPeriodo(e.target.value as typeof periodo)}
                className="h-7 rounded-full border border-line bg-surface px-2 text-xs text-fg"
                aria-label="Estatísticas no canvas"
              >
                <option value="off">Sem estatística</option>
                <option value="7">Últimos 7 dias</option>
                <option value="30">Últimos 30 dias</option>
              </select>
            </label>
            {stats && (
              <span className="hidden items-center gap-2 px-1.5 text-xs tabular text-muted xl:flex">
                <span title="Entraram no período">{stats.total.entraram} entraram</span>
                <span className="text-success" title="Terminaram o fluxo no período">{stats.total.concluidos} concluídos</span>
                <span title="Em andamento agora">{stats.total.esperando} esperando</span>
                <span className={stats.total.erros ? 'text-danger' : ''} title="Falharam no período">{stats.total.erros} com erro</span>
              </span>
            )}
            <Tooltip content="Atalhos (?)" side="bottom">
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Ver atalhos do teclado" onClick={() => setPainel('ajuda')}><span className="text-sm font-semibold">?</span></button>
            </Tooltip>
          </div>

          {!somenteLeitura && (
            <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
              {temGatilho && (
                <Button size="sm" variant="ghost" icon="zap" className="border border-line bg-surface" onClick={() => setAdicionar({ modo: 'gatilho' })}>
                  <span className="hidden sm:inline">Gatilho</span>
                </Button>
              )}
              <Button size="sm" variant="primary" icon="plus" onClick={() => setAdicionar({ modo: temGatilho ? 'passo' : 'gatilho' })}>
                {temGatilho ? 'Ação' : 'Gatilho'}
              </Button>
            </div>
          )}

          <EditorProvider value={ctxEditor}>
            <ReactFlow
              nodes={nodesVisiveis}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onInit={setRf}
              nodeTypes={tiposNo}
              edgeTypes={tiposAresta}
              onNodeClick={(_, n) => (n.type === TIPO_ADICIONAR_GATILHO ? setAdicionar({ modo: 'gatilho' }) : setSelecionado(n.id))}
              onPaneClick={() => setSelecionado(null)}
              onNodeDragStart={() => registrarAntes()}
              onSelectionDragStart={() => registrarAntes()}
              nodesDraggable={!somenteLeitura}
              nodesConnectable={!somenteLeitura}
              deleteKeyCode={null}
              selectionKeyCode="Shift"
              multiSelectionKeyCode={['Meta', 'Control']}
              fitView
              fitViewOptions={{ padding: 0.1, maxZoom: 1 }}
              minZoom={0.2}
              proOptions={{ hideAttribution: false }}
              defaultEdgeOptions={{ type: 'khub' }}
              connectionLineStyle={{ stroke: 'var(--brand)', strokeWidth: 2 }}
            >
              <Background gap={18} size={1.4} color="color-mix(in srgb, var(--brand) 22%, transparent)" />
              <Controls showInteractive={false} position="bottom-left" className="overflow-hidden !rounded-xl !border !border-line !shadow-sm" />
              <MiniMap
                pannable
                zoomable
                position="bottom-right"
                style={{ width: 168, height: 104 }}
                className="overflow-hidden !rounded-xl !border !border-line !bg-surface2 !shadow-sm max-lg:!hidden"
                maskColor="color-mix(in srgb, var(--base-0) 55%, transparent)"
                nodeBorderRadius={6}
                nodeColor={(n) => (n.type === 'nota' ? 'var(--border-strong)' : n.type === TIPO_ADICIONAR_GATILHO ? 'transparent' : (n.data as DadosNo)?.categoria === 'gatilho' ? 'var(--success)' : 'var(--brand)')}
              />
            </ReactFlow>
          </EditorProvider>

          {!pronto && (
            <div className="absolute inset-0 grid place-items-center bg-surface">
              <SkeletonLines lines={4} className="w-64" label="Carregando o fluxo" />
            </div>
          )}

          {/* Canvas vazio não pode ser uma tela em branco: ele ensina o começo. */}
          {pronto && passos.length === 0 && !somenteLeitura && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="pointer-events-auto max-w-sm text-center">
                <span className="icon-tile mx-auto h-11 w-11 rounded-lg"><Icon name="zap" size={21} /></span>
                <p className="mt-3 font-semibold text-fg">Comece escolhendo o que dispara a automação</p>
                <p className="mx-auto mt-1 text-sm text-muted">
                  O gatilho é o quando: tag adicionada, contato novo, mensagem no WhatsApp, uma data e hora.
                  Pode ter vários, um embaixo do outro; as ações seguem para a direita.
                </p>
                <Button className="mt-4" variant="primary" icon="plus" onClick={() => setAdicionar({ modo: 'gatilho' })}>Escolher o primeiro gatilho</Button>
                <p className="mt-2 text-xs text-muted">ou arraste um da paleta à esquerda</p>
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
            onExcluir={() => excluirSelecao(new Set([noSelecionado.no.id]))}
            onFechar={() => setSelecionado(null)}
            outrosNos={passos.filter((n) => n.id !== selecionado).map((n) => ({ id: n.id, rotulo: n.data.nome }))}
            outrosFluxos={fluxos.filter((f) => f.status === 'ativo').map((f) => ({ id: f.id, nome: f.nome }))}
          />
        )}
      </div>

      {config && (
        <ConfigFluxo
          open={painel === 'config'}
          onClose={() => setPainel(null)}
          config={config}
          tags={tags}
          webhookUrl={webhookUrl}
          webhookAssinado={webhookAssinado}
          temGatilhoWebhook={passos.some((n) => n.data.tipo === 'gatilho.webhook')}
          onSalvar={async (patch) => {
            await automations.configurar(id, patch);
            setConfig((c) => (c ? { ...c, ...patch } : c));
          }}
          onTags={salvarTags}
          onGerarWebhook={async () => {
            const r = await automations.gerarWebhook(id);
            setWebhookUrl(r.url);
          }}
          onGerarSegredo={async () => {
            const r = await automations.gerarSegredoWebhook(id);
            setWebhookAssinado(true);
            return r;
          }}
          onRemoverSegredo={async () => {
            await automations.removerSegredoWebhook(id);
            setWebhookAssinado(false);
          }}
        />
      )}

      <HistoricoVersoes
        open={painel === 'versoes'}
        onClose={() => setPainel(null)}
        workflowId={id}
        visualizando={leitura?.id ?? null}
        onVisualizar={(v) => void verVersao(v)}
        onRestaurar={(v) => setRestaurando(v)}
        revisao={revisaoVersoes}
      />

      <MoverParaPasta open={painel === 'pasta'} onClose={() => setPainel(null)} atual={pasta} existentes={pastas} onMover={moverPasta} />
      <AjudaAtalhos open={painel === 'ajuda'} onClose={() => setPainel(null)} />

      <Confirm
        open={restaurando !== null}
        onClose={() => setRestaurando(null)}
        onConfirm={restaurar}
        loading={ocupado === 'restaurar'}
        tone="primary"
        title={`Restaurar a versão ${restaurando?.versao ?? ''}?`}
        description="Ela volta a rodar para quem entrar a partir de agora, e o canvas passa a mostrá-la. Quem já está no fluxo termina na versão em que entrou. O rascunho atual fica no Desfazer."
        confirmLabel="Restaurar"
      />
      <Confirm
        open={confirmarExcluir}
        onClose={() => setConfirmarExcluir(false)}
        onConfirm={excluirFluxo}
        loading={ocupado === 'excluir'}
        title={`Excluir "${nome || 'este fluxo'}"?`}
        description="O fluxo, todas as versões e o histórico de execuções somem. Quem está no meio dele para na hora. Não dá para desfazer."
        confirmLabel="Excluir fluxo"
        requireText="EXCLUIR"
      />

      {/* Teste com contato real: o run aparece passo a passo no modal */}
      {testando && (
        <TestarAutomacao
          workflowId={id}
          rotulos={Object.fromEntries(passos.map((n) => [n.id, configs.current[n.id]?.rotulo ?? n.data.nome]))}
          onFechar={() => setTestando(false)}
        />
      )}

      {/* Painel "Adicionar" com busca (o jeito rápido; a paleta continua para arrastar) */}
      {adicionar && (
        <PainelAdicionar
          catalogo={catalogo}
          modo={adicionar.modo}
          onEscolher={(tipo) => criarNo(tipo, adicionar.arestaId ? { arestaId: adicionar.arestaId } : { ligarDe: adicionar.modo === 'passo' ? ultimoNoId() : undefined })}
          onFechar={() => setAdicionar(null)}
        />
      )}
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
