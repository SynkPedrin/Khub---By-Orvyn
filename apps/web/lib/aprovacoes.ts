'use client';

import { clienteApi } from './session-fetch';

/** Aprovações do cliente: artes e roteiros (API `/v1/aprovacoes`, db/085). */
const req = clienteApi('/api/v1/aprovacoes');

export type TipoAprovacao = 'arte' | 'roteiro' | 'video' | 'outro';
export type StatusAprovacao = 'pendente' | 'aprovado' | 'ajustes' | 'recusado';
export type Resposta = 'aprovado' | 'ajustes' | 'recusado';

export interface AprovacaoResumo {
  id: string;
  tipo: TipoAprovacao;
  titulo: string;
  descricao: string | null;
  canal: string | null;
  status: StatusAprovacao;
  versao: number;
  publicarEm: string | null;
  prazoEm: string | null;
  /** `null` = rascunho da equipe (o cliente ainda não vê). */
  enviadaEm: string | null;
  respondidoEm: string | null;
  createdAt: string;
  updatedAt: string;
  criadoPorNome: string | null;
  capaId: string | null;
  capaMime: string | null;
  qtdArquivos: number;
  qtdComentarios: number;
  trecho: string | null;
}

export interface ArquivoAprovacao { id: string; nome: string; mime: string; tamanho: number }
export interface ComentarioAprovacao { id: string; autorNome: string; autorId: string | null; texto: string; acao: Resposta | 'reenviado' | null; versao: number; createdAt: string }

export interface AprovacaoDetalhe extends Omit<AprovacaoResumo, 'capaId' | 'capaMime' | 'qtdArquivos' | 'qtdComentarios' | 'trecho'> {
  conteudo: string | null;
  legenda: string | null;
  linkExterno: string | null;
  criadoPor: string | null;
  respondidoPorNome: string | null;
  arquivos: ArquivoAprovacao[];
  comentarios: ComentarioAprovacao[];
}

export interface ResumoAprovacoes { pendente: number; aprovado: number; ajustes: number; recusado: number; rascunhos: number; equipe: boolean }

export interface DadosAprovacao {
  tipo: TipoAprovacao;
  titulo: string;
  descricao?: string | null;
  conteudo?: string | null;
  legenda?: string | null;
  linkExterno?: string | null;
  canal?: string | null;
  publicarEm?: string | null;
  prazoEm?: string | null;
}

export const ROTULO_TIPO: Record<TipoAprovacao, string> = { arte: 'Arte', roteiro: 'Roteiro', video: 'Vídeo', outro: 'Outro' };
export const ROTULO_STATUS: Record<StatusAprovacao, string> = { pendente: 'Aguardando você', aprovado: 'Aprovado', ajustes: 'Ajustes pedidos', recusado: 'Recusado' };
/** Rótulo do ponto de vista da equipe (desktop). */
export const ROTULO_STATUS_EQUIPE: Record<StatusAprovacao, string> = { pendente: 'Aguardando cliente', aprovado: 'Aprovado', ajustes: 'Ajustes pedidos', recusado: 'Recusado' };

export const urlArquivo = (id: string, arquivoId: string) => `/api/aprovacoes-arquivo/${id}/${arquivoId}`;

type Visao = 'cliente' | 'equipe';
const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const aprovacoes = {
  listar: (f: { status?: StatusAprovacao[]; tipo?: TipoAprovacao; busca?: string; visao?: Visao } = {}) =>
    req<AprovacaoResumo[]>(qs({ status: f.status?.join(','), tipo: f.tipo, busca: f.busca, visao: f.visao === 'cliente' ? 'cliente' : undefined })),
  resumo: (visao?: Visao) => req<ResumoAprovacoes>(`/resumo${qs({ visao: visao === 'cliente' ? 'cliente' : undefined })}`),
  detalhe: (id: string) => req<AprovacaoDetalhe>(`/${id}`),
  criar: (d: DadosAprovacao) => req<{ id: string }>('', { method: 'POST', body: JSON.stringify(d) }),
  atualizar: (id: string, d: Partial<DadosAprovacao>) => req<{ ok: true }>(`/${id}`, { method: 'PATCH', body: JSON.stringify(d) }),
  remover: (id: string) => req<{ ok: true }>(`/${id}`, { method: 'DELETE' }),
  anexar: (id: string, a: { nome: string; mime: string; base64: string }) => req<ArquivoAprovacao>(`/${id}/arquivos`, { method: 'POST', body: JSON.stringify(a) }),
  removerArquivo: (id: string, arquivoId: string) => req<{ ok: true }>(`/${id}/arquivos/${arquivoId}`, { method: 'DELETE' }),
  enviar: (id: string, mensagem?: string) => req<{ ok: true; versao: number; avisados: number; celulares: number }>(`/${id}/enviar`, { method: 'POST', body: JSON.stringify({ mensagem }) }),
  responder: (id: string, acao: Resposta, comentario?: string) => req<{ ok: true; status: Resposta }>(`/${id}/responder`, { method: 'POST', body: JSON.stringify({ acao, comentario }) }),
  comentar: (id: string, texto: string) => req<{ ok: true }>(`/${id}/comentarios`, { method: 'POST', body: JSON.stringify({ texto }) }),
};

/**
 * Prepara um arquivo para envio: imagem é redimensionada (lado maior 2048 px)
 * e regravada em JPEG/WEBP até caber em ~3 MB — o limite de 4 MB do servidor
 * e o de 4,5 MB do proxy da Vercel. PNG com transparência vira WEBP. PDF vai como está.
 */
export async function prepararArquivo(f: File): Promise<{ nome: string; mime: string; base64: string }> {
  const LIMITE = 3 * 1024 * 1024;
  const paraBase64 = (b: Blob) =>
    new Promise<string>((ok, erro) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).replace(/^data:[^;]+;base64,/, ''));
      r.onerror = () => erro(new Error('Não foi possível ler o arquivo.'));
      r.readAsDataURL(b);
    });
  if (f.type === 'application/pdf') {
    if (f.size > LIMITE) throw new Error('PDF maior que 3 MB. Exporte em qualidade menor ou mande por link.');
    return { nome: f.name, mime: f.type, base64: await paraBase64(f) };
  }
  if (!/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(f.type) && !/\.(heic|heif)$/i.test(f.name)) {
    throw new Error('Formato não aceito: envie imagem (JPG, PNG, WEBP) ou PDF. Vídeo vai por link.');
  }
  if (f.type === 'image/gif' && f.size <= LIMITE) return { nome: f.name, mime: f.type, base64: await paraBase64(f) };
  const bitmap = await createImageBitmap(f).catch(() => null);
  if (!bitmap) {
    if (f.size <= LIMITE && /^image\/(jpeg|png|webp)$/.test(f.type)) return { nome: f.name, mime: f.type, base64: await paraBase64(f) };
    throw new Error('Não foi possível abrir esta imagem. Exporte em JPG ou PNG.');
  }
  const escala = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const mime = f.type === 'image/png' ? 'image/webp' : 'image/jpeg';
  let blob: Blob | null = null;
  for (const q of [0.9, 0.82, 0.72, 0.6, 0.5]) {
    blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, mime, q));
    if (blob && blob.size <= LIMITE) break;
  }
  if (!blob || blob.size > LIMITE) throw new Error('Imagem grande demais mesmo comprimida.');
  const nome = f.name.replace(/\.[^.]+$/, '') + (mime === 'image/webp' ? '.webp' : '.jpg');
  return { nome, mime, base64: await paraBase64(blob) };
}
