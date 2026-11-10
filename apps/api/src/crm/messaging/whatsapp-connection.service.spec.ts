import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EvolutionProvider } from './evolution.provider';
import { CryptoService } from '../../integrations/crypto.service';

const tenant = 'a7f09625-8049-4ed3-9a0f-39420da4de8f';
const instance = `khub-${tenant}`;
const qr = { qrImageDataUrl: 'data:image/png;base64,ABC=', expiresAt: new Date(Date.now() + 45000).toISOString() };

describe('WhatsAppConnectionService — pareamento', () => {
  function setup(existente = true) {
    const integration = {
      findFirst: jest.fn().mockResolvedValue(existente ? { tenantId: tenant, externalBusinessId: instance } : null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn().mockResolvedValue({}),
    };
    const withTenant = jest.fn(async (id, work) => {
      expect(id).toBe(tenant);
      return work({ integration });
    });
    const evolution = {
      configured: jest.fn().mockReturnValue(true),
      createInstance: jest.fn().mockResolvedValue({ instanceName: instance, instanceToken: 'test-only', qr }),
      configureWebhook: jest.fn().mockResolvedValue(undefined),
      getConnectionState: jest.fn().mockResolvedValue({ estado: 'conectando' }),
      getQrCode: jest.fn().mockResolvedValue(qr),
    };
    const service = new WhatsAppConnectionService(
      { withTenant } as unknown as PrismaService,
      evolution as unknown as EvolutionProvider,
      { encrypt: jest.fn().mockReturnValue('encrypted-test-token') } as unknown as CryptoService,
    );
    return { service, integration, evolution, withTenant };
  }

  it('QR ainda ausente não é anunciado como disponível; o poll posterior recupera a imagem', async () => {
    const { service, evolution, integration } = setup();
    evolution.getQrCode.mockResolvedValueOnce({ expiresAt: qr.expiresAt }).mockResolvedValueOnce(qr);
    const first = await service.connect(tenant, 'https://orvyn.example/webhook');
    expect(first.estado).toBe('conectando');
    expect(first.qr?.qrImageDataUrl).toBeUndefined();
    const second = await service.status(tenant, true);
    expect(second.estado).toBe('aguardando_qr');
    expect(second.qr).toEqual(qr);
    expect(evolution.createInstance).not.toHaveBeenCalled();
    expect(evolution.configureWebhook).toHaveBeenCalledTimes(1);
    expect(evolution.getQrCode).toHaveBeenNthCalledWith(2, instance);
    for (const [args] of integration.updateMany.mock.calls) expect(args.where.tenantId).toBe(tenant);
  });

  it('reaproveita o QR devolvido na criação sem reiniciar o pareamento', async () => {
    const { service, evolution, integration } = setup(false);
    expect((await service.connect(tenant, 'https://orvyn.example/webhook')).qr).toEqual(qr);
    expect(evolution.getQrCode).not.toHaveBeenCalled();
    expect(integration.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ tenantId: tenant, credentialsEncrypted: 'encrypted-test-token' }),
    }));
  });

  it('não solicita QR nem reconfigura a instância quando já está conectada', async () => {
    const { service, evolution } = setup();
    evolution.getConnectionState.mockResolvedValue({ estado: 'conectado' });
    expect((await service.connect(tenant, 'https://orvyn.example/webhook')).estado).toBe('conectado');
    expect((await service.status(tenant, true)).qr).toBeUndefined();
    expect(evolution.createInstance).not.toHaveBeenCalled();
    expect(evolution.getQrCode).not.toHaveBeenCalled();
    expect(evolution.configureWebhook).not.toHaveBeenCalled();
  });

  it('poll comum não renova QR; somente solicitação explícita renova', async () => {
    const { service, evolution } = setup();
    await service.status(tenant);
    expect(evolution.getQrCode).not.toHaveBeenCalled();
    await service.status(tenant, true);
    expect(evolution.getQrCode).toHaveBeenCalledTimes(1);
  });

  it('sem integração no tenant não consulta nem cria instância de outra conta', async () => {
    const { service, evolution, integration } = setup(false);
    expect((await service.status(tenant, true)).estado).toBe('desconectado');
    expect(integration.findFirst).toHaveBeenCalledWith({ where: { tenantId: tenant, provider: 'evolution' } });
    expect(evolution.getQrCode).not.toHaveBeenCalled();
    expect(evolution.createInstance).not.toHaveBeenCalled();
  });

  it('sem credenciais não consulta o banco ou o provedor', async () => {
    const { service, evolution, withTenant } = setup();
    evolution.configured.mockReturnValue(false);
    expect((await service.connect(tenant, '')).estado).toBe('nao_configurado');
    expect(withTenant).not.toHaveBeenCalled();
  });

  it('falha do provedor não se transforma em conectado ou QR fictício', async () => {
    const { service, evolution } = setup();
    evolution.getQrCode.mockRejectedValue(new Error('provider unavailable'));
    await expect(service.status(tenant, true)).rejects.toThrow('provider unavailable');
  });
});
