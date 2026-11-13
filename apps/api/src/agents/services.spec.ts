import type { Queue } from 'bullmq';
import type { PrismaService } from '../prisma/prisma.service';
import type { MessagesService } from '../crm/messaging/messages.service';
import { DeliveryService, MAX_TENTATIVAS, type EntregaJob } from './delivery/delivery.service';
import { avaliarConfianca, detectarConflitos } from './knowledge/knowledge.service';
import { csvParaMarkdown, extrairConteudo, htmlParaMarkdown, parseCsv, validarUrlPublica, ErroExtracao, estruturarTexto } from './knowledge/text-extraction';
import { diffSnapshots, estavel, hashSnapshot, snapshotDoAgente } from './versioning/versioning.service';
import { aplicarPatch, chaveTexto, eventosDoTurno, minimizar } from './learning/learning.service';
import { configPadrao } from './config/agent-config';
import { analisarHeuristica } from './engines/analysis';
import type { ResultadoCore } from './intelligence/intelligence-core.service';

const TENANT = '11111111-1111-1111-1111-111111111111';

// ------------------------------------------------------------------ fila de entrega

interface Linha {
  id: string;
  tenantId: string;
  agentId: string | null;
  conversationId: string;
  runId: string | null;
  followupId: string | null;
  sequenciaId: string;
  ordem: number;
  total: number;
  texto: string;
  atrasoMs: number;
  status: string;
  tentativas: number;
  agendadoPara: Date;
  messageId: string | null;
  idempotencyKey: string;
  motivo: string | null;
  createdAt: Date;
}

function fila(o: { respondeuDepois?: boolean; atendimento?: string; optout?: boolean; runStatus?: string; envio?: (texto: string) => { id: string; status: string; erro?: string | null; missing?: string[] } } = {}) {
  const linhas: Linha[] = [];
  let n = 0;
  const casa = (l: Linha, w: Record<string, unknown>): boolean =>
    Object.entries(w).every(([k, v]): boolean => {
      if (k === 'OR') return (v as Record<string, unknown>[]).some((c) => casa(l, c));
      return (l as unknown as Record<string, unknown>)[k] === v;
    });
  const tx = {
    agentDelivery: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string; tenantId_idempotencyKey?: { idempotencyKey: string } } }) =>
        // Cópia: o Prisma real devolve um objeto novo, não a linha "viva".
        { const l = where.id ? linhas.find((x) => x.id === where.id) : linhas.find((x) => x.idempotencyKey === where.tenantId_idempotencyKey?.idempotencyKey); return l ? { ...l } : null; },
      ),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => linhas.find((l) => casa(l, where)) ?? null),
      createMany: jest.fn(async ({ data }: { data: Omit<Linha, 'id' | 'status' | 'tentativas' | 'messageId' | 'motivo' | 'createdAt'>[] }) => {
        for (const d of data) linhas.push({ ...d, id: `b${++n}`, status: 'pendente', tentativas: 0, messageId: null, motivo: null, createdAt: new Date() } as Linha);
        return { count: data.length };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(linhas.find((l) => l.id === where.id)!, data)),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const alvo = linhas.filter((l) => casa(l, where));
        for (const l of alvo) {
          const d = { ...data } as Record<string, unknown>;
          if (d.tentativas && typeof d.tentativas === 'object') d.tentativas = l.tentativas + 1;
          Object.assign(l, d);
        }
        return { count: alvo.length };
      }),
    },
    message: { findFirst: jest.fn(async () => (o.respondeuDepois ? { id: 'nova' } : null)) },
    conversation: { findUnique: jest.fn(async () => ({ atendimento: o.atendimento ?? 'ia', contact: { optedOutAt: o.optout ? new Date() : null } })) },
    agentRun: { findUnique: jest.fn(async () => (o.runStatus ? { status: o.runStatus } : null)) },
  };
  const prisma = { withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)) } as unknown as PrismaService;
  const enviados: string[] = [];
  const mensagens = {
    send: jest.fn(async (_t: string, _c: string, texto: string) => {
      enviados.push(texto);
      return o.envio ? o.envio(texto) : { id: `m-${texto}`, status: 'sent', erro: null, missing: [] };
    }),
  } as unknown as MessagesService;
  const jobs: { data: EntregaJob; opts: { jobId: string; delay: number } }[] = [];
  const queue = { add: jest.fn(async (_n: string, data: EntregaJob, opts: { jobId: string; delay: number }) => jobs.push({ data, opts })) } as unknown as Queue<EntregaJob>;
  const svc = new DeliveryService(prisma, mensagens, queue);
  /** Simula o worker: processa os jobs na ordem em que entram. */
  const drenar = async () => {
    const saidas: string[] = [];
    while (jobs.length) saidas.push(await svc.processar(jobs.shift()!.data));
    return saidas;
  };
  return { svc, linhas, jobs, enviados, mensagens, drenar };
}

const BLOCOS = [
  { ordem: 1, texto: 'Oi, Ana!', atrasoMs: 1200 },
  { ordem: 2, texto: 'A avaliação custa R$ 250.', atrasoMs: 1500 },
  { ordem: 3, texto: 'Quer agendar?', atrasoMs: 1300 },
];
const ENF = { tenantId: TENANT, agentId: 'ag1', conversationId: 'cv1', runId: 'r1', blocos: BLOCOS, chaveBase: 'agent:m1' };

describe('Message Delivery Queue', () => {
  it('envia os blocos EM ORDEM, cada um agendando o próximo com o seu atraso', async () => {
    const f = fila();
    await f.svc.enfileirar(ENF);
    expect(f.jobs).toHaveLength(1);
    expect(f.jobs[0].opts).toMatchObject({ jobId: 'entrega-b1', delay: 1200 });
    expect(await f.drenar()).toEqual(['enviado', 'enviado', 'enviado']);
    expect(f.enviados).toEqual(['Oi, Ana!', 'A avaliação custa R$ 250.', 'Quer agendar?']);
    expect(f.linhas.map((l) => l.status)).toEqual(['enviado', 'enviado', 'enviado']);
    // Cada bloco usa a própria chave de idempotência no MessagesService.
    expect(f.mensagens.send).toHaveBeenCalledWith(TENANT, 'cv1', 'Oi, Ana!', 'agentblk:b1', expect.any(String), { tipo: 'ia', agentId: 'ag1' });
  });

  it('enfileirar a mesma sequência duas vezes não duplica (chaveBase)', async () => {
    const f = fila();
    await f.svc.enfileirar(ENF);
    const r = await f.svc.enfileirar(ENF);
    expect(r.duplicado).toBe(true);
    expect(f.linhas).toHaveLength(3);
  });

  it('contato respondeu durante a sequência → o resto é cancelado (reavaliação)', async () => {
    const f = fila({ respondeuDepois: true });
    await f.svc.enfileirar(ENF);
    expect(await f.drenar()).toEqual(['cancelado']);
    expect(f.enviados).toEqual([]);
    expect(f.linhas.every((l) => l.status === 'cancelado')).toBe(true);
  });

  it('humano assumiu → cancela; mas o aviso de transferência do mesmo run sai', async () => {
    const f1 = fila({ atendimento: 'humano', runStatus: 'respondido' });
    await f1.svc.enfileirar(ENF);
    expect(await f1.drenar()).toEqual(['cancelado']);
    const f2 = fila({ atendimento: 'humano', runStatus: 'transferido' });
    await f2.svc.enfileirar(ENF);
    expect(await f2.drenar()).toEqual(['enviado', 'enviado', 'enviado']);
  });

  it('opt-out → nada sai', async () => {
    const f = fila({ optout: true });
    await f.svc.enfileirar(ENF);
    await f.drenar();
    expect(f.enviados).toEqual([]);
  });

  it('falha retentável → backoff; esgotou → falhou e cancela o resto', async () => {
    const f = fila({ envio: () => ({ id: 'mx', status: 'pending', erro: 'provider 503' }) });
    await f.svc.enfileirar(ENF);
    const saidas = await f.drenar();
    expect(saidas.filter((s) => s === 'reagendado')).toHaveLength(MAX_TENTATIVAS - 1);
    expect(saidas[saidas.length - 1]).toBe('falhou');
    expect(f.linhas[0].status).toBe('falhou');
    expect(f.linhas.slice(1).every((l) => l.status === 'cancelado')).toBe(true);
  });

  it('aceite incerto → para a sequência (nunca reenvia às cegas)', async () => {
    const f = fila({ envio: (t) => (t === 'A avaliação custa R$ 250.' ? { id: 'mx', status: 'unknown', erro: 'timeout' } : { id: 'ok', status: 'sent' }) });
    await f.svc.enfileirar(ENF);
    expect(await f.drenar()).toEqual(['enviado', 'incerto']);
    expect(f.linhas.map((l) => l.status)).toEqual(['enviado', 'incerto', 'cancelado']);
  });

  it('sem credencial/ambiente de dev: registra no Inbox e mantém a sequência completa', async () => {
    const f = fila({ envio: () => ({ id: 'mx', status: 'bloqueado_dev', erro: null }) });
    await f.svc.enfileirar(ENF);
    expect(await f.drenar()).toEqual(['registrado', 'registrado', 'registrado']);
    expect(f.linhas.every((l) => l.messageId === 'mx' && l.motivo?.includes('bloqueado_dev'))).toBe(true);
  });

  it('bloco não-pendente é ignorado (job duplicado)', async () => {
    const f = fila();
    await f.svc.enfileirar(ENF);
    const job = f.jobs[0].data;
    await f.drenar();
    expect(await f.svc.processar(job)).toBe('ignorado');
  });
});

// ------------------------------------------------------------------ extração

describe('Knowledge — extração e recuperação', () => {
  it('CSV (vírgula e ponto-e-vírgula, aspas) vira Markdown estruturado', () => {
    expect(parseCsv('a;b\n"x;1";2')).toEqual([['a', 'b'], ['x;1', '2']]);
    const md = csvParaMarkdown('Serviço,Preço\nAvaliação,"R$ 250,00"\nRetorno,R$ 0', 'Tabela');
    expect(md).toContain('## Avaliação\n- Serviço: Avaliação\n- Preço: R$ 250,00');
  });

  it('HTML descarta script/nav e preserva títulos e listas', () => {
    const { titulo, markdown } = htmlParaMarkdown('<html><head><title>Clínica &amp; Cia</title><script>evil()</script></head><body><nav>menu</nav><main><h1>Serviços</h1><ul><li>Implante</li><li>Clareamento</li></ul><p>Agende já.</p></main></body></html>');
    expect(titulo).toBe('Clínica & Cia');
    expect(markdown).toContain('## Serviços');
    expect(markdown).toContain('- Implante');
    expect(markdown).not.toMatch(/evil|menu/);
  });

  it('texto corrido ganha estrutura (título → heading)', () => {
    expect(estruturarTexto('Política de cancelamento\nO cancelamento deve ser feito com 24 horas de antecedência para não haver cobrança.')).toMatch(/^## Política de cancelamento/);
  });

  it('valida tipo de arquivo pelo conteúdo, não pela extensão', async () => {
    await expect(extrairConteudo({ tipo: 'pdf', titulo: 'x', arquivo: Buffer.from('não sou pdf') })).rejects.toBeInstanceOf(ErroExtracao);
    await expect(extrairConteudo({ tipo: 'docx', titulo: 'x', arquivo: Buffer.from('%PDF-1.4') })).rejects.toThrow('DOCX');
    expect(await extrairConteudo({ tipo: 'texto', titulo: 'x', texto: '  Horário: 8h às 18h  ' })).toBe('Horário: 8h às 18h');
  });

  it('SSRF: recusa rede interna, credencial na URL e protocolo não-http', async () => {
    await expect(validarUrlPublica('http://127.0.0.1:8080/admin')).rejects.toThrow('interna');
    await expect(validarUrlPublica('http://10.0.0.5/')).rejects.toThrow('interna');
    await expect(validarUrlPublica('http://[::1]/')).rejects.toThrow('interna');
    await expect(validarUrlPublica('http://localhost/')).rejects.toThrow('interno');
    await expect(validarUrlPublica('file:///etc/passwd')).rejects.toThrow('http');
    await expect(validarUrlPublica('https://user:pw@example.com/')).rejects.toThrow('credencial');
    await expect(validarUrlPublica('http://169.254.169.254/latest/meta-data')).rejects.toThrow('interna');
  });

  it('confiança da busca e informação conflitante', () => {
    expect(avaliarConfianca('preço avaliação capilar', []).nivel).toBe('nenhuma');
    expect(avaliarConfianca('preço avaliação capilar', [{ titulo: 'Tabela', conteudo: 'Avaliação capilar — preço R$ 250' }]).nivel).toBe('alta');
    expect(avaliarConfianca('horário de sábado', [{ titulo: 'Tabela', conteudo: 'Avaliação capilar R$ 250' }]).nivel).toBe('baixa');
    const c = detectarConflitos([
      { documentId: 'd1', titulo: 'Tabela 2025', conteudo: 'Avaliação: R$ 200,00' },
      { documentId: 'd2', titulo: 'Tabela 2026', conteudo: 'Avaliação: R$ 250,00' },
    ]);
    expect(c[0]).toContain('Tabela 2025');
    expect(detectarConflitos([{ documentId: 'd1', titulo: 'A', conteudo: 'R$ 250' }, { documentId: 'd2', titulo: 'B', conteudo: 'R$ 250,00' }])).toEqual([]);
  });
});

// ------------------------------------------------------------------ versões

describe('Versionamento', () => {
  const agente = { nome: 'Lia', descricao: null, modelo: 'claude-opus-5-5', instrucoes: 'Atenda.', tom: 'cordial', personalidade: '', ferramentas: ['b', 'a'], conhecimentoAtivo: true, conhecimentoEscopos: ['tenant'], maxRespostasConversa: 20, maxCaracteres: 600, canais: ['WhatsApp'], config: {} };
  it('hash é estável à ordem de listas e chaves', () => {
    const a = snapshotDoAgente(agente);
    const b = snapshotDoAgente({ ...agente, ferramentas: ['a', 'b'] });
    expect(hashSnapshot(a)).toBe(hashSnapshot(b));
    expect(estavel({ b: 1, a: 2 })).toBe(estavel({ a: 2, b: 1 }));
  });
  it('diff aponta campo e seção da config', () => {
    const a = snapshotDoAgente(agente);
    const b = snapshotDoAgente({ ...agente, instrucoes: 'Outra', config: { personalidade: { humor: 0 } } });
    expect(diffSnapshots(a, b).map((d) => d.campo)).toEqual(['instrucoes', 'config.personalidade']);
  });
});

// ------------------------------------------------------------------ aprendizado

describe('Learning', () => {
  it('minimiza dados pessoais nas evidências', () => {
    expect(minimizar('me liga no (11) 98888-7777 ou ana@ex.com, cpf 123.456.789-09')).toBe('me liga no [telefone] ou [email], cpf [cpf]');
    expect(chaveTexto('Qual é o PREÇO da avaliação?')).toBe('qual preco avaliacao');
  });

  it('eventos do turno: lacuna, objeção, transferência, erro de ferramenta', () => {
    const r = {
      decisao: 'transferir',
      motivo: 'pediu humano',
      analise: { ...analisarHeuristica('achei caro, vou pensar'), fonte: 'modelo', confiancaIntencao: 0.3 },
      conhecimento: { consulta: 'preço do pacote', fontes: [], confianca: { nivel: 'nenhuma', motivo: '' }, conflitos: [], latenciaMs: 1 },
      ferramentas: [{ nome: 'mover_etapa', ok: false, erro: 'etapa inexistente' }],
      guardrail: null,
    } as unknown as ResultadoCore;
    const tipos = eventosDoTurno('ag1', r, { conversationId: 'cv1', runId: 'r1', limiarConfianca: 0.55, mensagem: 'achei caro' }).map((e) => e.tipo);
    expect(tipos).toEqual(expect.arrayContaining(['transferencia', 'lacuna_conhecimento', 'baixa_confianca', 'objecao', 'erro_ferramenta']));
  });

  it('patch de proposta NUNCA mexe em políticas (permissões, CRM, inteligência)', () => {
    const cfg = configPadrao();
    const novo = aplicarPatch(cfg, { comportamento: { objecoes: 'Reconheça a preocupação.' } });
    expect(novo.comportamento.objecoes).toBe('Reconheça a preocupação.');
    expect(() => aplicarPatch(cfg, { permissoes: { exigirConfirmacao: [] } })).toThrow();
    expect(() => aplicarPatch(cfg, { inteligencia: { orcamentoUsdDiario: 5000 } })).toThrow();
  });
});
