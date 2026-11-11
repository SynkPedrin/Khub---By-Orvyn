import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { TriggersService } from '../automations/triggers.service';
import { idDeJob, PassoJob } from '../automations/runs.service';
import { MetaLeadsService } from '../integrations/meta-leads.service';
import { MessagesService, InboundInput } from '../crm/messaging/messages.service';
import { StevoApiEventosService } from '../crm/messaging/stevo-api-eventos.service';
import type { EventoStevoApi } from '../crm/messaging/stevo-api-webhook.controller';
import { GatilhoJob } from '../events/domain-events.service';
import { isWorker } from '../common/queue-connection';
import { ATRASO_RESPOSTA_MS, FILA_AGENTES, type AgenteJob } from '../agents/agent-runtime.service';
import { AgendaService } from '../agenda/agenda.service';
import { AgendadorService } from '../automations/agendador.service';
import { DisparosService } from '../disparos/disparos.service';

/** Varredura do lembrete D-1 da agenda: no máximo 1x por minuto por tenant. */
const INTERVALO_LEMBRETES_MS = 60_000;

@Injectable()
export class OperationsService implements OnModuleInit {
 private readonly log = new Logger('Operations');
 constructor(private readonly db: PrismaService, private readonly triggers: TriggersService,
   private readonly meta: MetaLeadsService, private readonly messages: MessagesService, private readonly stevoApi: StevoApiEventosService,
   @InjectQueue('khub-maintenance') private readonly queue: Queue,
   @InjectQueue('automation-steps') private readonly steps: Queue<PassoJob>,
   @InjectQueue(FILA_AGENTES) private readonly agentes: Queue<AgenteJob>,
   private readonly agenda: AgendaService,
   private readonly agendador: AgendadorService,
   private readonly disparos: DisparosService) {}
 private readonly ultimaVarreduraLembretes = new Map<string, number>();
 async onModuleInit() {
   if (!isWorker()) return;
   const install = async () => { await this.queue.upsertJobScheduler('reconcile', { every: 5000 }, {name:'reconcile', data:{}, opts:{removeOnComplete:10,removeOnFail:100}}); };
   const client = await this.queue.client;
   client.on('ready', () => { void install().catch(() => this.log.error('scheduler recovery failed')); });
   await install();
 }
 async reconcile(): Promise<void> {
   let cursor: string | undefined;
   do {
     const tenants = await this.db.tenant.findMany({where:{status:'active'},select:{id:true},orderBy:{id:'asc'},take:100,...(cursor ? {cursor:{id:cursor},skip:1}: {})});
     if (!tenants.length) break;
     for (const t of tenants) {
       // Lembrete D-1 (Q2.4/RV-07.1): marca e o trigger da 054 publica no outbox,
       // que este mesmo loop despacha. Falha aqui não pode travar o reconcile.
       const ultima=this.ultimaVarreduraLembretes.get(t.id) ?? 0;
       if (Date.now()-ultima >= INTERVALO_LEMBRETES_MS) {
         this.ultimaVarreduraLembretes.set(t.id,Date.now());
         await this.agenda.dispararLembretes(t.id).catch(()=>this.log.error(`varredura de lembretes falhou (tenant ${t.id})`));
         // Gatilhos por tempo (Q3.2): agendado e data do contato (db/057). Idempotente por lease + dedupe.
         await this.agendador.varrer(t.id).catch((e)=>this.log.error(`varredura de agendas de automação falhou (tenant ${t.id}): ${(e as Error).message}`));
       }
       const data = await this.db.withTenant(t.id, async tx => ({
         events: await tx.outboxEvent.findMany({where:{status:'pending'},orderBy:{createdAt:'asc'},take:100}),
         runs: await tx.workflowRun.findMany({where:{status:{in:['rodando','esperando']}, scheduledAt:{lte:new Date(Date.now()+60_000)}, OR:[{leaseUntil:null},{leaseUntil:{lt:new Date()}}], workflow:{status:'ativo'}},orderBy:{scheduledAt:'asc'},take:100}),
       }));
       for (const e of data.events) await this.queue.add('event',{tenantId:t.id,id:e.id},{jobId:e.id,attempts:5,backoff:{type:'exponential',delay:2000},removeOnComplete:100,removeOnFail:false});
       for (const run of data.runs) {
         if (!run.noAtual) continue;
         const jobId=idDeJob(run.id,String(run.generation));
         const existing=await this.steps.getJob(jobId);
         if (existing && ['completed','failed'].includes(await existing.getState())) {
           if (run.attempts >= 4) {
             await this.db.withTenant(t.id,tx=>tx.workflowRun.updateMany({where:{id:run.id,generation:run.generation},data:{status:'falhou',erro:'limite de tentativas atingido',finishedAt:new Date()}}));
             continue;
           }
           await existing.remove();
         }
         await this.steps.add('passo',{tenantId:t.id,runId:run.id,noId:run.noAtual,generation:run.generation},{jobId,delay:Math.max(0,run.scheduledAt.getTime()-Date.now()),attempts:4,backoff:{type:'exponential',delay:3000},removeOnComplete:1000,removeOnFail:false});
       }
     }
     cursor=tenants.at(-1)!.id;
   } while(cursor);
   const client=await this.queue.client;
   // `IRedisClient` do BullMQ não expõe `call`; a forma tipada do TTL é o
   // objeto de opções `{ EX }` — equivalente a `SET ... EX 30`.
   await client.set('khub:worker:heartbeat',new Date().toISOString(),{EX:30});
 }
 async event(tenantId:string,id:string): Promise<void> {
   const e=await this.db.withTenant(tenantId,tx=>tx.outboxEvent.findUnique({where:{id,tenantId}}));
   if (!e || e.status!=='pending') return;
   try {
     // stevo.inbound e evolution.inbound convergem no mesmo InboundInput
     // genérico — a diferença é só qual webhook os gerou.
     if(e.kind==='stevo.inbound' || e.kind==='evolution.inbound') await this.messages.receiveInbound(e.payload as unknown as InboundInput);
     // Webhook de conta da Stevo (API de gestão): mensagem, recibo ou estado da instância.
     else if(e.kind==='stevo_api.event') await this.stevoApi.processar(tenantId,e.payload as unknown as EventoStevoApi);
     else if(e.kind==='meta.lead') {
       const result=await this.meta.processar(e.payload as unknown as Parameters<MetaLeadsService['processar']>[0]);
       if(!result.ok) throw new Error(result.motivo ?? 'meta processing failed');
     } else if(e.kind==='workflow.hook') {
       const p=e.payload as {workflowId:string;body:Record<string,unknown>};
       await this.triggers.processarWebhook(tenantId,p.workflowId,p.body,e.id);
     } else {
       // Mensagem do contato → resposta do agente (ADR-0030). Enfileira ANTES dos
       // gatilhos: se eles falharem e o evento for reprocessado, o jobId (= id da
       // mensagem, sem ':' — BUG-010) deduplica, e o runtime é idempotente.
       if (e.kind==='message.created') {
         const p=e.payload as {id?:string;de?:string};
         // "Sim" ao lembrete confirma o compromisso (RV-07.1) ANTES dos gatilhos:
         // o appointment.confirmed sai no mesmo commit e o fluxo enxerga o novo status.
         if (p.id && p.de==='contato') await this.agenda.confirmarPorResposta(tenantId,p.id);
         // Resposta em até 72h a um disparo em massa vira métrica "respondeu" (Q4.3). Idempotente.
         // Métrica não pode derrubar o evento (ex.: banco ainda sem a db/061): loga e segue.
         if (p.id && p.de==='contato') await this.disparos.registrarResposta(tenantId,p.id).catch((err: Error)=>this.log.warn(`resposta de disparo não registrada: ${err.message}`));
         if (p.id && p.de==='contato') await this.agentes.add('responder',{tenantId,messageId:p.id},{jobId:`agente-${p.id}`,delay:ATRASO_RESPOSTA_MS,attempts:3,backoff:{type:'exponential',delay:3000},removeOnComplete:1000,removeOnFail:1000});
       }
       await this.triggers.processar({tenantId,evento:e.kind,dados:e.payload,dedupeKey:e.id} as GatilhoJob);
     }
     await this.db.withTenant(tenantId,tx=>tx.outboxEvent.update({where:{id,tenantId},data:{status:'processed',processedAt:new Date()}}));
   } catch(error) {
     const attempts=e.attempts+1;
     await this.db.withTenant(tenantId,tx=>tx.outboxEvent.update({where:{id,tenantId},data:{attempts,status:attempts>=5?'failed':'pending',lastError:error instanceof Error?error.name:'Error'}}));
     throw error;
   }
 }
 async snapshot(tenantId:string) {
   const [queues, records, heartbeat]=await Promise.all([
     this.steps.getJobCounts('waiting','active','delayed','failed'),
     this.db.withTenant(tenantId,async tx=>({followups:await tx.workflowRun.groupBy({by:['status'],_count:true}),events:await tx.outboxEvent.groupBy({by:['status'],_count:true}),uncertainMessages:await tx.message.count({where:{deliveryStatus:{in:['unknown','sending']}}})})),
     this.queue.client.then(c=>c.get('khub:worker:heartbeat')),
   ]);
   // Queue counts are infrastructure-wide; expose only to operators separately.
   return {...records,workerOnline:!!heartbeat};
 }
}
@Processor('khub-maintenance',{concurrency:4})
export class OperationsProcessor extends WorkerHost {
 constructor(private readonly operations:OperationsService){super();}
 async process(job:Job<{tenantId:string;id:string}>){
   if(job.name==='reconcile') await this.operations.reconcile();
   else await this.operations.event(job.data.tenantId,job.data.id);
 }
}
