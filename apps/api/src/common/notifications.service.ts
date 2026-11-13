import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** Tipos persistidos: @menção (Q2.6), disparo aguardando aprovação (Q4.3), avaliação negativa (Q4.4). */
export type TipoPersistida = 'mencao' | 'disparo_aprovacao' | 'avaliacao_negativa';

export interface NovaNotificacao {
  /** Destinatário (identities.id), já validado como membro do tenant por quem chama. */
  identityId: string;
  /** CHECK `notifications_tipo_chk` (db/055, ampliado em db/061). */
  tipo: TipoPersistida;
  titulo: string;
  detalhe?: string;
  /** Caminho interno do app (`/inbox?c=…`). O banco recusa URL externa. */
  url: string;
  entidade?: string;
  entidadeId?: string;
}

/**
 * Notificações PERSISTIDAS (db/055 · Q2.6). As derivadas (não lidas,
 * integração quebrada) continuam calculadas na leitura em SettingsService;
 * esta tabela existe só para o que tem destinatário e "lida" próprios
 * (hoje: @menção em nota interna).
 *
 * Grava DENTRO da transação de quem originou (a nota e a notificação nascem
 * ou morrem juntas). Publicar no socket é de quem chama, depois do commit.
 */
@Injectable()
export class NotificationsService {
  async criar(tx: Tx, tenantId: string, n: NovaNotificacao): Promise<{ id: string; identityId: string }> {
    if (!/^\/[^/]/.test(n.url)) throw new Error('notificação só aceita caminho interno');
    const r = await tx.notification.create({
      data: {
        tenantId,
        identityId: n.identityId,
        tipo: n.tipo,
        titulo: n.titulo.slice(0, 200),
        detalhe: (n.detalhe ?? '').slice(0, 500),
        url: n.url,
        entidade: n.entidade ?? null,
        entidadeId: n.entidadeId ?? null,
      },
      select: { id: true, identityId: true },
    });
    return r;
  }
}
