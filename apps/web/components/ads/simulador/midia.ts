'use client';

import type { ImagemAnalise } from '@/lib/ads-simulador';

/** Mídia carregada no navegador (não sobe para o servidor, só os frames da análise). */
export interface Midia {
  tipo: 'imagem' | 'video';
  url: string;
  nome: string;
  arquivo: File;
  segundos?: number;
  largura?: number;
  altura?: number;
}

const LADO_MAX = 768;

function paraJpeg(fonte: CanvasImageSource, w: number, h: number): string {
  const escala = Math.min(1, LADO_MAX / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * escala));
  c.height = Math.max(1, Math.round(h * escala));
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível');
  ctx.drawImage(fonte, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82).split(',')[1] ?? '';
}

export async function lerMidia(arquivo: File): Promise<Midia> {
  const url = URL.createObjectURL(arquivo);
  if (arquivo.type.startsWith('video/')) {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.src = url;
    await new Promise<void>((ok, erro) => {
      v.onloadedmetadata = () => ok();
      v.onerror = () => erro(new Error('Não consegui ler esse vídeo.'));
    });
    return { tipo: 'video', url, nome: arquivo.name, arquivo, segundos: Math.round(v.duration || 0), largura: v.videoWidth, altura: v.videoHeight };
  }
  if (!arquivo.type.startsWith('image/')) throw new Error('Envie uma imagem ou um vídeo.');
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => { throw new Error('Não consegui ler essa imagem.'); });
  return { tipo: 'imagem', url, nome: arquivo.name, arquivo, largura: img.naturalWidth, altura: img.naturalHeight };
}

/**
 * Frames para a IA: a imagem inteira, ou o INÍCIO do vídeo (0s, 1,5s e 3s),
 * que é onde o hook visual ganha ou perde a pessoa.
 */
export async function framesParaAnalise(m: Midia): Promise<ImagemAnalise[]> {
  if (m.tipo === 'imagem') {
    const img = new Image();
    img.src = m.url;
    await img.decode();
    return [{ tipo: 'image/jpeg', base64: paraJpeg(img, img.naturalWidth, img.naturalHeight), rotulo: 'imagem do anúncio' }];
  }
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.playsInline = true;
  v.src = m.url;
  await new Promise<void>((ok, erro) => {
    v.onloadeddata = () => ok();
    v.onerror = () => erro(new Error('Não consegui ler esse vídeo.'));
  });
  const marcas = [0.1, 1.5, 3].filter((t) => t < (v.duration || 0) || t === 0.1);
  const out: ImagemAnalise[] = [];
  for (const t of marcas) {
    v.currentTime = Math.min(t, Math.max(0, (v.duration || 0) - 0.05));
    await new Promise<void>((ok) => { v.onseeked = () => ok(); });
    out.push({ tipo: 'image/jpeg', base64: paraJpeg(v, v.videoWidth, v.videoHeight), rotulo: `frame ${t < 1 ? 0 : t}s do vídeo` });
  }
  return out;
}
