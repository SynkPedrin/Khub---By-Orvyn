import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../common/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PushService } from '../push/push.service';

type Tx = Prisma.TransactionClient;

export const TIPOS_APROVACAO = ['arte', 'roteiro', 'video', 'outro'] as const;
export type TipoAprovacao = (typeof TIPOS_APROVACAO)[number];
export const STATUS_APROVACAO = ['pendente', 'aprovado', 'ajustes', 'recusado'] as const;
export type StatusAprovacao = (typeof STATUS_APROVACAO)[number];
export const RESPOSTAS = ['aprovado', 'ajustes', 'recusado'] as const;
export type Resposta = (typeof RESPOSTAS)[number];

export const MIMES_ARQUIVO = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'] as const;
/** 4 MB por arquivo (CHECK de db/085). O front comprime imagem antes. */
export const TAMANHO_MAX_ARQUIVO = 4 * 1024 * 1024;
const MAX_ARQUIVOS = 10;

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

interface LinhaLista {
  id: string;
  tipo: TipoAprovacao;
  titulo: string;
  descricao: string | null;
  canal: string | null;
  status: StatusAprovacao;
  versao: number;
  publicarEm: Date | null;
  prazoEm: Date | null;
  enviadaEm: Date | null;
  respondidoEm: Date | null;
  createdAt: Date;
  updatedAt: Date;
  criadoPorNome: string | null;
  capaId: string | null;
  capaMime: string | null;
  qtdArquivos: number;
  qtdComentarios: number;
  trecho: string | null;
}

const LIMITE_LISTA = 300;

function texto(v: string | null | undefined, max: number): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}
function data(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('data inválida');
  return d;
}
const ROTULO_TIPO: Record<TipoAprovacao, string> = { arte: 'Arte', roteiro: 'Roteiro', video: 'Vídeo', outro: 'Peça' };

/**
 * Aprovações do cliente (db/085).
 *
 * A equipe monta a peça (rascunho), anexa arte ou escreve o roteiro e ENVIA.
 * Enviar avisa todo mundo da subconta (sino + celular, quem ativou). O cliente
 * aprova, pede ajustes ou recusa pelo app mobile; a resposta volta para quem
 * criou. Reenviar depois de ajuste sobe a versão e avisa de novo.
 */
@Injectable()
export class AprovacoesService {
  private readonly log = new Logger('Aprovacoes');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificacoes: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
  ) {}

  // ── Leitura ─────────────────────────────────────────────────────────────

  async listar(tenantId: string, f: { status?: StatusAprovacao[]; tipo?: TipoAprovacao; incluirRascunhos: boolean; busca?: string }) {
    const status = f.status?.length ? f.status : null;
    const busca = f.busca?.trim() ? `%${f.busca.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const linhas = await this.prisma.withTenant(tenantId, (tx) => tx.$queryRaw<LinhaLista[]>`
      SELECT a.id, a.tipo, a.titulo, a.descricao, a.canal, a.status, a.versao,
             a.publicar_em AS "publicarEm", a.prazo_em AS "prazoEm", a.enviada_em AS "enviadaEm",
             a.respondido_em AS "respondidoEm", a.created_at AS "createdAt", a.updated_at AS "updatedAt",
             (SELECT u.nome FROM users u WHERE u.identity_id = a.criado_por LIMIT 1) AS "criadoPorNome",
             capa.id AS "capaId", capa.mime AS "capaMime",
             (SELECT count(*)::int FROM aprovacao_arquivos x WHERE x.aprovacao_id = a.id) AS "qtdArquivos",
             (SELECT count(*)::int FROM aprovacao_comentarios c WHERE c.aprovacao_id = a.id AND c.texto <> '') AS "qtdComentarios",
             left(coalesce(a.conteudo, a.legenda, a.descricao), 220) AS trecho
      FROM aprovacoes a
      LEFT JOIN LATERAL (
        SELECT x.id, x.mime FROM aprovacao_arquivos x WHERE x.aprovacao_id = a.id ORDER BY x.ordem, x.created_at LIMIT 1
      ) capa ON true
      WHERE a.tenant_id = ${tenantId}::uuid
        AND (${f.incluirRascunhos}::boolean OR a.enviada_em IS NOT NULL)
        AND (${status}::text[] IS NULL OR a.status = ANY(${status}::text[]))
        AND (${f.tipo ?? null}::text IS NULL OR a.tipo = ${f.tipo ?? null}::text)
        AND (${busca}::text IS NULL OR a.titulo ILIKE ${busca}::text)
      ORDER BY (a.status = 'pendente' AND a.enviada_em IS NOT NULL) DESC, coalesce(a.enviada_em, a.created_at) DESC
      LIMIT ${LIMITE_LISTA}`);
    return linhas;
  }

  async resumo(tenantId: string, incluirRascunhos: boolean) {
    const r = await this.prisma.withTenant(tenantId, (tx) => tx.$queryRaw<{ status: string; rascunho: boolean; n: number }[]>`
      SELECT status, enviada_em IS NULL AS rascunho, count(*)::int AS n
      FROM aprovacoes WHERE tenant_id = ${tenantId}::uuid GROUP BY 1, 2`);
    const out = { pendente: 0, aprovado: 0, ajustes: 0, recusado: 0, rascunhos: 0 };
    for (const l of r) {
      if (l.rascunho) { if (incluirRascunhos) out.rascunhos += l.n; continue; }
      out[l.status as StatusAprovacao] += l.n;
    }
    return out;
  }

  async detalhe(tenantId: string, id: string, incluirRascunhos: boolean) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [a] = await tx.$queryRaw<Record<string, unknown>[]>`
        SELECT a.id, a.tipo, a.titulo, a.descricao, a.conteudo, a.legenda, a.link_externo AS "linkExterno", a.canal,
               a.status, a.versao, a.publicar_em AS "publicarEm", a.prazo_em AS "prazoEm", a.enviada_em AS "enviadaEm",
               a.respondido_em AS "respondidoEm", a.created_at AS "createdAt", a.updated_at AS "updatedAt", a.criado_por AS "criadoPor",
               (SELECT u.nome FROM users u WHERE u.identity_id = a.criado_por LIMIT 1) AS "criadoPorNome",
               (SELECT u.nome FROM users u WHERE u.identity_id = a.respondido_por LIMIT 1) AS "respondidoPorNome"
        FROM aprovacoes a WHERE a.tenant_id = ${tenantId}::uuid AND a.id = ${id}::uuid`;
      if (!a || (!incluirRascunhos && !a.enviadaEm)) throw new NotFoundException('Aprovação não encontrada');
      const arquivos = await tx.$queryRaw<{ id: string; nome: string; mime: string; tamanho: number }[]>`
        SELECT id, nome, mime, tamanho FROM aprovacao_arquivos WHERE aprovacao_id = ${id}::uuid ORDER BY ordem, created_at`;
      const comentarios = await tx.$queryRaw<{ id: string; autorNome: string; autorId: string | null; texto: string; acao: string | null; versao: number; createdAt: Date }[]>`
        SELECT id, autor_nome AS "autorNome", autor_id AS "autorId", texto, acao, versao, created_at AS "createdAt"
        FROM aprovacao_comentarios WHERE aprovacao_id = ${id}::uuid ORDER BY created_at`;
      return { ...a, arquivos, comentarios };
    });
  }

  async arquivo(tenantId: string, id: string, arquivoId: string, incluirRascunhos: boolean) {
    const [r] = await this.prisma.withTenant(tenantId, (tx) => tx.$queryRaw<{ nome: string; mime: string; dados: Buffer; enviada: boolean }[]>`
      SELECT x.nome, x.mime, x.dados, a.enviada_em IS NOT NULL AS enviada
      FROM aprovacao_arquivos x JOIN aprovacoes a ON a.id = x.aprovacao_id
      WHERE x.tenant_id = ${tenantId}::uuid AND x.aprovacao_id = ${id}::uuid AND x.id = ${arquivoId}::uuid`);
    if (!r || (!incluirRascunhos && !r.enviada)) throw new NotFoundException('Arquivo não encontrado');
    return { nome: r.nome, mime: r.mime, dados: Buffer.from(r.dados) };
  }

  // ── Escrita da equipe ───────────────────────────────────────────────────

  async criar(tenantId: string, identityId: string, d: DadosAprovacao) {
    const titulo = texto(d.titulo, 200);
    if (!titulo) throw new BadRequestException('Dê um título para a peça.');
    const [r] = await this.prisma.withTenant(tenantId, (tx) => tx.$queryRaw<{ id: string }[]>`
      INSERT INTO aprovacoes (tenant_id, tipo, titulo, descricao, conteudo, legenda, link_externo, canal, publicar_em, prazo_em, criado_por)
      VALUES (${tenantId}::uuid, ${d.tipo}, ${titulo}, ${texto(d.descricao, 2000)}, ${texto(d.conteudo, 20000)}, ${texto(d.legenda, 5000)},
              ${texto(d.linkExterno, 1000)}, ${texto(d.canal, 60)}, ${data(d.publicarEm)}, ${data(d.prazoEm)}, ${identityId}::uuid)
      RETURNING id`);
    return { id: r!.id };
  }

  async atualizar(tenantId: string, id: string, d: Partial<DadosAprovacao>) {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await this.exigir(tx, tenantId, id);
      if (atual.status === 'aprovado') throw new ConflictException('Peça já aprovada: crie uma nova versão em vez de editar.');
      const titulo = d.titulo !== undefined ? texto(d.titulo, 200) : undefined;
      if (titulo === null) throw new BadRequestException('Dê um título para a peça.');
      await tx.$executeRaw`
        UPDATE aprovacoes SET
          tipo = coalesce(${d.tipo ?? null}::text, tipo),
          titulo = coalesce(${titulo ?? null}::text, titulo),
          descricao = CASE WHEN ${d.descricao !== undefined}::boolean THEN ${texto(d.descricao, 2000)}::text ELSE descricao END,
          conteudo = CASE WHEN ${d.conteudo !== undefined}::boolean THEN ${texto(d.conteudo, 20000)}::text ELSE conteudo END,
          legenda = CASE WHEN ${d.legenda !== undefined}::boolean THEN ${texto(d.legenda, 5000)}::text ELSE legenda END,
          link_externo = CASE WHEN ${d.linkExterno !== undefined}::boolean THEN ${texto(d.linkExterno, 1000)}::text ELSE link_externo END,
          canal = CASE WHEN ${d.canal !== undefined}::boolean THEN ${texto(d.canal, 60)}::text ELSE canal END,
          publicar_em = CASE WHEN ${d.publicarEm !== undefined}::boolean THEN ${data(d.publicarEm)}::timestamptz ELSE publicar_em END,
          prazo_em = CASE WHEN ${d.prazoEm !== undefined}::boolean THEN ${data(d.prazoEm)}::timestamptz ELSE prazo_em END,
          updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`;
    });
    return { ok: true };
  }

  async adicionarArquivo(tenantId: string, id: string, a: { nome: string; mime: string; base64: string }) {
    if (!(MIMES_ARQUIVO as readonly string[]).includes(a.mime)) throw new BadRequestException('Formato não aceito: envie JPG, PNG, WEBP, GIF ou PDF.');
    const dados = Buffer.from(a.base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (dados.length === 0) throw new BadRequestException('Arquivo vazio.');
    if (dados.length > TAMANHO_MAX_ARQUIVO) throw new BadRequestException('Arquivo maior que 4 MB. Para vídeo, use o campo de link.');
    const nome = texto(a.nome, 200) ?? 'arquivo';
    return this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await this.exigir(tx, tenantId, id);
      if (atual.status === 'aprovado') throw new ConflictException('Peça já aprovada.');
      const [{ n }] = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM aprovacao_arquivos WHERE aprovacao_id = ${id}::uuid`;
      if (n >= MAX_ARQUIVOS) throw new BadRequestException(`No máximo ${MAX_ARQUIVOS} arquivos por peça.`);
      const [r] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO aprovacao_arquivos (tenant_id, aprovacao_id, nome, mime, tamanho, dados, ordem)
        VALUES (${tenantId}::uuid, ${id}::uuid, ${nome}, ${a.mime}, ${dados.length}, ${dados}, ${n})
        RETURNING id`;
      await tx.$executeRaw`UPDATE aprovacoes SET updated_at = now() WHERE id = ${id}::uuid`;
      return { id: r!.id, nome, mime: a.mime, tamanho: dados.length };
    }, { timeout: 30_000, maxWait: 10_000 });
  }

  async removerArquivo(tenantId: string, id: string, arquivoId: string) {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await this.exigir(tx, tenantId, id);
      if (atual.status === 'aprovado') throw new ConflictException('Peça já aprovada.');
      await tx.$executeRaw`DELETE FROM aprovacao_arquivos WHERE aprovacao_id = ${id}::uuid AND id = ${arquivoId}::uuid`;
    });
    return { ok: true };
  }

  async remover(tenantId: string, id: string) {
    const n = await this.prisma.withTenant(tenantId, (tx) => tx.$executeRaw`DELETE FROM aprovacoes WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
    if (!n) throw new NotFoundException('Aprovação não encontrada');
    return { ok: true };
  }

  /** Envia (ou reenvia depois de ajuste) para o cliente e avisa no sino e no celular. */
  async enviar(tenantId: string, identityId: string, id: string, mensagem?: string) {
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await this.exigir(tx, tenantId, id);
      if (atual.status === 'aprovado') throw new ConflictException('Peça já aprovada.');
      if (atual.tipo === 'arte' && atual.qtdArquivos === 0 && !atual.linkExterno) throw new BadRequestException('Anexe a arte antes de enviar.');
      if (atual.tipo === 'roteiro' && !atual.conteudo) throw new BadRequestException('Escreva o roteiro antes de enviar.');
      if (atual.tipo === 'video' && !atual.linkExterno && atual.qtdArquivos === 0) throw new BadRequestException('Coloque o link do vídeo antes de enviar.');
      const reenvio = atual.enviadaEm !== null;
      if (reenvio && atual.status === 'pendente') throw new ConflictException('Já está com o cliente aguardando resposta.');
      const versao = reenvio ? atual.versao + 1 : atual.versao;
      await tx.$executeRaw`
        UPDATE aprovacoes SET status = 'pendente', versao = ${versao}, enviada_em = now(), respondido_em = NULL, respondido_por = NULL, updated_at = now()
        WHERE id = ${id}::uuid`;
      const nome = await this.nomeDe(tx, identityId);
      const msg = texto(mensagem, 2000) ?? '';
      if (reenvio || msg) {
        await tx.$executeRaw`
          INSERT INTO aprovacao_comentarios (tenant_id, aprovacao_id, autor_id, autor_nome, texto, acao, versao)
          VALUES (${tenantId}::uuid, ${id}::uuid, ${identityId}::uuid, ${nome}, ${msg}, ${reenvio ? 'reenviado' : null}, ${versao})`;
      }
      // Sino: todo membro da subconta, menos quem enviou.
      const membros = await tx.$queryRaw<{ identity_id: string }[]>`
        SELECT identity_id FROM memberships WHERE tenant_id = ${tenantId}::uuid AND identity_id <> ${identityId}::uuid`;
      const titulo = `${ROTULO_TIPO[atual.tipo]} para aprovar${reenvio ? ` (versão ${versao})` : ''}`;
      const notificadas = [];
      for (const m of membros) {
        notificadas.push(
          await this.notificacoes.criar(tx, tenantId, {
            identityId: m.identity_id,
            tipo: 'aprovacao_pendente',
            titulo,
            detalhe: atual.titulo,
            url: `/aprovacoes?id=${id}`,
            entidade: 'aprovacao',
            entidadeId: id,
          }),
        );
      }
      return { titulo, peca: atual.titulo, notificadas, versao };
    });
    for (const n of r.notificadas) this.realtime.publicar(tenantId, 'notification.created', { id: n.id, paraIdentityId: n.identityId });
    const enviados = await this.push.enviar(tenantId, null, { titulo: r.titulo, corpo: r.peca, url: `/m/aprovacoes/${id}`, tag: `aprovacao-${id}` }, identityId);
    return { ok: true, versao: r.versao, avisados: r.notificadas.length, celulares: enviados };
  }

  // ── Resposta do cliente ─────────────────────────────────────────────────

  async responder(tenantId: string, identityId: string, id: string, acao: Resposta, comentario?: string) {
    const msg = texto(comentario, 2000) ?? '';
    if ((acao === 'ajustes' || acao === 'recusado') && !msg) throw new BadRequestException('Conte o que precisa mudar.');
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await this.exigir(tx, tenantId, id);
      if (!atual.enviadaEm) throw new NotFoundException('Aprovação não encontrada');
      if (atual.status !== 'pendente') throw new ConflictException('Esta peça já foi respondida.');
      await tx.$executeRaw`
        UPDATE aprovacoes SET status = ${acao}, respondido_por = ${identityId}::uuid, respondido_em = now(), updated_at = now()
        WHERE id = ${id}::uuid`;
      const nome = await this.nomeDe(tx, identityId);
      await tx.$executeRaw`
        INSERT INTO aprovacao_comentarios (tenant_id, aprovacao_id, autor_id, autor_nome, texto, acao, versao)
        VALUES (${tenantId}::uuid, ${id}::uuid, ${identityId}::uuid, ${nome}, ${msg}, ${acao}, ${atual.versao})`;
      const rotulo = acao === 'aprovado' ? 'aprovou' : acao === 'ajustes' ? 'pediu ajustes em' : 'recusou';
      const titulo = `${nome || 'Cliente'} ${rotulo} ${atual.titulo}`.slice(0, 200);
      const para = atual.criadoPor && atual.criadoPor !== identityId ? atual.criadoPor : null;
      const n = para
        ? await this.notificacoes.criar(tx, tenantId, { identityId: para, tipo: 'aprovacao_respondida', titulo, detalhe: msg, url: `/aprovacoes?id=${id}`, entidade: 'aprovacao', entidadeId: id })
        : null;
      return { titulo, msg, para, n };
    });
    if (r.n) this.realtime.publicar(tenantId, 'notification.created', { id: r.n.id, paraIdentityId: r.n.identityId });
    if (r.para) await this.push.enviar(tenantId, [r.para], { titulo: r.titulo, corpo: r.msg || 'Toque para ver.', url: `/aprovacoes?id=${id}`, tag: `aprovacao-${id}` });
    return { ok: true, status: acao };
  }

  async comentar(tenantId: string, identityId: string, id: string, textoBruto: string, incluirRascunhos: boolean) {
    const msg = texto(textoBruto, 2000);
    if (!msg) throw new BadRequestException('Comentário vazio.');
    await this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await this.exigir(tx, tenantId, id);
      if (!incluirRascunhos && !atual.enviadaEm) throw new NotFoundException('Aprovação não encontrada');
      const nome = await this.nomeDe(tx, identityId);
      await tx.$executeRaw`
        INSERT INTO aprovacao_comentarios (tenant_id, aprovacao_id, autor_id, autor_nome, texto, versao)
        VALUES (${tenantId}::uuid, ${id}::uuid, ${identityId}::uuid, ${nome}, ${msg}, ${atual.versao})`;
      await tx.$executeRaw`UPDATE aprovacoes SET updated_at = now() WHERE id = ${id}::uuid`;
    });
    return { ok: true };
  }

  // ── Apoio ───────────────────────────────────────────────────────────────

  private async exigir(tx: Tx, tenantId: string, id: string) {
    const [a] = await tx.$queryRaw<{ tipo: TipoAprovacao; titulo: string; status: StatusAprovacao; versao: number; enviadaEm: Date | null; criadoPor: string | null; conteudo: string | null; linkExterno: string | null; qtdArquivos: number }[]>`
      SELECT tipo, titulo, status, versao, enviada_em AS "enviadaEm", criado_por AS "criadoPor", conteudo, link_externo AS "linkExterno",
             (SELECT count(*)::int FROM aprovacao_arquivos x WHERE x.aprovacao_id = a.id) AS "qtdArquivos"
      FROM aprovacoes a WHERE a.tenant_id = ${tenantId}::uuid AND a.id = ${id}::uuid FOR UPDATE`;
    if (!a) throw new NotFoundException('Aprovação não encontrada');
    return a;
  }

  private async nomeDe(tx: Tx, identityId: string): Promise<string> {
    const [u] = await tx.$queryRaw<{ nome: string }[]>`SELECT nome FROM users WHERE identity_id = ${identityId}::uuid LIMIT 1`;
    return (u?.nome ?? '').slice(0, 200);
  }
}
