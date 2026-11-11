import { BadRequestException } from '@nestjs/common';
import { avaliarAntiRobo, emitirCarimbo, hashIp, ipDoCliente } from '../common/public-request';
import { celulaCsv, extrairUtm, normalizarTelefoneBR, validarRespostas, type CampoPublico } from '../common/public-fields';
import { camposPadrao, dadosDoContato, linhasCsv, problemasDosCampos } from './forms.schema';
import { EVENTO_FORM_ENVIADO, FormsService } from './forms.service';
import { LeadsService } from '../crm/leads.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CrmService } from '../crm/crm.service';
import type { CustomFieldsService } from '../crm/custom-fields.service';
import type { PublicRateLimiter } from '../common/public-request';
import type { RedisService } from '../common/redis.service';
import type { DomainEventsService } from '../events/domain-events.service';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'segredo-de-teste-com-mais-de-32-caracteres';

const CAMPOS: CampoPublico[] = [
  ...camposPadrao(),
  { id: 'interesse', tipo: 'select', rotulo: 'Interesse', obrigatorio: false, largura: 'inteira', opcoes: ['Implante', 'Clareamento'] },
  { id: 'servicos', tipo: 'multiselect', rotulo: 'Serviços', obrigatorio: false, largura: 'inteira', opcoes: ['A', 'B'] },
  { id: 'novidades', tipo: 'checkbox', rotulo: 'Quero novidades', obrigatorio: false, largura: 'inteira' },
  { id: 'nascimento', tipo: 'date', rotulo: 'Nascimento', obrigatorio: false, largura: 'metade', mapear: { tipo: 'custom', chave: 'nascimento' } },
];

describe('normalizarTelefoneBR', () => {
  it.each([
    ['(11) 97777-1234', '5511977771234'],
    ['+55 11 97777-1234', '5511977771234'],
    ['011977771234', '5511977771234'],
    ['11 3333-4444', '551133334444'],
    ['5511977771234', '5511977771234'],
  ])('%s → %s', (bruto, esperado) => expect(normalizarTelefoneBR(bruto)).toBe(esperado));
  it.each(['123', '11 87777-1234', '(00) 00000-0000', '11111111111', 'abc'])('%s é inválido', (bruto) => expect(normalizarTelefoneBR(bruto)).toBeNull());
  it('estrangeiro só com + explícito', () => {
    expect(normalizarTelefoneBR('+1 415 555 2671')).toBe('14155552671');
  });
});

describe('validarRespostas (validação de submissão por campo)', () => {
  const base = { nome: 'Ana Souza', email: 'ANA@Exemplo.com ', telefone: '(11) 97777-1234', consentimento: true };

  it('normaliza e-mail, telefone e completa caixas desmarcadas', () => {
    const r = validarRespostas(CAMPOS, base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valores.email).toBe('ana@exemplo.com');
    expect(r.valores.telefone).toBe('5511977771234');
    expect(r.valores.novidades).toBe(false);
  });

  it('obrigatório vazio, e-mail inválido e consentimento não marcado viram erro por campo', () => {
    const r = validarRespostas(CAMPOS, { nome: '  ', email: 'nao-e-email', consentimento: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros.map((e) => e.campo).sort()).toEqual(['consentimento', 'email', 'nome']);
    expect(r.erros.find((e) => e.campo === 'consentimento')?.erro).toMatch(/aceitar/);
  });

  it('opção fora da lista, data impossível e telefone sem DDD são recusados', () => {
    const r = validarRespostas(CAMPOS, { ...base, interesse: 'Outro', servicos: ['A', 'Z'], nascimento: '2026-02-30', telefone: '97777-1234' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros.map((e) => e.campo).sort()).toEqual(['interesse', 'nascimento', 'servicos', 'telefone']);
  });

  it('chave fora do formulário é descartada (o cliente não injeta dado)', () => {
    const r = validarRespostas(CAMPOS, { ...base, tenant_id: 'outro', admin: true });
    expect(r.ok && Object.keys(r.valores)).not.toContain('tenant_id');
  });

  it('dadosDoContato segue o mapeamento e guarda o texto do consentimento', () => {
    const r = validarRespostas(CAMPOS, { ...base, nascimento: '1990-05-01' });
    if (!r.ok) throw new Error('deveria validar');
    const d = dadosDoContato(CAMPOS, r.valores);
    expect(d).toMatchObject({ nome: 'Ana Souza', email: 'ana@exemplo.com', telefone: '5511977771234', camposCustom: { nascimento: '1990-05-01' } });
    expect(d.consentimento?.texto).toMatch(/LGPD/);
  });
});

describe('problemasDosCampos (montagem do formulário)', () => {
  const defs = [{ chave: 'nascimento', tipo: 'date', rotulo: 'Nascimento' }];
  it('formulário padrão é válido', () => expect(problemasDosCampos(CAMPOS, defs, true)).toEqual([]));
  it('ativo sem e-mail nem telefone ligado ao contato é recusado (não teria dedupe)', () => {
    const semContato = CAMPOS.filter((c) => c.id !== 'email' && c.id !== 'telefone');
    expect(problemasDosCampos(semContato, defs, true).join()).toMatch(/e-mail ou de telefone/);
    expect(problemasDosCampos(semContato, defs, false)).toEqual([]);
  });
  it('campo nativo repetido, campo personalizado inexistente e tipo incompatível', () => {
    const ruim: CampoPublico[] = [
      ...CAMPOS,
      { id: 'email2', tipo: 'email', rotulo: 'Outro e-mail', obrigatorio: false, largura: 'inteira', mapear: { tipo: 'nativo', campo: 'email' } },
      { id: 'x', tipo: 'text', rotulo: 'X', obrigatorio: false, largura: 'inteira', mapear: { tipo: 'custom', chave: 'nao_existe' } },
      { id: 'y', tipo: 'checkbox', rotulo: 'Y', obrigatorio: false, largura: 'inteira', mapear: { tipo: 'custom', chave: 'nascimento' } },
    ];
    const p = problemasDosCampos(ruim, defs, true).join(' | ');
    expect(p).toMatch(/mesmo campo do contato/);
    expect(p).toMatch(/não existe/);
    expect(p).toMatch(/não combina/);
  });
});

describe('anti-robô (honeypot + tempo mínimo)', () => {
  const agora = 1_800_000_000_000;
  it('isca preenchida', () => expect(avaliarAntiRobo('form:1', { isca: 'http://spam', carimbo: emitirCarimbo('form:1', agora - 10_000) }, { agora })).toBe('isca'));
  it('enviado rápido demais', () => expect(avaliarAntiRobo('form:1', { carimbo: emitirCarimbo('form:1', agora - 1000) }, { agora })).toBe('rapido'));
  it('humano depois de 10s', () => expect(avaliarAntiRobo('form:1', { isca: '', carimbo: emitirCarimbo('form:1', agora - 10_000) }, { agora })).toBe('ok'));
  it('carimbo de outro formulário, forjado ou vencido', () => {
    expect(avaliarAntiRobo('form:2', { carimbo: emitirCarimbo('form:1', agora - 10_000) }, { agora })).toBe('carimbo_invalido');
    expect(avaliarAntiRobo('form:1', { carimbo: `${agora - 10_000}.${'a'.repeat(43)}` }, { agora })).toBe('carimbo_invalido');
    expect(avaliarAntiRobo('form:1', { carimbo: emitirCarimbo('form:1', agora - 25 * 3_600_000) }, { agora })).toBe('carimbo_invalido');
    expect(avaliarAntiRobo('form:1', {}, { agora })).toBe('carimbo_invalido');
  });
});

describe('IP, UTM e CSV', () => {
  const req = (h: Record<string, string>) => ({ ip: '10.0.0.1', headers: h });
  it('só confia no IP repassado com o segredo do proxy', () => {
    const segredo = 's'.repeat(32);
    expect(ipDoCliente(req({ 'x-khub-client-ip': '200.1.2.3', 'x-khub-proxy-secret': segredo }), segredo)).toBe('200.1.2.3');
    expect(ipDoCliente(req({ 'x-khub-client-ip': '200.1.2.3', 'x-khub-proxy-secret': 'errado'.padEnd(32, 'x') }), segredo)).toBe('10.0.0.1');
    expect(ipDoCliente(req({ 'x-khub-client-ip': '200.1.2.3' }), undefined)).toBe('10.0.0.1');
  });
  it('hash do IP muda por tenant', () => expect(hashIp('t1', '1.1.1.1')).not.toBe(hashIp('t2', '1.1.1.1')));
  it('UTM explícita vence a da página, que vence a do referrer; query some da URL gravada', () => {
    const u = extrairUtm({ utm: { utm_source: 'insta' }, pagina: 'https://site.com/lp?utm_source=google&utm_medium=cpc&email=a@b.com', referrer: 'https://google.com/?utm_campaign=x' });
    expect(u).toEqual({ utm_source: 'insta', utm_medium: 'cpc', utm_campaign: 'x', pagina: 'https://site.com/lp', referrer: 'https://google.com/' });
  });
  it('CSV neutraliza fórmula e escapa aspas', () => {
    expect(celulaCsv('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(celulaCsv(['A', 'B'])).toBe('"A; B"');
    const csv = linhasCsv(CAMPOS.slice(0, 2), [{ createdAt: new Date('2026-11-10T12:00:00Z'), respostas: { nome: 'Ana', email: 'a@b.com', antigo: 'x' }, utm: { utm_source: 'g' } }], celulaCsv);
    expect(csv.split('\r\n')[0]).toBe('﻿Enviado em,Nome completo,E-mail,antigo,utm_source');
  });
});

// ------------------------------------------------------------------ serviço

const TENANT = '11111111-1111-4111-8111-111111111111';
const FORM = '22222222-2222-4222-8222-222222222222';
const STAGE = '33333333-3333-4333-8333-333333333333';

function montarServico(opts: { nonce?: number | null } = {}) {
  const tx = {
    form: { findUnique: jest.fn(async () => ({ nome: 'Contato do site', campos: CAMPOS, estilo: { mensagemSucesso: 'Valeu!' }, tag: 'Site', stageId: STAGE })) },
    formSubmission: { create: jest.fn(async () => ({})) },
    outboxEvent: { create: jest.fn(async () => ({})) },
  };
  const prisma = {
    $queryRaw: jest.fn(async () => [{ tenant_id: TENANT, form_id: FORM, tenant_nome: 'Clínica Sorriso' }]),
    withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)),
  } as unknown as PrismaService;
  const leads = { capturar: jest.fn(async () => ({ contactId: 'c1', criado: true, tagsAdicionadas: ['Site'] })) } as unknown as LeadsService;
  const crm = { createDeal: jest.fn(async () => ({ id: 'd1' })) } as unknown as CrmService;
  const limite = { consumir: jest.fn(async () => undefined) } as unknown as PublicRateLimiter;
  const redis = { incrWithTtl: jest.fn(async () => (opts.nonce === undefined ? 1 : opts.nonce)) } as unknown as RedisService;
  const svc = new FormsService(prisma, leads, crm, {} as CustomFieldsService, limite, redis);
  return { svc, tx, leads, crm, limite };
}

const CTX = { ip: '200.1.2.3', userAgent: 'jest' };
const envio = (extra: Record<string, unknown> = {}) => ({
  respostas: { nome: 'Ana Souza', email: 'Ana@Exemplo.com', telefone: '(11) 97777-1234', consentimento: true, nascimento: '1990-05-01' },
  carimbo: emitirCarimbo(`form:${FORM}`, Date.now() - 8000),
  pagina: 'https://clinica.com/?utm_source=meta',
  ...extra,
});

describe('FormsService.enviar', () => {
  it('cria/deduplica o contato pelo CRM, aplica tag, cria negócio e publica form.submitted com dedupe = id do envio', async () => {
    const { svc, tx, leads, crm } = montarServico();
    const r = await svc.enviar('contato-do-site', envio(), CTX);
    expect(r).toEqual({ ok: true, mensagem: 'Valeu!', redirecionarUrl: null });
    expect(leads.capturar).toHaveBeenCalledWith(TENANT, expect.objectContaining({
      email: 'ana@exemplo.com', telefone: '5511977771234', nome: 'Ana Souza', tags: ['Site'],
      camposCustom: { nascimento: '1990-05-01' },
      consentimento: expect.objectContaining({ baseLegal: 'consentimento', origem: `formulario:${FORM}` }),
    }));
    expect(crm.createDeal).toHaveBeenCalledWith(TENANT, expect.objectContaining({ stageId: STAGE, contactId: 'c1' }));
    const sub = (tx.formSubmission.create.mock.calls[0] as unknown as [{ data: { id: string; utm: unknown; ipHash: string } }])[0].data;
    expect(sub.utm).toMatchObject({ utm_source: 'meta' });
    expect(sub.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sub.ipHash).not.toContain('200.1.2.3');
    const ev = (tx.outboxEvent.create.mock.calls[0] as unknown as [{ data: { kind: string; dedupeKey: string; payload: Record<string, unknown> } }])[0].data;
    expect(ev.kind).toBe(EVENTO_FORM_ENVIADO);
    expect(ev.dedupeKey).toBe(`form.submitted:${sub.id}`);
    expect(ev.payload).toMatchObject({ formId: FORM, contactId: 'c1', respostas: expect.objectContaining({ email: 'ana@exemplo.com' }) });
  });

  it('honeypot: responde sucesso e não grava nada', async () => {
    const { svc, tx, leads } = montarServico();
    const r = await svc.enviar('contato-do-site', envio({ website: 'http://spam.example' }), CTX);
    expect(r.ok).toBe(true);
    expect(leads.capturar).not.toHaveBeenCalled();
    expect(tx.formSubmission.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('envio rápido demais → 400 sem gravar', async () => {
    const { svc, leads } = montarServico();
    await expect(svc.enviar('contato-do-site', envio({ carimbo: emitirCarimbo(`form:${FORM}`, Date.now() - 500) }), CTX)).rejects.toBeInstanceOf(BadRequestException);
    expect(leads.capturar).not.toHaveBeenCalled();
  });

  it('resposta inválida → 400 com a lista de campos', async () => {
    const { svc } = montarServico();
    const e = await svc.enviar('contato-do-site', envio({ respostas: { nome: 'Ana', email: 'x', consentimento: true } }), CTX).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect((e as BadRequestException).getResponse()).toMatchObject({ code: 'respostas_invalidas', campos: [expect.objectContaining({ campo: 'email' })] });
  });

  it('duplo clique (mesmo carimbo) grava uma vez só', async () => {
    const { svc, leads } = montarServico({ nonce: 2 });
    const r = await svc.enviar('contato-do-site', envio(), CTX);
    expect(r.ok).toBe(true);
    expect(leads.capturar).not.toHaveBeenCalled();
  });

  it('rate limit por formulário e por IP antes de qualquer leitura do envio', async () => {
    const { svc, limite } = montarServico();
    await svc.enviar('contato-do-site', envio(), CTX);
    const chaves = (limite.consumir as jest.Mock).mock.calls.map((c) => c[0]);
    expect(chaves).toEqual([`form-post:${FORM}:200.1.2.3`, 'form-post-ip:200.1.2.3']);
  });

  it('slug desconhecido → 404 sem consultar o form', async () => {
    const { svc, tx } = montarServico();
    await expect(svc.enviar('NAO VALE', envio(), CTX)).rejects.toThrow('não encontrado');
    expect(tx.form.findUnique).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ dedupe no CRM

describe('LeadsService.capturar (dedupe de contato)', () => {
  function montarLeads(existente: { porEmail?: boolean; porTelefone?: boolean }) {
    const contato = { id: 'c-existente', nome: 'Ana Antiga', email: existente.porEmail ? 'ana@exemplo.com' : null, telefone: '+55 11 97777-1234', camposCustom: {} };
    const tx = {
      contact: {
        findFirst: jest.fn(async () => (existente.porEmail ? contato : null)),
        findUnique: jest.fn(async () => ({ ...contato, tags: ['Cliente'], camposCustom: {}, empresa: null })),
        create: jest.fn(async () => ({ id: 'c-novo' })),
        update: jest.fn(async () => ({})),
      },
      activity: { create: jest.fn(async () => ({})) },
      customFieldDef: { findMany: jest.fn(async () => []) },
      $queryRaw: jest.fn(async () => (existente.porTelefone ? [{ id: 'c-existente' }] : [])),
      $executeRaw: jest.fn(async () => 1),
    };
    const prisma = { withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)) } as unknown as PrismaService;
    const eventos = { publicar: jest.fn() } as unknown as DomainEventsService;
    return { svc: new LeadsService(prisma, eventos), tx, eventos };
  }

  it('mesmo e-mail: atualiza o existente (não cria), soma a tag e não regrava o nome', async () => {
    const { svc, tx, eventos } = montarLeads({ porEmail: true });
    const r = await svc.capturar(TENANT, { origem: 'Formulário: X', nome: 'Ana Nova', email: 'ANA@exemplo.com', telefone: '5511977771234', tags: ['Site'] });
    expect(r).toEqual({ contactId: 'c-existente', criado: false, tagsAdicionadas: ['Site'] });
    expect(tx.contact.create).not.toHaveBeenCalled();
    const data = (tx.contact.update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data.nome).toBeUndefined();
    expect(data.tags).toEqual(['Cliente', 'Site']);
    expect(eventos.publicar).toHaveBeenCalledWith(TENANT, 'contact.tagged', { id: 'c-existente', tag: 'Site' });
    expect(eventos.publicar).not.toHaveBeenCalledWith(TENANT, 'contact.created', expect.anything());
  });

  it('sem e-mail igual, acha pelo telefone normalizado (mesmo helper do inbox)', async () => {
    const { svc, tx } = montarLeads({ porTelefone: true });
    const r = await svc.capturar(TENANT, { origem: 'Agendamento: Y', nome: 'Ana', telefone: '5511977771234' });
    expect(r.criado).toBe(false);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.contact.create).not.toHaveBeenCalled();
  });

  it('pessoa nova: cria e aplica as tags num UPDATE (para o trigger emitir contact.tagged)', async () => {
    const { svc, tx, eventos } = montarLeads({});
    const r = await svc.capturar(TENANT, { origem: 'Formulário: X', nome: 'Bia', email: 'bia@exemplo.com', tags: ['Site'], consentimento: { baseLegal: 'consentimento', origem: 'formulario:1' } });
    expect(r).toMatchObject({ contactId: 'c-novo', criado: true });
    const criado = (tx.contact.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(criado.tags).toBeUndefined();
    expect(criado.consentimento).toMatchObject({ baseLegal: 'consentimento' });
    expect(tx.contact.update).toHaveBeenCalledWith({ where: { id: 'c-novo' }, data: { tags: ['Site'] } });
    expect(eventos.publicar).toHaveBeenCalledWith(TENANT, 'contact.created', expect.objectContaining({ id: 'c-novo' }));
  });

  it('sem e-mail e sem telefone → 400', async () => {
    const { svc } = montarLeads({});
    await expect(svc.capturar(TENANT, { origem: 'X', nome: 'Sem contato' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
