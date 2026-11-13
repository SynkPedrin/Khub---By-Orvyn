import type { Prisma } from '@prisma/client';
import { validarConfig, type Grafo, type No, type TipoNo } from './catalogo';
import type { ProblemaGrafo } from './workflows.service';

/**
 * Validação de publicação que precisa do BANCO (Q3.1/Q3.2): o schema do nó diz
 * "é um uuid", só o banco diz "esse usuário ainda é da conta" ou "esse campo
 * personalizado existe e é de data". Mesma regra do `validar()`: o que passa
 * daqui executa — sem fluxo publicado que morre no primeiro contato.
 */
export async function validarReferencias(tx: Prisma.TransactionClient, tenantId: string, grafo: Grafo): Promise<ProblemaGrafo[]> {
  const problemas: ProblemaGrafo[] = [];
  const camposContato = new Map<string, string>();
  const camposNegocio = new Map<string, string>();
  const usuarios = new Map<string, string>(); // identityId → noId
  const fluxos = new Map<string, string>();
  const motivos = new Map<string, string>();
  const etapas = new Map<string, string>();
  const nome = (no: No) => no.rotulo ?? no.tipo;

  const pedirCampo = (no: No, ref: string, exigeData: boolean) => {
    const m = /^(contato|negocio)\.campos\.([a-z][a-z0-9_]{0,49})$/.exec(ref);
    if (!m) return;
    (m[1] === 'contato' ? camposContato : camposNegocio).set(`${m[2]}|${exigeData ? 'date' : ''}|${no.id}`, nome(no));
  };

  for (const no of grafo.nos) {
    const v = validarConfig(no.tipo as TipoNo, no.config);
    if (!v.ok) continue; // o validar() síncrono já reporta
    const c = v.dados as Record<string, unknown>;
    switch (no.tipo as TipoNo) {
      case 'acao.atualizar_contato':
        for (const x of (c.campos as { chave: string }[]) ?? []) pedirCampo(no, `contato.campos.${x.chave}`, false);
        break;
      case 'acao.atualizar_negocio':
        for (const x of (c.campos as { chave: string }[]) ?? []) pedirCampo(no, `negocio.campos.${x.chave}`, false);
        if (c.dono === 'usuario' && typeof c.ownerId === 'string') usuarios.set(c.ownerId, no.id);
        if (typeof c.motivoPerdaId === 'string') motivos.set(c.motivoPerdaId, no.id);
        if (typeof c.stageId === 'string') etapas.set(c.stageId, no.id);
        break;
      case 'controle.esperar_ate':
        if (c.modo === 'campo') pedirCampo(no, String(c.campo), true);
        break;
      case 'gatilho.data_contato':
        pedirCampo(no, String(c.campo), true);
        break;
      case 'controle.condicao':
        for (const ramo of (c.ramos as { regras: { campo: string }[] }[]) ?? []) for (const r of ramo.regras) pedirCampo(no, r.campo, false);
        break;
      case 'acao.atribuir_usuario':
        for (const id of c.modo === 'fixo' ? [String(c.usuarioId)] : (c.usuarios as string[])) usuarios.set(id, no.id);
        break;
      case 'acao.remover_de_fluxo':
        if (c.alvo === 'outros') for (const id of c.workflowIds as string[]) fluxos.set(id, no.id);
        break;
      default:
        break;
    }
  }

  for (const [entidade, pedidos] of [['contact', camposContato], ['deal', camposNegocio]] as const) {
    if (!pedidos.size) continue;
    const defs = await tx.customFieldDef.findMany({ where: { entidade, arquivadoEm: null }, select: { chave: true, tipo: true } });
    const tipos = new Map(defs.map((d) => [d.chave, d.tipo]));
    for (const [k, rotulo] of pedidos) {
      const [chave, exige, noId] = k.split('|');
      const tipo = tipos.get(chave);
      const quem = entidade === 'contact' ? 'contato' : 'negócio';
      if (!tipo) problemas.push({ noId, problema: `${rotulo}: o campo personalizado "${chave}" do ${quem} não existe ou está arquivado` });
      else if (exige === 'date' && tipo !== 'date') problemas.push({ noId, problema: `${rotulo}: o campo "${chave}" não é do tipo data` });
    }
  }
  if (usuarios.size) {
    const membros = await tx.membership.findMany({ where: { tenantId, identityId: { in: [...usuarios.keys()] } }, select: { identityId: true } });
    const ok = new Set(membros.map((m) => m.identityId));
    for (const [id, noId] of usuarios) if (!ok.has(id)) problemas.push({ noId, problema: 'usuário escolhido não é membro da conta' });
  }
  if (fluxos.size) {
    const achados = await tx.workflow.findMany({ where: { id: { in: [...fluxos.keys()] } }, select: { id: true } });
    const ok = new Set(achados.map((w) => w.id));
    for (const [id, noId] of fluxos) if (!ok.has(id)) problemas.push({ noId, problema: '"Remover de fluxo" aponta para um fluxo que não existe mais' });
  }
  if (motivos.size) {
    const achados = await tx.lostReason.findMany({ where: { id: { in: [...motivos.keys()] }, ativo: true }, select: { id: true } });
    const ok = new Set(achados.map((m) => m.id));
    for (const [id, noId] of motivos) if (!ok.has(id)) problemas.push({ noId, problema: 'motivo de perda inexistente ou desativado' });
  }
  if (etapas.size) {
    const achadas = await tx.stage.findMany({ where: { id: { in: [...etapas.keys()] } }, select: { id: true } });
    const ok = new Set(achadas.map((s) => s.id));
    for (const [id, noId] of etapas) if (!ok.has(id)) problemas.push({ noId, problema: 'etapa do funil inexistente' });
  }
  return problemas;
}
