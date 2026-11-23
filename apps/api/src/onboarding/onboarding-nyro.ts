import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { ToolExecutorService, type ContextoNyro } from '../nyro/tool-executor.service';
import { AgencyService } from '../agency/agency.service';
import { OnboardingService } from './onboarding.service';

const ArgsIniciar = z.object({
  nomeCliente: z.string().min(2).max(120),
  escopo: z
    .object({
      trafego: z.boolean(),
      social: z.boolean(),
      audiovisual: z.boolean(),
      agente_ia: z.boolean(),
      branding: z.boolean(),
    })
    .partial()
    .optional(),
  criarSubconta: z.boolean().optional(),
});
const ArgsAndamento = z.object({ nomeCliente: z.string().min(2).max(120).optional() });

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/**
 * Dispatch das tools de onboarding do catálogo da NICO (`iniciar_onboarding`,
 * `andamento_onboarding` — ADR-0054). O modelo vê as tools pelo catálogo; quem
 * executa é este módulo, via `registrarHandler` — sem import circular com o
 * NyroModule. Tudo passa pelo OnboardingService/AgencyService (mesma validação,
 * escopo e auditoria de um humano — "Nyro é usuário, não deus").
 */
@Injectable()
export class OnboardingNyro implements OnModuleInit {
  private readonly log = new Logger('OnboardingNyro');

  constructor(
    private readonly executor: ToolExecutorService,
    private readonly agency: AgencyService,
    private readonly onboarding: OnboardingService,
  ) {}

  onModuleInit(): void {
    this.executor.registrarHandler('iniciar_onboarding', (args, ctx) => this.iniciar(ArgsIniciar.parse(args), ctx));
    this.executor.registrarHandler('andamento_onboarding', (args, ctx) => this.andamento(ArgsAndamento.parse(args), ctx));
  }

  /** "Entrou mais um cliente na KROMA" → localiza (ou cria) a subconta e abre o onboarding. */
  private async iniciar(a: z.infer<typeof ArgsIniciar>, ctx: ContextoNyro) {
    const escopo = await this.agency.escopo(ctx.identityId);
    if (!escopo) return { iniciado: false, pergunta: 'Esta conta não pertence a uma agência. O onboarding é um recurso do modo agência.' };

    const alvo = norm(a.nomeCliente);
    const candidatas = escopo.clientes.filter((c) => norm(c.displayName).includes(alvo) || alvo.includes(norm(c.displayName)));
    let cliente = candidatas.length === 1 ? candidatas[0] : undefined;

    if (!cliente && candidatas.length > 1) {
      return {
        iniciado: false,
        pergunta: `Encontrei mais de uma subconta parecida com "${a.nomeCliente}". Qual delas?`,
        opcoes: candidatas.map((c) => c.displayName),
      };
    }

    if (!cliente) {
      if (!a.criarSubconta) {
        return {
          iniciado: false,
          pergunta: `Não encontrei a subconta "${a.nomeCliente}" na agência. Quer que eu crie o cadastro dela e já inicie o onboarding?`,
          subcontasParecidas: escopo.clientes
            .filter((c) => norm(c.displayName).includes(alvo.split(' ')[0] ?? alvo))
            .map((c) => c.displayName)
            .slice(0, 5),
        };
      }
      if (!['owner', 'admin'].includes(escopo.membro.role)) {
        return { iniciado: false, pergunta: 'Só o dono ou um admin da agência pode criar a subconta do cliente. Pede para um deles criar e me avisa.' };
      }
      const criada = await this.agency.criarCliente(ctx.identityId, { nome: a.nomeCliente });
      cliente = criada;
      this.log.log(`subconta criada pela NICO: ${criada.id} (${a.nomeCliente})`);
    }

    try {
      const ob = await this.onboarding.iniciar(ctx.identityId, {
        clientAccountId: cliente.id,
        ...(a.escopo ? { escopo: a.escopo } : {}),
      });
      return {
        iniciado: true,
        onboardingId: ob.id,
        cliente: cliente.displayName,
        status: ob.status,
        link: `/agency/onboarding/${ob.id}`,
        resumo:
          `Onboarding de ${cliente.displayName} iniciado (etapa coleta). Já semeei as verificações de homologação do escopo ` +
          'e as 7 seções de dados do negócio. Próximos passos: preencher a coleta, agendar a imersão e gerar as tarefas da equipe na aba Tarefas.',
      };
    } catch (e) {
      // Corrida ou aviso repetido: a subconta já tem onboarding em andamento.
      const corpo = typeof (e as { getResponse?: () => unknown }).getResponse === 'function' ? (e as { getResponse: () => unknown }).getResponse() : {};
      if ((corpo as { code?: string }).code === 'onboarding_duplicado') {
        const existente = (corpo as { onboardingId?: string }).onboardingId;
        return {
          iniciado: false,
          jaExistia: true,
          onboardingId: existente ?? null,
          link: existente ? `/agency/onboarding/${existente}` : '/agency/onboarding',
          resumo: `${cliente.displayName} já tem um onboarding em andamento — abri ele em vez de duplicar.`,
        };
      }
      throw e;
    }
  }

  /** "Como está a implantação do cliente X?" → contadores + linhas resumidas. */
  private async andamento(a: z.infer<typeof ArgsAndamento>, ctx: ContextoNyro) {
    const visao = await this.onboarding.visaoExecutiva(ctx.identityId, {});
    let itens = visao.itens;
    if (a.nomeCliente) {
      const alvo = norm(a.nomeCliente);
      itens = itens.filter((i) => norm(i.cliente.nome).includes(alvo));
      if (!itens.length) {
        return { encontrado: false, resumo: `Nenhum onboarding em andamento para "${a.nomeCliente}". Se o cliente acabou de entrar, é só me pedir para iniciar.` };
      }
    }
    return {
      contadores: visao.contadores,
      itens: itens.slice(0, 20).map((i) => ({
        cliente: i.cliente.nome,
        status: i.status,
        etapaAtual: i.etapaAtual,
        progresso: `${i.verificacoes.verificadas}/${i.verificacoes.total} verificações`,
        tarefasAtrasadas: i.tarefas.atrasadas,
        link: `/agency/onboarding/${i.id}`,
      })),
    };
  }
}
