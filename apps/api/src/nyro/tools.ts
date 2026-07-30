import { z } from 'zod';

/**
 * Conjunto **fechado** de tools da Nyro (ADR-0014 — fecha a LACUNA do PRD §5.1).
 *
 * Invariante do CLAUDE.md: *"Nyro é usuário, não deus"*. Ela nunca escreve no
 * banco: toda tool aqui vira chamada de serviço do CRM/automações, com as mesmas
 * validações, RLS e auditoria (`actor:'nyro'`). Tool que não está aqui não existe
 * — o modelo não a recebe e, se alucinar o nome, o executor recusa.
 */

/** Ações que mexem no mundo real pedem confirmação humana (PRD §5.1). */
export type Sensibilidade = 'leitura' | 'escrita' | 'sensivel';

export interface Tool {
  nome: string;
  descricao: string;
  schema: z.ZodTypeAny;
  sensibilidade: Sensibilidade;
  /** Como explicar ao humano o que será feito (tela de aprovação). */
  resumir: (args: Record<string, never>) => string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const t = <S extends z.ZodTypeAny>(
  nome: string,
  descricao: string,
  schema: S,
  sensibilidade: Sensibilidade,
  resumir: (a: z.infer<S>) => string,
): Tool => ({ nome, descricao, schema, sensibilidade, resumir: resumir as any });

export const TOOLS: Tool[] = [
  // ---------------- Leitura (livres: não mudam nada) ----------------
  t(
    'buscar_conhecimento',
    'Busca na base de conhecimento do nicho e da conta. Use SEMPRE antes de responder dúvida técnica, de preço, prazo ou protocolo.',
    z.object({ pergunta: z.string().min(3).max(400) }),
    'leitura',
    (a) => `buscar "${a.pergunta}" no conhecimento`,
  ),
  t(
    'resumo_do_funil',
    'Números atuais do CRM: contatos, negócios por etapa, valor no funil, taxa de conversão.',
    z.object({}),
    'leitura',
    () => 'ler o resumo do funil',
  ),
  t(
    'buscar_contatos',
    'Procura contatos por nome, e-mail, telefone, empresa ou tag.',
    z.object({ termo: z.string().min(2).max(80) }),
    'leitura',
    (a) => `procurar contatos com "${a.termo}"`,
  ),
  t(
    'ver_contato',
    'Perfil 360 de um contato: dados, negócios, conversas, tarefas e histórico.',
    z.object({ contactId: z.string().uuid() }),
    'leitura',
    () => 'abrir o perfil do contato',
  ),
  t(
    'listar_automacoes',
    'Lista as automações do tenant, com status e número de execuções/falhas.',
    z.object({}),
    'leitura',
    () => 'listar as automações',
  ),

  // ---------------- Escrita (efeito interno, reversível) ----------------
  t(
    'criar_contato',
    'Cadastra um contato novo no CRM.',
    z.object({
      nome: z.string().min(1).max(160),
      email: z.string().email().optional(),
      telefone: z.string().max(40).optional(),
      empresa: z.string().max(160).optional(),
      tag: z.string().max(40).optional(),
    }),
    'escrita',
    (a) => `criar o contato "${a.nome}"`,
  ),
  t(
    'atualizar_contato',
    'Altera um campo do contato (nome, email, telefone, empresa, tag ou valor estimado).',
    z.object({
      contactId: z.string().uuid(),
      campo: z.enum(['nome', 'email', 'telefone', 'empresa', 'tag', 'valorEstimado']),
      valor: z.string().max(200),
    }),
    'escrita',
    (a) => `mudar ${a.campo} do contato para "${a.valor}"`,
  ),
  t(
    'criar_tarefa',
    'Abre uma tarefa para a equipe, opcionalmente ligada a um contato.',
    z.object({
      titulo: z.string().min(1).max(200),
      contactId: z.string().uuid().optional(),
      prioridade: z.enum(['baixa', 'media', 'alta']).default('media'),
      emDias: z.number().int().min(0).max(90).default(0),
    }),
    'escrita',
    (a) => `criar a tarefa "${a.titulo}"`,
  ),
  t(
    'adicionar_nota',
    'Registra uma nota no histórico do contato.',
    z.object({ contactId: z.string().uuid(), corpo: z.string().min(1).max(2000) }),
    'escrita',
    () => 'adicionar uma nota no contato',
  ),
  t(
    'criar_oportunidade',
    'Cria um negócio no funil para um contato.',
    z.object({
      titulo: z.string().min(1).max(200),
      contactId: z.string().uuid(),
      stageId: z.string().uuid(),
      valor: z.number().min(0).optional(),
    }),
    'escrita',
    (a) => `criar a oportunidade "${a.titulo}"`,
  ),
  t(
    'lembrar',
    'Guarda um fato do negócio na memória da conta (ticket médio, tom de voz, horário...). Use quando o usuário informar algo que vale para sempre.',
    z.object({ chave: z.string().min(2).max(60), valor: z.string().min(1).max(400) }),
    'escrita',
    (a) => `lembrar que ${a.chave} = "${a.valor}"`,
  ),

  // ---------------- Configuração do CRM (a Nyro monta) ----------------
  t(
    'criar_funil',
    'Cria um novo funil (pipeline) com as etapas informadas. Use na configuração inicial do CRM, adaptando as etapas ao processo comercial do cliente.',
    z.object({ nome: z.string().min(1).max(80), etapas: z.array(z.string().min(1).max(60)).min(2).max(12) }),
    'escrita',
    (a) => `criar o funil "${a.nome}" (${a.etapas.join(' → ')})`,
  ),
  t(
    'criar_etapa',
    'Adiciona uma etapa ao fim de um funil existente.',
    z.object({ pipelineId: z.string().uuid(), nome: z.string().min(1).max(60), cor: z.string().max(9).optional() }),
    'escrita',
    (a) => `adicionar a etapa "${a.nome}" ao funil`,
  ),

  // ---------------- Sensível (pede aprovação humana) ----------------
  t(
    'instalar_automacao',
    'Procura no marketplace um template de automação pela descrição e instala (cria e PUBLICA um fluxo ativo). Pede aprovação humana.',
    z.object({ busca: z.string().min(2).max(120) }),
    'sensivel',
    (a) => `instalar uma automação para: "${a.busca}"`,
  ),
  t(
    'aplicar_blueprint',
    'Configura o CRM INTEIRO a partir de um blueprint de nicho: cria o funil com as etapas certas e instala as automações recomendadas. Use no onboarding depois de descobrir o nicho. Chaves: saude.odontologia, juridico.advocacia, contabil.escritorio.',
    z.object({ blueprint: z.string().min(3).max(60) }),
    'sensivel',
    (a) => `configurar o CRM inteiro com o blueprint "${a.blueprint}"`,
  ),
  t(
    'enviar_mensagem',
    'Envia mensagem no WhatsApp para um contato. SEMPRE pede aprovação do humano antes.',
    z.object({ contactId: z.string().uuid(), texto: z.string().min(1).max(1000) }),
    'sensivel',
    (a) => `enviar WhatsApp: "${a.texto.slice(0, 80)}${a.texto.length > 80 ? '…' : ''}"`,
  ),
  t(
    'mover_etapa',
    'Move um negócio para outra etapa do funil.',
    z.object({ dealId: z.string().uuid(), stageId: z.string().uuid() }),
    'sensivel',
    () => 'mover o negócio de etapa',
  ),
  t(
    'mudar_status_automacao',
    'Ativa ou pausa uma automação. Mexer em automação ativa afeta todo mundo que está nela.',
    z.object({ workflowId: z.string().uuid(), status: z.enum(['ativo', 'pausado']) }),
    'sensivel',
    (a) => `${a.status === 'ativo' ? 'ATIVAR' : 'PAUSAR'} uma automação`,
  ),
];

export const TOOLS_POR_NOME = new Map(TOOLS.map((x) => [x.nome, x]));

/** Formato de tool que a API da Anthropic espera. */
export function paraAnthropic(tools: Tool[]): { name: string; description: string; input_schema: Record<string, unknown> }[] {
  return tools.map((x) => ({
    name: x.nome,
    description: x.descricao,
    input_schema: zodParaJsonSchema(x.schema),
  }));
}

/**
 * Zod → JSON Schema, só para o subconjunto que as tools usam (object de campos
 * planos). Suficiente e sem dependência nova; se uma tool precisar de estrutura
 * aninhada, isto aqui tem que crescer junto — por isso lança em vez de gerar
 * schema silenciosamente errado.
 */
export function zodParaJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as z.ZodObject<z.ZodRawShape>)._def;
  if (def.typeName !== z.ZodFirstPartyTypeKind.ZodObject) throw new Error('tool precisa ser um z.object');

  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [chave, campoBruto] of Object.entries(shape)) {
    let campo = campoBruto as z.ZodTypeAny;
    let obrigatorio = true;

    // desembrulha optional/default até achar o tipo base
    for (;;) {
      const tn = (campo as z.ZodTypeAny)._def.typeName;
      if (tn === z.ZodFirstPartyTypeKind.ZodOptional || tn === z.ZodFirstPartyTypeKind.ZodDefault) {
        obrigatorio = false;
        campo = (campo._def as { innerType: z.ZodTypeAny }).innerType;
        continue;
      }
      break;
    }

    properties[chave] = tipoJson(campo);
    if (obrigatorio) required.push(chave);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

function tipoJson(campo: z.ZodTypeAny): Record<string, unknown> {
  const tn = campo._def.typeName;
  if (tn === z.ZodFirstPartyTypeKind.ZodString) return { type: 'string' };
  if (tn === z.ZodFirstPartyTypeKind.ZodNumber) return { type: 'number' };
  if (tn === z.ZodFirstPartyTypeKind.ZodBoolean) return { type: 'boolean' };
  if (tn === z.ZodFirstPartyTypeKind.ZodEnum) return { type: 'string', enum: (campo._def as { values: string[] }).values };
  if (tn === z.ZodFirstPartyTypeKind.ZodArray) return { type: 'array', items: tipoJson((campo._def as { type: z.ZodTypeAny }).type) };
  throw new Error(`tipo de campo não suportado nas tools: ${tn}`);
}
