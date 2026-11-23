import Image from 'next/image';
import { cx } from '@/components/ui';

/**
 * Identidade da NICO — v2 "Signal + Intelligence" (22/11/2026, revoga o
 * ADR-0040 original que separava NICO=lime / Agentes=violeta).
 *
 * Nova semântica única aprovada pelo dono: VIOLETA = INTELIGÊNCIA — tudo que
 * é IA no produto (NICO, Agentes, sugestões, automações rodando) fala na mesma
 * cor, e o usuário aprende "violeta = a IA está agindo". O lime fica 100%
 * reservado a SINAL/ação do usuário.
 *
 * A NICO é a agente INTERNA de marketing: trabalha com a equipe dentro do
 * KHUB, analisa, sugere e executa ações com as permissões de quem pede.
 * Não confundir com os Agentes de IA, que atendem os CLIENTES no WhatsApp.
 */

export const NICO = {
  nome: 'NICO',
  papel: 'Agente interna de marketing',
  resumo:
    'Trabalha com a sua equipe aqui dentro: analisa a operação, sugere e executa ações no CRM com as suas permissões. Ações sensíveis pedem a sua aprovação e tudo fica registrado na auditoria.',
  diferenca: 'Os Agentes de IA atendem os seus clientes no WhatsApp. A NICO trabalha com você.',
} as const;

export type EstadoNico = 'online' | 'pensando' | 'configurar';

/** Rosto da NICO: a orbe é viva — muda de forma como uma gosma, a estrela
    balança dentro e o halo pulsa atrás. O ponto de presença fica por cima. */
export function NicoAvatar({ tamanho = 40, estado, className }: { tamanho?: number; estado?: EstadoNico; className?: string }) {
  const ponto = Math.max(8, Math.round(tamanho * 0.24));
  return (
    <span className={cx('relative inline-flex shrink-0', className)} style={{ width: tamanho, height: tamanho }}>
      {/* Halo goo atrás da orbe — violeta = inteligência */}
      <span
        className="nico-orbe-halo absolute -inset-[22%] rounded-full"
        style={{
          background:
            'radial-gradient(circle at 32% 28%, color-mix(in srgb, var(--violet-600) 55%, transparent), color-mix(in srgb, var(--violet-400) 38%, transparent) 62%, transparent 78%)',
          filter: 'blur(6px)',
        }}
        aria-hidden
      />
      <span
        className="nico-orbe relative flex h-full w-full items-center justify-center overflow-hidden"
        style={{
          background:
            'radial-gradient(circle at 30% 25%, var(--base-0), var(--violet-950) 62%, var(--violet-900))',
          boxShadow: 'inset 0 0 0 1px var(--violet-border), 0 4px 14px -6px color-mix(in srgb, var(--violet-600) 35%, transparent)',
        }}
      >
        <Image src="/nico-avatar.png" alt="" width={256} height={256} unoptimized className="nico-orbe-estrela h-[78%] w-[78%] object-contain" />
      </span>
      {estado && (
        <span
          className={cx('absolute bottom-0 right-0 rounded-full ring-2 ring-[var(--base-0)]', estado === 'pensando' && 'animate-pulse')}
          style={{ width: ponto, height: ponto, background: estado === 'configurar' ? 'var(--warning)' : 'var(--violet-400)' }}
          aria-hidden
        />
      )}
    </span>
  );
}

/** Rótulo de presença: "online", "pensando…", "precisa de configuração". */
export function NicoStatus({ estado }: { estado: EstadoNico }) {
  const rotulo = estado === 'configurar' ? 'Precisa de configuração' : estado === 'pensando' ? 'Pensando…' : 'Online';
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[12px] font-medium', estado === 'configurar' ? 'text-warning' : 'text-violet-300')}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: estado === 'configurar' ? 'var(--warning)' : 'var(--violet-400)' }} aria-hidden />
      {rotulo}
    </span>
  );
}

/**
 * Como a NICO descreve o que sabe fazer, em linguagem de gente. A API devolve
 * nomes de ferramenta e descrições escritas PARA o modelo ("Use SEMPRE...");
 * na tela isso parecia painel técnico. Ferramenta nova sem tradução cai no
 * nome legível + a descrição da API.
 */
const CAPACIDADES: Record<string, { nome: string; descricao: string }> = {
  buscar_conhecimento: { nome: 'Consultar a base de conhecimento', descricao: 'Responde com o que está nos materiais do seu nicho e da sua empresa.' },
  resumo_do_funil: { nome: 'Resumir o funil', descricao: 'Mostra contatos, negócios por etapa, valor em aberto e conversão.' },
  buscar_contatos: { nome: 'Encontrar contatos', descricao: 'Procura por nome, e-mail, telefone, empresa ou tag.' },
  ver_contato: { nome: 'Ver o perfil completo', descricao: 'Dados, negócios, conversas, tarefas e histórico de um contato.' },
  listar_automacoes: { nome: 'Acompanhar automações', descricao: 'Diz quais estão ativas e quantas execuções e falhas tiveram.' },
  criar_contato: { nome: 'Cadastrar contatos', descricao: 'Coloca um contato novo no CRM.' },
  atualizar_contato: { nome: 'Atualizar dados de contato', descricao: 'Corrige nome, e-mail, telefone, empresa, tag ou valor.' },
  criar_tarefa: { nome: 'Criar tarefas para a equipe', descricao: 'Abre um lembrete ou próximo passo, ligado a um contato se quiser.' },
  adicionar_nota: { nome: 'Anotar no histórico', descricao: 'Registra uma nota no contato ou no negócio.' },
  criar_oportunidade: { nome: 'Abrir oportunidades', descricao: 'Cria um negócio no funil, na etapa certa.' },
  lembrar: { nome: 'Lembrar do que importa', descricao: 'Guarda preferências e contexto da sua empresa para as próximas conversas.' },
  criar_funil: { nome: 'Montar funis', descricao: 'Cria um funil de vendas novo.' },
  criar_etapa: { nome: 'Ajustar etapas do funil', descricao: 'Acrescenta etapas ao funil.' },
  instalar_automacao: { nome: 'Instalar automações prontas', descricao: 'Coloca uma automação da biblioteca para rodar.' },
  aplicar_blueprint: { nome: 'Montar a operação do nicho', descricao: 'Aplica um modelo completo de funil e automações.' },
  enviar_mensagem: { nome: 'Enviar mensagens', descricao: 'Manda mensagem para um contato pelo canal conectado.' },
  mover_etapa: { nome: 'Mover negócios no funil', descricao: 'Avança ou recua um negócio de etapa.' },
  mudar_status_automacao: { nome: 'Ligar e pausar automações', descricao: 'Ativa ou pausa uma automação existente.' },
};

export function capacidadeHumana(c: { nome: string; descricao: string }): { nome: string; descricao: string } {
  const t = CAPACIDADES[c.nome];
  if (t) return t;
  const legivel = c.nome.replace(/_/g, ' ');
  return { nome: legivel.charAt(0).toUpperCase() + legivel.slice(1), descricao: c.descricao };
}
