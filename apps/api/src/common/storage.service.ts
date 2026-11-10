import { Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { ConfigService } from '../config/config.service';

/**
 * Storage S3-compatible (R2/AWS/MinIO) — stack congelada: "Arquivos:
 * S3-compatible". Sem SDK: assinatura AWS Signature V4 implementada aqui
 * (PUT de objeto + URL pré-assinada de GET), o que evita uma dependência
 * pesada só para duas operações. O algoritmo é o publicado pela AWS e o teste
 * (`storage.service.spec.ts`) confere contra o vetor oficial da documentação.
 *
 * Gating (Brief §2): sem `S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/
 * S3_SECRET_ACCESS_KEY`, `enviar` lança 501 config_required (provider
 * `storage`). Quem chama decide se tem fallback (ex.: base64 ao provedor).
 *
 * O banco guarda só a CHAVE do objeto; a URL é gerada na hora (assinada e
 * com validade) — nunca persistir URL assinada.
 */

/** Validade máxima de uma URL SigV4 (7 dias), usada para o provedor baixar a mídia. */
export const VALIDADE_PROVEDOR_S = 7 * 24 * 3600;
/** Validade para a tela abrir/baixar o anexo. */
export const VALIDADE_TELA_S = 3600;

const sha256Hex = (d: string | Buffer) => createHash('sha256').update(d).digest('hex');
const hmac = (k: Buffer | string, d: string) => createHmac('sha256', k).update(d).digest();

/** RFC 3986 estrito (o que a SigV4 exige): além do encodeURIComponent, `!'()*`. */
export function encodeRfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Caminho canônico: cada segmento codificado, as barras preservadas. */
function caminhoCanonico(caminho: string): string {
  return caminho.split('/').map(encodeRfc3986).join('/');
}

function dataAmz(d: Date): { amzDate: string; dia: string } {
  const amzDate = d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { amzDate, dia: amzDate.slice(0, 8) };
}

function chaveAssinatura(segredo: string, dia: string, regiao: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${segredo}`, dia), regiao), 's3'), 'aws4_request');
}

export interface CredenciaisS3 {
  accessKeyId: string;
  secretAccessKey: string;
  regiao: string;
}

/**
 * URL pré-assinada (query string) — SigV4 "UNSIGNED-PAYLOAD", só `host`
 * assinado. Pura e determinística (data injetada) para ser testável.
 */
export function preAssinarUrl(
  cred: CredenciaisS3,
  req: { metodo: 'GET' | 'PUT'; origem: string; caminho: string; expiraEmS: number; agora: Date },
): string {
  const url = new URL(req.origem);
  const { amzDate, dia } = dataAmz(req.agora);
  const escopo = `${dia}/${cred.regiao}/s3/aws4_request`;
  const params: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${cred.accessKeyId}/${escopo}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(req.expiraEmS)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  const query = params
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const caminho = caminhoCanonico(req.caminho);
  const canonica = [req.metodo, caminho, query, `host:${url.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const paraAssinar = ['AWS4-HMAC-SHA256', amzDate, escopo, sha256Hex(canonica)].join('\n');
  const assinatura = createHmac('sha256', chaveAssinatura(cred.secretAccessKey, dia, cred.regiao)).update(paraAssinar).digest('hex');
  return `${url.protocol}//${url.host}${caminho}?${query}&X-Amz-Signature=${assinatura}`;
}

/** Cabeçalhos de um PUT assinado (payload assinado por hash). Pura, para teste. */
export function assinarPut(
  cred: CredenciaisS3,
  req: { origem: string; caminho: string; corpo: Buffer; contentType: string; agora: Date },
): Record<string, string> {
  const url = new URL(req.origem);
  const { amzDate, dia } = dataAmz(req.agora);
  const escopo = `${dia}/${cred.regiao}/s3/aws4_request`;
  const hashCorpo = sha256Hex(req.corpo);
  const cabecalhos: Record<string, string> = {
    'content-type': req.contentType,
    host: url.host,
    'x-amz-content-sha256': hashCorpo,
    'x-amz-date': amzDate,
  };
  const nomes = Object.keys(cabecalhos).sort();
  const canonicos = nomes.map((n) => `${n}:${cabecalhos[n].trim()}\n`).join('');
  const assinados = nomes.join(';');
  const canonica = ['PUT', caminhoCanonico(req.caminho), '', canonicos, assinados, hashCorpo].join('\n');
  const paraAssinar = ['AWS4-HMAC-SHA256', amzDate, escopo, sha256Hex(canonica)].join('\n');
  const assinatura = createHmac('sha256', chaveAssinatura(cred.secretAccessKey, dia, cred.regiao)).update(paraAssinar).digest('hex');
  const { host: _host, ...semHost } = cabecalhos;
  return {
    ...semHost,
    authorization: `AWS4-HMAC-SHA256 Credential=${cred.accessKeyId}/${escopo}, SignedHeaders=${assinados}, Signature=${assinatura}`,
  };
}

/** Nome de arquivo seguro para chave de objeto (sem barra, sem controle, curto). */
export function nomeSeguro(nome: string): string {
  const base = nome.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (base || 'arquivo').slice(-80);
}

@Injectable()
export class StorageService {
  private readonly log = new Logger('Storage');

  constructor(private readonly config: ConfigService) {}

  configurado(): boolean {
    return this.config.isConfigured('storage');
  }
  faltando(): string[] {
    return this.config.missingVars('storage');
  }

  private cred(): CredenciaisS3 {
    return {
      accessKeyId: this.config.get('S3_ACCESS_KEY_ID')!,
      secretAccessKey: this.config.get('S3_SECRET_ACCESS_KEY')!,
      regiao: this.config.get('S3_REGION') ?? 'auto',
    };
  }

  /** Path-style: `<endpoint>/<bucket>/<chave>` — funciona em R2, AWS e MinIO. */
  private local(chave: string): { origem: string; caminho: string } {
    const endpoint = new URL(this.config.get('S3_ENDPOINT')!);
    const prefixo = endpoint.pathname.replace(/\/+$/, '');
    return { origem: `${endpoint.protocol}//${endpoint.host}`, caminho: `${prefixo}/${this.config.get('S3_BUCKET')}/${chave}` };
  }

  /** Grava o objeto. 501 config_required sem as variáveis. */
  async enviar(chave: string, corpo: Buffer, contentType: string): Promise<void> {
    this.config.require('storage');
    const { origem, caminho } = this.local(chave);
    const headers = assinarPut(this.cred(), { origem, caminho, corpo, contentType, agora: new Date() });
    const res = await fetch(`${origem}${caminhoCanonico(caminho)}`, {
      method: 'PUT',
      headers,
      body: corpo,
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    });
    if (!res.ok) {
      // Nunca loga o corpo da resposta (pode ecoar a chave do objeto com dado pessoal no nome).
      this.log.warn(`PUT no storage recusado: HTTP ${res.status}`);
      throw new StorageError(res.status);
    }
  }

  /** URL de leitura: base pública (CDN) se houver; senão assinada com validade. */
  urlLeitura(chave: string, validadeS: number = VALIDADE_TELA_S): string | null {
    if (!this.configurado()) return null;
    const publica = this.config.get('S3_PUBLIC_BASE_URL');
    if (publica) return `${publica.replace(/\/+$/, '')}/${caminhoCanonico(chave)}`;
    const { origem, caminho } = this.local(chave);
    return preAssinarUrl(this.cred(), { metodo: 'GET', origem, caminho, expiraEmS: validadeS, agora: new Date() });
  }
}

export class StorageError extends Error {
  constructor(readonly status: number) {
    super(`storage_http_${status}`);
    this.name = 'StorageError';
  }
}
