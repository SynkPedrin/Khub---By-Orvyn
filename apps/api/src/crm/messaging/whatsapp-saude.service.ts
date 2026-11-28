import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StevoApiError, StevoApiProvider } from './stevo-api.provider';

/**
 * SAÚDE DO WHATSAPP (Stevo) — verificação periódica
 * ================================================
 * Incidente 25/11 (Dra. Bárbara): a instância parou na Stevo ("not_ready") sem
 * mandar `instance.disconnected`. O KHUB seguiu mostrando "conectado" e por 3
 * dias nenhuma mensagem chegou, sem ninguém saber. O webhook continua sendo o
 * caminho em tempo real; esta verificação é a rede de segurança: pergunta à
 * Stevo o estado REAL de cada instância vinculada e grava na integração.
 *
 * `health: 'down'` é o que acende o aviso "integração quebrada" no sino
 * (SettingsService.notifications) e tira o "Conectado" do card de Integrações.
 *
 * Cross-tenant sem função privilegiada: a lista vem da própria Stevo, e cada
 * instância traz o tenant em `external_ref` (gravado no vínculo). A escrita é
 * feita dentro do tenant (RLS), só na integração daquela instância.
 */

export interface SaudeIntegracao {
  status: 'connected' | 'disconnected' | 'error';
  health: 'ok' | 'down';
  erro: string | null;
}

/** Decide o estado a gravar a partir do que a Stevo respondeu. Pura. */
export function saudeDaInstancia(r: { pareada: boolean } | { falha: { codigo: string; retryable: boolean } }): SaudeIntegracao | null {
  if ('pareada' in r) {
    return r.pareada
      ? { status: 'connected', health: 'ok', erro: null }
      : { status: 'disconnected', health: 'down', erro: 'WhatsApp desconectado: gere o QR Code em Configurações > Integrações e leia no celular.' };
  }
  // Instabilidade passageira da Stevo (5xx/429) não derruba o canal: a próxima volta confere.
  if (r.falha.retryable) return null;
  if (r.falha.codigo === 'not_ready') {
    return { status: 'error', health: 'down', erro: 'A instância do WhatsApp está parada na Stevo (not_ready). Reinicie a instância no painel da Stevo e depois gere o QR Code em Integrações.' };
  }
  return { status: 'error', health: 'down', erro: `A Stevo recusou a verificação da instância (${r.falha.codigo}).` };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class WhatsappSaudeService {
  private readonly log = new Logger('WhatsappSaude');

  constructor(
    private readonly prisma: PrismaService,
    private readonly stevo: StevoApiProvider,
  ) {}

  async verificarTodos(): Promise<{ instancias: number; mudancas: number; falhas: number }> {
    if (!this.stevo.configured()) return { instancias: 0, mudancas: 0, falhas: 0 };
    const lista = await this.stevo.listarInstancias();
    let mudancas = 0;
    let falhas = 0;
    for (const inst of lista) {
      const tenantId = inst.external_ref;
      if (!tenantId || !UUID_RE.test(tenantId)) continue;
      try {
        if (await this.verificar(tenantId, inst.id)) mudancas++;
      } catch (e) {
        falhas++;
        this.log.warn(`saúde da instância ${inst.id.slice(0, 8)}… falhou: ${(e as Error).message.slice(0, 200)}`);
      }
    }
    return { instancias: lista.length, mudancas, falhas };
  }

  /** Confere uma instância e grava só se o estado mudou. Devolve se mudou. */
  async verificar(tenantId: string, instanciaId: string): Promise<boolean> {
    const integ = await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.findFirst({ where: { provider: 'stevo_api', externalBusinessId: instanciaId, status: { not: 'revoked' } }, select: { id: true, status: true, health: true, erro: true } }),
    );
    if (!integ) return false;

    let saude: SaudeIntegracao | null;
    try {
      const c = await this.stevo.conexao(instanciaId);
      saude = saudeDaInstancia({ pareada: c.connected && c.logged_in });
    } catch (e) {
      if (!(e instanceof StevoApiError)) throw e;
      saude = saudeDaInstancia({ falha: { codigo: e.codigo, retryable: e.retryable } });
    }
    if (!saude) return false;

    const mudou = integ.status !== saude.status || integ.health !== saude.health || (integ.erro ?? null) !== saude.erro;
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.update({
        where: { id: integ.id },
        data: { ...saude, lastSyncAt: new Date(), ...(mudou ? { updatedAt: new Date() } : {}) },
      }),
    );
    if (mudou) {
      const msg = `WhatsApp (Stevo) do tenant ${tenantId.slice(0, 8)}…: ${integ.status}/${integ.health} → ${saude.status}/${saude.health}`;
      if (saude.health === 'down') this.log.warn(msg);
      else this.log.log(msg);
    }
    return mudou;
  }
}
