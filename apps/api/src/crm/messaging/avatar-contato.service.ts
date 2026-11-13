import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StevoApiProvider } from './stevo-api.provider';
import { soDigitos } from '../telefone';

/**
 * Foto de perfil do WhatsApp no contato (db/037).
 *
 * A URL que a SM v2 devolve (`pps.whatsapp.net`) é assinada e expira — por
 * isso toda gravação guarda `fotoEm` e a releitura revalida por TTL. Dois
 * caminhos:
 *  - lazy: `revalidarSeVencido` (abrir a conversa agenda a atualização em
 *    background, sem segurar a resposta);
 *  - massa: `sincronizarTenant` (usado pelo scripts/operar/sincronizar-avatares.mjs).
 *
 * Nenhum caminho lança: foto é enfeite, nunca pode derrubar leitura do CRM.
 */
@Injectable()
export class AvatarContatoService {
  private readonly log = new Logger(AvatarContatoService.name);

  /**
   * Desde a db/066 a IMAGEM fica guardada (contact_fotos) e a tela lê do KHUB,
   * então a foto não "some" quando a URL do WhatsApp expira. Revalidar serve só
   * para pegar troca de foto: 3 dias basta.
   */
  private static readonly TTL_MS = 3 * 24 * 60 * 60 * 1000;
  /** Teto da imagem guardada (foto de perfil tem ~5–60 KB). */
  static readonly MAX_BYTES = 600_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stevoApi: StevoApiProvider,
  ) {}

  /** Atualiza a foto de UM contato. `false` quando não há o que fazer (sem telefone, sem instância Stevo, sem foto). */
  async sincronizarContato(tenantId: string, contactId: string): Promise<boolean> {
    try {
      // Leitura e escrita em transações separadas: a chamada externa à Stevo
      // NÃO pode ficar dentro do withTenant (seguraria o lock/conexão por
      // segundos esperando rede).
      const alvo = await this.prisma.withTenant(tenantId, async (tx) => {
        const contato = await tx.contact.findUnique({ where: { id: contactId, tenantId }, select: { telefone: true } });
        const numero = contato?.telefone ? soDigitos(contato.telefone) : '';
        if (!numero) return null;
        const vinculo = await tx.integration.findFirst({
          where: { tenantId, provider: 'stevo_api', status: 'connected' },
          select: { externalBusinessId: true },
        });
        return vinculo?.externalBusinessId ? { numero, instanciaId: vinculo.externalBusinessId } : null;
      });
      if (!alvo) return false;
      if (!this.stevoApi.configured()) return false;

      const acesso = await this.stevoApi.acessoInstancia(alvo.instanciaId);
      if (!acesso) return false;
      const url = await this.stevoApi.avatarDoNumero(acesso.serverUrl, acesso.token, alvo.numero);
      if (!url) return false;

      return await this.guardarDeUrl(tenantId, contactId, url, 'whatsapp');
    } catch (e) {
      this.log.warn(`avatar do contato ${contactId.slice(0, 8)}… falhou: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * Baixa a foto (URL https assinada do WhatsApp/Instagram), confere que é
   * imagem pelos primeiros bytes, guarda em `contact_fotos` e aponta o contato
   * para o endereço DURÁVEL do KHUB (`/api/fotos/:id`). `false` se não deu.
   */
  async guardarDeUrl(tenantId: string, contactId: string, url: string, fonte: 'whatsapp' | 'instagram' | 'messenger'): Promise<boolean> {
    try {
      if (!/^https:\/\//i.test(url)) return false;
      const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) return false;
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = mimeDaImagem(buf);
      if (!mime || buf.length > AvatarContatoService.MAX_BYTES) return false;
      const agora = new Date();
      await this.prisma.withTenant(tenantId, async (tx) => {
        await tx.contactFoto.upsert({
          where: { contactId },
          create: { contactId, tenantId, mime, bytes: buf, fonte },
          update: { mime, bytes: buf, fonte, atualizadaEm: agora },
        });
        // `v=` muda a cada foto nova: o navegador não fica preso na antiga.
        await tx.contact.update({ where: { id: contactId, tenantId }, data: { fotoUrl: `/api/fotos/${contactId}?v=${agora.getTime()}`, fotoEm: agora } });
      });
      return true;
    } catch (e) {
      this.log.warn(`foto do contato ${contactId.slice(0, 8)}… não guardada: ${(e as Error).message}`);
      return false;
    }
  }

  /** Bytes da foto guardada (rota `GET /v1/crm/contacts/:id/foto`). */
  async obterFoto(tenantId: string, contactId: string): Promise<{ mime: string; bytes: Buffer; atualizadaEm: Date } | null> {
    const f = await this.prisma.withTenant(tenantId, (tx) => tx.contactFoto.findUnique({ where: { contactId }, select: { mime: true, bytes: true, atualizadaEm: true } }));
    return f ? { mime: f.mime, bytes: Buffer.from(f.bytes), atualizadaEm: f.atualizadaEm } : null;
  }

  /** Agenda revalidação em background se a foto está ausente/vencida. Nunca lança. */
  revalidarSeVencido(tenantId: string, contato: { id: string; fotoEm: Date | null; fotoUrl?: string | null } | null): void {
    if (!contato) return;
    const legado = contato.fotoUrl !== undefined && !contato.fotoUrl?.startsWith('/api/fotos/');
    const vencido = legado || !contato.fotoEm || Date.now() - contato.fotoEm.getTime() > AvatarContatoService.TTL_MS;
    if (!vencido) return;
    void this.sincronizarContato(tenantId, contato.id).catch(() => undefined);
  }

  /** Todos os contatos do tenant com telefone (backfill/rotina). Espaça as chamadas pra não tropeçar no rate-limit da SM v2. */
  async sincronizarTenant(tenantId: string, intervaloMs = 350): Promise<{ atualizados: number; falhas: number }> {
    const ids = await this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.contact.findMany({
        where: { telefone: { not: null } },
        select: { id: true, fotoEm: true, fotoUrl: true },
        orderBy: { ultimoContatoAt: 'desc' },
      });
      // URL antiga do WhatsApp (pré-066) conta como vencida: ainda não tem a imagem guardada.
      return rows.filter((c) => !c.fotoUrl?.startsWith('/api/fotos/') || !c.fotoEm || Date.now() - c.fotoEm.getTime() > AvatarContatoService.TTL_MS).map((c) => c.id);
    });
    let atualizados = 0, falhas = 0;
    for (const id of ids) {
      const ok = await this.sincronizarContato(tenantId, id);
      if (ok) atualizados++; else falhas++;
      await new Promise((r) => setTimeout(r, intervaloMs));
    }
    return { atualizados, falhas };
  }
}

/** Tipo pelos primeiros bytes (o content-type do servidor remoto não é prova). */
export function mimeDaImagem(b: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
