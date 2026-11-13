'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '@/components/ui';
import { AvatarContato } from './AvatarContato';
import { Icon } from '@/components/icons';
import { EmptyState, ErrorState } from '@/components/revenue/States';
import { ConfigRequired } from '@/components/app/ConfigRequired';
import { crm, type Atendente, type Conversa } from '@/lib/crm';
import { settingsApi } from '@/lib/settings';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api-error';
import { useRealtime } from '@/lib/realtime';
import { Drawer, Menu, useToast, type MenuEntry } from '@/components/kit';
import { corpoDaMidia, inbox, lerBase64, tipoDoArquivo, type ContagensConversas, type ContextoConversa, type ItemThread } from '@/lib/inbox';
import { FILTRO_INICIAL, STATUS_LISTA, filtrarBusca, mesmoFiltro, queryDaLista, type FiltroLista } from '@/lib/conversas-filtro';
import { Composer } from './Composer';
import { AnexoBolha } from './AnexoBolha';
import { PainelContexto } from './PainelContexto';
import { NovaConversaModal } from './NovaConversaModal';
import { ColunaCanais } from './ColunaCanais';
import { CanaisConectados } from './CanaisConectados';
import { SugestoesIA } from './SugestoesIA';
import { CanalIcone, SeloCanal, canalInfo } from './CanalIcone';

/**
 * Inbox de atendimento REAL (ADR-0039) — substitui a tela que só existia no
 * modo demo. Lista leve + mensagens carregadas por conversa, tempo real com
 * polling de reserva, envio otimista reconciliado, marcar como lida ao abrir
 * e troca de atendimento IA ↔ humano.
 *
 * Desenho oficial (PO, 2026-11-11): o mockup de Conversas da LP, em 4
 * colunas: Canais/Status/Etiquetas (contagens reais) · lista com abas e busca ·
 * thread com "Marcar como" e Sugestões da IA · Dados do Lead. Canal, status e
 * etiqueta filtram NO SERVIDOR; a busca e "Responsável" filtram a lista
 * carregada. No celular, lista e thread alternam e filtros/painel viram drawer.
 */

type Responsavel = 'todos' | 'minhas' | 'ia' | 'humano';
const RESPONSAVEL: [Responsavel, string][] = [['todos', 'Qualquer responsável'], ['minhas', 'Minhas'], ['ia', 'Com a IA'], ['humano', 'Com a equipe']];
const ABAS = STATUS_LISTA.filter((s) => s.chave === 'todas' || s.chave === 'nao_lidas' || s.chave === 'em_atendimento');
type Msg = ItemThread & { local?: 'enviando' | 'falhou' };
const PREF_PAINEL = 'khub:inbox:painel';

const STATUS_SAIDA: Record<string, { rotulo: string; tom: string }> = {
  enviando: { rotulo: 'Enviando…', tom: 'text-muted' },
  falhou: { rotulo: 'Falhou', tom: 'text-danger' },
  failed: { rotulo: 'Falhou', tom: 'text-danger' },
  bloqueado_dev: { rotulo: 'Não enviada (ambiente de teste)', tom: 'text-warning' },
  canal_desconectado: { rotulo: 'Canal desconectado', tom: 'text-warning' },
  sending: { rotulo: 'Enviando…', tom: 'text-muted' },
  unknown: { rotulo: 'Entrega não confirmada', tom: 'text-warning' },
  config_required: { rotulo: 'Não enviada: falta configurar', tom: 'text-warning' },
  midia_nao_suportada: { rotulo: 'Este canal não envia arquivos', tom: 'text-warning' },
};

const diaDe = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' }) : '');
const hojeOuOntem = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(Date.now() - 864e5);
  if (d.toDateString() === hoje.toDateString()) return 'Hoje';
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';
  return diaDe(iso);
};

/** Prévia da lista: link de mídia vira "📷 Mídia" (o link cru não diz nada). */
function previaLegivel(p: string | null | undefined): string {
  if (!p) return 'Sem mensagens';
  const t = p.replace(/📎\s*https?:\/\/\S+/g, '📷 Mídia').replace(/https?:\/\/lookaside\.fbsbx\.com\S*/g, '📷 Mídia').trim();
  return t || '📷 Mídia';
}

/**
 * Mídia que chegou como link (DM do Instagram/Messenger, histórico importado):
 * tenta exibir como vídeo (pela extensão) ou imagem; se não carregar (link
 * expirado do CDN da Meta, ou não é mídia), vira um link "Abrir anexo".
 */
function MidiaPorLink({ url }: { url: string }) {
  const [falhou, setFalhou] = useState(false);
  const video = /\.(mp4|mov|webm)(\?|$)/i.test(url);
  if (!falhou && video) {
    return <video src={url} controls preload="metadata" className="mt-1 max-h-72 w-full rounded-xl" onError={() => setFalhou(true)} />;
  }
  if (!falhou) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mt-1 block overflow-hidden rounded-xl">
        {/* eslint-disable-next-line @next/next/no-img-element -- CDN externo da Meta, fora do otimizador do Next */}
        <img src={url} alt="Mídia recebida" loading="lazy" referrerPolicy="no-referrer" className="max-h-72 w-full object-cover" onError={() => setFalhou(true)} />
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1.5 underline decoration-current/40 underline-offset-2">
      <Icon name="paperclip" size={13} /> Abrir anexo
    </a>
  );
}

/** Linhas "📎 url" (anexos importados) viram mídia; o resto é texto. */
function CorpoMensagem({ texto }: { texto: string }) {
  return (
    <>
      {texto.split('\n').map((linha, i) => {
        const anexo = /^📎\s*(https?:\/\/\S+)/.exec(linha);
        if (anexo) return <MidiaPorLink key={i} url={anexo[1]} />;
        return (
          <span key={i} className="block whitespace-pre-wrap break-words">
            {linha || ' '}
          </span>
        );
      })}
    </>
  );
}

/**
 * Estado vazio do Inbox. Olha as integrações de verdade: se o WhatsApp já
 * está conectado, o CTA não pode sugerir "conectar de novo" — o que falta é
 * a primeira mensagem chegar.
 */
function InboxVazio({ onNova, onConectar }: { onNova: () => void; onConectar: () => void }) {
  const [conectado, setConectado] = useState<boolean | null>(null);
  useEffect(() => {
    settingsApi
      .integrations()
      .then((rows) =>
        setConectado(rows.some((r) => ['stevo_api', 'evolution', 'whatsapp'].includes(r.provider) && r.status === 'connected')),
      )
      .catch(() => setConectado(null));
  }, []);

  return (
    <div className="card">
      <EmptyState
        icon="chat"
        title="Nenhuma conversa ainda"
        description={
          conectado
            ? 'WhatsApp conectado e funcionando. Quando um cliente escrever, a conversa aparece aqui na hora.'
            : 'Conecte o WhatsApp, o Instagram, o Messenger ou o YouTube. Quando um cliente escrever ou comentar, a conversa aparece aqui na hora.'
        }
        action={
          conectado ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={onNova}>
              <Icon name="plus" size={15} /> Iniciar conversa
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={onConectar}>
              <Icon name="link" size={15} /> Conectar canais
            </button>
          )
        }
      />
    </div>
  );
}

export function InboxAtendimento() {
  const { user } = useAuth();
  const [convs, setConvs] = useState<Conversa[] | null>(null);
  const [erroLista, setErroLista] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [thread, setThread] = useState<Msg[] | null>(null);
  const [total, setTotal] = useState(0);
  const [erroThread, setErroThread] = useState(false);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltroLista] = useState<FiltroLista>(FILTRO_INICIAL);
  const [responsavel, setResponsavel] = useState<Responsavel>('todos');
  const [contagens, setContagens] = useState<ContagensConversas | null>(null);
  const [canaisAberto, setCanaisAberto] = useState(false);
  const [filtrosMobile, setFiltrosMobile] = useState(false);
  const [painelMobile, setPainelMobile] = useState(false);
  const [rascunho, setRascunho] = useState<{ texto: string; n: number } | null>(null);
  const [marcando, setMarcando] = useState(false);
  const filtroRef = useRef<FiltroLista>(FILTRO_INICIAL);
  const cacheSel = useRef<Conversa | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [gated, setGated] = useState<{ provider: string; missing: string[] } | null>(null);
  const [trocando, setTrocando] = useState(false);
  const toast = useToast();
  const [atendentes, setAtendentes] = useState<Atendente[]>([]);
  const [contexto, setContexto] = useState<ContextoConversa | null>(null);
  const [versaoContexto, setVersaoContexto] = useState(0);
  const [painel, setPainel] = useState(true);
  const [novaConversa, setNovaConversa] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);
  const selRef = useRef<string | null>(null);
  const threadRef = useRef<Msg[] | null>(null);
  const versaoRef = useRef<Record<string, string | undefined>>({});
  selRef.current = sel;
  threadRef.current = thread;

  const descer = useCallback((suave = true) => setTimeout(() => fimRef.current?.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'end' }), 30), []);

  const carregarLista = useCallback(async () => {
    inbox.contagens().then(setContagens).catch(() => undefined);
    const pedido = filtroRef.current;
    try {
      const cs = await crm.conversations(queryDaLista(pedido));
      // Resposta de um filtro que já mudou: descarta (a do filtro atual vem a seguir).
      if (!mesmoFiltro(pedido, filtroRef.current)) return null;
      setConvs(cs);
      setErroLista(false);
      return cs;
    } catch {
      setErroLista(true);
      return null;
    }
  }, []);

  const mudarFiltro = useCallback(
    (f: FiltroLista) => {
      setFiltrosMobile(false);
      if (mesmoFiltro(f, filtroRef.current)) return;
      filtroRef.current = f;
      setFiltroLista(f);
      setConvs(null);
      void carregarLista().then((cs) => {
        for (const c of cs ?? []) versaoRef.current[c.id] = c.atualizadaEm;
      });
    },
    [carregarLista],
  );

  // Volta do OAuth de um canal (`?canais=1&conectado=…|erro=…`): abre o painel e avisa.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('canais') !== '1') return;
    setCanaisAberto(true);
    const erroOauth = p.get('erro');
    if (erroOauth) toast.error('Não consegui conectar o canal', { description: erroOauth });
    else if (p.get('conectado')) {
      const n = Number(p.get('contas') ?? 0);
      toast.success(n ? `${n} conta(s) conectada(s)` : 'Nenhuma conta nova conectada', p.get('aviso') ? { description: p.get('aviso')! } : undefined);
    }
    window.history.replaceState(null, '', '/conversas');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abrir = useCallback(
    async (id: string) => {
      setSel(id);
      setThread(null);
      setErroThread(false);
      setAviso('');
      setContexto(null);
      try {
        const r = await inbox.thread(id);
        if (selRef.current !== id) return;
        setThread(r.mensagens);
        setTotal(r.total);
        descer(false);
      } catch {
        if (selRef.current === id) setErroThread(true);
      }
      // Abrir = ler. Zera o contador local na hora; o servidor confirma.
      setConvs((cs) => cs?.map((c) => (c.id === id ? { ...c, naoLidas: 0 } : c)) ?? cs);
      crm.marcarLida(id).catch(() => undefined);
    },
    [descer],
  );

  // Carga inicial; `?c=` (deep link da busca ⌘K) abre a conversa pedida.
  useEffect(() => {
    const alvo = new URLSearchParams(window.location.search).get('c');
    void carregarLista().then((cs) => {
      if (!cs) return;
      for (const c of cs) versaoRef.current[c.id] = c.atualizadaEm;
      const inicial = (alvo && cs.find((x) => x.id === alvo)) || (window.matchMedia('(min-width: 1024px)').matches ? cs[0] : null);
      if (inicial) void abrir(inicial.id);
    });
  }, [carregarLista, abrir]);

  // Notificação clicada com o Inbox já aberto (`khub:abrir` do sino): abre a conversa do link.
  useEffect(() => {
    const ouvir = (e: Event) => {
      const url = (e as CustomEvent<string>).detail;
      const id = typeof url === 'string' ? new URL(url, window.location.origin).searchParams.get('c') : null;
      if (id && id !== selRef.current) void carregarLista().then(() => abrir(id));
    };
    window.addEventListener('khub:abrir', ouvir);
    return () => window.removeEventListener('khub:abrir', ouvir);
  }, [carregarLista, abrir]);

  /** Evento chegou (socket) ou polling: atualiza a lista e, se a conversa aberta mudou, as mensagens dela. */
  const sincronizar = useCallback(async (forcar = false) => {
    const cs = await carregarLista();
    const id = selRef.current;
    if (!cs || !id) return;
    const conv = cs.find((c) => c.id === id);
    const mudou = conv && (forcar || conv.atualizadaEm !== versaoRef.current[id]);
    for (const c of cs) versaoRef.current[c.id] = c.atualizadaEm;
    if (!mudou) return;
    let r: { total: number; mensagens: ItemThread[] };
    try {
      r = await inbox.thread(id);
    } catch {
      return;
    }
    if (selRef.current !== id) return;
    const atual = threadRef.current ?? [];
    const ids = new Set(atual.map((m) => m.id));
    const novas: Msg[] = [];
    let alterou = false;
    const reconciliada = atual.map((m) => ({ ...m }));
    for (const m of r.mensagens) {
      if (ids.has(m.id)) continue;
      const pend = reconciliada.find((x) => x.local === 'enviando' && x.de !== 'contato' && x.texto === m.texto);
      if (pend) {
        Object.assign(pend, m, { local: undefined });
        alterou = true;
        continue;
      }
      novas.push(m);
    }
    if (novas.length || alterou) {
      setThread([...reconciliada, ...novas]);
      setTotal(r.total);
      if (novas.length) descer();
    }
    // A conversa aberta está sendo lida: o que chegou não fica como "não lida".
    if (conv && conv.naoLidas > 0) {
      setConvs((xs) => xs?.map((c) => (c.id === id ? { ...c, naoLidas: 0 } : c)) ?? xs);
      crm.marcarLida(id).catch(() => undefined);
    }
  }, [carregarLista, descer]);

  const { conectado } = useRealtime({
    'message.created': () => void sincronizar(),
    'conversation.updated': () => void sincronizar(),
    // Nota interna não mexe em `updated_at` da conversa (não sobe na lista): força a releitura.
    'conversation.note_created': (d) => {
      if (d.conversationId === selRef.current) void sincronizar(true);
    },
  });

  // Atendentes (atribuir e @menção) e preferência do painel lateral.
  useEffect(() => {
    crm.atendentes().then(setAtendentes).catch(() => setAtendentes([]));
    try {
      if (window.localStorage.getItem(PREF_PAINEL) === '0') setPainel(false);
    } catch {
      /* armazenamento bloqueado: painel aberto por padrão */
    }
  }, []);
  const alternarPainel = () =>
    setPainel((v) => {
      try {
        window.localStorage.setItem(PREF_PAINEL, v ? '0' : '1');
      } catch {
        /* sem persistência: só nesta sessão */
      }
      return !v;
    });
  useEffect(() => {
    if (conectado) return;
    const t = setInterval(() => void sincronizar(), 6000);
    return () => clearInterval(t);
  }, [conectado, sincronizar]);

  // A conversa aberta continua aberta quando um filtro a tira da lista.
  const achada = convs?.find((c) => c.id === sel) ?? null;
  if (achada) cacheSel.current = achada;
  const conversa = achada ?? (sel && cacheSel.current?.id === sel ? cacheSel.current : null);

  const visiveis = useMemo(() => {
    const porResponsavel = (convs ?? []).filter((c) => {
      if (responsavel === 'minhas') return !!user?.identityId && c.assigneeId === user.identityId;
      if (responsavel === 'ia') return c.atendimento === 'ia';
      if (responsavel === 'humano') return c.atendimento === 'humano';
      return true;
    });
    return filtrarBusca(porResponsavel, busca);
  }, [convs, busca, responsavel, user?.identityId]);

  const filtroAtivo = !mesmoFiltro(filtro, FILTRO_INICIAL) || responsavel !== 'todos';

  /** "Marcar como": resolvida, reaberta ou não lida (com desfazer pelo próprio menu). */
  const marcar = async (acao: 'resolvida' | 'aberta' | 'nao_lida') => {
    if (!conversa || marcando) return;
    setMarcando(true);
    try {
      const r = await inbox.marcar(conversa.id, acao);
      setConvs((cs) => cs?.map((c) => (c.id === conversa.id ? { ...c, status: r.status, naoLidas: r.naoLidas } : c)) ?? cs);
      if (cacheSel.current?.id === conversa.id) cacheSel.current = { ...cacheSel.current, status: r.status, naoLidas: r.naoLidas };
      toast.success(acao === 'resolvida' ? 'Conversa resolvida' : acao === 'aberta' ? 'Conversa reaberta' : 'Marcada como não lida');
      inbox.contagens().then(setContagens).catch(() => undefined);
      if (acao === 'nao_lida') setSel(null);
    } catch (e) {
      toast.error('Não consegui marcar a conversa', { description: e instanceof ApiError && e.message ? e.message : undefined });
    } finally {
      setMarcando(false);
    }
  };

  const enviar = async (digitado: string) => {
    const t = digitado.trim();
    if (!t || !conversa || enviando) return;
    setEnviando(true);
    setAviso('');
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const tmp = `tmp-${Date.now()}`;
    setThread((p) => [...(p ?? []), { id: tmp, de: 'humano', texto: t, hora, criadaEm: new Date().toISOString(), local: 'enviando', enviadoPorNome: user?.name ?? null }]);
    setConvs((cs) => cs?.map((c) => (c.id === conversa.id ? { ...c, ultimaPrevia: t, ultimaHora: hora } : c)) ?? cs);
    descer();
    try {
      const r = await crm.sendMessage(conversa.id, t);
      setThread((p) => p?.map((m) => (m.id === tmp ? { ...m, id: r.id ?? m.id, local: undefined, status: r.status === 'sent' ? 'delivered' : r.status } : m)) ?? p);
      setGated(null);
      if (r.status === 'config_required') setGated({ provider: (r as { provider?: string }).provider ?? 'stevo', missing: r.missing ?? [] });
      else if (r.status === 'sem_telefone') setAviso('Este contato não tem telefone cadastrado. A mensagem foi registrada, mas não saiu.');
      else if (r.status === 'failed') setAviso(`O ${canalInfo(conversa.canal).rotulo} recusou a mensagem${r.erro ? ` (${r.erro})` : ''}. Tente de novo.`);
      else if (r.status === 'canal_desconectado') setAviso(`A conta do ${canalInfo(conversa.canal).rotulo} está desconectada. Conecte de novo em Canais conectados.`);
    } catch (e) {
      setThread((p) => p?.map((m) => (m.id === tmp ? { ...m, local: 'falhou' } : m)) ?? p);
      const cr = e instanceof ApiError ? e.configRequired : null;
      if (cr) setGated(cr);
      else setAviso('Não consegui enviar. Verifique a conexão e tente de novo.');
    } finally {
      setEnviando(false);
    }
  };

  /** Anexo (Q2.5): otimista com o mesmo corpo que o servidor grava, reconciliado pelo id. */
  const enviarMidia = async (arquivo: File, legenda: string) => {
    if (!conversa || enviando) return;
    setEnviando(true);
    setAviso('');
    const tipo = tipoDoArquivo(arquivo.type);
    const corpo = corpoDaMidia(tipo, arquivo.name, legenda);
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const tmp = `tmp-${Date.now()}`;
    const anexoLocal = { tipo, mime: arquivo.type, nome: arquivo.name, tamanho: arquivo.size, legenda: legenda || undefined, url: null };
    setThread((p) => [...(p ?? []), { id: tmp, de: 'humano', texto: corpo, hora, criadaEm: new Date().toISOString(), local: 'enviando', enviadoPorNome: user?.name ?? null, anexo: anexoLocal }]);
    descer();
    try {
      const base64 = await lerBase64(arquivo);
      const r = await inbox.enviarMidia(conversa.id, { tipo, mime: arquivo.type || 'application/octet-stream', nome: arquivo.name, base64, legenda: legenda || undefined });
      setThread((p) => p?.map((m) => (m.id === tmp ? { ...m, id: r.id, local: undefined, status: r.status === 'sent' ? 'delivered' : r.status, anexo: r.anexo } : m)) ?? p);
      setGated(r.status === 'config_required' ? { provider: r.provider ?? 'storage', missing: r.missing } : null);
      if (r.status === 'sem_telefone') setAviso('Este contato não tem telefone cadastrado. O arquivo foi registrado, mas não saiu.');
      else if (r.status === 'failed') setAviso(`O WhatsApp recusou o arquivo${r.erro ? ` (${r.erro})` : ''}. Tente de novo.`);
      else if (r.status === 'midia_nao_suportada') setAviso(conversa.canal === 'WhatsApp' ? 'O canal conectado não envia arquivos. Conecte o WhatsApp pela Stevo ou Evolution.' : `O ${canalInfo(conversa.canal).rotulo} não recebe arquivos por aqui: responda com texto.`);
    } catch (e) {
      setThread((p) => p?.filter((m) => m.id !== tmp) ?? p);
      const cr = e instanceof ApiError ? e.configRequired : null;
      if (cr) setGated(cr);
      else toast.error('Não consegui enviar o arquivo', { description: e instanceof ApiError && e.message ? e.message : 'Verifique a conexão e tente de novo.' });
    } finally {
      setEnviando(false);
    }
  };

  /** Nota interna (Q2.5): só equipe, nunca vai ao provedor. */
  const criarNota = async (corpo: string, mencoes: string[]) => {
    if (!conversa || enviando) return;
    setEnviando(true);
    try {
      const n = await inbox.criarNota(conversa.id, corpo, mencoes);
      setThread((p) => (p && !p.some((m) => m.id === n.id) ? [...p, n] : p));
      setTotal((t) => t + 1);
      descer();
      if (mencoes.length) toast.success(mencoes.length > 1 ? `Nota salva. ${mencoes.length} pessoas avisadas` : 'Nota salva e menção avisada');
    } catch (e) {
      toast.error('Não consegui salvar a nota', { description: e instanceof ApiError && e.message ? e.message : undefined });
    } finally {
      setEnviando(false);
    }
  };

  const atribuir = async (assigneeId: string) => {
    if (!conversa || trocando) return;
    setTrocando(true);
    try {
      const r = await crm.mudarAtendimento(conversa.id, { acao: 'atribuir', assigneeId });
      setConvs((cs) => cs?.map((c) => (c.id === conversa.id ? { ...c, atendimento: r.atendimento, agentId: r.agentId, assigneeId: r.assigneeId, handoffMotivo: r.handoffMotivo } : c)) ?? cs);
      setVersaoContexto((v) => v + 1);
      toast.success(`Conversa atribuída a ${atendentes.find((a) => a.identityId === assigneeId)?.nome ?? 'membro'}`);
    } catch (e) {
      toast.error('Não consegui atribuir', { description: e instanceof ApiError && e.message ? e.message : undefined });
    } finally {
      setTrocando(false);
    }
  };

  const trocarAtendimento = async (acao: 'assumir' | 'devolver_ia') => {
    if (!conversa || trocando) return;
    setTrocando(true);
    try {
      const r = await crm.mudarAtendimento(conversa.id, { acao });
      setConvs((cs) => cs?.map((c) => (c.id === conversa.id ? { ...c, atendimento: r.atendimento, agentId: r.agentId, assigneeId: r.assigneeId, handoffMotivo: r.handoffMotivo } : c)) ?? cs);
    } catch (e) {
      setAviso(e instanceof ApiError && e.message ? e.message : 'Não foi possível trocar o atendimento agora.');
    } finally {
      setTrocando(false);
    }
  };

  if (erroLista && !convs) {
    return (
      <div className="card">
        <ErrorState title="Não consegui carregar as conversas" description="Verifique sua conexão e tente de novo." onRetry={() => void carregarLista()} />
      </div>
    );
  }

  const modalNova = (
    <NovaConversaModal
      open={novaConversa}
      onClose={() => setNovaConversa(false)}
      onAberta={(id) => {
        void carregarLista().then((cs) => {
          for (const c of cs ?? []) versaoRef.current[c.id] = c.atualizadaEm;
          void abrir(id);
        });
      }}
    />
  );

  const drawerCanais = (
    <CanaisConectados open={canaisAberto} onClose={() => setCanaisAberto(false)} onMudou={() => void carregarLista()} />
  );

  // Vazio de verdade (sem filtro e sem nenhuma conversa na conta): convida a conectar.
  if (convs && convs.length === 0 && !filtroAtivo && contagens?.total === 0) {
    return (
      <>
        <InboxVazio onNova={() => setNovaConversa(true)} onConectar={() => setCanaisAberto(true)} />
        {modalNova}
        {drawerCanais}
      </>
    );
  }

  // Agrupa mensagens por dia para os separadores.
  const grupos: { dia: string; itens: Msg[] }[] = [];
  for (const m of thread ?? []) {
    const dia = hojeOuOntem(m.criadaEm);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.dia === dia) ultimo.itens.push(m);
    else grupos.push({ dia, itens: [m] });
  }

  const painelVisivel = painel && !!conversa;
  const colunaCanais = <ColunaCanais contagens={contagens} filtro={filtro} onFiltro={mudarFiltro} onConectar={() => { setFiltrosMobile(false); setCanaisAberto(true); }} />;

  return (
    <div
      className={cx(
        'grid h-[calc(100dvh-210px)] min-h-[520px] grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[200px_320px_minmax(0,1fr)]',
        painelVisivel ? '2xl:grid-cols-[210px_330px_minmax(0,1fr)_300px]' : '2xl:grid-cols-[210px_330px_minmax(0,1fr)]',
      )}
    >
      {/* 1 · CANAIS, STATUS E ETIQUETAS (no celular, drawer pelo botão de filtros) */}
      <aside className="card hidden min-h-0 flex-col overflow-hidden p-0 xl:flex" aria-label="Canais, status e etiquetas">
        {colunaCanais}
      </aside>

      {/* 2 · LISTA */}
      <section className={cx('card min-h-0 min-w-0 flex-col overflow-hidden p-0', conversa ? 'hidden lg:flex' : 'flex')} aria-label="Conversas">
        <div className="border-b border-line px-3 pt-3">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input type="search" className="input h-9 w-full pl-9" placeholder="Buscar conversas..." value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar conversas" />
            </div>
            <button type="button" className={cx('btn btn-icon btn-sm h-9 w-9 xl:hidden', filtroAtivo && 'text-brand')} aria-label="Canais, status e etiquetas" onClick={() => setFiltrosMobile(true)}>
              <Icon name="funnel" size={15} />
            </button>
            <Menu
              label="Filtrar por responsável"
              triggerClassName={cx('btn btn-icon btn-sm h-9 w-9', responsavel !== 'todos' && 'text-brand')}
              menuClassName="w-56"
              trigger={<Icon name="users" size={15} />}
              items={[
                { type: 'label', id: 'resp', label: 'Responsável' } as MenuEntry,
                ...RESPONSAVEL.map(([v, r]): MenuEntry => ({ id: v, label: r, icon: responsavel === v ? 'check' : undefined, onSelect: () => setResponsavel(v) })),
              ]}
            />
            <button type="button" className="btn btn-soft btn-icon btn-sm h-9 w-9" aria-label="Nova conversa" title="Nova conversa" onClick={() => setNovaConversa(true)}>
              <Icon name="plus" size={15} />
            </button>
          </div>
          <div className="mt-2 flex gap-4" role="tablist" aria-label="Status das conversas">
            {ABAS.map((a) => (
              <button
                key={a.chave}
                type="button"
                role="tab"
                aria-selected={filtro.status === a.chave}
                className="tab whitespace-nowrap py-2 text-[13px]"
                onClick={() => mudarFiltro({ ...filtro, status: a.chave })}
              >
                {a.rotulo}
                {contagens && a.chave !== 'em_atendimento' ? ` (${contagens.status[a.chave]})` : ''}
              </button>
            ))}
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {!convs &&
            Array.from({ length: 7 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="skeleton h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-3 w-2/3" />
                  <div className="skeleton h-3 w-full" />
                </div>
              </li>
            ))}
          {convs && visiveis.length === 0 && (
            <li className="px-4 py-10 text-center text-[13px] text-muted">
              Nenhuma conversa com esse filtro.
              {filtroAtivo && (
                <button type="button" className="mt-2 block w-full text-[12.5px] font-medium text-brand hover:underline" onClick={() => { setResponsavel('todos'); mudarFiltro(FILTRO_INICIAL); }}>
                  Limpar filtros
                </button>
              )}
            </li>
          )}
          {visiveis.map((c) => {
            const ativa = c.id === sel;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => void abrir(c.id)}
                  aria-current={ativa ? 'true' : undefined}
                  className={cx(
                    'flex w-full items-start gap-3 border-b border-line px-3 py-3 text-left transition-colors',
                    ativa ? 'bg-[color-mix(in_srgb,var(--brand)_8%,transparent)]' : 'hover:bg-[var(--fill-4)]',
                  )}
                >
                  <span className="relative shrink-0">
                    <AvatarContato nome={c.nome} fotoUrl={c.contato?.fotoUrl} contatoId={c.contato?.id} size={40} />
                    <SeloCanal canal={c.canal} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cx('truncate text-[14px] text-fg', c.naoLidas ? 'font-semibold' : 'font-medium')}>{c.nome}</span>
                      <span className={cx('shrink-0 text-[11.5px] tabular', c.naoLidas ? 'font-semibold text-brand' : 'text-muted')}>{c.ultimaHora ?? ''}</span>
                    </span>
                    {c.contato?.empresa && <span className="block truncate text-[12px] text-brand">{c.contato.empresa}</span>}
                    <span className="mt-0.5 flex items-center gap-2">
                      {c.atendimento === 'ia' && <span className="shrink-0 rounded-full bg-[var(--violet-soft)] px-1.5 text-[11px] font-semibold text-[var(--violet)]">IA</span>}
                      <span className={cx('truncate text-[13px]', c.naoLidas ? 'text-fg' : 'text-muted')}>{previaLegivel(c.ultimaPrevia)}</span>
                    </span>
                    <span className="mt-1.5 flex items-center gap-1.5">
                      {c.tipo === 'comentario' && <span className="pill h-5 shrink-0 px-2 text-[11px]">Comentário</span>}
                      {c.status === 'resolvida' && <span className="pill pill-success h-5 shrink-0 px-2 text-[11px]">Resolvida</span>}
                      {(c.etiquetas ?? []).slice(0, 2).map((e) => (
                        <span key={e} className="pill h-5 max-w-[7.5rem] truncate px-2 text-[11px]">{e}</span>
                      ))}
                      {c.naoLidas > 0 && (
                        <span className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-[var(--base-0)]">{c.naoLidas > 99 ? '99+' : c.naoLidas}</span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* CONVERSA */}
      <section className={cx('card min-h-0 min-w-0 flex-col overflow-hidden p-0', conversa ? 'flex' : 'hidden lg:flex')} aria-label="Mensagens">
        {!conversa ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <EmptyState icon="chat" title="Selecione uma conversa" description="Escolha um contato à esquerda para ver o histórico e responder." />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 lg:px-5">
              <button type="button" className="btn btn-ghost btn-icon btn-sm lg:hidden" onClick={() => setSel(null)} aria-label="Voltar para a lista">
                <Icon name="arrowLeft" size={18} />
              </button>
              <span className="relative shrink-0">
                <AvatarContato nome={conversa.nome} fotoUrl={conversa.contato?.fotoUrl} contatoId={conversa.contato?.id} size={38} />
                <SeloCanal canal={conversa.canal} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-fg">{conversa.nome}</p>
                <p className="flex items-center gap-1.5 truncate text-[12.5px] text-muted">
                  <CanalIcone canal={conversa.canal} size={13} />
                  {conversa.tipo === 'comentario' ? `Comentário no ${canalInfo(conversa.canal).rotulo}` : canalInfo(conversa.canal).rotulo}
                  {conversa.contato?.telefone ? ` · ${conversa.contato.telefone}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {conversa.atendimento === 'ia' ? (
                  <>
                    <span className="pill pill-brand hidden sm:inline-flex">
                      <Icon name="sparkles" size={12} /> IA respondendo
                    </span>
                    <button type="button" className="btn btn-sm" disabled={trocando} onClick={() => void trocarAtendimento('assumir')}>
                      Assumir conversa
                    </button>
                  </>
                ) : (
                  conversa.agentId && (
                    <button type="button" className="btn btn-soft btn-sm" disabled={trocando} onClick={() => void trocarAtendimento('devolver_ia')}>
                      <Icon name="sparkles" size={14} /> Devolver para a IA
                    </button>
                  )
                )}
                <Menu
                  label="Atribuir conversa"
                  disabled={trocando || atendentes.length === 0}
                  triggerClassName="btn btn-ghost btn-sm !w-auto gap-1.5 !px-2.5"
                  menuClassName="w-64"
                  trigger={
                    <>
                      <Icon name="user" size={14} />
                      <span className="hidden max-w-[9rem] truncate sm:inline">
                        {conversa.assigneeId ? atendentes.find((a) => a.identityId === conversa.assigneeId)?.nome ?? 'Responsável' : 'Atribuir'}
                      </span>
                    </>
                  }
                  items={[
                    { type: 'label', id: 'rotulo', label: 'Atribuir a' } as MenuEntry,
                    ...atendentes.map(
                      (a): MenuEntry => ({
                        id: a.identityId,
                        label: (
                          <span className="flex w-full items-center justify-between gap-2">
                            <span className="truncate">{a.identityId === user?.identityId ? `${a.nome} (você)` : a.nome}</span>
                            <span className="shrink-0 text-xs text-muted tabular">{a.abertas} abertas</span>
                          </span>
                        ),
                        textValue: a.nome,
                        icon: a.identityId === conversa.assigneeId ? 'check' : 'user',
                        disabled: a.identityId === conversa.assigneeId,
                        onSelect: () => void atribuir(a.identityId),
                      }),
                    ),
                  ]}
                />
                <Menu
                  label="Marcar como"
                  disabled={marcando}
                  triggerClassName="btn btn-sm !w-auto gap-1.5 !px-3"
                  menuClassName="w-56"
                  trigger={
                    <>
                      <span className="hidden sm:inline">Marcar como</span>
                      <Icon name="chevronDown" size={14} />
                    </>
                  }
                  items={[
                    conversa.status === 'resolvida'
                      ? { id: 'aberta', label: 'Reabrir conversa', icon: 'undo', onSelect: () => void marcar('aberta') }
                      : { id: 'resolvida', label: 'Resolvida', icon: 'check2', onSelect: () => void marcar('resolvida') },
                    { id: 'nao_lida', label: 'Não lida', icon: 'eyeOff', onSelect: () => void marcar('nao_lida') },
                  ]}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm hidden 2xl:inline-flex"
                  aria-label={painel ? 'Recolher Dados do Lead' : 'Mostrar Dados do Lead'}
                  aria-pressed={painel}
                  onClick={alternarPainel}
                >
                  <Icon name="layout" size={16} />
                </button>
                <button type="button" className="btn btn-ghost btn-sm 2xl:hidden" onClick={() => setPainelMobile(true)}>
                  <Icon name="info" size={14} /> <span className="hidden sm:inline">Dados do lead</span>
                </button>
              </div>
              {conversa.atendimento === 'humano' && conversa.handoffMotivo && (
                <p className="w-full rounded-lg bg-[var(--fill-4)] px-3 py-2 text-[12.5px] text-muted">Transferida para a equipe: {conversa.handoffMotivo}</p>
              )}
            </header>

            <div className="chat-fundo min-h-0 flex-1 overflow-y-auto scrollbar-thin px-4 py-5 lg:px-6">
              {erroThread && <ErrorState title="Não consegui abrir esta conversa" description="Tente de novo em instantes." onRetry={() => void abrir(conversa.id)} />}
              {!thread && !erroThread && (
                <div className="space-y-3">
                  {[60, 40, 70, 35].map((w, i) => (
                    <div key={i} className={cx('flex', i % 2 ? 'justify-end' : 'justify-start')}>
                      <div className="skeleton h-12 rounded-2xl" style={{ width: `${w}%` }} />
                    </div>
                  ))}
                </div>
              )}
              {thread && total > thread.length && (
                <p className="mb-4 text-center text-[12px] text-muted">Mostrando as {thread.length} mensagens mais recentes de {total}.</p>
              )}
              {grupos.map((g) => (
                <div key={g.dia} className="space-y-1.5">
                  {g.dia && (
                    <div className="my-4 flex justify-center">
                      <span className="rounded-full bg-[var(--base-0)] px-3 py-1 text-[11.5px] font-medium text-muted shadow-sm">{g.dia}</span>
                    </div>
                  )}
                  {g.itens.map((m) => {
                    if (m.de === 'nota') {
                      // Nota interna: centralizada, tom amarelado, nunca parece mensagem ao cliente.
                      return (
                        <div key={m.id} className="flex justify-center py-1">
                          <div className="w-full max-w-[86%] rounded-2xl border border-warning-border bg-warning-soft px-3.5 py-2 text-sm text-fg sm:max-w-[72%]">
                            <p className="mb-0.5 flex items-center gap-1 text-xs font-semibold text-warning">
                              <Icon name="lock" size={11} /> Nota interna{m.enviadoPorNome ? ` de ${m.enviadoPorNome}` : ''}
                            </p>
                            <span className="block whitespace-pre-wrap break-words">{m.texto}</span>
                            <p className="mt-1 text-right text-xs text-muted tabular">{m.hora ?? ''}</p>
                          </div>
                        </div>
                      );
                    }
                    const minha = m.de !== 'contato';
                    const ia = m.de === 'ia' || m.de === 'nyro';
                    const automacao = m.de === 'automacao';
                    const st = m.local ? STATUS_SAIDA[m.local] : m.status ? STATUS_SAIDA[m.status] : undefined;
                    return (
                      <div key={m.id} className={cx('flex', minha ? 'justify-end' : 'justify-start')}>
                        <div
                          className={cx(
                            'max-w-[78%] rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed shadow-sm sm:max-w-[68%]',
                            !minha && 'rounded-bl-md border border-line bg-[var(--base-0)] text-fg',
                            // Padrão WhatsApp: verde com texto escuro no claro, verde-escuro com texto claro no escuro (o lima da marca não tinha contraste com texto branco).
                            minha && !ia && !automacao && 'rounded-br-md bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]',
                            ia && 'rounded-br-md border border-[color-mix(in_srgb,var(--brand)_18%,transparent)] bg-brand-soft text-fg',
                            automacao && 'rounded-br-md border border-lime-border bg-lime-soft text-fg',
                          )}
                        >
                          {ia && <p className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-brand"><Icon name="sparkles" size={11} /> IA</p>}
                          {automacao && (
                            <p className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-lime-ink">
                              <Icon name="zap" size={11} /> Automação{m.workflowNome ? `: ${m.workflowNome}` : ''}
                            </p>
                          )}
                                                    {!ia && !automacao && minha && (
                            <p className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-[#1f7a57] dark:text-[#7fe0b8]">
                              {/* Mensagens antigas (importadas antes da migration 036) não
                                  têm autor gravado — o histórico do WhatsApp não traz isso.
                                  Caem no rótulo genérico "Equipe" em vez de ficar sem origem. */}
                              <Icon name="users" size={11} /> {m.enviadoPorNome ?? 'Equipe'}
                            </p>
                          )}
                          {m.anexo ? (
                            <>
                              <AnexoBolha anexo={m.anexo} claro={minha && !ia && !automacao} />
                              {m.anexo.legenda && <span className="block whitespace-pre-wrap break-words">{m.anexo.legenda}</span>}
                            </>
                          ) : (
                            <CorpoMensagem texto={m.texto} />
                          )}
                          <p className={cx('mt-1 text-right text-[10.5px] tabular', minha && !ia && !automacao ? 'text-[#667781] dark:text-[#e9edef]/70' : 'text-muted')}>
                            {m.hora ?? ''}
                          </p>
                        </div>
                        {st && minha && <span className={cx('sr-only')}>{st.rotulo}</span>}
                      </div>
                    );
                  })}
                  {g.itens.some((m) => m.de !== 'contato' && m.de !== 'nota' && (m.local || (m.status && STATUS_SAIDA[m.status]))) && (
                    <div className="flex justify-end">
                      {(() => {
                        const ult = [...g.itens].reverse().find((m) => m.de !== 'contato' && m.de !== 'nota');
                        const st = ult?.local ? STATUS_SAIDA[ult.local] : ult?.status ? STATUS_SAIDA[ult.status] : undefined;
                        return st ? <span className={cx('text-[11.5px]', st.tom)}>{st.rotulo}</span> : null;
                      })()}
                    </div>
                  )}
                </div>
              ))}
              <div ref={fimRef} />
            </div>

            <SugestoesIA conversationId={conversa.id} onEscolher={(texto) => setRascunho((r) => ({ texto, n: (r?.n ?? 0) + 1 }))} />

            <Composer
              key={conversa.id}
              rascunho={rascunho}
              iaRespondendo={conversa.atendimento === 'ia'}
              atendentes={atendentes}
              meuId={user?.identityId}
              ocupado={enviando}
              dados={{
                contato: contexto?.contato ?? { nome: conversa.nome, telefone: conversa.contato?.telefone ?? null, email: conversa.contato?.email ?? null },
                atendente: { nome: user?.name ?? null },
                negocio: contexto?.negocios[0] ?? null,
              }}
              topo={
                <>
                  {conversa.tipo === 'comentario' && (
                    <p className="mb-2 flex items-center gap-1.5 text-[12.5px] text-muted">
                      <Icon name="globe" size={13} /> Resposta pública: vai como resposta ao comentário no {canalInfo(conversa.canal).rotulo}.
                    </p>
                  )}
                  {gated && (
                    <div className="mb-3">
                      <ConfigRequired provider={gated.provider} missing={gated.missing} />
                    </div>
                  )}
                  {aviso && (
                    <p role="alert" className="mb-2 text-sm text-warning">
                      {aviso}
                    </p>
                  )}
                </>
              }
              onTexto={enviar}
              onMidia={enviarMidia}
              onNota={criarNota}
            />
          </div>
          </div>
        )}
      </section>

      {/* 4 · DADOS DO LEAD (abaixo de 2xl, drawer) */}
      {painelVisivel && conversa && (
        <aside className="card hidden min-h-0 flex-col overflow-hidden p-0 2xl:flex" aria-label="Dados do Lead">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="text-[15px] font-semibold text-fg">Dados do Lead</h2>
            {conversa.contato?.id && (
              <Link href={`/contatos/${conversa.contato.id}`} className="text-[12.5px] font-medium text-brand hover:underline">
                Editar
              </Link>
            )}
          </div>
          <PainelContexto conversationId={conversa.id} versao={versaoContexto} onContexto={setContexto} />
        </aside>
      )}

      <Drawer open={painelMobile && !!conversa} onClose={() => setPainelMobile(false)} title="Dados do Lead" width="sm:max-w-sm" className="[&>div:last-child]:p-0">
        {conversa && <PainelContexto conversationId={conversa.id} versao={versaoContexto} onContexto={setContexto} />}
      </Drawer>
      <Drawer open={filtrosMobile} onClose={() => setFiltrosMobile(false)} title="Canais, status e etiquetas" side="left" width="sm:max-w-xs" className="[&>div:last-child]:p-0">
        {colunaCanais}
      </Drawer>
      {drawerCanais}
      {modalNova}
    </div>
  );
}
