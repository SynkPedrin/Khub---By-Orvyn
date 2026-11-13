/**
 * Roda o golden set contra a NICO REAL (modelo configurado) e imprime o relatório.
 *
 *   NICO_EVAL_TENANT=<uuid do tenant de TESTE> NICO_EVAL_IDENTITY=<uuid de um usuário dele> \
 *   pnpm --filter @khub/api build && pnpm --filter @khub/api nico:eval
 *
 * Segurança: exige NICO_EVAL_TENANT explícito (nunca roda "no tenant que der").
 * Os casos só leem ou viram aprovação, mas escrevem conversa e memória: use tenant de teste.
 * Opções: NICO_EVAL_MIN=70 (nota mínima, padrão 70) · NICO_EVAL_SO=id1,id2 (subconjunto).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'node:fs';
import { loadEnv } from '../../config/env';
import { CASOS } from './casos';
import { avaliar, resumir, type ResultadoCaso } from './avaliador';

async function main(): Promise<void> {
  const tenantId = process.env.NICO_EVAL_TENANT;
  const identityId = process.env.NICO_EVAL_IDENTITY;
  if (!tenantId || !identityId) throw new Error('defina NICO_EVAL_TENANT e NICO_EVAL_IDENTITY (tenant de TESTE; nunca de cliente real)');
  loadEnv();
  const { AppModule } = await import('../../app.module');
  const { NyroService } = await import('../nyro.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const nyro = app.get(NyroService);
  if (!nyro.configurada()) throw new Error(`NICO sem credencial: faltam ${nyro.missing().join(', ')}`);

  const so = process.env.NICO_EVAL_SO?.split(',').map((x) => x.trim()).filter(Boolean);
  const casos = so?.length ? CASOS.filter((c) => so.includes(c.id)) : CASOS;
  const resultados: ResultadoCaso[] = [];
  for (const c of casos) {
    const t0 = Date.now();
    try {
      const r = await nyro.conversar({ tenantId, identityId }, c.entrada);
      const res = avaliar(c, { texto: r.texto, tools: r.ferramentas, aprovacoes: r.aprovacoes.length });
      resultados.push(res);
      process.stdout.write(`${res.passou ? '✅' : '❌'} ${c.id} (${((Date.now() - t0) / 1000).toFixed(1)}s)${res.passou ? '' : `\n     - ${res.falhas.join('\n     - ')}`}\n`);
    } catch (e) {
      resultados.push({ id: c.id, categoria: c.categoria, passou: false, falhas: [`erro: ${(e as Error).message.slice(0, 160)}`] });
      process.stdout.write(`❌ ${c.id}: erro ${(e as Error).message.slice(0, 160)}\n`);
    }
  }
  const resumo = resumir(resultados);
  const arq = `nico-eval-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  writeFileSync(arq, JSON.stringify({ modelo: process.env.NICO_MODELO ?? 'padrão', resumo, resultados }, null, 2));
  process.stdout.write(`\nNota: ${resumo.nota}/100 (${resumo.passaram}/${resumo.total}) · ${JSON.stringify(resumo.porCategoria)}\nRelatório: ${arq}\n`);
  await app.close();
  process.exit(resumo.nota >= Number(process.env.NICO_EVAL_MIN ?? 70) ? 0 : 1);
}
void main().catch((e: Error) => {
  process.stderr.write(`${e.message}\n`);
  process.exit(2);
});
