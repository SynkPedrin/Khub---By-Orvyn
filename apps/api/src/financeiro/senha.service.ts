import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaService } from '../prisma/prisma.service';

const scrypt = promisify(scryptCb) as (senha: string, sal: Buffer, tam: number) => Promise<Buffer>;

/** Cabeçalho com o "desbloqueio" (token curto) depois de digitar a senha do financeiro. */
export const CABECALHO_SENHA = 'x-financeiro-senha';
/** Quanto tempo a senha digitada vale (a recepção não precisa redigitar a cada clique). */
const VALIDADE_MS = 30 * 60_000;
const MAX_TENTATIVAS = 6;
const JANELA_TENTATIVAS_MS = 10 * 60_000;

const b64url = (b: Buffer) => b.toString('base64url');

export async function gerarHash(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const h = await scrypt(senha, sal, 32);
  return `scrypt$${b64url(sal)}$${b64url(h)}`;
}

export async function conferirHash(senha: string, hash: string): Promise<boolean> {
  const [alg, sal, esperado] = hash.split('$');
  if (alg !== 'scrypt' || !sal || !esperado) return false;
  const h = await scrypt(senha, Buffer.from(sal, 'base64url'), 32);
  const e = Buffer.from(esperado, 'base64url');
  return e.length === h.length && timingSafeEqual(e, h);
}

/**
 * Senha do financeiro (db/075, ADR-0051): protege Visão geral e Comissões e
 * autoriza editar/cancelar venda no caixa. Só o hash (scrypt) fica no banco.
 * Digitada a senha, a API devolve um token assinado (HMAC com chave derivada
 * do JWT_SECRET) válido por 30 min, preso à conta E à pessoa.
 * Sem senha configurada, nada é bloqueado (comportamento anterior).
 */
@Injectable()
export class FinanceiroSenhaService {
  private tentativas = new Map<string, { n: number; desde: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private chave(): Buffer {
    const s = this.config.get('JWT_SECRET');
    if (!s) throw new Error('JWT_SECRET ausente');
    return createHmac('sha256', s).update('khub:financeiro-senha:v1').digest();
  }

  private async hash(tenantId: string): Promise<string | null> {
    const c = await this.prisma.withTenant(tenantId, (tx) => tx.financeiroConfig.findUnique({ where: { tenantId }, select: { senhaHash: true } }));
    return c?.senhaHash ?? null;
  }

  async configurada(tenantId: string): Promise<boolean> {
    return !!(await this.hash(tenantId));
  }

  /** Define ou troca a senha. Só dono/admin; trocar exige a senha atual. */
  async definir(tenantId: string, actor: { identityId: string; role: string }, dto: { senhaAtual?: string; novaSenha: string }) {
    if (!['owner', 'admin'].includes(actor.role)) throw new ForbiddenException('só o dono ou um admin define a senha do financeiro');
    const nova = (dto.novaSenha ?? '').trim();
    if (nova.length < 4 || nova.length > 64) throw new BadRequestException('a senha precisa ter de 4 a 64 caracteres');
    const atual = await this.hash(tenantId);
    if (atual && !(await conferirHash(dto.senhaAtual ?? '', atual))) throw new ForbiddenException('senha atual incorreta');
    const senhaHash = await gerarHash(nova);
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.financeiroConfig.upsert({
        where: { tenantId },
        create: { tenantId, senhaHash, updatedBy: actor.identityId },
        update: { senhaHash, updatedBy: actor.identityId, updatedAt: new Date() },
      });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
        VALUES (${tenantId}::uuid, 'humano', ${actor.identityId}, ${atual ? 'financeiro.senha_trocada' : 'financeiro.senha_definida'}, 'financeiro_config', ${tenantId}::uuid)`;
    });
    return { ok: true };
  }

  /** Confere a senha e devolve o desbloqueio (token) por 30 min. Limite de tentativas por pessoa. */
  async verificar(tenantId: string, identityId: string, senha: string, agora = Date.now()) {
    const hash = await this.hash(tenantId);
    if (!hash) return { token: null, expiraEm: null, configurada: false };
    const k = `${tenantId}:${identityId}`;
    const t = this.tentativas.get(k);
    if (t && agora - t.desde < JANELA_TENTATIVAS_MS && t.n >= MAX_TENTATIVAS) {
      throw new HttpException({ message: 'muitas tentativas: aguarde alguns minutos', code: 'senha_bloqueada' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!(await conferirHash(senha ?? '', hash))) {
      const base = t && agora - t.desde < JANELA_TENTATIVAS_MS ? t : { n: 0, desde: agora };
      this.tentativas.set(k, { n: base.n + 1, desde: base.desde });
      throw new ForbiddenException({ message: 'senha incorreta', code: 'senha_incorreta' });
    }
    this.tentativas.delete(k);
    const exp = agora + VALIDADE_MS;
    return { token: this.assinar(tenantId, identityId, exp), expiraEm: new Date(exp).toISOString(), configurada: true };
  }

  assinar(tenantId: string, identityId: string, exp: number): string {
    const corpo = b64url(Buffer.from(JSON.stringify({ t: tenantId, i: identityId, exp })));
    return `${corpo}.${b64url(createHmac('sha256', this.chave()).update(corpo).digest())}`;
  }

  tokenValido(token: string | undefined, tenantId: string, identityId: string, agora = Date.now()): boolean {
    if (!token || !token.includes('.')) return false;
    const [corpo, sig] = token.split('.');
    const esperado = createHmac('sha256', this.chave()).update(corpo).digest();
    const recebido = Buffer.from(sig ?? '', 'base64url');
    if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) return false;
    try {
      const p = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')) as { t: string; i: string; exp: number };
      return p.t === tenantId && p.i === identityId && typeof p.exp === 'number' && p.exp > agora;
    } catch {
      return false;
    }
  }

  /** Barreira das rotas protegidas: sem senha configurada passa; com senha, exige o desbloqueio. */
  async exigir(tenantId: string, identityId: string, token: string | undefined): Promise<void> {
    if (!(await this.configurada(tenantId))) return;
    if (!this.tokenValido(token, tenantId, identityId)) {
      throw new ForbiddenException({ message: 'digite a senha do financeiro para continuar', code: 'senha_financeiro' });
    }
  }
}
