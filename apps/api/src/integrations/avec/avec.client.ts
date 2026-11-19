import { entrarCognito } from './cognito-srp';

/**
 * Cliente do Avec (admin.avec.beauty), SOMENTE LEITURA (ADR-0052).
 * Login sem navegador, mapeado na tela de login em 19/11:
 *   1. Cognito (pool do Avec) com o SSO id da conta, desafio "Avec;<conta>";
 *   2. api.avec.beauty/auth/amplify/signin troca o token Cognito pelo
 *      application_token do salão;
 *   3. admin.avec.beauty/<slug>/admin-mfe abre a sessão do painel (cookie);
 *   4. as telas da agenda usam POST form `dados=<json>` com essa sessão.
 * Escrever no Avec (criar/remarcar/cancelar) NÃO existe aqui: depende de
 * canário autorizado pela dona do salão.
 */
export const AVEC_COGNITO = { poolId: 'us-east-1_D16vFV52G', clientId: '4i7bsfv96ocgkv5umr6tr9mfrd' } as const;
/** Constante do app web do Avec (vai em todo signin; não é segredo). */
const JWT_CLIENT = 'S@laoV1P';
const ADMIN = 'https://admin.avec.beauty';
const API = 'https://api.avec.beauty';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export interface CredenciaisAvec {
  email: string;
  senha: string;
  /** Usuário do Cognito (UUID do SSO): o pool não aceita o e-mail. */
  ssoId: string;
  salaoId: number;
  /** Trecho da URL do painel (admin.avec.beauty/<slug>). */
  slug: string;
}

export interface ProfissionalAvec {
  id: string;
  nome: string;
  apelido: string | null;
}

export interface ReservaAvec {
  hora_inicio: string | number;
  hora_fim: string | number;
  status: string | number | null;
  status_agendamento?: string | number | null;
  cliente_nome?: string | null;
  cliente_tel?: string | null;
  profissional_id: string | number;
  servico_id?: string | number | null;
  servico?: string | null;
  salao_cliente_id?: string | number | null;
  data: string;
}

export interface BloqueioAvec {
  hora_inicio: string | number;
  hora_fim: string | number;
  profissional_id: string | number;
  data_ini?: string;
}

export interface DiaProfissionalAvec {
  idProf: string | number;
  reservas?: ReservaAvec[] | Record<string, ReservaAvec>;
  /** `[]` = folga nesse dia. */
  jornada?: { horarios?: { hora_inicio: string | number; hora_fim: string | number } | unknown[]; bloqueado?: BloqueioAvec[] } | unknown[] | null;
}

export class ErroAvec extends Error {
  constructor(
    message: string,
    /** sessao = a sessão caiu (refazer login); credencial = login recusado. */
    readonly tipo: 'sessao' | 'credencial' | 'rede' | 'formato',
  ) {
    super(message);
  }
}

export class AvecCliente {
  private jar = new Map<string, string>();
  private logadoEm = 0;

  constructor(private readonly cred: CredenciaisAvec) {}

  /** Sessão do painel dura horas; renova por precaução a cada 2h. */
  get sessaoValida(): boolean {
    return this.logadoEm > 0 && Date.now() - this.logadoEm < 2 * 3_600_000;
  }

  private async http(metodo: 'GET' | 'POST', url: string, corpo?: { json?: unknown; form?: Record<string, string> }, referer = `${ADMIN}/`) {
    let r: Response;
    try {
      r = await fetch(url, {
        method: metodo,
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
        headers: {
          'user-agent': UA,
          accept: 'application/json, text/javascript, */*; q=0.01',
          origin: ADMIN,
          referer,
          ...(this.jar.size ? { cookie: [...this.jar.values()].join('; ') } : {}),
          ...(corpo?.json ? { 'content-type': 'application/json' } : {}),
          ...(corpo?.form ? { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest' } : {}),
        },
        body: corpo?.json ? JSON.stringify(corpo.json) : corpo?.form ? new URLSearchParams(corpo.form) : undefined,
      });
    } catch (e) {
      throw new ErroAvec(`Avec fora do ar (${(e as Error).name})`, 'rede');
    }
    for (const sc of r.headers.getSetCookie?.() ?? []) {
      const kv = sc.split(';')[0];
      const i = kv.indexOf('=');
      if (i > 0) this.jar.set(kv.slice(0, i), kv);
    }
    const texto = await r.text();
    let json: unknown = null;
    try {
      json = JSON.parse(texto);
    } catch {
      json = null;
    }
    return { status: r.status, json, location: r.headers.get('location') };
  }

  async entrar(): Promise<void> {
    this.jar.clear();
    this.logadoEm = 0;
    const cog = await entrarCognito({
      ...AVEC_COGNITO,
      usuario: this.cred.ssoId,
      senha: this.cred.senha,
      metaInicio: { challenge: 'AccountInfo' },
      metaCustom: { vertical: 'Avec', challenge: 'AccountInfo' },
      respostaCustom: (cp) => {
        const contas = JSON.parse(cp.accountsJson ?? '{}') as { Avec?: string[] };
        if (!contas.Avec?.[0]) throw new ErroAvec('a conta não tem acesso ao Avec', 'credencial');
        return `Avec;${contas.Avec[0]}`;
      },
    }).catch((e: Error & { codigo?: string }) => {
      if (e instanceof ErroAvec) throw e;
      throw new ErroAvec(`login do Avec recusado: ${e.message}`, e.codigo === 'NotAuthorizedException' || e.codigo === 'UserNotFoundException' ? 'credencial' : 'rede');
    });
    const s = await this.http('POST', `${API}/auth/amplify/signin`, {
      json: { email: this.cred.email, password: this.cred.senha, salon_id: this.cred.salaoId, jwt_client: JWT_CLIENT, cognito_token: cog.accessToken },
    });
    const dados = (s.json as { data?: { application_token?: string }; application_token?: string } | null) ?? null;
    const token = dados?.data?.application_token ?? dados?.application_token;
    if (s.status !== 200 || !token) throw new ErroAvec(`signin do Avec falhou (HTTP ${s.status})`, s.status === 401 || s.status === 403 ? 'credencial' : 'formato');
    const m = await this.http('POST', `${ADMIN}/${encodeURIComponent(this.cred.slug)}/admin-mfe`, { form: { token, cognito_token: cog.accessToken } });
    if (m.status >= 400 || !this.jar.size) throw new ErroAvec(`painel do Avec não abriu a sessão (HTTP ${m.status})`, 'formato');
    if (m.location) await this.http('GET', new URL(m.location, ADMIN).href);
    this.logadoEm = Date.now();
  }

  /** Chamada de tela da agenda; uma nova tentativa com login novo se a sessão caiu. */
  private async agenda<T>(caminho: string, dados: unknown): Promise<T> {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      if (!this.sessaoValida) await this.entrar();
      const r = await this.http('POST', `${ADMIN}${caminho}`, { form: { dados: JSON.stringify(dados) } }, `${ADMIN}/admin/agenda-v2`);
      const j = r.json as { dados?: T } | null;
      if (r.status === 200 && j && j.dados !== undefined) return j.dados;
      // Sessão vencida volta como redirect para o login ou HTML: refaz o login uma vez.
      this.logadoEm = 0;
      if (tentativa === 1) throw new ErroAvec(`agenda do Avec respondeu HTTP ${r.status} sem dados`, r.status >= 500 ? 'rede' : 'sessao');
    }
    throw new ErroAvec('agenda do Avec indisponível', 'rede');
  }

  async profissionais(): Promise<ProfissionalAvec[]> {
    const lista = await this.agenda<{ id: string | number; nome?: string; apelido?: string | null }[]>('/admin/agenda/listarTodosProfissionaisComAgendaAndServicos', {});
    if (!Array.isArray(lista)) throw new ErroAvec('lista de profissionais do Avec em formato inesperado', 'formato');
    return lista.map((p) => ({ id: String(p.id), nome: String(p.nome ?? '').trim(), apelido: p.apelido ? String(p.apelido).trim() : null }));
  }

  async agendaDoDia(data: string, profissionalIds: string[]): Promise<DiaProfissionalAvec[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new ErroAvec('data deve ser AAAA-MM-DD', 'formato');
    const dia = await this.agenda<DiaProfissionalAvec[]>('/admin/agenda/carregarAgenda', { data, profissionalIdArr: profissionalIds.map((id) => ({ id })) });
    if (!Array.isArray(dia)) throw new ErroAvec('agenda do Avec em formato inesperado', 'formato');
    return dia;
  }
}
