'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from '../icons';
import { ApiError } from '@/lib/api-error';
import {
  OBJETIVO_ROTULO, POSICIONAMENTO_ROTULO, PUBLICOS, simulador, simuladorSalvas,
  type CriativoSim, type EntradaSimulacao, type Objetivo, type Posicionamento, type ResultadoSimulacao,
} from '@/lib/ads-simulador';
import { MetaLogoAnimado } from '../ads/MetaLogoAnimado';
import { EditorCriativo } from '../ads/simulador/EditorCriativo';
import { PreviewAnuncio } from '../ads/simulador/PreviewAnuncio';
import { ResultadoSimulacaoPainel } from '../ads/simulador/ResultadoSimulacao';
import type { Midia } from '../ads/simulador/midia';

/**
 * Gerenciador de campanhas em modo SIMULADOR (ambiente de teste da Meta).
 *
 * O operador monta a campanha (objetivo, verba, público, posicionamento) e até
 * 3 criativos (hook, copy, título, CTA, imagem/vídeo) e o motor da API
 * (`/v1/ads/simulador`) projeta o que a verba entrega, dia a dia, com faixa
 * provável, teste A/B e curva de verba. Calibra com o histórico real da conta
 * quando a Meta está conectada. A IA analisa texto e visual do criativo.
 *
 * As simulações salvas ficam na subconta (db/067, via API); o localStorage
 * vira espelho offline. A mídia nunca sai do navegador, só os frames da
 * análise.
 */

interface CriativoUi { id: string; c: CriativoSim; midia: Midia | null }
interface Salva { id: string; nome: string; entrada: EntradaSimulacao; negocio: string; pagina: string; resumo: { resultados: number; cpr: number; nome: string; investimento: number }; salvoEm: string }

const CHAVE = 'khub:ads-simulador:v2';
const LETRAS = ['A', 'B', 'C'];
const uid = () => Math.random().toString(36).slice(2, 10);
const brl = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const GERA_VENDA: Record<Objetivo, boolean> = { mensagens: true, leads: true, conversoes: true, trafego: false, alcance: false, engajamento: false };
const FRASES = ['Entrando no leilão da Meta…', 'Passando pela fase de aprendizado…', 'Medindo cansaço do criativo…', 'Rodando 400 cenários…'];

const criativoVazio = (letra: string): CriativoSim => ({ nome: `Criativo ${letra}`, formato: 'video', hook: '', copy: '', titulo: '', cta: 'enviar_mensagem', videoSegundos: 15, legendas: true, rosto: true, textoNaImagem: 'pouco' });

function lerSalvas(): Salva[] {
  try {
    const s = localStorage.getItem(CHAVE);
    const v: unknown = s ? JSON.parse(s) : [];
    return Array.isArray(v) ? (v as Salva[]) : [];
  } catch {
    return [];
  }
}
function gravarSalvas(l: Salva[]) {
  try { localStorage.setItem(CHAVE, JSON.stringify(l)); } catch { /* navegador sem storage: segue sem salvar */ }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function daApi(s: import('@/lib/ads-simulador').SimulacaoSalvaApi): Salva {
  const r = s.resumo as Partial<Salva['resumo'] & { negocio?: string; pagina?: string }>;
  return {
    id: s.id,
    nome: s.nome,
    entrada: s.entrada,
    negocio: typeof r.negocio === 'string' ? r.negocio : '',
    pagina: typeof r.pagina === 'string' ? r.pagina : '',
    resumo: { resultados: Number(r.resultados) || 0, cpr: Number(r.cpr) || 0, nome: String(r.nome ?? ''), investimento: Number(r.investimento) || 0 },
    salvoEm: s.salvoEm,
  };
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-semibold text-muted">{children}</label>;
}

function Segmentado<T extends string>({ id, valor, opcoes, onChange }: { id: string; valor: T; opcoes: { v: T; rotulo: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-xl border border-line bg-surface2 p-1">
      {opcoes.map((o) => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)} className={`relative flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold ${valor === o.v ? 'text-fg' : 'text-muted hover:text-fg'}`}>
          {valor === o.v && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-lg bg-surface shadow-sm" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
          <span className="relative">{o.rotulo}</span>
        </button>
      ))}
    </div>
  );
}

function Deslizante({ valor, min, max, passo = 1, onChange, formatar }: { valor: number; min: number; max: number; passo?: number; onChange: (v: number) => void; formatar: (v: number) => string }) {
  const pct = ((Math.min(max, Math.max(min, valor)) - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-3">
      <input
        type="range" min={min} max={max} step={passo} value={Math.min(max, valor)} onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full accent-[var(--brand)]"
        style={{ background: `linear-gradient(to right, var(--brand) ${pct}%, var(--surface-3) ${pct}%)` }}
      />
      <span className="w-20 text-right text-sm font-bold tabular-nums text-fg">{formatar(valor)}</span>
    </div>
  );
}

export function AdsSimulador() {
  const [salvas, setSalvas] = useState<Salva[]>([]);
  const [aberto, setAberto] = useState(false);
  const [idAtual, setIdAtual] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [negocio, setNegocio] = useState('');
  const [pagina, setPagina] = useState('');
  const [campanha, setCampanha] = useState<Omit<EntradaSimulacao, 'criativos'>>({ objetivo: 'mensagens', orcamentoDia: 50, dias: 14, publico: 400_000, posicionamento: 'automatico', ticketMedio: 300, taxaFechamento: 20 });
  const [criativos, setCriativos] = useState<CriativoUi[]>([{ id: uid(), c: criativoVazio('A'), midia: null }]);
  const [ativo, setAtivo] = useState(0);
  const [avancado, setAvancado] = useState(false);
  const [resultado, setResultado] = useState<ResultadoSimulacao | null>(null);
  const [simulando, setSimulando] = useState(false);
  const [recalculando, setRecalculando] = useState(false);
  const [frase, setFrase] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [salvoOk, setSalvoOk] = useState(false);
  const resultadoRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    let vivo = true;
    simuladorSalvas.listar()
      .then((l) => { if (!vivo) return; const m = l.map(daApi); setSalvas(m); gravarSalvas(m); })
      .catch(() => { if (vivo) setSalvas(lerSalvas()); });
    return () => { vivo = false; };
  }, []);

  // Libera os object URLs da mídia ao sair.
  const midiasRef = useRef<CriativoUi[]>(criativos);
  midiasRef.current = criativos;
  useEffect(() => () => { midiasRef.current.forEach((x) => x.midia && URL.revokeObjectURL(x.midia.url)); }, []);

  const entrada: EntradaSimulacao = useMemo(
    () => ({ ...campanha, criativos: criativos.map((x, i) => ({ ...x.c, nome: `Criativo ${LETRAS[i]}` })) }),
    [campanha, criativos],
  );

  const rodar = useCallback(async (e: EntradaSimulacao, silencioso: boolean) => {
    const meu = ++seq.current;
    setErro(null);
    if (silencioso) setRecalculando(true); else setSimulando(true);
    try {
      const [r] = await Promise.all([simulador.simular(e), new Promise((ok) => setTimeout(ok, silencioso ? 0 : 1400))]);
      if (meu !== seq.current) return;
      setResultado(r);
      if (!silencioso) setTimeout(() => resultadoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } catch (x) {
      if (meu !== seq.current) return;
      setErro(x instanceof ApiError && x.status === 400 ? 'Confira os campos: verba mínima R$ 6/dia, até 90 dias e público a partir de 1.000 pessoas.' : 'Não consegui simular agora. Tente de novo.');
    } finally {
      if (meu === seq.current) { setSimulando(false); setRecalculando(false); }
    }
  }, []);

  // Depois da primeira simulação, cada mudança recalcula ao vivo.
  useEffect(() => {
    if (!resultado || simulando) return;
    const t = setTimeout(() => { void rodar(entrada, true); }, 650);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entrada]);

  useEffect(() => {
    if (!simulando) return;
    const t = setInterval(() => setFrase((f) => (f + 1) % FRASES.length), 420);
    return () => clearInterval(t);
  }, [simulando]);

  const novo = () => {
    criativos.forEach((x) => x.midia && URL.revokeObjectURL(x.midia.url));
    setIdAtual(null);
    setNome('');
    setCriativos([{ id: uid(), c: criativoVazio('A'), midia: null }]);
    setAtivo(0);
    setResultado(null);
    setErro(null);
    setAberto(true);
  };

  const abrir = (s: Salva) => {
    criativos.forEach((x) => x.midia && URL.revokeObjectURL(x.midia.url));
    const { criativos: cs, ...camp } = s.entrada;
    setIdAtual(s.id);
    setNome(s.nome);
    setNegocio(s.negocio);
    setPagina(s.pagina);
    setCampanha(camp);
    setCriativos(cs.map((c) => ({ id: uid(), c, midia: null })));
    setAtivo(0);
    setResultado(null);
    setAberto(true);
    void rodar(s.entrada, false);
  };

  const salvar = () => {
    if (!resultado) return;
    const id = idAtual ?? uid();
    const item: Salva = {
      id,
      nome: nome.trim() || `Simulação ${new Date().toLocaleDateString('pt-BR')}`,
      entrada,
      negocio,
      pagina,
      resumo: { resultados: resultado.total.resultados.p50, cpr: resultado.total.custoPorResultado.p50, nome: resultado.resultadoNome, investimento: resultado.total.investimento },
      salvoEm: new Date().toISOString(),
    };
    const lista = [item, ...salvas.filter((s) => s.id !== id)].slice(0, 30);
    setSalvas(lista);
    gravarSalvas(lista);
    setIdAtual(id);
    setSalvoOk(true);
    setTimeout(() => setSalvoOk(false), 1600);
    void simuladorSalvas.salvar({ ...(UUID_RE.test(id) ? { id } : {}), nome: item.nome, entrada, resumo: { ...item.resumo, negocio, pagina } })
      .then((s) => {
        setIdAtual(s.id);
        setSalvas((l) => {
          const m = [daApi(s), ...l.filter((x) => x.id !== id && x.id !== s.id)].slice(0, 50);
          gravarSalvas(m);
          return m;
        });
      })
      .catch(() => { /* API fora: a cópia do navegador segue valendo */ });
  };

  const remover = (id: string) => {
    const lista = salvas.filter((s) => s.id !== id);
    setSalvas(lista);
    gravarSalvas(lista);
    if (UUID_RE.test(id)) void simuladorSalvas.remover(id).catch(() => { /* já some na próxima carga */ });
  };

  const setCamp = (p: Partial<typeof campanha>) => setCampanha((c) => ({ ...c, ...p }));
  const setCriativo = (i: number, c: CriativoSim) => setCriativos((l) => l.map((x, j) => (j === i ? { ...x, c } : x)));
  const setMidia = (i: number, m: Midia | null) => setCriativos((l) => l.map((x, j) => {
    if (j !== i) return x;
    if (x.midia && x.midia.url !== m?.url) URL.revokeObjectURL(x.midia.url);
    return { ...x, midia: m };
  }));
  const variacao = () => {
    if (criativos.length >= 3) return;
    const base = criativos[ativo].c;
    setCriativos((l) => [...l, { id: uid(), c: { ...base, nome: `Criativo ${LETRAS[l.length]}`, notaVisualIa: undefined }, midia: null }]);
    setAtivo(criativos.length);
  };
  const tirarVariacao = (i: number) => {
    if (criativos.length <= 1) return;
    const m = criativos[i].midia;
    if (m) URL.revokeObjectURL(m.url);
    setCriativos((l) => l.filter((_, j) => j !== i));
    setAtivo((a) => Math.max(0, a >= i ? a - 1 : a));
  };

  const publicoPreset = PUBLICOS.some((p) => p.valor === campanha.publico);
  const atual = criativos[Math.min(ativo, criativos.length - 1)];

  return (
    <div className="card overflow-hidden p-5">
      {/* cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <MetaLogoAnimado size={42} simulando={simulando || recalculando} />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-fg">Gerenciador de campanhas</h2>
              <span className="rounded-full border border-[#0081fb]/40 bg-[#0081fb]/10 px-2 py-0.5 text-2xs font-semibold text-[#0081fb]">Simulador</span>
            </div>
            <p className="text-[11px] text-muted">Teste copy, criativo, vídeo, hook e CTA com verba simulada antes de gastar de verdade.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {aberto && <button type="button" onClick={() => setAberto(false)} className="btn btn-ghost text-sm">Fechar</button>}
          <motion.button whileTap={{ scale: 0.96 }} type="button" onClick={novo} className="btn btn-primary text-sm"><Icon name="plus" size={15} /> Nova simulação</motion.button>
        </div>
      </div>

      {/* vazio */}
      {!aberto && salvas.length === 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative mt-4 overflow-hidden rounded-2xl border border-dashed border-line px-6 py-10 text-center">
          <div className="pointer-events-none absolute inset-0 opacity-60" style={{ background: 'radial-gradient(60% 80% at 50% 0%, rgba(0,129,251,0.14), transparent 70%)' }} />
          <div className="relative flex flex-col items-center">
            <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}>
              <MetaLogoAnimado size={68} />
            </motion.div>
            <p className="mt-4 text-sm font-semibold text-fg">Simule sua próxima campanha antes de pôr dinheiro</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted">Monte o anúncio, compare até 3 criativos e veja quanto a verba entrega por dia: custo por resultado, alcance, fase de aprendizado e o ponto em que escalar deixa de valer.</p>
            <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }} type="button" onClick={novo} className="btn btn-primary mt-4 text-sm"><Icon name="play" size={15} /> Começar simulação</motion.button>
          </div>
        </motion.div>
      )}

      {/* salvas */}
      {!aberto && salvas.length > 0 && (
        <div className="mt-4 grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {salvas.map((s, i) => (
            <motion.div key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="group rounded-2xl border border-line bg-surface p-3.5 transition-colors hover:border-[#0081fb]/50">
              <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={() => abrir(s)} className="min-w-0 text-left">
                  <p className="truncate font-semibold text-fg">{s.nome}</p>
                  <p className="truncate text-[11px] text-muted">{OBJETIVO_ROTULO[s.entrada.objetivo]} · {brl(s.entrada.orcamentoDia)}/dia · {s.entrada.dias} dias · {s.entrada.criativos.length} criativo(s)</p>
                </button>
                <button type="button" onClick={() => remover(s.id)} className="rounded-lg p-1 text-muted opacity-60 hover:text-red-500 group-hover:opacity-100" aria-label="Excluir simulação"><Icon name="close" size={14} /></button>
              </div>
              <button type="button" onClick={() => abrir(s)} className="mt-3 grid w-full grid-cols-3 gap-2 text-left text-xs">
                <span><span className="block text-2xs text-muted">Verba</span><b className="text-fg">{brl(s.resumo.investimento)}</b></span>
                <span><span className="block text-2xs capitalize text-muted">{s.resumo.nome}</span><b className="text-fg">{Math.round(s.resumo.resultados).toLocaleString('pt-BR')}</b></span>
                <span><span className="block text-2xs text-muted">Custo/result.</span><b className="text-brand">{brl(s.resumo.cpr)}</b></span>
              </button>
            </motion.div>
          ))}
        </div>
      )}

      {/* editor */}
      <AnimatePresence initial={false}>
        {aberto && (
          <motion.div key="editor" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 32 }} className="overflow-hidden">
            <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_320px]">
              {/* campanha */}
              <section className="space-y-3.5 rounded-2xl border border-line bg-surface p-4">
                <p className="flex items-center gap-2 text-sm font-bold text-fg"><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#0081fb]/12 text-2xs font-bold text-[#0081fb]">1</span> Campanha</p>
                <div><Rotulo>Nome</Rotulo><input className="input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Captação avaliação · novembro" /></div>
                <div>
                  <Rotulo>Objetivo</Rotulo>
                  <select className="input" value={campanha.objetivo} onChange={(e) => setCamp({ objetivo: e.target.value as Objetivo })}>
                    {(Object.keys(OBJETIVO_ROTULO) as Objetivo[]).map((o) => <option key={o} value={o}>{OBJETIVO_ROTULO[o]}</option>)}
                  </select>
                </div>
                <div>
                  <Rotulo>Verba por dia</Rotulo>
                  <Deslizante valor={campanha.orcamentoDia} min={6} max={2000} passo={1} onChange={(v) => setCamp({ orcamentoDia: v })} formatar={(v) => brl(v)} />
                </div>
                <div>
                  <Rotulo>Duração</Rotulo>
                  <Deslizante valor={campanha.dias} min={1} max={90} onChange={(v) => setCamp({ dias: v })} formatar={(v) => `${v} dias`} />
                  <p className="mt-1 text-2xs text-muted">Total: <b className="text-fg">{brl(campanha.orcamentoDia * campanha.dias)}</b></p>
                </div>
                <div>
                  <Rotulo>Público</Rotulo>
                  <select className="input" value={publicoPreset ? String(campanha.publico) : 'outro'} onChange={(e) => { if (e.target.value !== 'outro') setCamp({ publico: Number(e.target.value) }); else setCamp({ publico: 250_000 }); }}>
                    {PUBLICOS.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
                    <option value="outro">Outro tamanho…</option>
                  </select>
                  {!publicoPreset && <input type="number" min={1000} className="input mt-2" value={campanha.publico} onChange={(e) => setCamp({ publico: Math.max(1000, Number(e.target.value) || 1000) })} />}
                </div>
                <div>
                  <Rotulo>Posicionamento</Rotulo>
                  <Segmentado id="pos" valor={campanha.posicionamento} onChange={(v: Posicionamento) => setCamp({ posicionamento: v })} opcoes={(Object.keys(POSICIONAMENTO_ROTULO) as Posicionamento[]).map((p) => ({ v: p, rotulo: p === 'automatico' ? 'Automático' : POSICIONAMENTO_ROTULO[p] }))} />
                </div>
                {GERA_VENDA[campanha.objetivo] && (
                  <div className="grid grid-cols-2 gap-3">
                    <div><Rotulo>Ticket médio (R$)</Rotulo><input type="number" min={0} className="input" value={campanha.ticketMedio} onChange={(e) => setCamp({ ticketMedio: Math.max(0, Number(e.target.value) || 0) })} /></div>
                    <div><Rotulo>Fechamento (%)</Rotulo><input type="number" min={0} max={100} className="input" value={campanha.taxaFechamento} onChange={(e) => setCamp({ taxaFechamento: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div><Rotulo>Nome da página</Rotulo><input className="input" value={pagina} onChange={(e) => setPagina(e.target.value)} placeholder="Studio da Beleza" /></div>
                  <div><Rotulo>Negócio (para a IA)</Rotulo><input className="input" value={negocio} maxLength={200} onChange={(e) => setNegocio(e.target.value)} placeholder="Clínica de estética" /></div>
                </div>
                <button type="button" onClick={() => setAvancado((v) => !v)} className="flex items-center gap-1 text-xs font-semibold text-muted hover:text-fg">
                  <Icon name="chevronRight" size={12} className={`transition-transform ${avancado ? 'rotate-90' : ''}`} /> Premissas de mercado
                </button>
                <AnimatePresence initial={false}>
                  {avancado && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="grid grid-cols-3 gap-2">
                        {([['cpm', 'CPM (R$)'], ['ctr', 'CTR (%)'], ['conversao', 'Conversão (%)']] as const).map(([k, rot]) => (
                          <div key={k}>
                            <Rotulo>{rot}</Rotulo>
                            <input
                              type="number" step="0.1" className="input" value={campanha.premissas?.[k] ?? ''}
                              placeholder={resultado ? resultado.base[k].toFixed(k === 'cpm' ? 0 : 1) : 'auto'}
                              onChange={(e) => { const v = Number(e.target.value); setCamp({ premissas: { ...campanha.premissas, [k]: e.target.value === '' || !v ? undefined : v } }); }}
                            />
                          </div>
                        ))}
                      </div>
                      <p className="mt-1.5 text-2xs text-muted">Em branco, usa a sua conta Meta (se conectada) ou a referência de mercado.</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>

              {/* criativos */}
              <section className="rounded-2xl border border-line bg-surface p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-bold text-fg"><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#0081fb]/12 text-2xs font-bold text-[#0081fb]">2</span> Criativos</p>
                  <div className="flex items-center gap-1">
                    {criativos.map((x, i) => (
                      <div key={x.id} className="relative">
                        <button type="button" onClick={() => setAtivo(i)} className={`relative rounded-lg px-3 py-1.5 text-xs font-bold ${ativo === i ? 'text-fg' : 'text-muted hover:text-fg'}`}>
                          {ativo === i && <motion.span layoutId="aba-criativo" className="absolute inset-0 rounded-lg border border-line bg-surface2" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
                          <span className="relative">{LETRAS[i]}</span>
                        </button>
                        {criativos.length > 1 && ativo === i && (
                          <button type="button" onClick={() => tirarVariacao(i)} className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-surface3 text-muted hover:text-red-500" aria-label={`Remover criativo ${LETRAS[i]}`}><Icon name="close" size={9} /></button>
                        )}
                      </div>
                    ))}
                    {criativos.length < 3 && (
                      <button type="button" onClick={variacao} className="ml-1 rounded-lg border border-dashed border-line px-2.5 py-1.5 text-xs font-semibold text-muted hover:border-brand/50 hover:text-brand">+ Variação A/B</button>
                    )}
                  </div>
                </div>
                {criativos.map((x, i) => (
                  <div key={x.id} hidden={i !== ativo}>
                    <EditorCriativo criativo={x.c} midia={x.midia} objetivo={campanha.objetivo} negocio={negocio} onChange={(c) => setCriativo(i, c)} onMidia={(m) => setMidia(i, m)} />
                  </div>
                ))}
                {/* prévia abaixo dos campos quando não há 3ª coluna */}
                <div className="mt-5 2xl:hidden"><PreviewAnuncio criativo={atual.c} midia={atual.midia} pagina={pagina} /></div>
              </section>

              {/* prévia */}
              <section className="hidden 2xl:block">
                <div className="sticky top-4"><PreviewAnuncio criativo={atual.c} midia={atual.midia} pagina={pagina} /></div>
              </section>
            </div>

            {/* ação */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface2/60 px-4 py-3">
              <p className="text-xs text-muted">
                {criativos.length > 1 ? `Teste A/B: a verba se divide igual entre ${criativos.length} criativos (${brl(campanha.orcamentoDia / criativos.length)}/dia cada).` : 'Adicione uma variação para comparar hooks, copies ou criativos.'}
                {resultado && <span className="ml-1 text-faint">Atualiza sozinho enquanto você edita.</span>}
              </p>
              <div className="flex items-center gap-2">
                {resultado && (
                  <motion.button whileTap={{ scale: 0.96 }} type="button" onClick={salvar} className="btn btn-ghost text-sm">
                    <Icon name={salvoOk ? 'check' : 'download'} size={15} /> {salvoOk ? 'Salva' : 'Salvar simulação'}
                  </motion.button>
                )}
                <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} type="button" disabled={simulando} onClick={() => rodar(entrada, false)} className="btn btn-primary text-sm disabled:opacity-70">
                  {simulando ? <MetaLogoAnimado size={18} simulando comFundo={false} /> : <Icon name="play" size={15} />}
                  {simulando ? 'Simulando…' : resultado ? 'Simular de novo' : 'Simular campanha'}
                </motion.button>
              </div>
            </div>
            {erro && <p className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">{erro}</p>}

            {/* resultado */}
            <div ref={resultadoRef} className="scroll-mt-4">
              <AnimatePresence mode="wait">
                {simulando && !resultado && (
                  <motion.div key="rodando" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="mt-5 flex flex-col items-center justify-center rounded-2xl border border-line py-12">
                    <MetaLogoAnimado size={84} simulando />
                    <AnimatePresence mode="wait">
                      <motion.p key={frase} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} className="mt-5 text-sm font-semibold text-fg">{FRASES[frase]}</motion.p>
                    </AnimatePresence>
                    <p className="mt-1 text-2xs text-muted">{brl(campanha.orcamentoDia * campanha.dias)} em {campanha.dias} dias · {criativos.length} criativo(s)</p>
                  </motion.div>
                )}
                {resultado && (
                  <motion.div key="resultado" initial={{ opacity: 0, y: 12 }} animate={{ opacity: recalculando || simulando ? 0.6 : 1, y: 0 }} transition={{ duration: 0.25 }} className="mt-5">
                    <div className="mb-3 flex items-center gap-2">
                      <p className="flex items-center gap-2 text-sm font-bold text-fg"><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#0081fb]/12 text-2xs font-bold text-[#0081fb]">3</span> O que essa verba entrega</p>
                      {(recalculando || simulando) && <span className="flex items-center gap-1.5 text-2xs text-muted"><MetaLogoAnimado size={14} simulando comFundo={false} /> recalculando</span>}
                    </div>
                    <ResultadoSimulacaoPainel r={resultado} orcamentoDia={campanha.orcamentoDia} onOrcamento={(v) => setCamp({ orcamentoDia: v })} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
