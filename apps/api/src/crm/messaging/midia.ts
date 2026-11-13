import type { TipoMidia } from './provider.contract';

/**
 * Regras de mídia de saída do Inbox (Q2.5) — puras, para teste.
 *
 * Limites do WhatsApp (imagem 5 MB; áudio/documento maiores) cortados em
 * 15 MB para caber no parser JSON da rota (base64 ≈ +37%, ver main.ts).
 * Sem storage, só vai o que cabe em base64 direto ao provedor: 5 MB.
 */
export const LIMITE_BASE64_SEM_STORAGE = 5 * 1024 * 1024;

const MIMES: Record<TipoMidia, { mimes: string[]; max: number }> = {
  imagem: { mimes: ['image/jpeg', 'image/png', 'image/webp'], max: 5 * 1024 * 1024 },
  audio: { mimes: ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr'], max: 15 * 1024 * 1024 },
  documento: {
    mimes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/csv',
      'application/zip',
    ],
    max: 15 * 1024 * 1024,
  },
};

/** Assinatura dos primeiros bytes: o MIME declarado pelo browser não é prova. */
const MAGICOS: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
};

export type ErroMidia = 'tipo_nao_aceito' | 'arquivo_vazio' | 'arquivo_grande' | 'conteudo_nao_confere';

export const MENSAGEM_ERRO_MIDIA: Record<ErroMidia, string> = {
  tipo_nao_aceito: 'Formato não aceito para este tipo de anexo.',
  arquivo_vazio: 'O arquivo está vazio.',
  arquivo_grande: 'Arquivo acima do limite para este tipo.',
  conteudo_nao_confere: 'O conteúdo do arquivo não confere com o formato informado.',
};

export function validarMidia(tipo: TipoMidia, mime: string, conteudo: Buffer): ErroMidia | null {
  const regra = MIMES[tipo];
  const base = mime.split(';')[0].trim().toLowerCase();
  if (!regra.mimes.includes(base)) return 'tipo_nao_aceito';
  if (!conteudo.length) return 'arquivo_vazio';
  if (conteudo.length > regra.max) return 'arquivo_grande';
  const magico = MAGICOS[base];
  if (magico && !magico(conteudo)) return 'conteudo_nao_confere';
  return null;
}

export function limiteDoTipo(tipo: TipoMidia): number {
  return MIMES[tipo].max;
}

/** Texto que fica em `messages.corpo` (histórico, prévia, contexto do agente). */
export function corpoDaMidia(tipo: TipoMidia, nome: string, legenda?: string): string {
  const rotulo = tipo === 'imagem' ? 'Imagem' : tipo === 'audio' ? 'Áudio' : 'Documento';
  return legenda?.trim() ? `📎 ${rotulo}: ${nome}\n${legenda.trim()}` : `📎 ${rotulo}: ${nome}`;
}

/** Variáveis aceitas no corpo das respostas rápidas. */
export const VARIAVEIS_RESPOSTA = [
  'contato.nome',
  'contato.primeiro_nome',
  'contato.telefone',
  'contato.email',
  'contato.empresa',
  'atendente.nome',
  'negocio.titulo',
] as const;

/** Variáveis `{{x}}` do corpo que NÃO são conhecidas (para o 400 dizer quais). */
export function variaveisDesconhecidas(corpo: string): string[] {
  const achadas = [...corpo.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => m[1]);
  const conhecidas = new Set<string>(VARIAVEIS_RESPOSTA);
  return [...new Set(achadas.filter((v) => !conhecidas.has(v)))];
}

/** Atalho canônico: minúsculo, sem acento, sem "/" na frente. */
export function normalizarAtalho(atalho: string): string {
  return atalho
    .trim()
    .replace(/^\/+/, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '-');
}
