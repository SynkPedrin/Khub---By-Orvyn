import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventsService } from '../events/domain-events.service';
import { acharContatoPorTelefone, soDigitos } from './telefone';

/** Linha já mapeada pelo front (coluna do CSV → campo do KHUB). Tudo texto. */
export interface LinhaImportacao {
  nome?: string;
  primeiroNome?: string;
  sobrenome?: string;
  telefone?: string;
  email?: string;
  empresa?: string;
  cargo?: string;
  tags?: string;
  origem?: string;
  valor?: string;
  cidade?: string;
  observacao?: string;
  /** chave → valor (campos personalizados). */
  campos?: Record<string, string>;
}

export interface OpcoesImportacao {
  /** Contato já existente (mesmo e-mail ou telefone): completa só o que está vazio + soma tags. */
  atualizarExistentes?: boolean;
  /** Tag aplicada a todos (ex.: "importado-ghl"). */
  tagExtra?: string;
  /** Origem gravada no contato (ex.: "migracao_ghl", "planilha"). */
  origem?: string;
  /** false (padrão): a importação NÃO dispara automações, agentes nem mensagens. */
  dispararAutomacoes?: boolean;
  /** Se informado, cria um negócio aberto nesta etapa para cada contato NOVO. */
  stageId?: string;
}

export interface ResultadoImportacao {
  total: number;
  criados: number;
  atualizados: number;
  ignorados: number;
  negociosCriados: number;
  eventosNeutralizados: number;
  erros: { linha: number; motivo: string }[];
}

export const MAX_LINHAS_POR_LOTE = 500;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CHAVE_CAMPO = /^[a-zA-Z][a-zA-Z0-9_]{0,59}$/;

const limpo = (v: string | undefined, max: number) => {
  const s = (v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

/** "1.234,56" / "1234.56" / "R$ 1.234" → número; inválido → null. */
export function valorBR(v: string | undefined): number | null {
  const s = (v ?? '').replace(/[^\d,.-]/g, '');
  if (!s) return null;
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** Normaliza e valida UMA linha. Lança Error com motivo legível. */
export function normalizarLinha(l: LinhaImportacao) {
  const nome = limpo(l.nome, 160) ?? limpo([l.primeiroNome, l.sobrenome].filter(Boolean).join(' '), 160);
  const emailBruto = limpo(l.email, 200)?.toLowerCase() ?? null;
  const email = emailBruto && EMAIL.test(emailBruto) ? emailBruto : null;
  const digitos = soDigitos(l.telefone);
  const telefone = digitos.length >= 10 ? (digitos.length <= 11 ? `55${digitos}` : digitos).slice(0, 15) : null;
  if (!nome && !email && !telefone) throw new Error('linha sem nome, e-mail ou telefone');
  if (emailBruto && !email && !telefone && !nome) throw new Error(`e-mail inválido: ${emailBruto}`);
  const tags = [...new Set((l.tags ?? '').split(/[,;|]/).map((t) => t.trim()).filter((t) => t && t.length <= 40))].slice(0, 30);
  const campos: Record<string, string> = {};
  for (const [k, v] of Object.entries(l.campos ?? {})) {
    const valor = limpo(v, 500);
    if (valor && CHAVE_CAMPO.test(k)) campos[k] = valor;
  }
  if (limpo(l.cidade, 120)) campos.cidade = limpo(l.cidade, 120)!;
  if (limpo(l.observacao, 500)) campos.observacao_importacao = limpo(l.observacao, 500)!;
  return {
    nome: nome ?? email ?? telefone!,
    email, telefone,
    empresa: limpo(l.empresa, 160),
    cargo: limpo(l.cargo, 120),
    origem: limpo(l.origem, 80),
    valor: valorBR(l.valor),
    tags, campos,
  };
}

/**
 * Importação de contatos por planilha/CSV (ADR-0042), incluindo exportações
 * do GHL (o mapeamento de colunas é feito no front).
 *
 * Regras:
 *  - mesma pessoa = mesmo e-mail OU mesmo telefone (o MESMO helper do Inbox,
 *    senão importação e WhatsApp discordariam e duplicariam contato — BUG-012);
 *  - existente: completa só campos vazios e soma tags (nunca sobrescreve dado
 *    que a equipe já corrigiu); com `atualizarExistentes=false`, é ignorado;
 *  - por padrão NADA dispara: os gatilhos do banco geram eventos de outbox
 *    (contato criado, tag adicionada, negócio criado) e os desta transação
 *    viram `processed` — 500 contatos importados não recebem 500 boas-vindas;
 *  - lote de até 500 linhas por chamada, cada lote numa transação.
 */
@Injectable()
export class ImportacaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: DomainEventsService,
  ) {}

  async importarContatos(tenantId: string, identityId: string, linhas: LinhaImportacao[], opcoes: OpcoesImportacao = {}, linhaInicial = 1): Promise<ResultadoImportacao> {
    if (!Array.isArray(linhas) || !linhas.length) throw new BadRequestException('nenhuma linha para importar');
    if (linhas.length > MAX_LINHAS_POR_LOTE) throw new BadRequestException(`no máximo ${MAX_LINHAS_POR_LOTE} linhas por lote`);
    const tagExtra = limpo(opcoes.tagExtra, 40);
    const origemPadrao = limpo(opcoes.origem, 80) ?? 'importacao_csv';
    const atualizar = opcoes.atualizarExistentes !== false;
    const res: ResultadoImportacao = { total: linhas.length, criados: 0, atualizados: 0, ignorados: 0, negociosCriados: 0, eventosNeutralizados: 0, erros: [] };
    const criadosIds: { id: string; nome: string; origem: string }[] = [];

    await this.prisma.withTenant(tenantId, async (tx) => {
      const etapa = opcoes.stageId ? await tx.stage.findUnique({ where: { id: opcoes.stageId }, select: { id: true, pipelineId: true } }) : null;
      if (opcoes.stageId && !etapa) throw new NotFoundException('etapa do funil inexistente');

      for (let i = 0; i < linhas.length; i++) {
        const nLinha = linhaInicial + i;
        let dado: ReturnType<typeof normalizarLinha>;
        try {
          dado = normalizarLinha(linhas[i] ?? {});
        } catch (e) {
          res.erros.push({ linha: nLinha, motivo: (e as Error).message });
          continue;
        }
        const tags = tagExtra && !dado.tags.some((t) => t.toLowerCase() === tagExtra.toLowerCase()) ? [...dado.tags, tagExtra] : dado.tags;
        const origem = dado.origem ?? origemPadrao;
        try {
          const existenteId = (dado.email ? (await tx.contact.findFirst({ where: { email: { equals: dado.email, mode: 'insensitive' } }, select: { id: true } }))?.id : null)
            ?? (dado.telefone ? await acharContatoPorTelefone(tx, dado.telefone) : null);

          if (existenteId) {
            if (!atualizar) { res.ignorados++; continue; }
            const atual = await tx.contact.findUniqueOrThrow({ where: { id: existenteId }, select: { email: true, telefone: true, empresa: true, cargo: true, origem: true, tags: true, camposCustom: true, valorEstimado: true } });
            const custom = (atual.camposCustom && typeof atual.camposCustom === 'object' ? atual.camposCustom : {}) as Record<string, unknown>;
            const novosCampos = Object.fromEntries(Object.entries(dado.campos).filter(([k]) => custom[k] === undefined || custom[k] === ''));
            const tagsFinais = [...atual.tags, ...tags.filter((t) => !atual.tags.some((x) => x.toLowerCase() === t.toLowerCase()))];
            await tx.contact.update({
              where: { id: existenteId },
              data: {
                email: atual.email ? undefined : dado.email,
                telefone: atual.telefone ? undefined : dado.telefone,
                empresa: atual.empresa ? undefined : dado.empresa,
                cargo: atual.cargo ? undefined : dado.cargo,
                origem: atual.origem ? undefined : origem,
                valorEstimado: Number(atual.valorEstimado) > 0 || dado.valor === null ? undefined : dado.valor,
                tags: tagsFinais.length !== atual.tags.length ? tagsFinais : undefined,
                camposCustom: Object.keys(novosCampos).length ? ({ ...custom, ...novosCampos } as Prisma.InputJsonValue) : undefined,
                updatedAt: new Date(),
              },
            });
            res.atualizados++;
            continue;
          }

          const c = await tx.contact.create({
            data: {
              tenantId, nome: dado.nome, email: dado.email, telefone: dado.telefone, empresa: dado.empresa, cargo: dado.cargo,
              origem, tag: 'Lead', tags, valorEstimado: dado.valor ?? 0,
              camposCustom: { ...dado.campos, origem } as Prisma.InputJsonValue,
            },
            select: { id: true, nome: true },
          });
          res.criados++;
          criadosIds.push({ id: c.id, nome: c.nome, origem });
          if (etapa) {
            await tx.deal.create({ data: { tenantId, titulo: dado.nome, contactId: c.id, pipelineId: etapa.pipelineId, stageId: etapa.id, valor: dado.valor ?? 0, origem } });
            res.negociosCriados++;
          }
        } catch (e) {
          res.erros.push({ linha: nLinha, motivo: `não gravado: ${(e as Error).message.split('\n').pop()?.slice(0, 160) ?? 'erro'}` });
          // Uma linha ruim não pode deixar a transação abortada para as próximas.
          throw Object.assign(new Error('linha_invalida'), { linha: nLinha, cause: e });
        }
      }

      if (!opcoes.dispararAutomacoes) {
        res.eventosNeutralizados = Number(await tx.$executeRaw`UPDATE outbox_events SET status = 'processed', processed_at = now(), last_error = 'importacao_csv: não dispara automação'
          WHERE tenant_id = ${tenantId}::uuid AND status = 'pending' AND created_at = now()`);
      }
      await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `importou ${res.criados} contato(s) e atualizou ${res.atualizados} por planilha`, tone: 'neutral' } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'contacts.import', 'contact', NULL,
                ${JSON.stringify({ criados: res.criados, atualizados: res.atualizados, ignorados: res.ignorados, erros: res.erros.length, origem: origemPadrao, dispararAutomacoes: !!opcoes.dispararAutomacoes })}::jsonb)`;
    }, { timeout: 60_000 }).catch((e: Error & { linha?: number }) => {
      if (e.message === 'linha_invalida') {
        throw new BadRequestException(`a linha ${e.linha} não pôde ser gravada (${res.erros.at(-1)?.motivo ?? 'erro'}); nada deste lote foi salvo. Corrija ou remova a linha e importe de novo.`);
      }
      throw e;
    });

    // Atualiza as telas abertas (o socket não dispara automação; ver opcoes).
    for (const c of criadosIds.slice(0, 50)) this.eventos.publicar(tenantId, 'contact.created', c);
    return res;
  }
}
