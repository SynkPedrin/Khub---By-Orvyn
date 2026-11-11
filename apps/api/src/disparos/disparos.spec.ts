import { ForbiddenException } from '@nestjs/common';
import { DisparosService, desfechoWhatsApp, type Ator } from './disparos.service';
import { dentroDaJanela, inicioDoDiaLocal, proximaAbertura, type JanelaEnvio } from './janela';
import { destinoDoContato, elegibilidade } from './segmento';
import type { PrismaService } from '../prisma/prisma.service';
import type { ConfigService } from '../config/config.service';
import type { MessagesService } from '../crm/messaging/messages.service';
import type { MailerService } from '../common/mailer.service';
import type { NotificationsService } from '../common/notifications.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TENANT = '11111111-1111-4111-8111-111111111111';
const DONO: Ator = { tipo: 'humano', identityId: '22222222-2222-4222-8222-222222222222', role: 'owner' };
const MEMBRO: Ator = { tipo: 'humano', identityId: '33333333-3333-4333-8333-333333333333', role: 'member' };
const NYRO: Ator = { tipo: 'nyro', identityId: DONO.identityId, role: 'owner' };
const SEMPRE: JanelaEnvio = { dias: [0, 1, 2, 3, 4, 5, 6], inicio: 0, fim: 24, fuso: 'America/Sao_Paulo' };

type Linha = Record<string, any>;
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

/** Casa uma linha com um `where` do Prisma (o subconjunto que o serviço usa). */
function bate(l: Linha, w: any): boolean {
  if (!w) return true;
  return Object.entries(w).every(([k, v]: [string, any]) => {
    if (k === 'AND') return (v as any[]).every((x) => bate(l, x));
    if (k === 'OR') return (v as any[]).some((x) => bate(l, x));
    const atual = l[k];
    if (v === null) return atual === null || atual === undefined;
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return (v.in as unknown[]).includes(atual);
      if ('notIn' in v) return !(v.notIn as unknown[]).includes(atual);
      if ('not' in v) return v.not === null ? atual !== null && atual !== undefined : atual !== v.not;
      if ('lte' in v) return atual !== null && atual <= v.lte;
      if ('lt' in v) return atual !== null && atual < v.lt;
      if ('gte' in v) return atual !== null && atual >= v.gte;
      return true; // filtros de texto/relação: o segmento é testado à parte
    }
    return atual === v;
  });
}

function tabela(linhas: Linha[], padrao: () => Linha = () => ({})) {
  return {
    findUnique: jest.fn(async ({ where }: any) => linhas.find((l) => bate(l, where)) ?? null),
    findFirst: jest.fn(async ({ where }: any = {}) => linhas.find((l) => bate(l, where)) ?? null),
    findMany: jest.fn(async ({ where, take }: any = {}) => linhas.filter((l) => bate(l, where)).slice(0, take ?? Infinity)),
    count: jest.fn(async ({ where }: any = {}) => linhas.filter((l) => bate(l, where)).length),
    create: jest.fn(async ({ data }: any) => { const l = { ...padrao(), id: uuid(), createdAt: new Date(), ...data }; linhas.push(l); return l; }),
    createMany: jest.fn(async ({ data }: any) => {
      let n = 0;
      for (const d of data) {
        if (linhas.some((l) => l.broadcastId === d.broadcastId && l.contactId === d.contactId)) continue; // UNIQUE
        linhas.push({ ...padrao(), id: uuid(), createdAt: new Date(Date.now() + n), ...d }); n++;
      }
      return { count: n };
    }),
    update: jest.fn(async ({ where, data }: any) => { const l = linhas.find((x) => bate(x, where))!; Object.assign(l, aplicar(l, data)); return l; }),
    updateMany: jest.fn(async ({ where, data }: any) => { const ls = linhas.filter((x) => bate(x, where)); ls.forEach((l) => Object.assign(l, aplicar(l, data))); return { count: ls.length }; }),
    delete: jest.fn(async ({ where }: any) => { const i = linhas.findIndex((x) => bate(x, where)); return linhas.splice(i, 1)[0]; }),
    groupBy: jest.fn(async ({ where }: any) => {
      const m = new Map<string, number>();
      for (const l of linhas.filter((x) => bate(x, where))) m.set(l.status, (m.get(l.status) ?? 0) + 1);
      return [...m].map(([status, n]) => ({ status, _count: { _all: n } }));
    }),
  };
}
function aplicar(l: Linha, data: Linha): Linha {
  const out: Linha = {};
  for (const [k, v] of Object.entries(data)) out[k] = v && typeof v === 'object' && 'increment' in v ? (l[k] ?? 0) + v.increment : v && typeof v === 'object' && v.constructor?.name === 'NullTypes' ? null : v;
  return out;
}

function ambiente(opts: { contatos?: Linha[]; limiteDiario?: string; aprovacaoAcima?: string; enviar?: jest.Mock; mailerOk?: boolean } = {}) {
  const contatos: Linha[] = (opts.contatos ?? []).map((c) => ({ email: null, telefone: null, empresa: null, camposCustom: {}, optedOutAt: null, ...c }));
  const broadcasts: Linha[] = [];
  const recipients: Linha[] = [];
  const conversas: Linha[] = [];
  const membros: Linha[] = [{ tenantId: TENANT, identityId: DONO.identityId, role: 'owner' }, { tenantId: TENANT, identityId: MEMBRO.identityId, role: 'member' }];
  const notificacoes: Linha[] = [];
  const mensagens: Linha[] = [];

  const sql = (strings: TemplateStringsArray) => strings.join('?');
  const tx: any = {
    contact: tabela(contatos),
    broadcast: tabela(broadcasts, () => ({
      status: 'rascunho', mensagem: '', assunto: null, segmento: {}, agendadoPara: null, loteTamanho: 20, loteIntervaloSeg: 60, janela: SEMPRE,
      exigeAprovacao: false, aprovadoPor: null, aprovadoEm: null, criadoPorTipo: 'humano', pausaMotivo: null, proximoLoteEm: null, leaseUntil: null,
      iniciadoEm: null, totalDestinatarios: 0, totalEnviados: 0, totalFalhas: 0, totalIgnorados: 0, totalRespostas: 0, tenantId: TENANT,
    })),
    broadcastRecipient: tabela(recipients, () => ({ status: 'pendente', tentativaEm: null, enviadoEm: null, messageId: null, erro: null })),
    conversation: tabela(conversas),
    membership: tabela(membros),
    contactView: tabela([]),
    message: tabela(mensagens),
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...v: any[]) => {
      const q = sql(strings);
      if (q.includes('UPDATE broadcasts SET lease_until')) {
        const [ate, id, agora1, agora2] = v;
        const b = broadcasts.find((x) => x.id === id);
        if (!b || !['agendado', 'enviando'].includes(b.status) || (b.proximoLoteEm && b.proximoLoteEm > agora1) || (b.leaseUntil && b.leaseUntil >= agora2)) return 0;
        b.leaseUntil = ate; return 1;
      }
      if (q.includes('UPDATE broadcasts b SET')) {
        const id = v[0];
        const rs = recipients.filter((r) => r.broadcastId === id);
        const b = broadcasts.find((x) => x.id === id)!;
        Object.assign(b, {
          totalDestinatarios: rs.length,
          totalEnviados: rs.filter((r) => ['enviado', 'respondeu'].includes(r.status)).length,
          totalFalhas: rs.filter((r) => r.status === 'falhou').length,
          totalIgnorados: rs.filter((r) => r.status.startsWith('ignorado')).length,
          totalRespostas: rs.filter((r) => r.status === 'respondeu').length,
        });
        return 1;
      }
      return 1; // audit_logs
    }),
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...v: any[]) => {
      const q = sql(strings);
      if (q.includes('count(*)::bigint')) {
        const [desde, canal] = v;
        return [{ n: BigInt(recipients.filter((r) => r.enviadoEm && r.enviadoEm >= desde && broadcasts.find((b) => b.id === r.broadcastId)?.canal === canal).length) }];
      }
      if (q.includes('FOR UPDATE SKIP LOCKED')) {
        const [id, n] = v;
        return recipients.filter((r) => r.broadcastId === id && r.status === 'pendente').slice(0, n).map((r) => ({ id: r.id, tentativa_em: r.tentativaEm }));
      }
      if (q.includes("SET status = 'respondeu'")) {
        const [quando, contactId, desde, ate] = v;
        const rs = recipients.filter((r) => r.contactId === contactId && r.status === 'enviado' && r.enviadoEm >= desde && r.enviadoEm <= ate);
        rs.forEach((r) => { r.status = 'respondeu'; r.respondidoEm = quando; });
        return rs.map((r) => ({ broadcast_id: r.broadcastId }));
      }
      return [];
    }),
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const env: Record<string, string | undefined> = { DISPAROS_LIMITE_DIARIO_WHATSAPP: opts.limiteDiario, DISPAROS_APROVACAO_ACIMA: opts.aprovacaoAcima };
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  const enviar = opts.enviar ?? jest.fn(async (_t: string, _c: string, _txt: string, chave: string) => ({ id: `msg-${chave}`, status: 'sent', erro: null, missing: [] }));
  const mailer = { configured: () => opts.mailerOk ?? true, missing: () => (opts.mailerOk === false ? ['SMTP_URL'] : []), send: jest.fn(async () => ({ sent: true, messageId: 'm1' })) };
  const notif = { criar: jest.fn(async (_tx: unknown, _t: string, n: Linha) => { notificacoes.push(n); return { id: uuid(), identityId: n.identityId }; }) };
  const svc = new DisparosService(prisma, config, { send: enviar } as unknown as MessagesService, mailer as unknown as MailerService, notif as unknown as NotificationsService);
  return { svc, tx, contatos, broadcasts, recipients, notificacoes, mensagens, enviar, mailer };
}

const contato = (nome: string, extra: Linha = {}): Linha => ({ id: uuid(), nome, telefone: '5511999990000', ...extra });

async function rascunho(a: ReturnType<typeof ambiente>, extra: Linha = {}, ator: Ator = DONO) {
  return a.svc.criar(TENANT, ator, { nome: 'Promo', canal: 'whatsapp', mensagem: 'Oi, {{contato.primeiroNome}}!', janela: SEMPRE, ...extra });
}

describe('janela de envio', () => {
  const comercial: JanelaEnvio = { dias: [1, 2, 3, 4, 5], inicio: 9, fim: 18, fuso: 'America/Sao_Paulo' };

  it('respeita dia e hora no fuso do disparo', () => {
    // 2026-11-11 (quarta) 15:00 UTC = 12:00 em São Paulo
    expect(dentroDaJanela(new Date('2026-11-11T15:00:00Z'), comercial)).toBe(true);
    // 22:00 UTC = 19:00 SP (fora); 11:00 UTC = 08:00 SP (fora)
    expect(dentroDaJanela(new Date('2026-11-11T22:00:00Z'), comercial)).toBe(false);
    expect(dentroDaJanela(new Date('2026-11-11T11:00:00Z'), comercial)).toBe(false);
  });

  it('fora da janela, a próxima abertura pula o fim de semana', () => {
    // sexta 2026-11-13 19:30 SP → segunda 2026-11-16 09:00 SP (12:00 UTC)
    expect(proximaAbertura(new Date('2026-11-13T22:30:00Z'), comercial)?.toISOString()).toBe('2026-11-16T12:00:00.000Z');
  });

  it('janela impossível não gira para sempre', () => {
    expect(proximaAbertura(new Date('2026-11-11T15:00:00Z'), { dias: [1], inicio: 9, fim: 10, fuso: 'America/Sao_Paulo' })).not.toBeNull();
  });

  it('o dia do limite diário começa à meia-noite local', () => {
    expect(inicioDoDiaLocal(new Date('2026-11-11T15:20:00Z'), 'America/Sao_Paulo').toISOString()).toBe('2026-11-11T03:00:00.000Z');
  });
});

describe('elegibilidade e mapeamento de envio', () => {
  it('opt-out vence tudo; sem telefone/e-mail válido é "sem canal"', () => {
    expect(elegibilidade('whatsapp', { telefone: '5511999990000', email: null, optedOutAt: new Date() })).toBe('ignorado_optout');
    expect(elegibilidade('whatsapp', { telefone: '123', email: null, optedOutAt: null })).toBe('ignorado_sem_canal');
    expect(elegibilidade('email', { telefone: null, email: 'nao-e-email', optedOutAt: null })).toBe('ignorado_sem_canal');
    expect(destinoDoContato('email', { telefone: null, email: ' Ana@Ex.com ' })).toBe('ana@ex.com');
  });

  it('status do MessagesService vira desfecho; "unknown" nunca é reenviado', () => {
    expect(desfechoWhatsApp({ id: 'm', status: 'sent' })).toEqual({ tipo: 'enviado', messageId: 'm' });
    expect(desfechoWhatsApp({ id: 'm', status: 'cancelled' }).tipo).toBe('ignorado_optout');
    expect(desfechoWhatsApp({ id: 'm', status: 'pending' }).tipo).toBe('adiar');
    expect(desfechoWhatsApp({ id: 'm', status: 'config_required', provider: 'evolution', missing: ['EVOLUTION_API_KEY'] })).toMatchObject({ tipo: 'pausar', motivo: 'config_required' });
    expect(desfechoWhatsApp({ id: 'm', status: 'unknown' }).tipo).toBe('falhou');
  });
});

describe('DisparosService', () => {
  it('congela a audiência: opt-out e sem canal ficam registrados como ignorados, e contato novo não entra', async () => {
    const a = ambiente({ contatos: [contato('ana silva'), contato('Bia', { optedOutAt: new Date() }), contato('Caio', { telefone: null })] });
    const b = await rascunho(a);
    const r = await a.svc.enviar(TENANT, DONO, b.id);
    expect(r.status).toBe('agendado');
    expect(a.recipients.map((x) => [x.nome, x.status]).sort()).toEqual([['Bia', 'ignorado_optout'], ['Caio', 'ignorado_sem_canal'], ['ana silva', 'pendente']]);

    a.contatos.push(contato('Dani (entrou depois)'));
    await a.svc.processarLote(TENANT, b.id);
    expect(a.enviar).toHaveBeenCalledTimes(1);
    expect(a.enviar.mock.calls[0][2]).toBe('Oi, Ana!');
    expect(a.recipients).toHaveLength(3);
    expect(a.recipients.find((x) => x.nome === 'ana silva')?.status).toBe('enviado');
  });

  it('acima do limite exige aprovação de owner/admin, avisa a equipe e só congela ao aprovar', async () => {
    const a = ambiente({ aprovacaoAcima: '2', contatos: [contato('A'), contato('B'), contato('C')] });
    const b = await rascunho(a);
    const r = await a.svc.enviar(TENANT, MEMBRO, b.id);
    expect(r.status).toBe('aguardando_aprovacao');
    expect(a.recipients).toHaveLength(0);
    expect(a.notificacoes).toEqual([expect.objectContaining({ identityId: DONO.identityId, tipo: 'disparo_aprovacao', url: `/campanhas/disparos/${b.id}` })]);

    await expect(a.svc.aprovar(TENANT, MEMBRO, b.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(a.svc.aprovar(TENANT, NYRO, b.id)).rejects.toBeInstanceOf(ForbiddenException);

    a.contatos.push(contato('D (antes da aprovação)'));
    const ok = await a.svc.aprovar(TENANT, DONO, b.id);
    expect(ok.status).toBe('agendado');
    expect(ok.aprovadoPor).toBe(DONO.identityId);
    expect(a.recipients).toHaveLength(4); // congelou NO momento da aprovação
  });

  it('criado pela Nyro SEMPRE exige aprovação, mesmo com 1 contato', async () => {
    const a = ambiente({ contatos: [contato('A')] });
    const b = await rascunho(a, {}, NYRO);
    expect(b.criadoPorTipo).toBe('nyro');
    expect((await a.svc.enviar(TENANT, DONO, b.id)).status).toBe('aguardando_aprovacao');
  });

  it('lote é idempotente: lease impede dois workers e reserva interrompida reusa a MESMA chave', async () => {
    const a = ambiente({ contatos: [contato('A'), contato('B')] });
    const b = await rascunho(a, { loteTamanho: 1 });
    await a.svc.enviar(TENANT, DONO, b.id);

    // outro worker segurando o lease
    a.broadcasts[0].leaseUntil = new Date(Date.now() + 60_000);
    expect((await a.svc.processarLote(TENANT, b.id)).resultado).toBe('ocupado');
    expect(a.enviar).not.toHaveBeenCalled();
    a.broadcasts[0].leaseUntil = null;

    // simula queda DEPOIS de reservar e ANTES de gravar o desfecho
    const primeiro = a.recipients.find((r) => r.status === 'pendente')!;
    primeiro.tentativaEm = new Date('2026-11-11T10:00:00Z');
    await a.svc.processarLote(TENANT, b.id);
    expect(a.enviar).toHaveBeenCalledTimes(1);
    expect(a.enviar.mock.calls[0][3]).toBe(DisparosService.chaveIdempotencia(primeiro as { id: string; tentativaEm: Date }));
    expect(a.enviar.mock.calls[0][3]).toBe(`disparo:${primeiro.id}:${primeiro.tentativaEm.getTime()}`);
    expect(primeiro.status).toBe('enviado');

    // já resolvido nunca volta a ser enviado
    a.broadcasts[0].proximoLoteEm = null;
    await a.svc.processarLote(TENANT, b.id);
    a.broadcasts[0].proximoLoteEm = null;
    await a.svc.processarLote(TENANT, b.id);
    expect(a.enviar).toHaveBeenCalledTimes(2);
    expect(a.broadcasts[0].status).toBe('concluido');
    expect(a.broadcasts[0].totalEnviados).toBe(2);
  });

  it('e-mail com reserva interrompida vira falha e não é reenviado', async () => {
    const a = ambiente({ contatos: [contato('A', { email: 'a@ex.com' })] });
    const b = await rascunho(a, { canal: 'email', assunto: 'Oi' });
    await a.svc.enviar(TENANT, DONO, b.id);
    a.recipients[0].tentativaEm = new Date();
    await a.svc.processarLote(TENANT, b.id);
    expect(a.mailer.send).not.toHaveBeenCalled();
    expect(a.recipients[0].status).toBe('falhou');
  });

  it('fora da janela não envia e agenda o lote para a próxima abertura', async () => {
    const a = ambiente({ contatos: [contato('A')] });
    const b = await rascunho(a, { janela: { dias: [1, 2, 3, 4, 5], inicio: 9, fim: 18, fuso: 'America/Sao_Paulo' } });
    await a.svc.enviar(TENANT, DONO, b.id);
    const sabado = new Date('2026-11-14T15:00:00Z');
    a.broadcasts[0].proximoLoteEm = null;
    expect((await a.svc.processarLote(TENANT, b.id, sabado)).resultado).toBe('fora_da_janela');
    expect(a.enviar).not.toHaveBeenCalled();
    expect(a.broadcasts[0].proximoLoteEm.toISOString()).toBe('2026-11-16T12:00:00.000Z');
    expect(a.broadcasts[0].leaseUntil).toBeNull();
  });

  it('limite diário por tenant segura o envio até o dia seguinte', async () => {
    const a = ambiente({ limiteDiario: '1', contatos: [contato('A'), contato('B')] });
    const b = await rascunho(a, { loteTamanho: 10 });
    await a.svc.enviar(TENANT, DONO, b.id);
    const r = await a.svc.processarLote(TENANT, b.id);
    expect(r.enviados).toBe(1); // o lote encolhe para o que resta do dia
    a.broadcasts[0].proximoLoteEm = null;
    expect((await a.svc.processarLote(TENANT, b.id)).resultado).toBe('limite_diario');
    expect(a.enviar).toHaveBeenCalledTimes(1);
    expect(a.broadcasts[0].pausaMotivo).toBe('limite_diario');
  });

  it('opt-out depois do congelamento ainda vale no envio', async () => {
    const a = ambiente({ contatos: [contato('A')] });
    const b = await rascunho(a);
    await a.svc.enviar(TENANT, DONO, b.id);
    a.contatos[0].optedOutAt = new Date();
    await a.svc.processarLote(TENANT, b.id);
    expect(a.enviar).not.toHaveBeenCalled();
    expect(a.recipients[0].status).toBe('ignorado_optout');
  });

  it('canal sem credencial pausa o disparo e devolve a reserva', async () => {
    const enviar = jest.fn(async () => ({ id: 'm', status: 'config_required', erro: null, provider: 'evolution', missing: ['EVOLUTION_API_KEY'] }));
    const a = ambiente({ enviar, contatos: [contato('A'), contato('B')] });
    const b = await rascunho(a);
    await a.svc.enviar(TENANT, DONO, b.id);
    expect((await a.svc.processarLote(TENANT, b.id)).resultado).toBe('pausado:config_required');
    expect(a.broadcasts[0].status).toBe('pausado');
    expect(a.recipients.every((r) => r.status === 'pendente' && r.tentativaEm === null)).toBe(true);
  });

  it('pausar e cancelar respeitam o estado', async () => {
    const a = ambiente({ contatos: [contato('A')] });
    const b = await rascunho(a);
    await expect(a.svc.pausar(TENANT, DONO, b.id)).rejects.toThrow();
    await a.svc.enviar(TENANT, DONO, b.id);
    expect((await a.svc.pausar(TENANT, DONO, b.id)).status).toBe('pausado');
    expect((await a.svc.processarLote(TENANT, b.id)).resultado).toBe('ocupado');
    expect((await a.svc.retomar(TENANT, DONO, b.id)).status).toBe('agendado');
    expect((await a.svc.cancelar(TENANT, DONO, b.id)).status).toBe('cancelado');
    expect(a.enviar).not.toHaveBeenCalled();
  });

  it('resposta do contato em até 72h marca "respondeu"', async () => {
    const a = ambiente({ contatos: [contato('A')] });
    const b = await rascunho(a);
    await a.svc.enviar(TENANT, DONO, b.id);
    await a.svc.processarLote(TENANT, b.id);
    const r = a.recipients[0];
    a.tx.message.findUnique.mockResolvedValueOnce({ autorTipo: 'contato', createdAt: new Date(r.enviadoEm.getTime() + 3_600_000), conversation: { contactId: r.contactId } });
    expect(await a.svc.registrarResposta(TENANT, 'msg-1')).toBe(1);
    expect(r.status).toBe('respondeu');
    expect(a.broadcasts[0].totalRespostas).toBe(1);

    // resposta tardia (> 72h) não conta
    r.status = 'enviado';
    a.tx.message.findUnique.mockResolvedValueOnce({ autorTipo: 'contato', createdAt: new Date(r.enviadoEm.getTime() + 73 * 3_600_000), conversation: { contactId: r.contactId } });
    expect(await a.svc.registrarResposta(TENANT, 'msg-2')).toBe(0);
  });
});
