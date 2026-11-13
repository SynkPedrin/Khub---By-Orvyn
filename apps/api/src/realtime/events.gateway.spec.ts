import { JwtService } from '@nestjs/jwt';
import { EventsGateway, salaDeConversas, salaDoTenant } from './events.gateway';
import { RealtimeService } from './realtime.service';
import { TokenService } from '../auth/token.service';
import { ConfigService } from '../config/config.service';
import type { PrismaService } from '../prisma/prisma.service';

const TENANT_A = 'a0000000-0000-4000-8000-00000000000a';
const TENANT_B = 'b0000000-0000-4000-8000-00000000000b';
const SEGREDO = 'segredo-de-teste-com-mais-de-16-chars';

function tokens(): TokenService {
  const jwt = new JwtService({ secret: SEGREDO, signOptions: { expiresIn: '15m' } });
  return new TokenService(jwt, {} as PrismaService);
}

/** Socket falso: registra salas e o que foi emitido/desconectado. */
function fakeSocket(auth: Record<string, unknown> = {}, query: Record<string, unknown> = {}) {
  const salas: string[] = [];
  const emitidos: { evento: string; payload: unknown }[] = [];
  let desconectado = false;
  return {
    id: 'sock-1',
    handshake: { auth, query },
    data: {} as Record<string, unknown>,
    join: (s: string) => { salas.push(s); },
    emit: (evento: string, payload: unknown) => { emitidos.push({ evento, payload }); },
    disconnect: () => { desconectado = true; },
    salas,
    emitidos,
    get desconectado() { return desconectado; },
  };
}

/** Server falso: guarda para qual sala cada emissão foi. */
function fakeServer() {
  const enviados: { sala: string; evento: string; envelope: any }[] = [];
  return {
    to: (sala: string) => ({
      emit: (evento: string, envelope: unknown) => { enviados.push({ sala, evento, envelope }); },
    }),
    enviados,
  };
}

function gateway() {
  const g = new EventsGateway(tokens(), new ConfigService());
  const server = fakeServer();
  (g as unknown as { server: unknown }).server = server;
  return { g, server };
}

const claims = (tenant: string) => ({ sub: 'id-1', tenant_id: tenant, role: 'owner', email: 'a@b.c' });

describe('EventsGateway (D2 — auth e isolamento do socket)', () => {
  it('conecta com ticket válido e entra SÓ na sala do próprio tenant', () => {
    const { g } = gateway();
    const ticket = tokens().signWsTicket(claims(TENANT_A));
    const s = fakeSocket({ ticket });
    g.handleConnection(s as never);

    expect(s.salas).toEqual([salaDoTenant(TENANT_A), salaDeConversas(TENANT_A)]);
    expect(s.data).toMatchObject({ tenantId: TENANT_A });
    expect(s.desconectado).toBe(false);
    expect(s.emitidos[0].evento).toBe('pronto');
  });

  it('sem ticket: recusa e desconecta', () => {
    const { g } = gateway();
    const s = fakeSocket();
    g.handleConnection(s as never);
    expect(s.desconectado).toBe(true);
    expect(s.salas).toEqual([]);
    expect(s.emitidos[0].evento).toBe('nao_autorizado');
  });

  it('ticket forjado (outro segredo) é recusado', () => {
    const { g } = gateway();
    const outro = new JwtService({ secret: 'segredo-do-atacante-1234567890' });
    const ticket = outro.sign({ ...claims(TENANT_B), typ: 'ws' });
    const s = fakeSocket({ ticket });
    g.handleConnection(s as never);
    expect(s.desconectado).toBe(true);
    expect(s.salas).toEqual([]);
  });

  it('ticket expirado é recusado', () => {
    const { g } = gateway();
    const jwt = new JwtService({ secret: SEGREDO });
    const ticket = jwt.sign({ ...claims(TENANT_A), typ: 'ws' }, { expiresIn: '-10s' });
    const s = fakeSocket({ ticket });
    g.handleConnection(s as never);
    expect(s.desconectado).toBe(true);
  });

  it('ACCESS TOKEN comum não abre socket (falta typ:ws)', () => {
    const { g } = gateway();
    const access = tokens().signAccess(claims(TENANT_A)); // token da API REST
    const s = fakeSocket({ ticket: access });
    g.handleConnection(s as never);
    expect(s.desconectado).toBe(true);
    expect(s.salas).toEqual([]);
  });

  it('cliente NÃO escolhe tenant: o que ele manda no handshake é ignorado', () => {
    const { g } = gateway();
    const ticket = tokens().signWsTicket(claims(TENANT_A));
    // tenta se passar pelo tenant B por todos os caminhos que o cliente controla
    const s = fakeSocket({ ticket, tenantId: TENANT_B, tenant_id: TENANT_B }, { tenantId: TENANT_B });
    g.handleConnection(s as never);
    expect(s.salas).toEqual([salaDoTenant(TENANT_A), salaDeConversas(TENANT_A)]); // ticket manda, payload do cliente não
    expect(s.data.tenantId).toBe(TENANT_A);
  });

  it('evento vai para a sala do tenant — nunca em broadcast', () => {
    const { g, server } = gateway();
    g.emitirParaTenant(TENANT_A, 'deal.moved', { id: 'd1', stageId: 's2', stageAnterior: 's1' });

    expect(server.enviados).toHaveLength(1);
    expect(server.enviados[0].sala).toBe(salaDoTenant(TENANT_A));
    expect(server.enviados[0].sala).not.toBe(salaDoTenant(TENANT_B));
    expect(server.enviados[0].envelope).toMatchObject({ evento: 'deal.moved', dados: { id: 'd1' } });
    expect(server.enviados[0].envelope.emitidoEm).toBeTruthy();
  });

  it('ticket aceito também via query (fallback de cliente que não usa auth)', () => {
    const { g } = gateway();
    const ticket = tokens().signWsTicket(claims(TENANT_A));
    const s = fakeSocket({}, { ticket });
    g.handleConnection(s as never);
    expect(s.salas).toEqual([salaDoTenant(TENANT_A), salaDeConversas(TENANT_A)]);
  });
});

describe('EventsGateway — acesso por módulo (ADR-0045)', () => {
  /** Prisma falso: membership e permissões do colaborador. */
  function prismaCom(role: string, permissoes: unknown) {
    const user = { findFirst: async () => ({ permissoes }) };
    return {
      membership: { findUnique: async () => ({ role }) },
      withTenant: async <T>(_t: string, fn: (tx: unknown) => Promise<T>) => fn({ user }),
    } as unknown as PrismaService;
  }
  const conectar = async (prisma: PrismaService, role: string) => {
    const g = new EventsGateway(tokens(), new ConfigService(), prisma);
    const s = fakeSocket({ ticket: tokens().signWsTicket({ ...claims(TENANT_A), role }) });
    g.handleConnection(s as never);
    await new Promise((r) => setImmediate(r));
    return s;
  };

  it('colaborador sem Conversas NÃO entra na sala de conversas', async () => {
    const s = await conectar(prismaCom('member', { modulos: ['agenda'] }), 'member');
    expect(s.salas).toEqual([salaDoTenant(TENANT_A)]);
  });

  it('colaborador com Conversas entra', async () => {
    const s = await conectar(prismaCom('member', { modulos: ['conversas'] }), 'member');
    expect(s.salas).toEqual([salaDoTenant(TENANT_A), salaDeConversas(TENANT_A)]);
  });

  it('papel vem do banco, não do ticket: admin no banco nunca é restrito', async () => {
    const s = await conectar(prismaCom('admin', { modulos: [] }), 'member');
    expect(s.salas).toContain(salaDeConversas(TENANT_A));
  });

  it('mensagem e conversa vão para a sala de conversas; o resto, para a do tenant', () => {
    const { g, server } = gateway();
    g.emitirParaTenant(TENANT_A, 'message.created', { conversationId: 'c1', id: 'm1', de: 'contato', texto: 'oi', hora: null });
    g.emitirParaTenant(TENANT_A, 'conversation.updated', { id: 'c1' });
    g.emitirParaTenant(TENANT_A, 'deal.updated', { id: 'd1' });
    expect(server.enviados.map((e) => e.sala)).toEqual([salaDeConversas(TENANT_A), salaDeConversas(TENANT_A), salaDoTenant(TENANT_A)]);
  });
});

describe('RealtimeService (D2)', () => {
  it('publicar não derruba a operação de negócio se o socket falhar', () => {
    const gatewayQuebrado = {
      emitirParaTenant: () => { throw new Error('socket morreu'); },
    } as unknown as EventsGateway;
    const svc = new RealtimeService(gatewayQuebrado);
    // a mensagem já foi commitada: um socket quebrado não pode virar erro 500
    expect(() => svc.publicar(TENANT_A, 'deal.updated', { id: 'd1' })).not.toThrow();
  });

  it('gateway sem server (boot incompleto) não explode', () => {
    const g = new EventsGateway(tokens(), new ConfigService());
    expect(() => g.emitirParaTenant(TENANT_A, 'deal.updated', { id: 'd1' })).not.toThrow();
  });
});
