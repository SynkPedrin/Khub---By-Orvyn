'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from '@/components/icons';
import { CTA_ROTULO, type CriativoSim } from '@/lib/ads-simulador';
import type { Midia } from './midia';

/**
 * Prévia do anúncio como ele aparece no celular (feed ou stories). Mock
 * genérico de rede social, só para o operador enxergar a peça montada.
 */
export function PreviewAnuncio({ criativo, midia, pagina }: { criativo: CriativoSim; midia: Midia | null; pagina: string }) {
  const [modo, setModo] = useState<'feed' | 'stories'>('feed');
  const [mais, setMais] = useState(false);
  const texto = criativo.copy.trim() || 'O texto principal do anúncio aparece aqui.';
  const curto = texto.length > 125 && !mais ? `${texto.slice(0, 125).trimEnd()}… ` : texto;

  const visual = (
    <div className="relative h-full w-full overflow-hidden bg-surface3">
      {midia?.tipo === 'imagem' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={midia.url} alt="" className="h-full w-full object-cover" />
      )}
      {midia?.tipo === 'video' && <video src={midia.url} className="h-full w-full object-cover" autoPlay muted loop playsInline />}
      {!midia && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-5 text-center" style={{ background: 'linear-gradient(150deg, #0b1d3a 0%, #0064e0 60%, #00a6ff 100%)' }}>
          <Icon name={criativo.formato === 'video' ? 'video' : 'eye'} size={22} className="text-white/70" />
          <p className="text-[13px] font-bold leading-snug text-white">{criativo.hook || 'Seu hook aparece aqui'}</p>
          <p className="text-2xs text-white/60">Envie a imagem ou o vídeo para ver a peça real</p>
        </div>
      )}
      {midia && criativo.hook && (
        <motion.p
          key={criativo.hook}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute inset-x-3 top-3 rounded-lg bg-black/55 px-2.5 py-1.5 text-center text-[12px] font-bold leading-snug text-white backdrop-blur-sm"
        >
          {criativo.hook}
        </motion.p>
      )}
      {criativo.formato === 'carrossel' && (
        <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
          {[0, 1, 2].map((i) => <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === 0 ? 'bg-white' : 'bg-white/45'}`} />)}
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-muted">Prévia</p>
        <div className="flex rounded-lg border border-line bg-surface2 p-0.5 text-2xs font-semibold">
          {(['feed', 'stories'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setModo(m)} className={`relative rounded-md px-2 py-1 ${modo === m ? 'text-fg' : 'text-muted'}`}>
              {modo === m && <motion.span layoutId="preview-modo" className="absolute inset-0 rounded-md bg-surface shadow-sm" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
              <span className="relative">{m === 'feed' ? 'Feed' : 'Stories'}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[300px] rounded-[30px] border border-line bg-black p-2 shadow-xl">
        <div className="overflow-hidden rounded-[24px] bg-white text-[#0f1419]">
          <AnimatePresence mode="wait" initial={false}>
            {modo === 'feed' ? (
              <motion.div key="feed" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.18 }}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0081fb] text-xs font-bold text-white">{pagina.slice(0, 1).toUpperCase() || 'P'}</span>
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="truncate text-[12px] font-semibold">{pagina || 'Sua página'}</p>
                    <p className="text-2xs text-[#65676b]">Patrocinado</p>
                  </div>
                  <Icon name="dots" size={16} className="text-[#65676b]" />
                </div>
                <p className="whitespace-pre-line px-3 pb-2 text-[12px] leading-snug">
                  {curto}
                  {texto.length > 125 && !mais && <button type="button" className="text-[#65676b]" onClick={() => setMais(true)}>mais</button>}
                </p>
                <div className="aspect-square w-full">{visual}</div>
                <div className="flex items-center justify-between gap-2 bg-[#f0f2f5] px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-2xs uppercase text-[#65676b]">{criativo.cta === 'enviar_mensagem' ? 'WhatsApp' : 'Saiba mais'}</p>
                    <p className="truncate text-[12px] font-semibold">{criativo.titulo || 'Título do anúncio'}</p>
                  </div>
                  <span className="shrink-0 rounded-md bg-[#e4e6eb] px-2.5 py-1.5 text-[11px] font-semibold">{CTA_ROTULO[criativo.cta]}</span>
                </div>
              </motion.div>
            ) : (
              <motion.div key="stories" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }} className="relative aspect-[9/16] w-full">
                {visual}
                <div className="absolute inset-x-0 top-0 p-2.5">
                  <div className="mb-2 h-0.5 overflow-hidden rounded bg-white/35">
                    <motion.div className="h-full bg-white" initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: 5, repeat: Infinity, ease: 'linear' }} />
                  </div>
                  <div className="flex items-center gap-2 text-white">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0081fb] text-2xs font-bold">{pagina.slice(0, 1).toUpperCase() || 'P'}</span>
                    <p className="text-[11px] font-semibold drop-shadow">{pagina || 'Sua página'}</p>
                    <p className="text-2xs opacity-80 drop-shadow">Patrocinado</p>
                  </div>
                </div>
                <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-3 pb-3 pt-10">
                  <Icon name="chevronDown" size={14} className="rotate-180 text-white" />
                  <span className="rounded-full bg-white px-3.5 py-1.5 text-[11px] font-semibold text-[#0f1419]">{CTA_ROTULO[criativo.cta]}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
