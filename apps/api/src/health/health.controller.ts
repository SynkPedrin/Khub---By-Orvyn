import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators';
import { SkipRateLimit } from '../common/rate-limit.guard';
/**
 * UMA conexão persistente para o /ready (2026-11-14). Antes cada checagem do
 * Render (a cada poucos segundos) abria e fechava uma conexão nova: somada às
 * filas, estourava o limite de conexões do Redis gratuito e derrubava a API.
 */
let saude: Redis | null = null;
function redisDaSaude(): Redis {
  if (!saude) {
    saude = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: 2000, connectionName: 'khub-saude' });
    saude.on('error', () => undefined);
  }
  return saude;
}

@Public()
@SkipRateLimit()
@Controller()
export class HealthController {
 constructor(private readonly prisma:PrismaService) {}
 @Get('health') health(){return {status:'ok',service:'khub-api'};}
 @Get('ready') async ready(){
   try {
     const [, pong] = await Promise.all([this.prisma.$queryRaw`SELECT 1`, redisDaSaude().ping()]);
     if(pong!=='PONG') throw new Error('redis');
     return {status:'ready',database:true,redis:true};
   } catch {throw new ServiceUnavailableException('dependência obrigatória indisponível');}
 }
}
