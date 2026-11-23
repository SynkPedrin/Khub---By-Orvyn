import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { CENARIOS_TESTE_AGENTE, normalizarEscopo } from './onboarding.catalogo';
import type { PrismaService } from '../prisma/prisma.service';
import type { AgencyService } from '../agency/agency.service';
import type { GennaService } from '../integrations/genna/genna.service';

const AGENCIA = 'agencia-1';
const CLIENTE_1 = '11111111-1111-4111-8111-111111111111';
const CLIENTE_2 = '22222222-2222-4222-8222-222222222222';

type Linha = Record<string, any>;

/**
 * Banco em memória com o contrato que o OnboardingService usa — mesmo padrão
 * de agency.service.spec.ts. O foco é a fronteira de autorização (escopo da
 * agência via AgencyService) e as regras de homologação (finalizar).
 */
function ambiente(opts: {
  role?: string;
  clientesVisiveis?: string[];
  onboardings?: Linha[];
  verifications?: Linha[];
  knowledge?: Linha[];
  agents?: Linha[];
} = {}) {
  const role = opts.role ?? 'owner';
  const membro = { id: 'membro-1', agencyId: AGENCIA, identityId: 'ident-1', role };
  const clientesVisiveis = opts.clientesVisiveis ?? [CLIENTE_1, CLIENTE_2];

  const onboardings: Linha[] = [...(opts.onboardings ?? [])];
  const verifications: Linha[] = [...(opts.verifications ?? [])];
  const knowledge: Linha[] = [...(opts.knowledge ?? [])];
  const agents: Linha[] = [...(opts.agents ?? [])];
  const events: Linha[] = [];
  const tasks: Linha[] = [];
  const onboardingTasks: Linha[] = [];
  const hist: Linha[] = [];
  const meetings: Linha[] = [];
  const reports: Linha[] = [];
  const approvals: Linha[] = [];
  let seq = 0;
  const novoId = () => `id-${++seq}`;

  const casa = (row: Linha, where: Linha): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (v && typeof v === 'object') {
        if ('in' in v) return (v.in as unknown[]).includes(row[k]);
        if ('not' in v) return row[k] !== v.not;
      }
      return row[k] === v;
    });

  const prisma = {
    agencyMember: {
      count: jest.fn(async ({ where }: any) => (where.id && where.id !== 'membro-1' && where.id !== 'membro-2' ? 0 : 1)),
    },
    agencyOnboarding: {
      findFirst: jest.fn(async ({ where }: any) => onboardings.find((o) => casa(o, where)) ?? null),
      findMany: jest.fn(async ({ where }: any) => onboardings.filter((o) => casa(o, where))),
      create: jest.fn(async ({ data }: any) => {
        const ob = { id: novoId(), status: 'coleta', escopo: {}, createdAt: new Date(), ...data };
        onboardings.push(ob);
        return ob;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const ob = onboardings.find((o) => o.id === where.id)!;
        Object.assign(ob, data);
        return ob;
      }),
    },
    agencyOnboardingVerification: {
      findFirst: jest.fn(async ({ where }: any) => verifications.find((v) => casa(v, where)) ?? null),
      findMany: jest.fn(async ({ where, select }: any) => {
        const rows = verifications.filter((v) => casa(v, where));
        return select ? rows.map((r) => Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, r[k]]))) : rows;
      }),
      createMany: jest.fn(async ({ data }: any) => {
        for (const d of data) verifications.push({ id: novoId(), status: 'pendente', evidencias: [], ...d });
        return { count: data.length };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const v = verifications.find((x) => x.id === where.id)!;
        Object.assign(v, data);
        return v;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = verifications.filter((v) => casa(v, where));
        rows.forEach((v) => Object.assign(v, data));
        return { count: rows.length };
      }),
    },
    agencyOnboardingKnowledge: {
      findMany: jest.fn(async ({ where, select }: any) => {
        const rows = knowledge.filter((k) => casa(k, where));
        return select ? rows.map((r) => Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, r[k]]))) : rows;
      }),
      createMany: jest.fn(async ({ data }: any) => {
        for (const d of data) knowledge.push({ id: novoId(), dados: {}, pendente: true, ...d });
        return { count: data.length };
      }),
    },
    agencyOnboardingKnowledgeHist: {
      create: jest.fn(async ({ data }: any) => hist.push(data)),
      findMany: jest.fn(async () => hist),
    },
    agencyOnboardingMeeting: {
      create: jest.fn(async ({ data }: any) => {
        const m = { id: novoId(), ...data };
        meetings.push(m);
        return m;
      }),
      findMany: jest.fn(async ({ where }: any) => meetings.filter((m) => casa(m, where))),
      findFirst: jest.fn(async ({ where }: any) => meetings.find((m) => casa(m, where)) ?? null),
      update: jest.fn(async ({ where, data }: any) => Object.assign(meetings.find((m) => m.id === where.id)!, data)),
    },
    agencyOnboardingReport: {
      create: jest.fn(async ({ data }: any) => {
        const r = { id: novoId(), createdAt: new Date(), ...data };
        reports.push(r);
        return r;
      }),
      findMany: jest.fn(async ({ where }: any) => reports.filter((r) => casa(r, where))),
    },
    agencyOnboardingAgent: {
      findUnique: jest.fn(async ({ where }: any) => agents.find((g) => g.onboardingId === (where.onboardingId ?? where.onboardingId_secao)) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const g = agents.find((x) => x.onboardingId === where.onboardingId);
        if (g) return Object.assign(g, update);
        const n = { id: novoId(), testes: [], approvalStatus: 'rascunho', ...create };
        agents.push(n);
        return n;
      }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(agents.find((g) => g.id === where.id)!, data)),
    },
    agencyOnboardingTask: {
      findMany: jest.fn(async ({ where, select }: any) => {
        const rows = onboardingTasks.filter((t) => casa(t, where));
        return select ? rows.map((r) => Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, r[k]]))) : rows;
      }),
      create: jest.fn(async ({ data }: any) => {
        const l = { id: novoId(), ...data };
        onboardingTasks.push(l);
        return l;
      }),
    },
    agencyOnboardingApproval: {
      create: jest.fn(async ({ data, select }: any) => {
        const ap = { id: novoId(), status: 'pendente', createdAt: new Date(), ...data };
        approvals.push(ap);
        return select ? Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, (ap as any)[k]])) : ap;
      }),
      findUnique: jest.fn(async ({ where }: any) => approvals.find((ap) => ap.id === where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) => approvals.filter((ap) => casa(ap, where))),
      update: jest.fn(async ({ where, data }: any) => Object.assign(approvals.find((ap) => ap.id === where.id)!, data)),
    },
    agencyOnboardingEvent: {
      create: jest.fn(async ({ data }: any) => {
        events.push(data);
        return data;
      }),
      findMany: jest.fn(async ({ where }: any) => events.filter((e) => e.onboardingId === where.onboardingId)),
    },
    agencyTask: {
      findMany: jest.fn(async ({ where }: any) => tasks.filter((t) => casa(t, where))),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data, select }: any) => {
        const t = { id: novoId(), arquivadaEm: null, ...data };
        tasks.push(t);
        return select ? { id: t.id } : t;
      }),
    },
    $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(prisma)),
    // O FOR UPDATE do finalizar devolve a linha atual do onboarding.
    $queryRaw: jest.fn(async (..._a: unknown[]) => {
      const ob = onboardings.find((o) => o.id === (prisma.$queryRaw as any).__alvo);
      return ob ? [{ id: ob.id, status: ob.status, escopo: ob.escopo, completed_at: ob.completedAt ?? null }] : [];
    }),
    withTenant: jest.fn(async (_t: string, work: (tx: unknown) => Promise<unknown>) => work({ $executeRaw: jest.fn(async () => 1) })),
  } as unknown as PrismaService;

  const agency = {
    escopo: jest.fn(async (identityId: string) => {
      if (identityId === 'ninguem') return null;
      return {
        membro,
        clientes: clientesVisiveis.map((id) => ({ id, tenantId: `tenant-${id.slice(0, 8)}`, displayName: `Cliente ${id.slice(0, 4)}`, status: 'active' })),
      };
    }),
  } as unknown as AgencyService;

  const genna = {
    consultar: jest.fn(async () => ({ ferramenta: 'instagram_metrics', classe: 'leitura', ok: true, texto: '{}', dados: { seguidores: 100 }, imagens: [], links: [] })),
  } as unknown as GennaService;

  return { svc: new OnboardingService(prisma, agency, genna), prisma, agency, genna, onboardings, verifications, knowledge, agents, events, tasks, onboardingTasks, reports, approvals };
}

const OB_BASE = { agencyId: AGENCIA, clientAccountId: CLIENTE_1, status: 'coleta', escopo: { trafego: true }, createdAt: new Date() };

describe('OnboardingService.iniciar', () => {
  it('caminho feliz: cria onboarding + verificações do escopo + 7 seções de conhecimento + evento', async () => {
    const a = ambiente();
    const ob = await a.svc.iniciar('ident-1', { clientAccountId: CLIENTE_1, escopo: { trafego: true } });
    expect(ob.agencyId).toBe(AGENCIA);
    // Escopo com tráfego: 16 verificações menos as de social/branding/audiovisual/agente_ia = 12.
    const chaves = a.verifications.map((v) => v.chave);
    expect(chaves).toContain('verba_confirmada');
    expect(chaves).toContain('aprovacao_final');
    expect(chaves).not.toContain('agente_ia_testado');
    expect(a.knowledge).toHaveLength(7);
    expect(a.knowledge.every((k) => k.pendente === true)).toBe(true);
    expect(a.events.map((e) => e.tipo)).toContain('onboarding.iniciado');
  });

  it('409 quando a subconta já tem onboarding não finalizado', async () => {
    const a = ambiente({ onboardings: [{ id: 'ob-1', ...OB_BASE }] });
    await expect(a.svc.iniciar('ident-1', { clientAccountId: CLIENTE_1, escopo: {} })).rejects.toThrow(ConflictException);
    // Finalizado (pronto) libera um novo ciclo.
    const b = ambiente({ onboardings: [{ id: 'ob-1', ...OB_BASE, status: 'pronto' }] });
    await expect(b.svc.iniciar('ident-1', { clientAccountId: CLIENTE_1, escopo: {} })).resolves.toMatchObject({ status: 'coleta' });
  });

  it('subconta fora da visibilidade do membro não inicia onboarding', async () => {
    const a = ambiente({ role: 'member', clientesVisiveis: [CLIENTE_1] });
    await expect(a.svc.iniciar('ident-1', { clientAccountId: CLIENTE_2, escopo: {} })).rejects.toThrow(NotFoundException);
    expect(a.onboardings).toHaveLength(0);
  });

  it('viewer não inicia onboarding', async () => {
    const a = ambiente({ role: 'viewer' });
    await expect(a.svc.iniciar('ident-1', { clientAccountId: CLIENTE_1, escopo: {} })).rejects.toThrow(ForbiddenException);
  });

  it('identidade sem agência é recusada', async () => {
    const a = ambiente();
    await expect(a.svc.iniciar('ninguem', { clientAccountId: CLIENTE_1, escopo: {} })).rejects.toThrow(ForbiddenException);
  });
});

describe('OnboardingService — isolamento por subconta', () => {
  const OB_ALHEIO = { id: 'ob-alheio', agencyId: AGENCIA, clientAccountId: CLIENTE_2, status: 'coleta', escopo: {}, createdAt: new Date() };

  it('member restrito não acessa detalhe de onboarding de subconta alheia (404 esconde)', async () => {
    const a = ambiente({ role: 'member', clientesVisiveis: [CLIENTE_1], onboardings: [OB_ALHEIO] });
    await expect(a.svc.detalhe('ident-1', 'ob-alheio')).rejects.toThrow(NotFoundException);
  });

  it('owner vê; onboarding de OUTRA agência nem com id certo', async () => {
    const a = ambiente({ onboardings: [OB_ALHEIO, { id: 'ob-outra', agencyId: 'agencia-2', clientAccountId: CLIENTE_1, status: 'coleta', escopo: {} }] });
    await expect(a.svc.detalhe('ident-1', 'ob-alheio')).resolves.toMatchObject({ id: 'ob-alheio' });
    await expect(a.svc.detalhe('ident-1', 'ob-outra')).rejects.toThrow(NotFoundException);
  });

  it('visão executiva do member restrito só lista subcontas visíveis', async () => {
    const a = ambiente({
      role: 'member',
      clientesVisiveis: [CLIENTE_1],
      onboardings: [OB_ALHEIO, { id: 'ob-meu', agencyId: AGENCIA, clientAccountId: CLIENTE_1, status: 'coleta', escopo: {} }],
    });
    const visao = await a.svc.visaoExecutiva('ident-1', {});
    expect(visao.itens.map((i: any) => i.id)).toEqual(['ob-meu']);
    expect(visao.contadores).toEqual({ coleta: 1 });
  });
});

describe('OnboardingService.finalizar', () => {
  const verOk = (obId: string) =>
    // Todas as obrigatórias aplicáveis ao escopo {trafego} verificadas, exceto aprovacao_final.
    [
      'info_essenciais',
      'reuniao_imersao',
      'escopo_confirmado',
      'acessos_validados',
      'verba_confirmada',
      'estrategia_revisada',
      'genna_analise',
      'tarefas_atribuidas',
      'responsaveis_cientes',
      'pendencias_resolvidas',
      'revisao_qualidade',
    ].map((chave) => ({ id: `ver-${chave}`, onboardingId: obId, chave, rotulo: chave, secao: 'x', status: 'verificado', obrigatorio: true, escopoKey: chave === 'verba_confirmada' ? 'trafego' : null }));

  it('bloqueado com pendências: 409 lista o que falta', async () => {
    const a = ambiente({
      onboardings: [{ id: 'ob-1', ...OB_BASE }],
      verifications: [
        ...verOk('ob-1'),
        { id: 'ver-x', onboardingId: 'ob-1', chave: 'extra', rotulo: 'Verba confirmada', secao: 'trafego', status: 'pendente', obrigatorio: true, escopoKey: null },
      ],
    });
    (a.prisma.$queryRaw as any).__alvo = 'ob-1';
    const erro = await a.svc.finalizar('ident-1', 'ob-1').catch((e) => e);
    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro.getResponse() as any).pendencias).toEqual([{ chave: 'extra', rotulo: 'Verba confirmada', status: 'pendente' }]);
    expect(a.onboardings[0].status).toBe('coleta'); // nada mudou
  });

  it('verificação não aplicável ao escopo não bloqueia', async () => {
    const a = ambiente({
      onboardings: [{ id: 'ob-1', ...OB_BASE, escopo: { social: true } }],
      verifications: [
        ...verOk('ob-1'),
        // Obrigatória mas fora do escopo (só tráfego): não entra na conta.
        { id: 'ver-verba', onboardingId: 'ob-1', chave: 'verba_confirmada2', rotulo: 'Verba', secao: 'trafego', status: 'pendente', obrigatorio: true, escopoKey: 'trafego' },
      ],
    });
    (a.prisma.$queryRaw as any).__alvo = 'ob-1';
    const r = await a.svc.finalizar('ident-1', 'ob-1');
    expect(r.status).toBe('pronto');
  });

  it('tudo verificado → pronto, destrava e concede a aprovação final; segunda chamada é idempotente', async () => {
    const a = ambiente({
      onboardings: [{ id: 'ob-1', ...OB_BASE }],
      verifications: [...verOk('ob-1'), { id: 'ver-final', onboardingId: 'ob-1', chave: 'aprovacao_final', rotulo: 'Aprovação humana final', secao: 'aprovacao', status: 'pendente', obrigatorio: true, escopoKey: null }],
    });
    (a.prisma.$queryRaw as any).__alvo = 'ob-1';
    const r1 = await a.svc.finalizar('ident-1', 'ob-1');
    expect(r1).toMatchObject({ status: 'pronto', jaFinalizado: false });
    expect(a.onboardings[0]).toMatchObject({ status: 'pronto', completionLocked: false, aprovadoPor: 'membro-1' });
    expect(a.verifications.find((v) => v.chave === 'aprovacao_final')).toMatchObject({ status: 'verificado', verificadoPor: 'membro-1' });
    expect(a.events.map((e) => e.tipo)).toContain('onboarding.finalizado');

    const updatesAntes = (a.prisma.agencyOnboarding.update as jest.Mock).mock.calls.length;
    const r2 = await a.svc.finalizar('ident-1', 'ob-1');
    expect(r2).toMatchObject({ status: 'pronto', jaFinalizado: true });
    expect((a.prisma.agencyOnboarding.update as jest.Mock).mock.calls.length).toBe(updatesAntes); // não regravou
  });

  it('member não finaliza: só owner/admin', async () => {
    const a = ambiente({ role: 'member', onboardings: [{ id: 'ob-1', ...OB_BASE }] });
    await expect(a.svc.finalizar('ident-1', 'ob-1')).rejects.toThrow(ForbiddenException);
  });
});

describe('OnboardingService — agente de IA', () => {
  const comAgente = () =>
    ambiente({
      onboardings: [{ id: 'ob-1', ...OB_BASE, escopo: { agente_ia: true } }],
      agents: [{ id: 'ag-1', onboardingId: 'ob-1', nome: 'Agente', especificacao: {}, testes: [], approvalStatus: 'rascunho' }],
      verifications: [{ id: 'ver-agente', onboardingId: 'ob-1', chave: 'agente_ia_testado', rotulo: 'Agente testado', secao: 'agente_ia', status: 'pendente', obrigatorio: true, escopoKey: 'agente_ia', evidencias: [] }],
    });

  it('10 cenários aprovados não aprovam: precisa dos 11', async () => {
    const a = comAgente();
    for (const c of CENARIOS_TESTE_AGENTE.slice(0, 10)) {
      await a.svc.registrarResultadoTesteAgente('ident-1', 'ob-1', { cenario: c.cenario, status: 'aprovado' });
    }
    expect(a.agents[0].approvalStatus).toBe('em_testes');
    expect(a.verifications[0].status).toBe('em_andamento');
  });

  it('os 11 aprovados → aprovado e verificação agente_ia_testado verificada; um reprovado depois rebaixa', async () => {
    const a = comAgente();
    for (const c of CENARIOS_TESTE_AGENTE) {
      await a.svc.registrarResultadoTesteAgente('ident-1', 'ob-1', { cenario: c.cenario, status: 'aprovado' });
    }
    expect(a.agents[0].approvalStatus).toBe('aprovado');
    expect(a.verifications[0]).toMatchObject({ status: 'verificado', verificadoPor: 'membro-1' });

    await a.svc.registrarResultadoTesteAgente('ident-1', 'ob-1', { cenario: 'objecao', status: 'reprovado', observacao: 'respondeu preço errado' });
    expect(a.agents[0].approvalStatus).toBe('em_testes');
    expect(a.verifications[0]).toMatchObject({ status: 'em_andamento', verificadoPor: null });
  });

  it('cenário fora dos 11 base é recusado', async () => {
    const a = comAgente();
    await expect(a.svc.registrarResultadoTesteAgente('ident-1', 'ob-1', { cenario: 'inventado', status: 'aprovado' })).rejects.toThrow(BadRequestException);
  });
});

describe('OnboardingService — viewer só lê', () => {
  const OB = { id: 'ob-1', ...OB_BASE };

  it('viewer lê detalhe e visão, mas não escreve nada', async () => {
    const a = ambiente({ role: 'viewer', onboardings: [OB], verifications: [{ id: 'v1', onboardingId: 'ob-1', chave: 'genna_analise', rotulo: 'x', secao: 'analise', status: 'pendente', obrigatorio: true, escopoKey: null, evidencias: [] }] });
    await expect(a.svc.detalhe('ident-1', 'ob-1')).resolves.toMatchObject({ id: 'ob-1' });
    await expect(a.svc.visaoExecutiva('ident-1', {})).resolves.toMatchObject({ contadores: { coleta: 1 } });
    await expect(a.svc.verificar('ident-1', 'ob-1', 'genna_analise', { status: 'concluido' })).rejects.toThrow(ForbiddenException);
    await expect(a.svc.atualizarConhecimento('ident-1', 'ob-1', 'institucional', { dados: {}, pendente: true })).rejects.toThrow(ForbiddenException);
    await expect(a.svc.registrarReuniao('ident-1', 'ob-1', {})).rejects.toThrow(ForbiddenException);
    await expect(a.svc.gerarTarefas('ident-1', 'ob-1', {})).rejects.toThrow(ForbiddenException);
    await expect(a.svc.solicitarAprovacao('ident-1', 'ob-1', { acao: 'mudar_escopo' })).rejects.toThrow(ForbiddenException);
  });
});

describe('OnboardingService.verificar — evidência obrigatória', () => {
  const OB = { id: 'ob-1', ...OB_BASE };
  const VER = { id: 'v1', onboardingId: 'ob-1', chave: 'acessos_validados', rotulo: 'Acessos', secao: 'acessos', status: 'pendente', obrigatorio: true, escopoKey: null, evidencias: [] };

  it('verificado sem evidência e sem confirmação explícita é recusado', async () => {
    const a = ambiente({ onboardings: [OB], verifications: [VER] });
    await expect(a.svc.verificar('ident-1', 'ob-1', 'acessos_validados', { status: 'verificado' })).rejects.toThrow(/evidência/);
  });

  it('verificado com semEvidencia:true grava o motivo como evidência', async () => {
    const a = ambiente({ onboardings: [OB], verifications: [{ ...VER }] });
    const v = await a.svc.verificar('ident-1', 'ob-1', 'acessos_validados', { status: 'verificado', semEvidencia: true, motivo: 'cliente confirmou por telefone' });
    expect(v.status).toBe('verificado');
    expect((v.evidencias as any[])[0]).toMatchObject({ tipo: 'sem_evidencia' });
    expect(v.verificadoPor).toBe('membro-1');
  });
});

describe('OnboardingService — Genna (dado não confiável, nunca simulado)', () => {
  it('salva o relatório com o bruto e marca a análise como concluída (não verificada)', async () => {
    const a = ambiente({
      onboardings: [{ id: 'ob-1', ...OB_BASE }],
      verifications: [{ id: 'v1', onboardingId: 'ob-1', chave: 'genna_analise', rotulo: 'x', secao: 'analise', status: 'pendente', obrigatorio: true, escopoKey: null, evidencias: [] }],
    });
    const rep = await a.svc.salvarRelatorioGenna('ident-1', 'ob-1', { perfil: '@cliente', ferramenta: 'instagram_metrics', argumentos: { perfil: '@cliente' } });
    expect(rep.fonte).toBe('genna');
    expect(a.genna.consultar).toHaveBeenCalledWith(`tenant-${CLIENTE_1.slice(0, 8)}`, 'ident-1', 'instagram_metrics', { perfil: '@cliente' });
    expect(a.verifications[0].status).toBe('concluido'); // concluído ≠ verificado (humano)
  });

  it('sem conexão com o Genna, o erro propaga e NADA é salvo', async () => {
    const a = ambiente({ onboardings: [{ id: 'ob-1', ...OB_BASE }] });
    (a.genna.consultar as jest.Mock).mockRejectedValue(new Error('genna_nao_conectado'));
    await expect(a.svc.salvarRelatorioGenna('ident-1', 'ob-1', { perfil: '@cliente', ferramenta: 'instagram_metrics' })).rejects.toThrow('genna_nao_conectado');
    expect(a.reports).toHaveLength(0);
  });
});

describe('OnboardingService.gerarTarefas — dedupe', () => {
  it('cria as tarefas do escopo no Daily e rodar de novo não duplica', async () => {
    const a = ambiente({ onboardings: [{ id: 'ob-1', ...OB_BASE }] });
    const r1 = await a.svc.gerarTarefas('ident-1', 'ob-1', {});
    const total = r1.total;
    expect(r1.criadas.length).toBe(total);
    expect(a.tasks.every((t) => t.agencyId === AGENCIA && t.clientAccountId === CLIENTE_1)).toBe(true);

    const r2 = await a.svc.gerarTarefas('ident-1', 'ob-1', {});
    expect(r2.criadas).toHaveLength(0);
    expect(r2.ignoradas).toBe(total);
    expect(a.tasks).toHaveLength(total);
  });
});

describe('OnboardingService — normalizarEscopo aplicado ao detalhe', () => {
  it('escopo vindo do banco vira mapa completo de serviços', () => {
    expect(normalizarEscopo({ trafego: true })).toEqual({ trafego: true, social: false, audiovisual: false, agente_ia: false, branding: false });
  });
});
