import { z } from 'zod';
import { CAMPOS_PERFIL, IDS_INTENCOES_BASE, TIPOS_OBJECAO, type CampoPerfil } from '../config/agent-config';

/**
 * ANÁLISE ESTRUTURADA DE UMA MENSAGEM (Intelligence Core · ciclo §9.1, passos 5–8)
 * ===============================================================================
 *
 * Contrato único do que o motor sabe sobre a mensagem do contato. Produzido
 * pelo modelo via *structured outputs* (`output_config.format`) e, quando a IA
 * não está disponível ou a análise falha, pelo classificador determinístico
 * abaixo — o resto do pipeline (regras, perfil, follow-up, analytics) nunca
 * fica sem análise.
 *
 * Diferença fundamental: `extracoes[].origem`
 *   - `declarado` — o contato DISSE (ex.: "meu e-mail é…");
 *   - `inferido`  — o modelo DEDUZIU (ex.: temperatura "quente").
 * Inferência nunca sobrescreve fato confirmado (ver profile-policy.ts).
 */

export const extracaoSchema = z.object({
  campo: z.enum(CAMPOS_PERFIL),
  valor: z.string().min(1).max(400),
  origem: z.enum(['declarado', 'inferido']),
  confianca: z.number().min(0).max(1),
});
export type Extracao = z.infer<typeof extracaoSchema>;

export const analiseSchema = z.object({
  intencao: z.string().min(2).max(40),
  intencoesSecundarias: z.array(z.string().max(40)).max(3),
  confiancaIntencao: z.number().min(0).max(1),
  problema: z.string().max(300),
  objecoes: z.array(z.enum(TIPOS_OBJECAO)).max(4),
  sentimento: z.enum(['positivo', 'neutro', 'negativo']),
  urgencia: z.enum(['baixa', 'media', 'alta']),
  temperatura: z.enum(['fria', 'morna', 'quente']),
  interesse: z.string().max(160),
  precisaConhecimento: z.boolean(),
  pedeHumano: z.boolean(),
  consultaBase: z.string().max(300),
  extracoes: z.array(extracaoSchema).max(12),
  proximoPasso: z.string().max(300),
});
export type Analise = z.infer<typeof analiseSchema> & { fonte: 'modelo' | 'heuristica' };

/**
 * JSON Schema para `output_config.format`. Restrições de tamanho/número NÃO
 * são suportadas pelo structured outputs (skill claude-api) — ficam no Zod,
 * validado depois da resposta.
 */
export function analiseJsonSchema(intencoes: readonly string[]): Record<string, unknown> {
  const str = { type: 'string' };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['intencao', 'intencoesSecundarias', 'confiancaIntencao', 'problema', 'objecoes', 'sentimento', 'urgencia', 'temperatura', 'interesse', 'precisaConhecimento', 'pedeHumano', 'consultaBase', 'extracoes', 'proximoPasso'],
    properties: {
      intencao: { type: 'string', enum: [...intencoes] },
      intencoesSecundarias: { type: 'array', items: { type: 'string', enum: [...intencoes] } },
      confiancaIntencao: { type: 'number' },
      problema: str,
      objecoes: { type: 'array', items: { type: 'string', enum: [...TIPOS_OBJECAO] } },
      sentimento: { type: 'string', enum: ['positivo', 'neutro', 'negativo'] },
      urgencia: { type: 'string', enum: ['baixa', 'media', 'alta'] },
      temperatura: { type: 'string', enum: ['fria', 'morna', 'quente'] },
      interesse: str,
      precisaConhecimento: { type: 'boolean' },
      pedeHumano: { type: 'boolean' },
      consultaBase: str,
      extracoes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['campo', 'valor', 'origem', 'confianca'],
          properties: {
            campo: { type: 'string', enum: [...CAMPOS_PERFIL] },
            valor: str,
            origem: { type: 'string', enum: ['declarado', 'inferido'] },
            confianca: { type: 'number' },
          },
        },
      },
      proximoPasso: str,
    },
  };
}

// ------------------------------------------------------------------ heurística

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Padrões por intenção (texto normalizado, sem acento). Ordem = prioridade de desempate. */
const PADROES_INTENCAO: [string, RegExp, number][] = [
  ['solicitacao_humana', /\b(falar com (um|uma|alguem|atendente|humano|pessoa|gerente|responsavel)|atendente|humano de verdade|pessoa real|quero (um|uma) (humano|pessoa))\b/, 3],
  ['cancelamento', /\b(cancelar|cancelamento|desistir|desisto|encerrar (o )?contrato|quero sair|reembolso|estorno)\b/, 3],
  ['reclamacao', /\b(reclama|absurdo|pessim|horrivel|descaso|insatisfeit|nao funcion|nao resolve|procon|reclame aqui|vergonha|decepcion|enganad)\w*/, 3],
  // Reclamação de atendimento em linguagem de WhatsApp ("tô chateada, ninguém me atendeu").
  ['reclamacao', /\b(chatead|irritad|frustrad|desrespeit|falta de respeito|mal atendid|ninguem (me )?(atendeu|respondeu|retornou|deu retorno)|fiquei esperando|fiquei plantad|me deixaram esperando|nao me (atenderam|responderam|retornaram)|esperando ha \d+)\w*/, 3],
  ['agendamento', /\b(agendar|agendamento|marcar|horario|horarios|disponibilidade|consulta (dia|amanha|hoje)|remarcar|que dia|qual dia|vaga)\b/, 2],
  ['orcamento', /\b(orcamento|proposta|cotacao|cotar|quanto (custa|fica|sai|e|eh|ta|esta|cobra)|qual (o )?(valor|preco)|valores|precos|tabela de preco|investimento)\b/, 2],
  ['compra', /\b(quero (comprar|contratar|fechar|assinar|fazer)|vou (comprar|contratar|fechar)|como (faco|faz) (pra|para) (comprar|contratar|pagar)|fechado|pode (mandar|enviar) (o )?(link|pix|boleto)|forma de pagamento|parcel)\w*/, 2],
  ['negociacao', /\b(desconto|negociar|melhor preco|consegue (fazer|baixar)|abaixar|condicao especial|a vista|parcelar em)\b/, 2],
  ['comparacao', /\b(diferenca entre|comparar|comparando|melhor que|versus|vs\.?|concorrente|outra (empresa|clinica)|em outro lugar)\b/, 2],
  ['desinteresse', /\b(nao (tenho|tenho mais) interesse|nao quero|sem interesse|nao preciso|nao e pra mim|para de (mandar|enviar)|nao me (mande|envie))\b/, 2],
  ['suporte', /\b(problema com|nao consigo|erro|bug|ajuda com|suporte|parou de|nao esta funcionando|acesso|senha)\b/, 1],
  ['objecao', /\b(caro|muito caro|vou pensar|nao sei se|nao tenho tempo|depois eu vejo|mais pra frente|nao confio|sera que funciona|preciso falar com (meu|minha))\b/, 1],
  ['interesse', /\b(tenho interesse|me interessei|gostaria de saber|queria saber|quero saber|me fala mais|como funciona|vi o anuncio|vi no instagram|vi voces)\b/, 1],
  ['duvida', /\?|\b(como|qual|quais|quando|onde|por que|porque|pode me (explicar|dizer)|duvida)\b/, 1],
  ['saudacao', /^(oi+|ola|opa|bom dia|boa tarde|boa noite|e ai|tudo bem)\W*$/, 1],
];

const PADROES_OBJECAO: [Analise['objecoes'][number], RegExp][] = [
  ['preco', /\b(caro|muito caro|salgado|fora do (meu )?orcamento|nao tenho (dinheiro|condicoes)|sem grana|preco alto|ta puxado|esta puxado)\b/],
  ['tempo', /\b(nao tenho tempo|sem tempo|correria|agenda cheia)\b/],
  ['confianca', /\b(nao confio|sera que funciona|tenho medo|e seguro|golpe|garantia)\b/],
  ['concorrente', /\b(concorrente|outra (empresa|clinica|opcao)|em outro lugar|mais barato em|ja tenho (um|uma))\b/],
  ['necessidade', /\b(nao preciso|nao sei se preciso|nao vejo necessidade)\b/],
  ['decisor', /\b(falar com (meu|minha) (marido|esposa|socio|chefe|familia|mae|pai)|preciso consultar|nao decido sozinh)\w*/],
  ['adiamento', /\b(vou pensar|depois eu vejo|mais pra frente|mes que vem|outra hora|agora nao|deixa pra depois)\b/],
];

const NEGATIVAS = /\b(pessim|horrivel|raiva|irritad|chatead|absurdo|decepcion|triste|frustrad|cansad de|nunca mais|ruim|lixo|descaso|demora)\w*/;
const POSITIVAS = /\b(otimo|excelente|perfeito|maravilh|adorei|amei|obrigad|show|top|legal|gostei|incrivel|massa|valeu)\w*/;
const URGENTE = /\b(urgente|urgencia|emergencia|agora|hoje|imediat|o quanto antes|rapido|socorro|muita dor|sangr)\w*/;
const MEDIA_URG = /\b(essa semana|amanha|logo|em breve|proxim(o|a) (semana|dias))\b/;

const RE_EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const RE_NOME = /(?:[Mm]eu nome (?:é|e|eh)|[Mm]e chamo|[Aa]qui (?:é|e|eh) (?:o|a))\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ú][a-zà-ú]+){0,3})/;
const RE_EMPRESA = /\b(?:trabalho n[ao]|sou d[ao]|empresa (?:chamada|e|eh)|minha empresa (?:e|eh|se chama))\s+([\wà-ú&.\- ]{2,60}?)(?=[,.!?]|$)/i;
const RE_ORCAMENTO = /\b(?:ate|uns|cerca de|por volta de|no maximo|orcamento (?:de|e))\s*r?\$?\s*([\d.]+(?:,\d{2})?)\s*(mil|k|reais)?/;

/**
 * Classificador determinístico. Barato, auditável e sempre disponível — o
 * fallback quando a IA está sem credencial, fora do ar ou com orçamento
 * esgotado. Não substitui o modelo: a confiança dele é deliberadamente baixa.
 */
export function analisarHeuristica(mensagem: string, intencoesExtras: { chave: string; exemplos: string[] }[] = []): Analise {
  const t = norm(mensagem.trim());
  const pontos = new Map<string, number>();
  for (const [intencao, re, peso] of PADROES_INTENCAO) if (re.test(t)) pontos.set(intencao, (pontos.get(intencao) ?? 0) + peso);
  for (const extra of intencoesExtras) {
    if (extra.exemplos.some((e) => e.trim() && t.includes(norm(e.trim())))) pontos.set(extra.chave, (pontos.get(extra.chave) ?? 0) + 3);
  }
  const ordenadas = [...pontos.entries()].sort((a, b) => b[1] - a[1]);
  const objecoes = PADROES_OBJECAO.filter(([, re]) => re.test(t)).map(([o]) => o);
  if (objecoes.length && !pontos.has('objecao')) ordenadas.push(['objecao', 1]);
  const intencao = ordenadas[0]?.[0] ?? (t.length < 4 ? 'saudacao' : 'duvida');
  const sentimento: Analise['sentimento'] = NEGATIVAS.test(t) ? 'negativo' : POSITIVAS.test(t) ? 'positivo' : 'neutro';
  const urgencia: Analise['urgencia'] = URGENTE.test(t) ? 'alta' : MEDIA_URG.test(t) ? 'media' : 'baixa';
  const temperatura: Analise['temperatura'] = ['compra', 'agendamento', 'negociacao'].includes(intencao)
    ? 'quente'
    : ['orcamento', 'interesse', 'comparacao', 'objecao'].includes(intencao)
      ? 'morna'
      : 'fria';

  const extracoes: Extracao[] = [];
  const email = mensagem.match(RE_EMAIL)?.[0];
  if (email) extracoes.push({ campo: 'email', valor: email.toLowerCase(), origem: 'declarado', confianca: 0.95 });
  const nome = mensagem.match(RE_NOME)?.[1];
  if (nome) extracoes.push({ campo: 'nome', valor: nome.trim(), origem: 'declarado', confianca: 0.85 });
  const empresa = mensagem.match(RE_EMPRESA)?.[1];
  if (empresa) extracoes.push({ campo: 'empresa', valor: empresa.trim(), origem: 'declarado', confianca: 0.7 });
  const orc = t.match(RE_ORCAMENTO);
  if (orc) extracoes.push({ campo: 'orcamento', valor: `R$ ${orc[1]}${orc[2] && /mil|k/.test(orc[2]) ? ' mil' : ''}`, origem: 'declarado', confianca: 0.7 });
  if (objecoes.length) extracoes.push({ campo: 'objecoes', valor: objecoes.join(', '), origem: 'inferido', confianca: 0.6 });
  extracoes.push({ campo: 'temperatura', valor: temperatura, origem: 'inferido', confianca: 0.45 });

  return {
    fonte: 'heuristica',
    intencao,
    intencoesSecundarias: ordenadas.slice(1, 3).map(([i]) => i),
    confiancaIntencao: ordenadas.length ? Math.min(0.65, 0.35 + 0.1 * ordenadas[0][1]) : 0.25,
    problema: '',
    objecoes,
    sentimento,
    urgencia,
    temperatura,
    interesse: '',
    precisaConhecimento: ['duvida', 'orcamento', 'compra', 'agendamento', 'comparacao', 'objecao', 'suporte'].includes(intencao),
    pedeHumano: intencao === 'solicitacao_humana',
    consultaBase: mensagem.trim().slice(0, 300),
    extracoes,
    proximoPasso: '',
  };
}

/** Intenções válidas para um tenant: base + personalizadas ativas. */
export function intencoesValidas(extras: { chave: string }[]): string[] {
  return [...IDS_INTENCOES_BASE, ...extras.map((e) => e.chave).filter((c) => !(IDS_INTENCOES_BASE as readonly string[]).includes(c))];
}

/** Garante que a análise do modelo só usa valores conhecidos (defesa extra ao schema). */
export function sanearAnalise(a: Analise, intencoes: readonly string[]): Analise {
  const ok = new Set(intencoes);
  const campos = new Set<string>(CAMPOS_PERFIL);
  return {
    ...a,
    intencao: ok.has(a.intencao) ? a.intencao : 'duvida',
    intencoesSecundarias: a.intencoesSecundarias.filter((i) => ok.has(i) && i !== a.intencao),
    confiancaIntencao: Math.min(1, Math.max(0, a.confiancaIntencao)),
    extracoes: a.extracoes
      .filter((e) => campos.has(e.campo) && e.valor.trim())
      .map((e) => ({ ...e, valor: e.valor.trim().slice(0, 400), confianca: Math.min(1, Math.max(0, e.confianca)) as number, campo: e.campo as CampoPerfil })),
  };
}
