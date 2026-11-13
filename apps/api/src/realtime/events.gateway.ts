import { Logger, Optional } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { RealtimeEnvelope, RealtimeEvent, RealtimeEvents } from '@khub/types';
import { TokenService } from '../auth/token.service';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { moduloLiberado, modulosDe, papelRestringivel } from '../auth/modulos';

/** Sala do tenant: cada evento é publicado aqui, nunca em broadcast global. */
export const salaDoTenant = (tenantId: string): string => `tenant:${tenantId}`;
/**
 * Sala das conversas do tenant (ADR-0045): mensagem e conversa levam texto do
 * cliente, então só entra quem tem o módulo Conversas. Mudança de módulo vale
 * na próxima conexão do socket (o REST já bloqueia na hora).
 */
export const salaDeConversas = (tenantId: string): string => `tenant:${tenantId}:conversas`;
const EVENTO_DE_CONVERSA = /^(message|conversation)\./;

interface SocketAutenticado extends Socket {
  data: { tenantId: string; identityId: string; role: string };
}

/**
 * Gateway de tempo real (ADR-0011). Invariante que sustenta tudo: o `tenantId`
 * vem do **ticket assinado**, nunca de nada que o cliente mande. Na conexão o
 * socket entra só na sala do próprio tenant — não existe API para o cliente
 * pedir sala, então não há como escutar outro tenant nem por engano.
 */
@WebSocketGateway({
  namespace: '/rt',
  cors: { origin: true, credentials: true },
  // reconexão é do cliente; aqui só o heartbeat que detecta queda
  pingInterval: 25_000,
  pingTimeout: 20_000,
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger('Realtime');

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  handleConnection(client: Socket): void {
    const ticket =
      (client.handshake.auth?.ticket as string | undefined) ??
      (client.handshake.query?.ticket as string | undefined);
    if (!ticket) {
      this.recusar(client, 'ticket ausente');
      return;
    }
    try {
      const claims = this.tokens.verifyWsTicket(ticket);
      const c = client as SocketAutenticado;
      c.data = { tenantId: claims.tenant_id, identityId: claims.sub, role: claims.role };
      void client.join(salaDoTenant(claims.tenant_id));
      void this.entrarNasConversas(client, claims.tenant_id, claims.sub, claims.role);
      client.emit('pronto', { tenantId: claims.tenant_id });
      this.log.debug(`socket ${client.id} conectado (tenant ${claims.tenant_id})`);
    } catch (e) {
      this.recusar(client, (e as Error).message);
    }
  }

  handleDisconnect(client: Socket): void {
    this.log.debug(`socket ${client.id} desconectado`);
  }

  /** Publica na sala do tenant. Único caminho de saída de evento. */
  emitirParaTenant<E extends RealtimeEvent>(tenantId: string, evento: E, dados: RealtimeEvents[E]): void {
    if (!this.server) return; // gateway ainda não inicializado (ex.: teste unitário do serviço)
    const envelope: RealtimeEnvelope<E> = { evento, dados, emitidoEm: new Date().toISOString() };
    const sala = EVENTO_DE_CONVERSA.test(evento) ? salaDeConversas(tenantId) : salaDoTenant(tenantId);
    this.server.to(sala).emit(evento, envelope);
  }

  /** Entra na sala de conversas se o papel/módulos permitirem (lidos do banco, não do ticket). */
  private async entrarNasConversas(client: Socket, tenantId: string, identityId: string, roleDoTicket: string): Promise<void> {
    try {
      let role = roleDoTicket;
      if (this.prisma) {
        const m = await this.prisma.membership.findUnique({ where: { identityId_tenantId: { identityId, tenantId } }, select: { role: true } });
        if (!m) return;
        role = m.role;
        if (papelRestringivel(role)) {
          const u = await this.prisma.withTenant(tenantId, (tx) => tx.user.findFirst({ where: { identityId }, select: { permissoes: true } }));
          if (!moduloLiberado(modulosDe(u?.permissoes), ['conversas'])) return;
        }
      }
      await client.join(salaDeConversas(tenantId));
    } catch (e) {
      this.log.warn(`socket ${client.id} sem sala de conversas: ${(e as Error).message}`);
    }
  }

  private recusar(client: Socket, motivo: string): void {
    this.log.warn(`conexão recusada: ${motivo}`);
    client.emit('nao_autorizado', { motivo });
    client.disconnect(true);
  }
}
