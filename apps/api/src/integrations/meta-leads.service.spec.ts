import { MetaLeadsService } from './meta-leads.service';
import { ConfigService } from '../config/config.service';
import { CryptoService } from './crypto.service';
import type { LeadsService } from '../crm/leads.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { GraphClient } from './providers/meta-graph.client';
import { randomBytes } from 'node:crypto';

const TENANT = 'a0000000-0000-4000-8000-000000000001';

const PAYLOAD = {
  entry: [
    {
      changes: [
        {
          field: 'leadgen',
          value: { leadgen_id: 'LEAD_1', page_id: 'PAGE_1', form_id: 'F1', created_time: 1784000000 },
        },
        { field: 'outra_coisa', value: { x: 1 } }, // ruído: tem que ser ignorado
      ],
    },
  ],
};

function ambiente(opts: { eventoJaExiste?: boolean; pendente?: boolean; semPageToken?: boolean; tenant?: string | null; comIntegracao?: boolean } = {}) {
  const config = new ConfigService();
  const crypto = new CryptoService(config);
  const upserts: any[] = [];
  const leads = { upsertFromLead: jest.fn(async (t: string, l: unknown) => { upserts.push({ t, l }); return { contactId: 'c1', criado: true }; }) } as unknown as LeadsService;

  const cred = crypto.encryptJson({ accessToken: 'token-do-cliente', pages: opts.semPageToken ? [] : [{pageId:'PAGE_1',accessToken:'token-da-pagina'}] });
  const marcados: string[] = [];
  const prisma = {
    $queryRaw: jest.fn(async () => [{ tenant_id: opts.tenant === undefined ? TENANT : opts.tenant }]),
    withTenant: jest.fn(async (_t: string, work: (tx: unknown) => Promise<unknown>) =>
      work({
        webhookEvent: {
          findFirst: jest.fn(async () => (opts.eventoJaExiste ? { id: 'e1', processedAt: opts.pendente ? null : new Date() } : null)),
          create: jest.fn(async () => ({ id: 'e1' })),
          updateMany: jest.fn(async ({ where }: any) => { marcados.push(where.eventId); return { count: 1 }; }),
        },
        integration: { findFirst: jest.fn(async () => (opts.comIntegracao === false ? null : { credentialsEncrypted: cred })) },
      }),
    ),
  } as unknown as PrismaService;

  const graph: GraphClient = {
    get: jest.fn(async () => ({
      id: 'LEAD_1',
      created_time: '2026-07-14T12:00:00+0000',
      field_data: [
        { name: 'full_name', values: ['Joana Prospect'] },
        { name: 'email', values: ['joana@exemplo.com'] },
        { name: 'phone_number', values: ['+5511987654321'] },
        { name: 'qual_seu_orcamento', values: ['R$ 5.000'] },
      ],
    })),
  };

  return { svc: new MetaLeadsService(prisma, config, crypto, leads, graph), leads, graph, upserts, marcados };
}

describe('MetaLeadsService (D1 — Lead Ads → contato)', () => {
  const backup = { ...process.env };
  beforeEach(() => {
    process.env.META_APP_ID = 'app';
    process.env.META_APP_SECRET = 'sec';
    process.env.INTEGRATIONS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });
  afterAll(() => { process.env = backup; });

  it('parse extrai só os leadgen (ignora outros campos do webhook)', () => {
    const { svc } = ambiente();
    const evs = svc.parse(PAYLOAD);
    expect(evs).toEqual([{ leadgenId: 'LEAD_1', pageId: 'PAGE_1', formId: 'F1', createdTime: 1784000000 }]);
  });

  it('parse de payload estranho não explode', () => {
    const { svc } = ambiente();
    expect(svc.parse(null)).toEqual([]);
    expect(svc.parse({ entry: [{}] })).toEqual([]);
    expect(svc.parse({ entry: [{ changes: [{ field: 'leadgen', value: {} }] }] })).toEqual([]); // sem ids
  });

  it('caminho feliz: busca no Graph, mapeia os campos e entrega ao CRM', async () => {
    const { svc, upserts, marcados } = ambiente();
    const r = await svc.processar({ leadgenId: 'LEAD_1', pageId: 'PAGE_1', createdTime: 1784000000 });

    expect(r.ok).toBe(true);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].t).toBe(TENANT); // tenant do ROTEAMENTO, nunca do payload
    expect(upserts[0].l).toMatchObject({
      nome: 'Joana Prospect',
      email: 'joana@exemplo.com',
      telefone: '+5511987654321',
      origem: 'Meta Lead Ads',
      externalId: 'LEAD_1',
    });
    // campos livres do formulário viajam junto
    expect(upserts[0].l.campos).toMatchObject({ qual_seu_orcamento: 'R$ 5.000' });
    expect(marcados).toEqual(['LEAD_1']); // processed_at carimbado
  });

  it('reentrega do mesmo leadgen NÃO chama o Graph nem o CRM (idempotência)', async () => {
    const { svc, leads, graph } = ambiente({ eventoJaExiste: true });
    const r = await svc.processar({ leadgenId: 'LEAD_1', pageId: 'PAGE_1' });
    expect(r).toEqual({ ok: true, motivo: 'duplicado' });
    expect(graph.get).not.toHaveBeenCalled();
    expect(leads.upsertFromLead).not.toHaveBeenCalled();
  });

  it('página de ninguém: não processa (nunca chuta tenant)', async () => {
    const { svc, leads } = ambiente({ tenant: null });
    const r = await svc.processar({ leadgenId: 'LEAD_1', pageId: 'PAGE_DESCONHECIDA' });
    expect(r).toEqual({ ok: false, motivo: 'page_sem_tenant' });
    expect(leads.upsertFromLead).not.toHaveBeenCalled();
  });

  it('evento pendente pode ser retomado usando exclusivamente o token da página', async () => {
    const {svc,graph}=ambiente({eventoJaExiste:true,pendente:true});
    expect(await svc.processar({leadgenId:'LEAD_1',pageId:'PAGE_1'})).toEqual({ok:true});
    expect(graph.get).toHaveBeenCalledWith('LEAD_1',expect.any(Object),'token-da-pagina');
  });

  it('sem token da página não usa o token de usuário como fallback', async () => {
    const {svc,graph,leads}=ambiente({semPageToken:true});
    expect(await svc.processar({leadgenId:'LEAD_1',pageId:'PAGE_1'})).toEqual({ok:false,motivo:'page_token_missing'});
    expect(graph.get).not.toHaveBeenCalled();
    expect(leads.upsertFromLead).not.toHaveBeenCalled();
  });

  it('sem credencial da Meta: registra o evento e NÃO inventa contato (gating)', async () => {
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
    const { svc, leads, graph } = ambiente();
    const r = await svc.processar({ leadgenId: 'LEAD_1', pageId: 'PAGE_1' });
    expect(r).toEqual({ ok: false, motivo: 'config_required' });
    expect(graph.get).not.toHaveBeenCalled();
    expect(leads.upsertFromLead).not.toHaveBeenCalled();
  });

  it('tenant sem integração conectada não processa', async () => {
    const { svc, leads } = ambiente({ comIntegracao: false });
    const r = await svc.processar({ leadgenId: 'LEAD_1', pageId: 'PAGE_1' });
    expect(r).toEqual({ ok: false, motivo: 'sem_credencial_conectada' });
    expect(leads.upsertFromLead).not.toHaveBeenCalled();
  });

  it('falha do Graph não derruba o webhook', async () => {
    const { svc } = ambiente();
    const quebrado = new MetaLeadsService(
      (svc as any).prisma, (svc as any).config, (svc as any).crypto, (svc as any).leads,
      { get: jest.fn(async () => { throw new Error('Graph 500'); }) },
    );
    await expect(quebrado.processar({ leadgenId: 'LEAD_1', pageId: 'PAGE_1' })).resolves.toEqual({ ok: false, motivo: 'erro' });
  });
});
