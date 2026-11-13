import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators';
import { SkipRateLimit } from '../common/rate-limit.guard';
@Public()
@SkipRateLimit()
@Controller()
export class HealthController {
 constructor(private readonly prisma:PrismaService) {}
 @Get('health') health(){return {status:'ok',service:'khub-api'};}
 @Get('ready') async ready(){
   const client=new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379',{lazyConnect:true,maxRetriesPerRequest:1,enableOfflineQueue:false,connectTimeout:1500,retryStrategy:()=>null,commandTimeout:1500});
   client.on('error',()=>undefined);
   try {
     await Promise.all([this.prisma.$queryRaw`SELECT 1`,client.connect()]);
     if(await client.ping()!=='PONG') throw new Error('redis');
     return {status:'ready',database:true,redis:true};
   } catch {throw new ServiceUnavailableException('dependência obrigatória indisponível');}
   finally {client.disconnect();}
 }
}
