import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StevoProvider } from './stevo.provider';
import { EvolutionProvider } from './evolution.provider';
import { ConfigService } from '../../config/config.service';
import { DomainEventsService } from '../../events/domain-events.service';
import { randomUUID } from 'node:crypto';
import { DeliveryError } from './stevo.provider';
import { acharContatoPorTelefone } from '../telefone';
import { AtendimentoService, type EstadoAtendimento } from './atendimento.service';
import { StevoApiProvider } from './stevo-api.provider';

/**
 * Autoria do envio. `humano` com `identityId` = alguém digitou no Inbox (e por
 * isso assume a conversa); sem `identityId` = automação/Nyro; `ia` = agente.
 */
export type AutorEnvio = { tipo: 'humano'; identityId?: string } | { tipo: 'ia'; agentId: string };

export interface InboundInput {
  tenantId: string;
  fromNumber: string;
  fromName?: string;
  text: string;
  providerMessageId: string;
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
  ) {}

  /** Implementação por nome (o nome é decidido POR TENANT dentro da transação). */
  private impl(nome: 'stevo_api' | 'evolution' | 'stevo'): StevoApiProvider | EvolutionProvider | StevoProvider {
    return nome === 'stevo_api' ? this.stevoApi : nome === 'evolution' ? this.evolution : this.stevo;
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
    return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  /** Reserve before sending. An uncertain provider acceptance is NEVER retried. */
  async send(tenantId: string, conversationId: string, texto: string, idempotencyKey: string = randomUUID(), runStartedAt?: string, autor: AutorEnvio = { tipo: 'humano' }) {
    let assumiu: EstadoAtendimento | null = null;
    const ctx = await this.prisma.withTenant(tenantId, async tx => {
      // $executeRaw: pg_advisory_xact_lock devolve `void`, que o Prisma não desserializa em $queryRaw (P2010).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ':' + idempotencyKey},0))`;
      const conv = await tx.conversation.findUnique({where:{id:conversationId,tenantId},include:{contact:true}});
      if (!conv) throw new NotFoundException('conversa inexistente');
      const previous = await tx.message.findUnique({where:{tenantId_idempotencyKey:{tenantId,idempotencyKey}}});
      if (previous && (previous.corpo!==texto || previous.conversationId!==conversationId)) throw new ConflictException('chave de idempotência já usada com outro conteúdo');
      if (previous && previous.deliveryStatus!=='pending') return {msg:previous,send:false,phone:null,instance:undefined,providerNome:this.provider().nome as 'stevo_api'|'evolution'|'stevo'};
      if (conv.contactId) await tx.$queryRaw`SELECT id FROM contacts WHERE id=${conv.contactId}::uuid AND tenant_id=${tenantId}::uuid FOR UPDATE`;
      const contact=conv.contactId ? await tx.contact.findUnique({where:{id:conv.contactId,tenantId}}) : null;
      // Provedor POR TENANT (doc 18 / ADR-0031): instância Stevo vinculada ao
      // tenant vence; sem ela, o comportamento anterior (Evolution global → Stevo legado).
      const stevoApi=await tx.integration.findFirst({where:{tenantId,provider:'stevo_api',status:{not:'revoked'}},select:{externalBusinessId:true,status:true}});
      const providerNome:'stevo_api'|'evolution'|'stevo'=stevoApi ? 'stevo_api' : this.provider().nome;
      const integration=stevoApi?.status==='connected' ? stevoApi : stevoApi ? null : await tx.integration.findFirst({where:{tenantId,provider:providerNome,status:'connected'},select:{externalBusinessId:true}});
      let status='sending';
      if (!contact?.telefone) status='sem_telefone';
      if (!this.impl(providerNome).configured() || (process.env.NODE_ENV==='production' && !integration?.externalBusinessId)) status='config_required';
      // Instância Stevo vinculada mas desconectada: não tenta (a Stevo responderia not_ready).
      if (status==='sending' && stevoApi && stevoApi.status!=='connected') status='canal_desconectado';
      if (contact?.optedOutAt || (runStartedAt && contact?.lastInboundAt && contact.lastInboundAt >= new Date(runStartedAt))) status='cancelled';
      // TRAVA DE DEV (doc 18, B-3): fora de produção nada sai para o telefone real
      // do contato. Só para STEVO_TEST_NUMBER; sem ele, a mensagem é gravada e bloqueada.
      if (status==='sending' && !this.emProducao() && !this.config.get('STEVO_TEST_NUMBER')) status='bloqueado_dev';
      const hora=this.hora();
      const data={deliveryStatus:status,deliveryError:status==='bloqueado_dev'?'envio externo bloqueado fora de produção: defina STEVO_TEST_NUMBER':null};
      const autoria = autor.tipo==='ia' ? {autorTipo:'ia',agentId:autor.agentId} : {autorTipo:'humano'};
      const msg=previous ? await tx.message.update({where:{id:previous.id,tenantId},data}) : await tx.message.create({data:{tenantId,conversationId,...autoria,corpo:texto,hora,idempotencyKey,...data}});
      await tx.conversation.update({where:{id:conversationId,tenantId},data:{ultimaPrevia:texto.slice(0,140),ultimaHora:hora,updatedAt:new Date()}});
      // Humano digitou no Inbox numa conversa da IA: ele assumiu (ADR-0030).
      if (autor.tipo==='humano' && autor.identityId) assumiu = await this.atendimento.aoHumanoEnviar(tx, tenantId, conversationId, autor.identityId);
      const actorType = autor.tipo==='ia' ? 'nyro' : 'humano';
      const actorId = autor.tipo==='ia' ? autor.agentId : autor.identityId ?? null;
      await tx.$executeRaw`INSERT INTO audit_logs(tenant_id,actor_type,actor_id,acao,entidade,entidade_id) VALUES(${tenantId}::uuid,${actorType},${actorId},'message.reserve','message',${msg.id})`;
      return {msg,send:status==='sending',phone:contact?.telefone,instance:integration?.externalBusinessId ?? undefined,providerNome};
    });
    let status=ctx.msg.deliveryStatus;
    let erro=ctx.msg.deliveryError;
    if (ctx.send && ctx.phone) {
      try {
        // Nunca cai para o telefone real fora de produção (a trava acima garante que existe).
        const destination=this.emProducao() ? ctx.phone : this.config.get('STEVO_TEST_NUMBER')!;
        const result=await this.impl(ctx.providerNome).sendText(destination,texto,ctx.instance,idempotencyKey);
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
    return {id:ctx.msg.id,hora:ctx.msg.hora ?? this.hora(),status,erro,missing:status==='config_required'?this.impl(ctx.providerNome).missing():[]};
  }

  /** Recebe mensagem de entrada (webhook STEVO): dedup + acha/cria contato+conversa. */
  async receiveInbound(input: InboundInput) {
    const r = await this.entrada(input);
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
        contact = await tx.contact.create({ data: { tenantId: input.tenantId, nome: input.fromName || input.fromNumber, telefone: input.fromNumber, tag: 'Lead', ultimoContatoAt: new Date() } });
      }
      await tx.$queryRaw`SELECT id FROM contacts WHERE id=${contact.id}::uuid FOR UPDATE`;
      const optout=/^(stop|parar|sair|cancelar|remover|não quero|nao quero)\b/i.test(input.text.trim());
      await tx.contact.update({where:{id:contact.id,tenantId:input.tenantId},data:{lastInboundAt:new Date(),...(optout?{optedOutAt:new Date()}: {})}});
      await tx.workflowRun.updateMany({where:{tenantId:input.tenantId,contactId:contact.id,status:{in:['rodando','esperando']},...(optout?{}:{workflow:{pararNoReply:true}})},data:{status:'cancelado',finishedAt:new Date(),erro:optout?'contato optou por sair':'contato respondeu'}});
      const hora = this.hora();
      let conv = await tx.conversation.findFirst({ where: { contactId: contact.id, canal: 'WhatsApp' } });
      if (!conv) {
        // Conversa nova nasce com a IA se houver agente padrão ativo (ADR-0030).
        const inicial = await this.atendimento.estadoInicial(tx, 'WhatsApp');
        conv = await tx.conversation.create({ data: { tenantId: input.tenantId, contactId: contact.id, nome: contact.nome, canal: 'WhatsApp', ultimaPrevia: input.text.slice(0, 140), naoLidas: 1, ultimaHora: hora, ...inicial } });
      } else {
        conv = await tx.conversation.update({ where: { id: conv.id }, data: { ultimaPrevia: input.text.slice(0, 140), naoLidas: { increment: 1 }, ultimaHora: hora, updatedAt: new Date() } });
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
      };
    });
  }
}
