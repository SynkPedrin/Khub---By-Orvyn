import { Body, Controller, Headers, Post, Query, ServiceUnavailableException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Public } from '../../auth/decorators';
import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../../prisma/prisma.service';

export function parseStevo(body:unknown) {
 const b=z.record(z.unknown()).parse(body);
 const d=z.record(z.unknown()).optional().parse(b.data) ?? {};
 const key=z.record(z.unknown()).optional().parse(d.key) ?? {};
 const message=z.record(z.unknown()).optional().parse(d.message ?? b.message) ?? {};
 if(d.fromMe===true || b.fromMe===true || key.fromMe===true) return null;
 const from=d.from ?? b.from ?? b.sender ?? b.phone ?? key.remoteJid;
 const text=d.text ?? message.text ?? b.text ?? b.body ?? message.conversation ?? d.body;
 const id=d.id ?? b.id ?? b.messageId ?? key.id;
 if(typeof from==='string' && (from.endsWith('@g.us') || from==='status@broadcast')) return null;
 return z.object({from:z.string().min(7).max(80),text:z.string().min(1).max(4000),id:z.string().min(1).max(300),instance:z.string().min(1).max(160),name:z.string().max(160).optional()}).parse({from,text,id,instance:b.instance ?? d.instance,name:d.pushName ?? b.pushName ?? b.name});
}
@Public()
@Controller('webhooks/stevo')
export class StevoWebhookController {
 constructor(private readonly prisma:PrismaService,private readonly config:ConfigService) {}
 @Post()
 async receive(@Body() body:unknown,@Query('token') token?:string,@Headers('x-webhook-token') header?:string) {
   const expected=this.config.get('STEVO_WEBHOOK_TOKEN');
   if(!expected) throw new ServiceUnavailableException('webhook não configurado');
   const actual=Buffer.from(header ?? token ?? '');const wanted=Buffer.from(expected);
   if(actual.length!==wanted.length || !timingSafeEqual(actual,wanted)) throw new UnauthorizedException('token inválido');
   let ev:ReturnType<typeof parseStevo>;
   try {ev=parseStevo(body);} catch {throw new BadRequestException('payload inválido ou sem identificador de evento');}
   if(!ev) return {ignored:true};
   const rows=await this.prisma.$queryRaw<{tenant_id:string|null}[]>`SELECT resolve_tenant_by_stevo_instance(${ev.instance}) AS tenant_id`;
   const tenantId=rows[0]?.tenant_id ?? (process.env.NODE_ENV!=='production'?this.config.get('STEVO_FALLBACK_TENANT_ID'):undefined);
   if(!tenantId) throw new BadRequestException('instância não conectada');
   const payload={tenantId,fromNumber:ev.from.replace(/@.*$/,''),fromName:ev.name,text:ev.text,providerMessageId:ev.id};
   await this.prisma.withTenant(tenantId,tx=>tx.outboxEvent.upsert({where:{tenantId_dedupeKey:{tenantId,dedupeKey:`stevo:${ev!.instance}:${ev!.id}`}},create:{tenantId,kind:'stevo.inbound',dedupeKey:`stevo:${ev!.instance}:${ev!.id}`,payload},update:{}}));
   return {ok:true};
 }
}
