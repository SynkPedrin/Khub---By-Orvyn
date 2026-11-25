import { ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StevoProvider, type MessagingProvider } from './stevo.provider';
import { EvolutionProvider } from './evolution.provider';
import { ConfigService } from '../../config/config.service';
import { DomainEventsService } from '../../events/domain-events.service';
import { randomUUID } from 'node:crypto';
import { DeliveryError } from './stevo.provider';
import { acharContatoPorTelefone } from '../telefone';
import { AtendimentoService, type EstadoAtendimento } from './atendimento.service';
import { StevoApiProvider } from './stevo-api.provider';
import { OpenWaProvider } from './openwa/openwa.provider';
import type { Prisma } from '@prisma/client';
import type { MidiaSaida } from './provider.contract';
import { CanaisService } from './canais/canais.service';
import { horaCurta } from '../../common/hora';
import { ehPedidoDeOptOut } from '../../common/optout';
import { AtribuicaoService } from '../atribuicao.service';
import { casarLink, toqueDeLink, type LinkParaMatch } from '../links-rastreados';

/**
 * Autoria do envio. `humano` com `identityId` = alguém digitou no Inbox (e por
 * isso assume a conversa) — persiste `enviado_por_id` pro Inbox mostrar quem;
 * `ia` = agente; `automacao` = workflow disparou sem humano no meio (migration
 * 036 — antes caía em `humano` genérico, indistinguível de atendente de verdade).
 */
export type AutorEnvio = { tipo: 'humano'; identityId?: string } | { tipo: 'ia'; agentId: string } | { tipo: 'automacao'; workflowId: string };

/**
 * Mídia de saída já preparada pelo Inbox (Q2.5): transporte decidido
 * (`url` do storage ou `base64` ≤ 5 MB) + o que vai para `messages.anexo`.
 */
export interface MidiaEnvio extends MidiaSaida {
  tamanho: number;
  /** Chave do objeto no storage (nunca a URL assinada). */
  storageKey?: string;
  /** Variáveis que faltam ao storage — para o 501 dizer o que configurar. */
  storageFaltando?: string[];
}

export type ProvedorNome = 'openwa' | 'stevo_api' | 'evolution' | 'stevo';

export interface InboundInput {
  tenantId: string;
  fromNumber: string;
  fromName?: string;
  text: string;
  providerMessageId: string;
  /**
   * A mensagem veio com referral de anúncio (CTWA): a atribuição quem grava é
   * o caller (toqueDeReferralWhatsApp) e o casamento de link rastreado (db/080)
   * NÃO roda — o anúncio é evidência mais forte que o texto.
   */
  referral?: boolean;
}

@Injectable()
export class MessagesService {
  private readonly log = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stevo: StevoProvider,
    private readonly evolution: EvolutionProvider,
    private readonly config: ConfigService,
    private readonly eventos: DomainEventsService,
    private readonly atendimento: AtendimentoService,
    private readonly stevoApi: StevoApiProvider,
    // Opcionais só para os testes antigos que montam o serviço à mão; no Nest sempre existem.
    @Optional() private readonly canais?: CanaisService,
    @Optional() private readonly atribuicao?: AtribuicaoService,
    @Optional() private readonly openwa?: OpenWaProvider,
  ) {}

  /** Implementação por nome (o nome é decidido POR TENANT dentro da transação). */
  private impl(nome: ProvedorNome): MessagingProvider {
    if (nome === 'openwa' && this.openwa) return this.openwa;
    return nome === 'stevo_api' ? this.stevoApi : nome === 'evolution' ? this.evolution : this.stevo;
  }

  /**
   * Provedor de WhatsApp DO TENANT (ADR-0031/0057), decidido dentro da transação:
   *  1. open-wa (QR Code próprio) conectado → ele;
   *  2. instância Stevo vinculada → ela (desconectada = `canal_desconectado`);
   *  3. open-wa vinculado mas caído (sem Stevo) → `canal_desconectado`;
   *  4. senão o comportamento anterior (Evolution global → Stevo legado).
   */
  private async escolherProvedor(tx: Prisma.TransactionClient, tenantId: string): Promise<{ providerNome: ProvedorNome; integration: { externalBusinessId: string | null } | null; desconectado: boolean }> {
    const openwa = this.openwa ? await tx.integration.findFirst({ where: { tenantId, provider: 'openwa', status: { not: 'revoked' } }, select: { externalBusinessId: true, status: true } }) : null;
    if (openwa?.status === 'connected') return { providerNome: 'openwa', integration: openwa, desconectado: false };
    const stevoApi = await tx.integration.findFirst({ where: { tenantId, provider: 'stevo_api', status: { not: 'revoked' } }, select: { externalBusinessId: true, status: true } });
    if (stevoApi) return { providerNome: 'stevo_api', integration: stevoApi.status === 'connected' ? stevoApi : null, desconectado: stevoApi.status !== 'connected' };
    if (openwa) return { providerNome: 'openwa', integration: null, desconectado: true };
    const providerNome = this.provider().nome;
    const integration = await tx.integration.findFirst({ where: { tenantId, provider: providerNome, status: 'connected' }, select: { externalBusinessId: true } });
    return { providerNome, integration, desconectado: false };
  }

  /**
   * Provider ativo de WhatsApp. Evolution é o CANAL_MVP (CLAUDE.md) — quando
   * configurada, tem prioridade. Stevo continua funcionando sozinha para
   * quem ainda depende dela; nenhuma das duas foi removida.
   */
  private provider(): { nome: 'evolution' | 'stevo'; impl: EvolutionProvider | StevoProvider } {
    return this.evolution.configured() ? { nome: 'evolution', impl: this.evolution } : { nome: 'stevo', impl: this.stevo };
  }

  private emProducao(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  private hora(): string {
    return horaCurta();
  }

  /**
   * Aviso para a EQUIPE num número de WhatsApp (nó "Notificar equipe"), sem
   * criar contato nem conversa: um contato "equipe" sujaria o CRM e ainda
   * dispararia os fluxos de "contato criado". Mesmas travas do `send`:
   * instância Stevo do tenant, dev lock (fora de produção só STEVO_TEST_NUMBER)
   * e idempotência — a chave é reservada em `webhook_events` ANTES do envio, então
   * um retry nunca manda o aviso duas vezes.
   */
  async notificarNumero(tenantId: string, telefone: string, texto: string, idempotencyKey: string): Promise<{ status: string; erro: string | null }> {
    const reserva = await this.prisma.withTenant(tenantId, async (tx) => {
      const nova = await tx.$executeRaw`INSERT INTO webhook_events(tenant_id,provider,event_id,payload,processed_at)
        VALUES(${tenantId}::uuid,'notificacao_equipe',${tenantId + ':' + idempotencyKey},'{}',now()) ON CONFLICT(provider,event_id) DO NOTHING`;
      if (!nova) return null;
      const { providerNome, integration, desconectado } = await this.escolherProvedor(tx, tenantId);
      let status = 'sending';
      if (!this.impl(providerNome).configured() || ((process.env.NODE_ENV === 'production' || providerNome === 'openwa') && !integration?.externalBusinessId && !desconectado)) status = 'config_required';
      if (status === 'sending' && desconectado) status = 'canal_desconectado';
      if (status === 'sending' && !this.emProducao() && !this.config.get('STEVO_TEST_NUMBER')) status = 'bloqueado_dev';
      await tx.$executeRaw`INSERT INTO audit_logs(tenant_id,actor_type,actor_id,acao,entidade,entidade_id) VALUES(${tenantId}::uuid,'sistema','automacao','equipe.notificacao','webhook_event',${idempotencyKey})`;
      return { status, providerNome, instance: integration?.externalBusinessId ?? undefined };
    });
    if (!reserva) return { status: 'sent', erro: null }; // já enviado antes (retry): não repete
    if (reserva.status !== 'sending') return { status: reserva.status, erro: null };
    try {
      const destino = this.emProducao() ? telefone : this.config.get('STEVO_TEST_NUMBER')!;
      await this.impl(reserva.providerNome).sendText(destino, texto, reserva.instance, idempotencyKey);
      return { status: 'sent', erro: null };
    } catch (error) {
      const status = error instanceof DeliveryError ? (error.retryable ? 'pending' : error.uncertain ? 'unknown' : 'failed') : 'unknown';
      if (status === 'pending') {
        // Nada saiu: libera a chave para o retry tentar de novo.
        await this.prisma.withTenant(tenantId, (tx) => tx.$executeRaw`DELETE FROM webhook_events WHERE provider='notificacao_equipe' AND event_id=${tenantId + ':' + idempotencyKey}`);
      }
      return { status, erro: error instanceof DeliveryError ? error.message : 'provider_acceptance_unknown' };
    }
  }

  /** Reserve before sending. An uncertain provider acceptance is NEVER retried. */
  async send(tenantId: string, conversationId: string, texto: string, idempotencyKey: string = randomUUID(), runStartedAt?: string, autor: AutorEnvio = { tipo: 'humano' }, midia?: MidiaEnvio) {
    // Conversa de Instagram/Messenger/Facebook/YouTube com id na rede (db/063):
    // a resposta sai pela rede dela, não pelo WhatsApp do tenant.
    const canalConv = this.canais ? await this.prisma.withTenant(tenantId, (tx) => tx.conversation.findUnique({ where: { id: conversationId }, select: { canal: true, externoId: true } })) : null;
    if (this.canais && canalConv && canalConv.canal !== 'WhatsApp' && this.canais.atende(canalConv)) {
      return this.canais.enviar(tenantId, conversationId, texto, idempotencyKey, autor, !!midia);
    }
    let assumiu: EstadoAtendimento | null = null;
    const ctx = await this.prisma.withTenant(tenantId, async tx => {
      // $executeRaw: pg_advisory_xact_lock devolve `void`, que o Prisma não desserializa em $queryRaw (P2010).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ':' + idempotencyKey},0))`;
      const conv = await tx.conversation.findUnique({where:{id:conversationId,tenantId},include:{contact:true}});
      if (!conv) throw new NotFoundException('conversa inexistente');
      const previous = await tx.message.findUnique({where:{tenantId_idempotencyKey:{tenantId,idempotencyKey}}});
      if (previous && (previous.corpo!==texto || previous.conversationId!==conversationId)) throw new ConflictException('chave de idempotência já usada com outro conteúdo');
      if (previous && previous.deliveryStatus!=='pending') return {msg:previous,send:false,phone:null,instance:undefined,providerNome:this.provider().nome as ProvedorNome,gateStorage:false};
      if (conv.contactId) await tx.$queryRaw`SELECT id FROM contacts WHERE id=${conv.contactId}::uuid AND tenant_id=${tenantId}::uuid FOR UPDATE`;
      const contact=conv.contactId ? await tx.contact.findUnique({where:{id:conv.contactId,tenantId}}) : null;
      // Provedor POR TENANT (doc 18 / ADR-0031): instância Stevo vinculada ao
      // tenant vence; sem ela, o comportamento anterior (Evolution global → Stevo legado).
      const {providerNome,integration,desconectado}=await this.escolherProvedor(tx,tenantId);
      let status='sending';
      if (!contact?.telefone) status='sem_telefone';
      // open-wa sempre precisa da sessão do tenant (não há instância global de dev).
      if (!this.impl(providerNome).configured() || ((process.env.NODE_ENV==='production' || providerNome==='openwa') && !integration?.externalBusinessId && !desconectado)) status='config_required';
      // Canal vinculado mas desconectado (Stevo ou open-wa): não tenta.
      if (status==='sending' && desconectado) status='canal_desconectado';
      // Cancelado de propósito: o contato pediu para sair, ou RESPONDEU depois que a automação começou
      // (follow-up não vai para quem acabou de falar). O motivo fica gravado (auditoria 16/11).
      const motivoCancelado=contact?.optedOutAt ? 'contato_optou_por_sair' : (runStartedAt && contact?.lastInboundAt && contact.lastInboundAt >= new Date(runStartedAt)) ? 'contato_respondeu_depois_do_inicio' : null;
      if (motivoCancelado) status='cancelled';
      // TRAVA DE DEV (doc 18, B-3): fora de produção nada sai para o telefone real
      // do contato. Só para STEVO_TEST_NUMBER; sem ele, a mensagem é gravada e bloqueada.
      if (status==='sending' && !this.emProducao() && !this.config.get('STEVO_TEST_NUMBER')) status='bloqueado_dev';
      // Mídia (Q2.5): o canal precisa ter endpoint de mídia documentado, e o
      // transporte tem de caber nele — URL do storage, ou base64 só para quem
      // aceita (Evolution). Senão, grava e devolve gated, sem tentar.
      let gateStorage=false;
      if (midia && ['sending','bloqueado_dev'].includes(status)) {
        const impl: MessagingProvider=this.impl(providerNome);
        if (!impl.sendMedia) status='midia_nao_suportada';
        else if (!midia.url && !(midia.base64 && impl.aceitaBase64)) { status='config_required'; gateStorage=true; }
      }
      const hora=this.hora();
      const data={deliveryStatus:status,deliveryError:status==='bloqueado_dev'?'envio externo bloqueado fora de produção: defina STEVO_TEST_NUMBER':status==='cancelled'?motivoCancelado:null};
      const autoria = autor.tipo==='ia' ? {autorTipo:'ia',agentId:autor.agentId}
        : autor.tipo==='automacao' ? {autorTipo:'automacao',workflowId:autor.workflowId}
        : {autorTipo:'humano',enviadoPorId:autor.identityId};
      const anexo=midia ? {tipo:midia.tipo,mime:midia.mime,nome:midia.nome,tamanho:midia.tamanho,...(midia.legenda?{legenda:midia.legenda}:{}),...(midia.storageKey?{storageKey:midia.storageKey}:{})} : undefined;
      const msg=previous ? await tx.message.update({where:{id:previous.id,tenantId},data}) : await tx.message.create({data:{tenantId,conversationId,...autoria,corpo:texto,hora,idempotencyKey,...data,...(anexo?{anexo}:{})}});
      await tx.conversation.update({where:{id:conversationId,tenantId},data:{ultimaPrevia:texto.slice(0,140),ultimaHora:hora,updatedAt:new Date()}});
      // Humano digitou no Inbox numa conversa da IA: ele assumiu (ADR-0030).
      if (autor.tipo==='humano' && autor.identityId) assumiu = await this.atendimento.aoHumanoEnviar(tx, tenantId, conversationId, autor.identityId);
      const actorType = autor.tipo==='ia' ? 'nyro' : autor.tipo==='automacao' ? 'sistema' : 'humano';
      const actorId = autor.tipo==='ia' ? autor.agentId : autor.tipo==='automacao' ? autor.workflowId : autor.identityId ?? null;
      await tx.$executeRaw`INSERT INTO audit_logs(tenant_id,actor_type,actor_id,acao,entidade,entidade_id) VALUES(${tenantId}::uuid,${actorType},${actorId},'message.reserve','message',${msg.id})`;
      return {msg,send:status==='sending',phone:contact?.telefone,instance:integration?.externalBusinessId ?? undefined,providerNome,gateStorage};
    });
    let status=ctx.msg.deliveryStatus;
    let erro=ctx.msg.deliveryError;
    if (ctx.send && ctx.phone) {
      try {
        // Nunca cai para o telefone real fora de produção (a trava acima garante que existe).
        const destination=this.emProducao() ? ctx.phone : this.config.get('STEVO_TEST_NUMBER')!;
        const impl: MessagingProvider=this.impl(ctx.providerNome);
        const result=midia && impl.sendMedia ? await impl.sendMedia(destination,midia,ctx.instance,idempotencyKey) : await impl.sendText(destination,texto,ctx.instance,idempotencyKey);
        await this.prisma.withTenant(tenantId,tx=>tx.message.update({where:{id:ctx.msg.id,tenantId},data:{deliveryStatus:'sent',providerId:result.providerId,sentAt:new Date()}}));
        status='sent';
      } catch(error) {
        // Network timeout and 5xx can happen AFTER acceptance. Keep evidence and
        // require reconciliation instead of risking another commercial message.
        status=error instanceof DeliveryError ? error.retryable ? 'pending' : error.uncertain ? 'unknown' : 'failed' : 'unknown';
        erro=error instanceof DeliveryError ? error.message : 'provider_acceptance_unknown';
        await this.prisma.withTenant(tenantId,tx=>tx.message.update({where:{id:ctx.msg.id,tenantId},data:{deliveryStatus:status,deliveryError:erro}}));
      }
    } else if(status==='sending') status='unknown';
    this.eventos.publicar(tenantId,'message.created',{conversationId,id:ctx.msg.id,de:autor.tipo==='ia'?'ia':'humano',texto,hora:ctx.msg.hora ?? this.hora(),agentId:autor.tipo==='ia'?autor.agentId:null});
    this.eventos.publicar(tenantId,'conversation.updated',{id:conversationId,ultimaPrevia:texto.slice(0,140),ultimaHora:ctx.msg.hora ?? this.hora(),naoLidas:0});
    if (assumiu) this.atendimento.publicar(tenantId, assumiu);
    const gated=status==='config_required' ? (ctx.gateStorage ? {provider:'storage',missing:midia?.storageFaltando ?? []} : {provider:ctx.providerNome,missing:this.impl(ctx.providerNome).missing()}) : null;
    return {id:ctx.msg.id,hora:ctx.msg.hora ?? this.hora(),status,erro,missing:gated?.missing ?? [],...(gated?{provider:gated.provider}:{})};
  }

  /** Recebe mensagem de entrada (webhook STEVO): dedup + acha/cria contato+conversa. */
  async receiveInbound(input: InboundInput) {
    const r = await this.entrada(input);
    // Lead novo cuja 1ª mensagem casa com um link rastreado (db/080): a origem
    // é gravada ANTES do contact.created, para quem consome o evento já ler a
    // atribuição. `registrar` nunca lança — a entrada nunca falha por isso.
    if (!r.deduped && r.contatoNovo && r.link) {
      await this.atribuicao?.registrar(input.tenantId, r.contactId!, toqueDeLink(r.link));
    }
    // Mensagem que chega é o evento mais sensível a atraso do inbox: publica assim
    // que o commit passou. Evento duplicado não é emitido — o dedupe sai antes.
    if (!r.deduped && r.conversationId) {
      this.eventos.publicar(input.tenantId, 'message.created', { conversationId: r.conversationId, id: r.messageId!, de: 'contato', texto: input.text, hora: r.hora! });
      this.eventos.publicar(input.tenantId, 'conversation.updated', { id: r.conversationId, ultimaPrevia: input.text.slice(0, 140), ultimaHora: r.hora!, naoLidas: r.naoLidas! });
      if (r.contatoNovo) {
        this.eventos.publicar(input.tenantId, 'contact.created', { id: r.contactId!, nome: r.contactNome!, origem: 'WhatsApp' });
      }
    }
    return r.deduped ? { deduped: true } : { conversationId: r.conversationId };
  }

  /**
   * Mensagem enviada pela equipe DIRETO NO CELULAR (`from_me` no webhook da
   * Stevo): entra no inbox como `humano`, para a conversa na tela refletir a
   * realidade. Não marca não-lida (foi a gente que respondeu), não dispara
   * agente/automação e não mexe em `lastInboundAt` — isso é métrica do contato.
   */
  async receberHumano(input: { tenantId: string; numeroContato: string; texto: string; providerMessageId: string }) {
    const r = await this.prisma.withTenant(input.tenantId, async (tx) => {
      const inserted = await tx.$executeRaw`INSERT INTO webhook_events(tenant_id,provider,event_id,payload,processed_at)
        VALUES(${input.tenantId}::uuid,'stevo',${input.tenantId + ':' + input.providerMessageId},'{}',now()) ON CONFLICT(provider,event_id) DO NOTHING`;
      if (!inserted) return { deduped: true as const };
      // Mensagem que o próprio KHUB enviou (API) também dispara message.sent
      // com from_me — já está no banco com provider_id = id do provedor.
      const provedorId = input.providerMessageId.replace(/^(stevo_api|openwa):/, '');
      const jaEnviada = await tx.message.findFirst({ where: { tenantId: input.tenantId, providerId: provedorId }, select: { id: true } });
      if (jaEnviada) return { deduped: true as const };
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.tenantId + ':' + input.numeroContato},0))`;
      const achadoId = await acharContatoPorTelefone(tx, input.numeroContato);
      const existente = achadoId ? await tx.contact.findUnique({ where: { id: achadoId } }) : null;
      const contact = existente ?? (await tx.contact.create({ data: { tenantId: input.tenantId, nome: input.numeroContato, telefone: input.numeroContato, tag: 'Lead', origem: 'WhatsApp' } }));
      const hora = this.hora();
      let conv = await tx.conversation.findFirst({ where: { contactId: contact.id, canal: 'WhatsApp' } });
      if (!conv) {
        conv = await tx.conversation.create({ data: { tenantId: input.tenantId, contactId: contact.id, nome: contact.nome, canal: 'WhatsApp', ultimaPrevia: input.texto.slice(0, 140), ultimaHora: hora, atendimento: 'humano' } });
      } else {
        // Eco do que o PRÓPRIO KHUB acabou de enviar e cujo provider_id ainda não
        // foi gravado (o webhook chegou antes da resposta do envio): mesmo texto,
        // saído daqui há menos de 2 min, sem id do provedor → é a mesma mensagem.
        const eco = await tx.message.findFirst({
          where: { conversationId: conv.id, corpo: input.texto, autorTipo: { in: ['humano', 'ia', 'automacao'] }, providerId: null, idempotencyKey: { not: { startsWith: 'celular:' } }, createdAt: { gte: new Date(Date.now() - 120_000) } },
          select: { id: true },
        });
        if (eco) {
          await tx.message.update({ where: { id: eco.id }, data: { providerId: provedorId } });
          return { deduped: true as const };
        }
        conv = await tx.conversation.update({ where: { id: conv.id }, data: { ultimaPrevia: input.texto.slice(0, 140), ultimaHora: hora, status: 'aberta', updatedAt: new Date() } });
      }
      const msg = await tx.message.create({ data: { tenantId: input.tenantId, conversationId: conv.id, autorTipo: 'humano', corpo: input.texto, hora, idempotencyKey: `celular:${input.providerMessageId}` }, select: { id: true } });
      return { deduped: false as const, conversationId: conv.id, messageId: msg.id, hora };
    });
    if (!r.deduped) {
      this.eventos.publicar(input.tenantId, 'message.created', { conversationId: r.conversationId, id: r.messageId!, de: 'humano', texto: input.texto, hora: r.hora! });
      this.eventos.publicar(input.tenantId, 'conversation.updated', { id: r.conversationId, ultimaPrevia: input.texto.slice(0, 140), ultimaHora: r.hora! });
    }
    return r.deduped ? { deduped: true } : { conversationId: r.conversationId };
  }

  private async entrada(input: InboundInput) {
    return this.prisma.withTenant(input.tenantId, async (tx) => {
      const inserted=await tx.$executeRaw`INSERT INTO webhook_events(tenant_id,provider,event_id,payload,processed_at)
        VALUES(${input.tenantId}::uuid,'stevo',${input.tenantId + ':' + input.providerMessageId},'{}',now()) ON CONFLICT(provider,event_id) DO NOTHING`;
      if (!inserted) return {deduped:true as const};
      // $executeRaw: pg_advisory_xact_lock devolve `void`, que o Prisma não desserializa em $queryRaw (P2010).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.tenantId + ':' + input.fromNumber},0))`;
      // BUG-012: comparar dígitos crus com o telefone formatado do banco
      // duplicava o contato a cada resposta. A normalização mora no helper.
      const achadoId = await acharContatoPorTelefone(tx, input.fromNumber);
      let contact = achadoId ? await tx.contact.findUnique({ where: { id: achadoId } }) : null;
      const contatoNovo = !contact;
      if (!contact) {
        // `origem` = canal da entrada (a conversa abaixo é sempre de WhatsApp). Antes ficava
        // nula e o outbox (db/050, que lê `contacts.origem`) publicava "Manual".
        contact = await tx.contact.create({ data: { tenantId: input.tenantId, nome: input.fromName || input.fromNumber, telefone: input.fromNumber, tag: 'Lead', origem: 'WhatsApp', ultimoContatoAt: new Date() } });
      }
      // Link rastreado (db/080): só para CONTATO NOVO sem referral — 1 query
      // extra nesse caso, zero para contato existente. O `?.` protege os specs
      // antigos, cujo tx falso não tem `linkRastreado`.
      let link: LinkParaMatch | null = null;
      if (contatoNovo && this.atribuicao && !input.referral) {
        const ativos = ((await tx.linkRastreado?.findMany({
          where: { ativo: true },
          select: { codigo: true, campanha: true, fonte: true, conjunto: true, criativo: true, textoInicial: true },
        })) ?? []) as LinkParaMatch[];
        link = casarLink(ativos, input.text);
      }
      await tx.$queryRaw`SELECT id FROM contacts WHERE id=${contact.id}::uuid FOR UPDATE`;
      const optout=ehPedidoDeOptOut(input.text);
      await tx.contact.update({where:{id:contact.id,tenantId:input.tenantId},data:{lastInboundAt:new Date(),...(optout?{optedOutAt:new Date()}: {})}});
      await tx.workflowRun.updateMany({where:{tenantId:input.tenantId,contactId:contact.id,status:{in:['rodando','esperando']},...(optout?{}:{workflow:{pararNoReply:true}})},data:{status:'cancelado',finishedAt:new Date(),erro:optout?'contato optou por sair':'contato respondeu'}});
      const hora = this.hora();
      let conv = await tx.conversation.findFirst({ where: { contactId: contact.id, canal: 'WhatsApp' } });
      if (!conv) {
        // Conversa nova nasce com a IA se houver agente padrão ativo (ADR-0030).
        const inicial = await this.atendimento.estadoInicial(tx, 'WhatsApp', contact.tags);
        conv = await tx.conversation.create({ data: { tenantId: input.tenantId, contactId: contact.id, nome: contact.nome, canal: 'WhatsApp', ultimaPrevia: input.text.slice(0, 140), naoLidas: 1, ultimaHora: hora, ...inicial } });
      } else {
        // Mensagem nova reabre conversa resolvida ("Marcar como", db/063).
        conv = await tx.conversation.update({ where: { id: conv.id }, data: { ultimaPrevia: input.text.slice(0, 140), naoLidas: { increment: 1 }, ultimaHora: hora, status: 'aberta', updatedAt: new Date() } });
      }
      const msg = await tx.message.create({ data: { tenantId: input.tenantId, conversationId: conv.id, autorTipo: 'contato', corpo: input.text, hora }, select: { id: true } });
      return {
        deduped: false as const,
        conversationId: conv.id,
        messageId: msg.id,
        hora,
        naoLidas: conv.naoLidas,
        contatoNovo,
        contactId: contact.id,
        contactNome: contact.nome,
        link,
      };
    });
  }
}
