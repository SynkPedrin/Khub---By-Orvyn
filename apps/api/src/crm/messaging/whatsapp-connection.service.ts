import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../integrations/crypto.service';
import { EvolutionProvider, type QrNormalizado } from './evolution.provider';

export type EstadoWhatsApp =
  | 'desconectado'
  | 'aguardando_qr'
  | 'conectando'
  | 'conectado'
  | 'erro'
  | 'nao_configurado';

export interface ConexaoWhatsApp {
  estado: EstadoWhatsApp;
  numero?: string;
  qr?: QrNormalizado;
  atualizadoEm: string;
}

/**
 * Orquestra a conexão de WhatsApp de UM tenant com a Evolution API.
 *
 * Responsabilidade separada de `MessagesService` (que só envia/recebe
 * mensagem) e de `EvolutionProvider` (que só fala HTTP com a Evolution) —
 * aqui mora a regra "não crie instância nova a cada clique" e a persistência
 * em `integrations`.
 */
@Injectable()
export class WhatsAppConnectionService {
  private readonly log = new Logger('WhatsAppConnection');

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionProvider,
    private readonly crypto: CryptoService,
  ) {}

  missing(): string[] {
    return this.evolution.missing();
  }

  /**
   * Conecta (ou reconecta) o WhatsApp do tenant.
   *
   * 1. Reaproveita a instância já registrada em `integrations`, se existir —
   *    nunca cria uma segunda para o mesmo tenant.
   * 2. Cria na Evolution só na primeira vez.
   * 3. Preserva conexão ativa; reaproveita QR da criação ou busca um novo.
   * 4. Registra o webhook do KHUB nessa instância.
   */
  async connect(tenantId: string, webhookUrl: string): Promise<ConexaoWhatsApp> {
    if (!this.evolution.configured()) {
      return { estado: 'nao_configurado', atualizadoEm: new Date().toISOString() };
    }

    const existente = await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.findFirst({ where: { tenantId, provider: 'evolution' } }),
    );

    let instanceName = existente?.externalBusinessId ?? undefined;
    let qr: QrNormalizado | undefined;

    if (instanceName) {
      const real = await this.evolution.getConnectionState(instanceName);
      if (real.estado === 'conectado') return this.status(tenantId);
    }

    if (!instanceName) {
      const criada = await this.evolution.createInstance(tenantId);
      instanceName = criada.instanceName;
      qr = criada.qr;
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.integration.upsert({
          where: { tenantId_provider_externalBusinessId: { tenantId, provider: 'evolution', externalBusinessId: instanceName! } },
          create: {
            tenantId,
            provider: 'evolution',
            externalBusinessId: instanceName,
            status: 'connecting',
            health: 'unknown',
            credentialsEncrypted: criada.instanceToken ? this.crypto.encrypt(criada.instanceToken) : null,
          },
          update: { status: 'connecting', health: 'unknown' },
        }),
      );
    }

    await this.evolution.configureWebhook(instanceName, webhookUrl);

    if (!qr?.qrImageDataUrl) qr = await this.evolution.getQrCode(instanceName);
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.updateMany({ where: { tenantId, provider: 'evolution', externalBusinessId: instanceName }, data: { status: 'connecting', erro: null } }),
    );

    return { estado: qr.qrImageDataUrl ? 'aguardando_qr' : 'conectando', qr, atualizadoEm: new Date().toISOString() };
  }

  /** Estado REAL, sempre perguntado à Evolution — nunca só o que está no banco. */
  async status(tenantId: string, incluirQr = false): Promise<ConexaoWhatsApp> {
    if (!this.evolution.configured()) {
      return { estado: 'nao_configurado', atualizadoEm: new Date().toISOString() };
    }

    const integ = await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.findFirst({ where: { tenantId, provider: 'evolution' } }),
    );
    if (!integ?.externalBusinessId) {
      return { estado: 'desconectado', atualizadoEm: new Date().toISOString() };
    }

    const real = await this.evolution.getConnectionState(integ.externalBusinessId);
    const estado: EstadoWhatsApp = real.estado === 'conectado' ? 'conectado' : real.estado === 'conectando' ? 'conectando' : real.estado === 'erro' ? 'erro' : 'desconectado';

    // Sincroniza o status persistido com o real — a UI de Integrações lê daqui.
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.updateMany({
        where: { tenantId, provider: 'evolution', externalBusinessId: integ.externalBusinessId },
        data: { status: estado === 'conectado' ? 'connected' : estado, health: estado === 'conectado' ? 'ok' : 'unknown', lastSyncAt: new Date() },
      }),
    );

    // O QR pode ficar pronto depois de /connect. Buscá-lo a pedido da UI
    // não recria instâncias nem reconfigura o webhook a cada poll.
    const qr = incluirQr && estado !== 'conectado' && estado !== 'erro'
      ? await this.evolution.getQrCode(integ.externalBusinessId)
      : undefined;
    return { estado: qr?.qrImageDataUrl ? 'aguardando_qr' : estado, qr, numero: real.numero, atualizadoEm: new Date().toISOString() };
  }

  async disconnect(tenantId: string): Promise<void> {
    const integ = await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.findFirst({ where: { tenantId, provider: 'evolution' } }),
    );
    if (!integ?.externalBusinessId) return;
    await this.evolution.logout(integ.externalBusinessId);
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.updateMany({ where: { tenantId, provider: 'evolution', externalBusinessId: integ.externalBusinessId }, data: { status: 'disconnected', health: 'unknown' } }),
    );
  }
}
