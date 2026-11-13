'use client';

import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from '@/components/icons';
import { ApiError } from '@/lib/api-error';
import { CTA_ROTULO, simulador, type AnaliseIa, type CriativoSim, type Cta, type Formato, type Objetivo } from '@/lib/ads-simulador';
import { MetaLogoAnimado } from '../MetaLogoAnimado';
import { framesParaAnalise, lerMidia, type Midia } from './midia';

const FORMATOS: { v: Formato; rotulo: string; icone: 'eye' | 'video' | 'layout' }[] = [
  { v: 'imagem', rotulo: 'Imagem', icone: 'eye' },
  { v: 'video', rotulo: 'Vídeo', icone: 'video' },
  { v: 'carrossel', rotulo: 'Carrossel', icone: 'layout' },
];

function Contador({ n, max }: { n: number; max: number }) {
  return <span className={`text-2xs tabular-nums ${n > max ? 'text-amber-500' : 'text-faint'}`}>{n}/{max}</span>;
}

function Alternar({ ativo, onChange, rotulo }: { ativo: boolean; onChange: (v: boolean) => void; rotulo: string }) {
  return (
    <button type="button" role="switch" aria-checked={ativo} onClick={() => onChange(!ativo)} className="flex items-center gap-2 text-xs text-fg">
      <span className={`relative h-5 w-9 rounded-full transition-colors ${ativo ? 'bg-brand' : 'bg-surface3'}`}>
        <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 34 }} className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow" style={{ left: ativo ? 18 : 2 }} />
      </span>
      {rotulo}
    </button>
  );
}

export function EditorCriativo({
  criativo, midia, objetivo, negocio, onChange, onMidia,
}: {
  criativo: CriativoSim;
  midia: Midia | null;
  objetivo: Objetivo;
  negocio: string;
  onChange: (c: CriativoSim) => void;
  onMidia: (m: Midia | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [erroMidia, setErroMidia] = useState<string | null>(null);
  const [analise, setAnalise] = useState<AnaliseIa | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [erroIa, setErroIa] = useState<string | null>(null);
  const set = (p: Partial<CriativoSim>) => onChange({ ...criativo, ...p });
  const palavrasHook = criativo.hook.trim() ? criativo.hook.trim().split(/\s+/).length : 0;

  const escolher = async (f: File | undefined) => {
    if (!f) return;
    setErroMidia(null);
    if (f.size > 200 * 1024 * 1024) { setErroMidia('Arquivo acima de 200 MB.'); return; }
    try {
      const m = await lerMidia(f);
      onMidia(m);
      if (m.tipo === 'video') set({ formato: 'video', videoSegundos: Math.max(1, m.segundos ?? 0) || criativo.videoSegundos, notaVisualIa: undefined });
      else set({ formato: criativo.formato === 'video' ? 'imagem' : criativo.formato, notaVisualIa: undefined });
      setAnalise(null);
    } catch (e) {
      setErroMidia(e instanceof Error ? e.message : 'Não consegui ler o arquivo.');
    }
  };

  const analisar = async () => {
    setAnalisando(true);
    setErroIa(null);
    try {
      const imagens = midia ? await framesParaAnalise(midia) : [];
      const { notaVisualIa: _ignorada, ...semNota } = criativo;
      void _ignorada;
      const r = await simulador.analisar({ objetivo, criativo: semNota, negocio, imagens });
      setAnalise(r);
      // A nota visual entra na nota do criativo e na projeção.
      set({ notaVisualIa: r.notaVisual ?? undefined });
    } catch (e) {
      const cr = e instanceof ApiError ? e.configRequired : null;
      setErroIa(cr ? `Configure a IA (${cr.provider}: ${cr.missing.join(', ') || 'credencial'}) para analisar o criativo.` : e instanceof ApiError && e.status === 502 ? 'A IA não devolveu uma análise válida. Tente de novo.' : 'Não consegui analisar agora. Tente de novo.');
    } finally {
      setAnalisando(false);
    }
  };

  return (
    <div className="space-y-3.5">
      {/* formato */}
      <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-line bg-surface2 p-1">
        {FORMATOS.map((f) => (
          <button key={f.v} type="button" onClick={() => set({ formato: f.v })} className={`relative flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold ${criativo.formato === f.v ? 'text-fg' : 'text-muted hover:text-fg'}`}>
            {criativo.formato === f.v && <motion.span layoutId={`formato-${criativo.nome}`} className="absolute inset-0 rounded-lg bg-surface shadow-sm" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
            <Icon name={f.icone} size={14} className="relative" />
            <span className="relative">{f.rotulo}</span>
          </button>
        ))}
      </div>

      {/* mídia */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void escolher(e.dataTransfer.files?.[0]); }}
        className="flex items-center gap-3 rounded-xl border border-dashed border-line bg-surface2/60 p-3"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface3 text-muted">
          {midia?.tipo === 'imagem' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={midia.url} alt="" className="h-full w-full object-cover" />
          ) : (
            <Icon name={midia?.tipo === 'video' ? 'video' : 'upload'} size={18} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-fg">{midia ? midia.nome : 'Imagem ou vídeo do anúncio'}</p>
          <p className="text-2xs text-muted">
            {midia ? `${midia.tipo === 'video' ? `${midia.segundos}s · ` : ''}${midia.largura}×${midia.altura}` : 'Arraste aqui ou escolha. Fica só no seu navegador.'}
          </p>
          {erroMidia && <p className="text-2xs text-amber-500">{erroMidia}</p>}
        </div>
        <input ref={input} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => { void escolher(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" onClick={() => input.current?.click()} className="btn btn-ghost px-2.5 py-1 text-xs">{midia ? 'Trocar' : 'Escolher'}</button>
        {midia && <button type="button" onClick={() => { onMidia(null); set({ notaVisualIa: undefined }); }} className="rounded-lg p-1.5 text-muted hover:text-red-500" aria-label="Remover mídia"><Icon name="close" size={14} /></button>}
      </div>

      {criativo.formato === 'video' && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="flex items-center gap-2 text-xs text-muted">
            Duração
            <input type="number" min={1} max={600} className="input w-20 py-1 text-xs" value={criativo.videoSegundos ?? ''} onChange={(e) => set({ videoSegundos: Math.max(1, Math.min(600, Number(e.target.value) || 1)) })} />
            s
          </label>
          <Alternar ativo={!!criativo.legendas} onChange={(v) => set({ legendas: v })} rotulo="Tem legenda" />
          <Alternar ativo={!!criativo.rosto} onChange={(v) => set({ rosto: v })} rotulo="Aparece rosto" />
        </div>
      )}
      {criativo.formato !== 'video' && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Alternar ativo={!!criativo.rosto} onChange={(v) => set({ rosto: v })} rotulo="Aparece rosto" />
          {criativo.formato === 'imagem' && (
            <label className="flex items-center gap-2 text-xs text-muted">
              Texto na imagem
              <select className="input w-auto py-1 text-xs" value={criativo.textoNaImagem ?? 'pouco'} onChange={(e) => set({ textoNaImagem: e.target.value as CriativoSim['textoNaImagem'] })}>
                <option value="pouco">Pouco</option>
                <option value="medio">Médio</option>
                <option value="muito">Muito</option>
              </select>
            </label>
          )}
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs font-semibold text-muted">Hook (primeira frase / 3 primeiros segundos)</label>
          <span className={`text-2xs tabular-nums ${palavrasHook > 12 ? 'text-amber-500' : 'text-faint'}`}>{palavrasHook} palavras</span>
        </div>
        <input className="input" value={criativo.hook} maxLength={300} onChange={(e) => set({ hook: e.target.value })} placeholder="Você ainda sente dor ao sorrir?" />
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs font-semibold text-muted">Copy (texto principal)</label>
          <Contador n={criativo.copy.length} max={3000} />
        </div>
        <textarea className="input min-h-[110px] resize-y" value={criativo.copy} maxLength={3000} onChange={(e) => set({ copy: e.target.value })} placeholder={'Mais de 1.200 pacientes atendidos.\n\nAvaliação completa e plano sem surpresa no preço.\n\nChame no WhatsApp e agende.'} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center justify-between"><label className="text-xs font-semibold text-muted">Título</label><Contador n={criativo.titulo.length} max={40} /></div>
          <input className="input" value={criativo.titulo} maxLength={120} onChange={(e) => set({ titulo: e.target.value })} placeholder="Avaliação odontológica" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Botão (CTA)</label>
          <select className="input" value={criativo.cta} onChange={(e) => set({ cta: e.target.value as Cta })}>
            {(Object.keys(CTA_ROTULO) as Cta[]).map((c) => <option key={c} value={c}>{CTA_ROTULO[c]}</option>)}
          </select>
        </div>
      </div>

      {/* análise da IA */}
      <div className="rounded-xl border border-line bg-surface2/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-fg">Análise do criativo com IA</p>
            <p className="text-2xs text-muted">{midia ? (midia.tipo === 'video' ? 'Lê o texto e os 3 primeiros segundos do vídeo (pode levar até 1 min).' : 'Lê o texto e a imagem (pode levar até 1 min).') : 'Lê o texto. Envie a mídia para avaliar o visual também.'}</p>
          </div>
          <button type="button" onClick={analisar} disabled={analisando} className="btn btn-primary shrink-0 px-3 py-1.5 text-xs disabled:opacity-60">
            {analisando ? <MetaLogoAnimado size={16} simulando comFundo={false} /> : <Icon name="sparkles" size={14} />}
            {analisando ? 'Analisando…' : analise ? 'Analisar de novo' : 'Analisar'}
          </button>
        </div>
        {erroIa && <p className="mt-2 text-xs text-amber-500">{erroIa}</p>}
        <AnimatePresence>
          {analise && !analisando && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="mt-3 space-y-3 text-xs">
                <div className="flex items-start gap-3">
                  {analise.notaVisual !== null && (
                    <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border border-line bg-surface">
                      <span className="text-base font-bold leading-none text-fg">{Math.round(analise.notaVisual)}</span>
                      <span className="text-2xs text-muted">visual</span>
                    </div>
                  )}
                  <p className="text-fg">{analise.resumo}</p>
                </div>
                {analise.pontosFortes.length > 0 && (
                  <ul className="space-y-1">{analise.pontosFortes.map((p) => <li key={p} className="flex gap-1.5 text-fg"><Icon name="check" size={13} className="mt-0.5 shrink-0 text-emerald-500" />{p}</li>)}</ul>
                )}
                {analise.melhorias.length > 0 && (
                  <ul className="space-y-1">{analise.melhorias.map((p) => <li key={p} className="flex gap-1.5 text-fg"><Icon name="arrowRight" size={13} className="mt-0.5 shrink-0 text-brand" />{p}</li>)}</ul>
                )}
                {analise.riscosPolitica.length > 0 && (
                  <ul className="space-y-1">{analise.riscosPolitica.map((p) => <li key={p} className="flex gap-1.5 text-amber-600 dark:text-amber-400"><Icon name="alert" size={13} className="mt-0.5 shrink-0" />{p}</li>)}</ul>
                )}
                {analise.hooksAlternativos.length > 0 && (
                  <div>
                    <p className="mb-1 font-semibold text-muted">Hooks para testar (clique para usar)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {analise.hooksAlternativos.map((h) => (
                        <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }} type="button" key={h} onClick={() => set({ hook: h })} className={`rounded-full border px-2.5 py-1 text-left ${criativo.hook === h ? 'border-brand bg-brand/12 text-fg' : 'border-line bg-surface text-fg hover:border-brand/50'}`}>{h}</motion.button>
                      ))}
                    </div>
                  </div>
                )}
                {analise.copySugerida && (
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <p className="font-semibold text-muted">Copy sugerida</p>
                      <button type="button" onClick={() => set({ copy: analise.copySugerida })} className="font-semibold text-brand hover:underline">Usar esta copy</button>
                    </div>
                    <p className="whitespace-pre-line rounded-lg border border-line bg-surface p-2.5 text-fg">{analise.copySugerida}</p>
                  </div>
                )}
                <p className="text-2xs text-faint">Modelo: {analise.modelo}{analise.analisouImagem ? ' · com visão' : ''}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
