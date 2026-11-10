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

  /** URLs assinadas do WhatsApp vivem ~24h; revalida um pouco antes disso. */
  private static readonly TTL_MS = 20 * 60 * 60 * 1000;

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

      await this.prisma.withTenant(tenantId, (tx) =>
        tx.contact.update({ where: { id: contactId, tenantId }, data: { fotoUrl: url, fotoEm: new Date() } }),
      );
      return true;
    } catch (e) {
      this.log.warn(`avatar do contato ${contactId.slice(0, 8)}… falhou: ${(e as Error).message}`);
      return false;
    }
  }

  /** Agenda revalidação em background se a foto está ausente/vencida. Nunca lança. */
  revalidarSeVencido(tenantId: string, contato: { id: string; fotoEm: Date | null } | null): void {
    if (!contato) return;
    const vencido = !contato.fotoEm || Date.now() - contato.fotoEm.getTime() > AvatarContatoService.TTL_MS;
    if (!vencido) return;
    void this.sincronizarContato(tenantId, contato.id).catch(() => undefined);
  }

  /** Todos os contatos do tenant com telefone (backfill/rotina). Espaça as chamadas pra não tropeçar no rate-limit da SM v2. */
  async sincronizarTenant(tenantId: string, intervaloMs = 350): Promise<{ atualizados: number; falhas: number }> {
    const ids = await this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.contact.findMany({
        where: { telefone: { not: null } },
        select: { id: true, fotoEm: true },
        orderBy: { ultimoContatoAt: 'desc' },
      });
      return rows.filter((c) => !c.fotoEm || Date.now() - c.fotoEm.getTime() > AvatarContatoService.TTL_MS).map((c) => c.id);
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
