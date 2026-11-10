import { Logger } from '@nestjs/common';
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

/** Sala do tenant: cada evento é publicado aqui, nunca em broadcast global. */
export const salaDoTenant = (tenantId: string): string => `tenant:${tenantId}`;

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
    this.server.to(salaDoTenant(tenantId)).emit(evento, envelope);
  }

  private recusar(client: Socket, motivo: string): void {
    this.log.warn(`conexão recusada: ${motivo}`);
    client.emit('nao_autorizado', { motivo });
    client.disconnect(true);
  }
}
