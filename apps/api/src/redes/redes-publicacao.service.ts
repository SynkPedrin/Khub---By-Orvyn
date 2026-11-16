import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type RedesPublicacao } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { validarUrlPublica } from '../agents/knowledge/text-extraction';
import { ErroRede, secaoDeErro } from './redes.erros';
import { RedesHttp } from './redes.http';
import { RedesConexaoService, type ConexaoAtiva } from './redes-conexao.service';
import { RedesService } from './redes.service';
import { DOC_REDES, PERMISSOES_IG, type RedeSocial } from './redes.tipos';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

export const PRIVACIDADES_TIKTOK = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'] as const;
export const PRIVACIDADES_YOUTUBE = ['public', 'unlisted', 'private'] as const;
/** Checagens de processamento (1 por tique de 60 s; a Meta recomenda consultar 1x/min). */
export const MAX_VERIFICACOES = 15;
const DIA = 86_400_000;

export interface NovaPublicacao {
  rede: RedeSocial;
  conexaoId: string;
  formato: 'imagem' | 'reels' | 'video';
  legenda: string;
  titulo?: string;
  midiaUrl: string;
  privacidade?: string;
  /** ISO. Ausente = publicar no próximo tique do worker (até 1 min). */
  agendarPara?: string;
  /** Confirmação explícita da pessoa na tela. Sem ela, nada é criado. */
  confirmado: boolean;
  desativarComentarios?: boolean;
}

export interface CriadorTiktok {
  apelido: string | null;
  usuario: string | null;
  foto: string | null;
  privacidades: string[];
  comentariosDesativados: boolean;
  duracaoMaxSeg: number | null;
}

/** Valida o pedido (puro): formato por rede, título/privacidade, data. Devolve a data de agendamento. */
export function validarNovaPublicacao(d: NovaPublicacao, agora = new Date()): Date {
  if (d.confirmado !== true) throw new BadRequestException('confirme a publicação antes de enviar');
  const formatos: Record<RedeSocial, string[]> = { instagram: ['imagem', 'reels'], tiktok: ['video'], youtube: ['video'] };
  if (!formatos[d.rede].includes(d.formato)) throw new BadRequestException(`formato ${d.formato} não é aceito no ${d.rede}`);
  if (!/^https:\/\//i.test(d.midiaUrl)) throw new BadRequestException('a mídia precisa estar numa URL pública https');
  if (d.rede === 'instagram' && d.legenda.length > 2200) throw new BadRequestException('a legenda do Instagram tem no máximo 2.200 caracteres');
  if (d.rede === 'tiktok') {
    if (d.legenda.length > 2200) throw new BadRequestException('a legenda do TikTok tem no máximo 2.200 caracteres');
    if (!d.privacidade || !(PRIVACIDADES_TIKTOK as readonly string[]).includes(d.privacidade)) throw new BadRequestException('escolha a privacidade do vídeo no TikTok');
  }
  if (d.rede === 'youtube') {
    if (!d.titulo?.trim() || d.titulo.length > 100) throw new BadRequestException('o título do YouTube é obrigatório e tem no máximo 100 caracteres');
    if (Buffer.byteLength(d.legenda, 'utf8') > 5000) throw new BadRequestException('a descrição do YouTube tem no máximo 5.000 bytes');
    if (!d.privacidade || !(PRIVACIDADES_YOUTUBE as readonly string[]).includes(d.privacidade)) throw new BadRequestException('escolha a visibilidade do vídeo no YouTube');
  }
  if (!d.agendarPara) return agora;
  const quando = new Date(d.agendarPara);
  if (Number.isNaN(quando.getTime())) throw new BadRequestException('data de agendamento inválida');
  if (quando.getTime() < agora.getTime() - 60_000) throw new BadRequestException('a data de agendamento já passou');
  if (quando.getTime() > agora.getTime() + 365 * DIA) throw new BadRequestException('agende para no máximo 1 ano à frente');
  return quando;
}

/**
 * Publicação nas redes. A pessoa CONFIRMA na tela; a linha entra em
 * `redes_publicacoes` (db/068) e SÓ o worker publica (tique de 60 s), nunca o
 * processo da API. Sem repetição automática: repetir uma publicação que pode
 * ter saído duplicaria o post; o erro fica visível e a pessoa decide.
 */
@Injectable()
export class RedesPublicacaoService {
  private readonly log = new Logger('RedesPublicacao');

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: RedesHttp,
    private readonly conexoes: RedesConexaoService,
    private readonly redes: RedesService,
  ) {}

  /** DOC_REDES.tiktokCriador: privacidades permitidas e limites, mostrados na tela antes de publicar. */
  async criadorTiktok(tenantId: string, conexaoId: string): Promise<CriadorTiktok> {
    const a = await this.conexoes.ativa(tenantId, 'tiktok', conexaoId);
    try {
      const d = obj((await this.http.tiktokPost('post/publish/creator_info/query/', {}, {}, a.token, ['video.publish'])).data);
      return {
        apelido: str(d.creator_nickname) ?? null,
        usuario: str(d.creator_username) ?? null,
        foto: str(d.creator_avatar_url) ?? null,
        privacidades: (Array.isArray(d.privacy_level_options) ? d.privacy_level_options : []).filter((x): x is string => typeof x === 'string'),
        comentariosDesativados: d.comment_disabled === true,
        duracaoMaxSeg: typeof d.max_video_post_duration_sec === 'number' ? d.max_video_post_duration_sec : null,
      };
    } catch (err) {
      throw this.httpDe(err);
    }
  }

  async criar(tenantId: string, identityId: string, d: NovaPublicacao) {
    const quando = validarNovaPublicacao(d);
    await validarUrlPublica(d.midiaUrl).catch((e: Error) => {
      throw new BadRequestException(`URL da mídia recusada: ${e.message}`);
    });
    const a = await this.conexoes.ativa(tenantId, d.rede, d.conexaoId);
    const cap = this.redes.capacidadePublicacao(d.rede, a.scopes);
    if (!cap.disponivel) throw new ConflictException({ title: cap.motivo ?? 'publicação indisponível', faltando: cap.faltando ?? [], doc: cap.doc });
    if (d.rede === 'tiktok') {
      const criador = await this.criadorTiktok(tenantId, d.conexaoId);
      if (!criador.privacidades.includes(d.privacidade!)) throw new BadRequestException('a privacidade escolhida não é permitida para esta conta do TikTok');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.redesPublicacao.create({
        data: {
          tenantId,
          conexaoId: a.id,
          rede: d.rede,
          formato: d.formato,
          titulo: d.titulo?.trim() || null,
          legenda: d.legenda,
          midiaUrl: d.midiaUrl,
          privacidade: d.privacidade ?? null,
          opcoes: { desativarComentarios: d.desativarComentarios === true } as Prisma.InputJsonValue,
          agendadoPara: quando,
          status: 'agendado',
          confirmadoPor: identityId,
          confirmadoEm: new Date(),
          criadoPor: identityId,
        },
      });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'rede.publicacao.confirmada', 'redes_publicacao', ${row.id}, ${JSON.stringify({ rede: d.rede, formato: d.formato, agendadoPara: quando.toISOString() })}::jsonb)`;
      return this.saida(row);
    });
  }

  async listar(tenantId: string, rede?: RedeSocial) {
    const rows = await this.prisma.withTenant(tenantId, (tx) => tx.redesPublicacao.findMany({ where: rede ? { rede } : {}, orderBy: { agendadoPara: 'desc' }, take: 50 }));
    return rows.map((r) => this.saida(r));
  }

  async cancelar(tenantId: string, identityId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const n = await tx.redesPublicacao.updateMany({ where: { id, status: 'agendado' }, data: { status: 'cancelado', updatedAt: new Date() } });
      if (!n.count) {
        const existe = await tx.redesPublicacao.findUnique({ where: { id }, select: { status: true } });
        if (!existe) throw new NotFoundException('publicação inexistente');
        throw new ConflictException(`não dá para cancelar: a publicação está ${existe.status}`);
      }
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'rede.publicacao.cancelada', 'redes_publicacao', ${id})`;
      return { ok: true };
    });
  }

  /* ------------------------------ worker ------------------------------ */

  /** Um passo da publicação (chamado SÓ pelo worker). Idempotente por estado. */
  async processar(tenantId: string, id: string): Promise<void> {
    const row = await this.prisma.withTenant(tenantId, (tx) => tx.redesPublicacao.findUnique({ where: { id } }));
    if (!row) return;
    if (row.status === 'publicando' && Date.now() - row.updatedAt.getTime() > 30 * 60_000) {
      await this.finalizar(tenantId, id, { status: 'erro', erro: 'O envio foi interrompido e o resultado é incerto. Confira na rede antes de publicar de novo.' });
      return;
    }
    if (row.status === 'processando') return this.verificar(tenantId, row);
    if (row.status !== 'agendado' || row.agendadoPara.getTime() > Date.now()) return;
    // Reserva atômica: só um tique pega a linha.
    const reservou = await this.prisma.withTenant(tenantId, (tx) => tx.redesPublicacao.updateMany({ where: { id, status: 'agendado' }, data: { status: 'publicando', tentativas: { increment: 1 }, updatedAt: new Date() } }));
    if (!reservou.count) return;
    try {
      const a = await this.conexoes.ativa(tenantId, row.rede as RedeSocial, row.conexaoId);
      if (row.rede === 'instagram') await this.iniciarInstagram(tenantId, row, a);
      else if (row.rede === 'tiktok') await this.iniciarTiktok(tenantId, row, a);
      else await this.enviarYoutube(tenantId, row, a);
    } catch (err) {
      await this.finalizar(tenantId, id, { status: 'erro', erro: this.textoErro(err) });
    }
  }

  private async iniciarInstagram(tenantId: string, row: Linha, a: ConexaoAtiva) {
    // DOC_REDES.igPublicacao: contêiner (image_url JPEG | video_url + REELS) → status_code → media_publish.
    const params: Record<string, unknown> = row.formato === 'imagem' ? { image_url: row.midiaUrl, caption: row.legenda } : { video_url: row.midiaUrl, media_type: 'REELS', caption: row.legenda };
    const r = await this.http.metaPost(`${a.externalId}/media`, params, a.token, PERMISSOES_IG.publicar);
    const container = str(r.id);
    if (!container) throw new Error('a Meta não devolveu o contêiner');
    await this.prisma.withTenant(tenantId, (tx) => tx.redesPublicacao.update({ where: { id: row.id }, data: { status: 'processando', externoId: container, tentativas: 0, proximaVerificacaoEm: new Date(), updatedAt: new Date() } }));
    await this.verificar(tenantId, { ...row, status: 'processando', externoId: container, tentativas: 0 });
  }

  private async iniciarTiktok(tenantId: string, row: Linha, a: ConexaoAtiva) {
    // DOC_REDES.tiktokPublicar: Direct Post com PULL_FROM_URL; privacidade conferida com creator_info.
    const criador = obj((await this.http.tiktokPost('post/publish/creator_info/query/', {}, {}, a.token, ['video.publish'])).data);
    const opcoes = Array.isArray(criador.privacy_level_options) ? criador.privacy_level_options : [];
    if (!row.privacidade || !opcoes.includes(row.privacidade)) throw new Error('a privacidade escolhida não é mais permitida para esta conta do TikTok');
    const desativar = obj(row.opcoes).desativarComentarios === true || criador.comment_disabled === true;
    const r = await this.http.tiktokPost(
      'post/publish/video/init/',
      {},
      {
        post_info: { title: row.legenda, privacy_level: row.privacidade, disable_comment: desativar, disable_duet: criador.duet_disabled === true, disable_stitch: criador.stitch_disabled === true },
        source_info: { source: 'PULL_FROM_URL', video_url: row.midiaUrl },
      },
      a.token,
      ['video.publish'],
    );
    const publishId = str(obj(r.data).publish_id);
    if (!publishId) throw new Error('o TikTok não devolveu o publish_id');
    await this.prisma.withTenant(tenantId, (tx) => tx.redesPublicacao.update({ where: { id: row.id }, data: { status: 'processando', externoId: publishId, tentativas: 0, proximaVerificacaoEm: new Date(Date.now() + 60_000), updatedAt: new Date() } }));
  }

  private async enviarYoutube(tenantId: string, row: Linha, a: ConexaoAtiva) {
    // DOC_REDES.ytInsert + ytUploadRetomavel: o worker baixa a mídia da URL pública e transmite ao YouTube.
    const midia = await this.http.baixarMidia(row.midiaUrl);
    const video = await this.http.youtubeEnviar(a.token, { snippet: { title: row.titulo ?? '', description: row.legenda }, status: { privacyStatus: row.privacidade ?? 'private' } }, midia, ['https://www.googleapis.com/auth/youtube.upload']);
    const id = str(video.id);
    if (!id) throw new Error('o YouTube não devolveu o id do vídeo');
    await this.finalizar(tenantId, row.id, { status: 'publicado', postId: id, permalink: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` });
  }

  /** Verificação de processamento (Instagram: contêiner; TikTok: publish_id). */
  private async verificar(tenantId: string, row: Linha) {
    if (!row.externoId) return this.finalizar(tenantId, row.id, { status: 'erro', erro: 'processamento sem id na rede' });
    try {
      const a = await this.conexoes.ativa(tenantId, row.rede as RedeSocial, row.conexaoId);
      if (row.rede === 'instagram') {
        const st = str((await this.http.metaGet(row.externoId, { fields: 'status_code' }, a.token, PERMISSOES_IG.publicar)).status_code);
        if (st === 'FINISHED') {
          const pub = await this.http.metaPost(`${a.externalId}/media_publish`, { creation_id: row.externoId }, a.token, PERMISSOES_IG.publicar);
          const mediaId = str(pub.id);
          const link = mediaId ? str((await this.http.metaGet(mediaId, { fields: 'permalink' }, a.token, PERMISSOES_IG.midias).catch(() => ({}) as Json)).permalink) : undefined;
          return this.finalizar(tenantId, row.id, { status: 'publicado', postId: mediaId ?? null, permalink: link ?? null });
        }
        if (st === 'PUBLISHED') return this.finalizar(tenantId, row.id, { status: 'publicado' });
        if (st === 'ERROR' || st === 'EXPIRED') return this.finalizar(tenantId, row.id, { status: 'erro', erro: st === 'EXPIRED' ? 'O contêiner expirou (24 h) antes de publicar.' : 'A Meta não conseguiu processar a mídia (formato, tamanho ou URL inacessível).' });
      } else {
        const d = obj((await this.http.tiktokPost('post/publish/status/fetch/', {}, { publish_id: row.externoId }, a.token, ['video.publish'])).data);
        const st = str(d.status);
        if (st === 'PUBLISH_COMPLETE') {
          const ids = Array.isArray(d.publicaly_available_post_id) ? d.publicaly_available_post_id : [];
          return this.finalizar(tenantId, row.id, { status: 'publicado', postId: ids.length ? String(ids[0]) : null });
        }
        if (st === 'FAILED') return this.finalizar(tenantId, row.id, { status: 'erro', erro: `O TikTok recusou o vídeo: ${str(d.fail_reason) ?? 'motivo não informado'}` });
      }
      if (row.tentativas + 1 >= MAX_VERIFICACOES) return this.finalizar(tenantId, row.id, { status: 'erro', erro: 'A rede não terminou de processar a mídia em 15 minutos. Confira na rede antes de publicar de novo.' });
      await this.prisma.withTenant(tenantId, (tx) => tx.redesPublicacao.update({ where: { id: row.id }, data: { tentativas: { increment: 1 }, proximaVerificacaoEm: new Date(Date.now() + 60_000), updatedAt: new Date() } }));
    } catch (err) {
      await this.finalizar(tenantId, row.id, { status: 'erro', erro: this.textoErro(err) });
    }
  }

  private async finalizar(tenantId: string, id: string, r: { status: 'publicado' | 'erro'; postId?: string | null; permalink?: string | null; erro?: string }) {
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.redesPublicacao.update({
        where: { id },
        data: { status: r.status, postId: r.postId ?? undefined, permalink: r.permalink ?? undefined, erro: r.erro ? r.erro.slice(0, 600) : null, publicadoEm: r.status === 'publicado' ? new Date() : undefined, proximaVerificacaoEm: null, updatedAt: new Date() },
      });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'sistema', NULL, ${r.status === 'publicado' ? 'rede.publicacao.publicada' : 'rede.publicacao.erro'}, 'redes_publicacao', ${id}, ${JSON.stringify({ postId: r.postId ?? null, erro: r.erro ?? null })}::jsonb)`;
    });
    if (r.status === 'erro') this.log.warn(`publicação ${id} (tenant ${tenantId}) falhou: ${r.erro}`);
  }

  private textoErro(err: unknown): string {
    if (err instanceof ErroRede) return err.info.faltando.length ? `${err.info.mensagem} Falta: ${err.info.faltando.join(', ')}.` : err.info.mensagem;
    return (err as Error)?.message ?? 'erro desconhecido';
  }

  private httpDe(err: unknown): Error {
    if (err instanceof ErroRede) {
      const s = secaoDeErro(err);
      return new ConflictException({ title: s.mensagem, faltando: s.faltando ?? [], doc: s.doc ?? DOC_REDES.tiktokCriador });
    }
    return err as Error;
  }

  private saida(r: Linha) {
    return {
      id: r.id,
      rede: r.rede,
      conexaoId: r.conexaoId,
      formato: r.formato,
      titulo: r.titulo,
      legenda: r.legenda,
      midiaUrl: r.midiaUrl,
      privacidade: r.privacidade,
      agendadoPara: r.agendadoPara.toISOString(),
      status: r.status,
      postId: r.postId,
      permalink: r.permalink,
      erro: r.erro,
      publicadoEm: r.publicadoEm?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}

type Linha = RedesPublicacao;
