/** Mapa do produto para a NICO responder "onde fica" e "como faço" sem inventar rota. */
export interface EntradaGuia {
  rota: string;
  nome: string;
  oque: string;
  comoFazer: string[];
}

export const GUIA_SISTEMA: EntradaGuia[] = [
  { rota: '/dashboard', nome: 'Dashboard', oque: 'Números do dia e resumo da operação.', comoFazer: ['Ver o resumo: abra o Dashboard.'] },
  { rota: '/leads', nome: 'Leads', oque: 'Contatos, empresas e carteira.', comoFazer: ['Criar contato: Leads > novo.', 'Importar ou filtrar por tag na própria lista.'] },
  { rota: '/pipeline', nome: 'Pipeline', oque: 'Funis, etapas e negócios.', comoFazer: ['Mover negócio: arraste o card entre etapas.', 'Criar funil/etapa: peça à NICO ou use Pipeline.'] },
  { rota: '/conversas', nome: 'Conversas', oque: 'Inbox do WhatsApp e demais canais.', comoFazer: ['Atender: abra a conversa e responda.', 'Conectar WhatsApp: Configurações > integrações.'] },
  { rota: '/agenda', nome: 'Agenda', oque: 'Compromissos e agendamentos.', comoFazer: ['Marcar: Agenda > novo compromisso.'] },
  { rota: '/tarefas', nome: 'Tarefas', oque: 'Tarefas da equipe.', comoFazer: ['Criar tarefa: Tarefas > nova (ou peça à NICO).'] },
  { rota: '/automacoes', nome: 'Automações', oque: 'Fluxos automáticos (boas-vindas, follow-up, reativação), com marketplace de templates.', comoFazer: ['Instalar pronto: Automações > marketplace (ou peça à NICO).', 'Ver falhas: pergunte à NICO "minhas automações estão funcionando?".', 'Ativar/pausar: dentro do fluxo.'] },
  { rota: '/campanhas', nome: 'Campanhas', oque: 'Disparos e campanhas para a base.', comoFazer: ['Criar disparo: Campanhas > nova. Disparo em massa sempre pede sua confirmação.'] },
  { rota: '/marketing/ads', nome: 'Anúncios', oque: 'Desempenho do tráfego pago (Meta).', comoFazer: ['Ver CPL, ROAS, CTR: Anúncios, ou peça à NICO para analisar o período.', 'Conectar Meta Ads: Configurações > integrações.'] },
  { rota: '/formularios', nome: 'Formulários', oque: 'Captura de leads por link ou embed.', comoFazer: ['Criar: Formulários > novo, copie o link ou embed.'] },
  { rota: '/analytics', nome: 'Analytics', oque: 'Funil de conversão e relatórios.', comoFazer: ['Ver gargalo: Analytics, ou pergunte à NICO.'] },
  { rota: '/financeiro', nome: 'Financeiro', oque: 'Cobranças e links de pagamento (Stripe).', comoFazer: ['Cobrar: Financeiro > nova cobrança, depois gerar link.', 'Ver vencidas: filtre por status.'] },
  { rota: '/nyro', nome: 'NICO', oque: 'A agente interna: analisa, cria e agenda rotinas e relatórios.', comoFazer: ['Rotina: diga "toda segunda às 8h faça X".', 'Aprovações pendentes ficam no painel lateral.'] },
  { rota: '/agentes', nome: 'Agentes de IA', oque: 'Agentes que atendem clientes no WhatsApp.', comoFazer: ['Criar/ajustar prompt: Agentes de IA. A NICO avalia o prompt de 0 a 100.'] },
  { rota: '/conhecimento', nome: 'Conhecimento', oque: 'Base que alimenta as respostas da IA.', comoFazer: ['Adicionar material: Conhecimento > novo documento.'] },
  { rota: '/configuracoes', nome: 'Configurações', oque: 'Conta, equipe, permissões por módulo e integrações.', comoFazer: ['Convidar pessoa e limitar módulos: Configurações > equipe.'] },
];

export function consultarGuia(assunto?: string) {
  if (!assunto) return GUIA_SISTEMA;
  const q = assunto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const termos = q.split(/\s+/).filter((x) => x.length > 2);
  const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const achados = GUIA_SISTEMA.filter((e) => {
    const alvo = norm(`${e.nome} ${e.oque} ${e.comoFazer.join(' ')}`);
    return termos.some((t) => alvo.includes(t));
  });
  return achados.length ? achados : GUIA_SISTEMA;
}
