import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  casarLink, fonteDoLink, limparOpcional, montarUrlWhatsapp, slugCodigo, toqueDeLink,
  validarCampanha, validarCodigo, validarFonte, validarTextoInicial, type LinkParaMatch,
} from './links-rastreados';
import { agregarCampanhas } from './atribuicao';
import { LinksRastreadosService } from './links-rastreados.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StevoApiProvider } from './messaging/stevo-api.provider';
import type { EvolutionProvider } from './messaging/evolution.provider';

const T = '11111111-1111-1111-1111-111111111111';
const L1 = '7b000000-0000-4000-8000-000000000001';

const link = (over: Partial<LinkParaMatch> = {}): LinkParaMatch => ({
  codigo: 'botox-sp', campanha: 'Botox SP', fonte: 'google_ads', conjunto: null, criativo: null,
  textoInicial: 'Quero saber o preço da botox', ...over,
});

describe('Links rastreados (db/080): slug e validação', () => {
  it('código nasce do nome da campanha: minúsculo, sem acento, 2–60 chars', () => {
    expect(slugCodigo('Progressiva — Black Friday 2026!')).toBe('progressiva-black-friday-2026');
    expect(slugCodigo('  Ótica ÉTICA  ')).toBe('otica-etica');
    expect(slugCodigo('a'.repeat(100))).toHaveLength(60);
    expect(slugCodigo('!!!')).toBe('link'); // sem nada aproveitável, ainda dentro do CHECK
  });

  it('código informado pelo usuário é validado; demais campos saneados', () => {
    expect(validarCodigo('Botox-SP')).toBe('botox-sp');
    expect(() => validarCodigo('botox_sp')).toThrow(BadRequestException);
    expect(() => validarCodigo('-x')).toThrow(BadRequestException);
    expect(() => validarCodigo('x')).toThrow(BadRequestException);
    expect(validarCampanha('  Campanha   X ')).toBe('Campanha X');
    expect(() => validarCampanha('  ')).toThrow(BadRequestException);
    expect(() => validarTextoInicial('oi')).toThrow(BadRequestException);
    expect(() => validarTextoInicial('x'.repeat(401))).toThrow(BadRequestException);
    expect(validarFonte('google_ads')).toBe('google_ads');
    expect(() => validarFonte('google')).toThrow(BadRequestException);
    expect(limparOpcional('  ')).toBeNull();
    expect(limparOpcional(' Conjunto 1 ')).toBe('Conjunto 1');
  });
});

describe('Links rastreados (db/080): casamento da 1ª mensagem', () => {
  const links = [link(), link({ codigo: 'promo', textoInicial: 'Promoção de novembro' })];

  it('match exato ignora caixa e espaços das bordas', () => {
    expect(casarLink(links, '  QUERO SABER O PREÇO DA BOTOX ')?.codigo).toBe('botox-sp');
  });

  it('prefixo: o lead completou a mensagem depois do texto do anúncio', () => {
    expect(casarLink(links, 'Quero saber o preço da botox, sou a Maria')?.codigo).toBe('botox-sp');
  });

  it('entre prefixos, vence o texto mais longo (mais específico)', () => {
    const dois = [link({ codigo: 'curto', textoInicial: 'Promoção' }), link({ codigo: 'longo', textoInicial: 'Promoção de novembro' })];
    expect(casarLink(dois, 'promoção de novembro chegando')?.codigo).toBe('longo');
  });

  it('não-match: texto no meio não conta; mensagem vazia não casa', () => {
    expect(casarLink(links, 'oi, tudo bem?')).toBeNull();
    expect(casarLink(links, 'alguém sabe o Quero saber o preço da botox')).toBeNull();
    expect(casarLink(links, '   ')).toBeNull();
  });

  it('o toque gravado é confirmado, com a campanha e o código como cliqueId', () => {
    const t = toqueDeLink(link({ conjunto: 'SP capital', criativo: 'vídeo 15s' }), new Date('2026-11-24T12:00:00Z'));
    expect(t).toMatchObject({
      fonte: 'google_ads', canal: 'WhatsApp', confianca: 'confirmada',
      campanha: 'Botox SP', conjunto: 'SP capital', criativo: 'vídeo 15s',
      cliqueId: 'botox-sp', sinal: 'link_rastreado',
    });
    expect(fonteDoLink('meta_ads')).toBe('meta_ads');
    expect(fonteDoLink('organico')).toBe('whatsapp_direto'); // post orgânico que caiu no WhatsApp
    expect(fonteDoLink('outro')).toBe('desconhecida');
  });
});

describe('Links rastreados (db/080): URL wa.me', () => {
  it('número vira só dígitos e o texto vai url-encoded', () => {
    expect(montarUrlWhatsapp('+55 (11) 99999-0000', 'Quero saber o preço?')).toBe(
      'https://wa.me/5511999990000?text=Quero%20saber%20o%20pre%C3%A7o%3F',
    );
  });

  it('número inválido não gera URL (o serviço devolve null + aviso)', () => {
    expect(montarUrlWhatsapp('123', 'oi')).toBeNull();
  });
});

describe('Métricas por campanha: agregação (db/066 × db/080)', () => {
  it('junta fonte+campanha separando confiança; sem fonte vira desconhecida', () => {
    const out = agregarCampanhas([
      { fonte: 'google_ads', campanha: 'Botox SP', confianca: 'confirmada', total: 3 },
      { fonte: 'google_ads', campanha: 'Botox SP', confianca: 'provavel', total: 1 },
      { fonte: 'meta_ads', campanha: null, confianca: 'confirmada', total: 5 },
      { fonte: null, campanha: null, confianca: null, total: 2 },
    ]);
    expect(out[0]).toEqual({ fonte: 'meta_ads', campanha: null, total: 5, confirmada: 5, provavel: 0, desconhecida: 0 });
    expect(out[1]).toEqual({ fonte: 'google_ads', campanha: 'Botox SP', total: 4, confirmada: 3, provavel: 1, desconhecida: 0 });
    expect(out[2]).toMatchObject({ fonte: 'desconhecida', total: 2, desconhecida: 2 });
  });
});

/* ------------------------------------------------------------------ */
/* CRUD do serviço com tx falso (mesmo padrão dos specs do módulo)     */
/* ------------------------------------------------------------------ */

interface Linha {
  id: string; codigo: string; campanha: string; fonte: string; conjunto: string | null;
  criativo: string | null; textoInicial: string; ativo: boolean; createdAt: Date; updatedAt: Date;
}
const linha = (over: Partial<Linha> = {}): Linha => ({
  id: L1, codigo: 'botox-sp', campanha: 'Botox SP', fonte: 'google_ads', conjunto: null, criativo: null,
  textoInicial: 'Quero saber o preço da botox', ativo: true,
  createdAt: new Date('2026-11-24T10:00:00Z'), updatedAt: new Date('2026-11-24T10:00:00Z'), ...over,
});

function ambiente(opts: { links?: Linha[]; leadsRows?: { codigo: string; total: number }[]; integracao?: { provider: string; externalBusinessId: string } | null; numeroStevo?: string | null } = {}) {
  const links = opts.links ? [...opts.links] : [];
  const log: { op: string; args: unknown }[] = [];
  const tx = {
    linkRastreado: {
      findMany: jest.fn(async () => links),
      findFirst: jest.fn(async (a: { where: { codigo: string } }) => links.find((l) => l.codigo === a.where.codigo) ?? null),
      findUnique: jest.fn(async (a: { where: { id: string } }) => links.find((l) => l.id === a.where.id) ?? null),
      create: jest.fn(async (a: { data: Partial<Linha> }) => { const l = linha({ id: `novo-${links.length}`, ...a.data } as Linha); links.push(l); log.push({ op: 'create', args: a }); return l; }),
      update: jest.fn(async (a: { where: { id: string }; data: Partial<Linha> }) => {
        const l = links.find((x) => x.id === a.where.id)!;
        Object.assign(l, a.data);
        log.push({ op: 'update', args: a });
        return l;
      }),
      delete: jest.fn(async (a: { where: { id: string } }) => { links.splice(links.findIndex((x) => x.id === a.where.id), 1); log.push({ op: 'delete', args: a }); }),
    },
    integration: {
      findFirst: jest.fn(async (a: { where: { provider: string; status: string } }) =>
        opts.integracao && opts.integracao.provider === a.where.provider ? opts.integracao : null),
    },
    $queryRaw: jest.fn(async () => opts.leadsRows ?? []),
  };
  const prisma = { withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)) } as unknown as PrismaService;
  const stevoApi = { conexao: jest.fn(async () => ({ connected: true, logged_in: true, phone_number: opts.numeroStevo === undefined ? '5511999990000' : opts.numeroStevo })) } as unknown as StevoApiProvider;
  const evolution = { getConnectionState: jest.fn(async () => ({ estado: 'conectado', numero: '5511988880000' })) } as unknown as EvolutionProvider;
  return { prisma, tx, links, log, stevoApi, evolution };
}

describe('LinksRastreadosService: CRUD', () => {
  const ENTRADA = { campanha: 'Botox SP', fonte: 'google_ads', textoInicial: 'Quero saber o preço da botox' };

  it('cria gerando o código da campanha e devolve a URL wa.me do número conectado', async () => {
    const a = ambiente({ integracao: { provider: 'stevo_api', externalBusinessId: 'inst-1' } });
    const r = await new LinksRastreadosService(a.prisma, a.stevoApi, a.evolution).criar(T, ENTRADA, 'ident-1');
    expect(r.codigo).toBe('botox-sp');
    expect(r.urlWhatsapp).toBe('https://wa.me/5511999990000?text=Quero%20saber%20o%20pre%C3%A7o%20da%20botox');
    expect(r.aviso).toBeNull();
    expect(r.leads).toBe(0);
    expect((a.log[0].args as { data: { createdBy: string } }).data.createdBy).toBe('ident-1');
  });

  it('código ocupado ganha sufixo (-2); todos ocupados é 409', async () => {
    const a = ambiente({ links: [linha()], integracao: null });
    const r = await new LinksRastreadosService(a.prisma).criar(T, ENTRADA);
    expect(r.codigo).toBe('botox-sp-2');
    const ocupados = [linha(), ...Array.from({ length: 19 }, (_, i) => linha({ id: `x${i}`, codigo: `botox-sp-${i + 2}` }))];
    const b = ambiente({ links: ocupados });
    await expect(new LinksRastreadosService(b.prisma).criar(T, { ...ENTRADA, codigo: 'botox-sp' })).rejects.toThrow(ConflictException);
  });

  it('sem WhatsApp conectado: urlWhatsapp null com aviso explicando (o link existe mesmo assim)', async () => {
    const a = ambiente({ links: [linha()] });
    const [item] = await new LinksRastreadosService(a.prisma, a.stevoApi, a.evolution).listar(T);
    expect(item.urlWhatsapp).toBeNull();
    expect(item.aviso).toContain('nenhum WhatsApp conectado');
  });

  it('falha ao consultar a instância não derruba o CRUD: URL null com aviso', async () => {
    const a = ambiente({ links: [linha()], integracao: { provider: 'stevo_api', externalBusinessId: 'inst-1' } });
    (a.stevoApi.conexao as jest.Mock).mockRejectedValue(new Error('stevo 500'));
    const [item] = await new LinksRastreadosService(a.prisma, a.stevoApi, a.evolution).listar(T);
    expect(item.urlWhatsapp).toBeNull();
    expect(item.aviso).toBeTruthy();
  });

  it('listar traz a contagem de leads por código (sinal link_rastreado + cliqueId)', async () => {
    const a = ambiente({ links: [linha()], leadsRows: [{ codigo: 'botox-sp', total: 7 }] });
    const [item] = await new LinksRastreadosService(a.prisma).listar(T);
    expect(item.leads).toBe(7);
  });

  it('atualiza campos, desativa e carimba updatedAt; inexistente é 404', async () => {
    const a = ambiente({ links: [linha()] });
    const r = await new LinksRastreadosService(a.prisma).atualizar(T, L1, { ativo: false, campanha: ' Botox SP 2027 ' });
    expect(r).toMatchObject({ ativo: false, campanha: 'Botox SP 2027' });
    expect((a.log.find((l) => l.op === 'update')!.args as { data: { updatedAt: Date } }).data.updatedAt).toBeInstanceOf(Date);
    await expect(new LinksRastreadosService(a.prisma).atualizar(T, '7b000000-0000-4000-8000-000000000099', { ativo: false })).rejects.toThrow(NotFoundException);
  });

  it('remove; inexistente é 404', async () => {
    const a = ambiente({ links: [linha()] });
    await expect(new LinksRastreadosService(a.prisma).remover(T, L1)).resolves.toEqual({ ok: true });
    expect(a.links).toHaveLength(0);
    await expect(new LinksRastreadosService(a.prisma).remover(T, L1)).rejects.toThrow(NotFoundException);
  });

  it('toda operação abre transação com o tenant da sessão (isolamento por tenant)', async () => {
    const a = ambiente({ links: [linha()] });
    const svc = new LinksRastreadosService(a.prisma, a.stevoApi, a.evolution);
    await svc.listar(T);
    await svc.atualizar(T, L1, { ativo: false });
    await svc.remover(T, L1);
    expect((a.prisma.withTenant as jest.Mock).mock.calls.every((c) => c[0] === T)).toBe(true);
  });
});
