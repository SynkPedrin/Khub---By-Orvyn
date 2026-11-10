import Image from 'next/image';
import { cx } from '@/components/ui';

/**
 * Identidade da NICO (ADR-0040).
 *
 * A NICO é a agente INTERNA de marketing: trabalha com a equipe dentro do
 * KHUB, analisa, sugere e executa ações com as permissões de quem pede.
 * Não confundir com os Agentes de IA, que atendem os CLIENTES no WhatsApp.
 *
 * Para as duas nunca se confundirem na interface: a NICO tem rosto próprio
 * (a estrela cromada roxa e verde da marca) e o verde-limão como cor de
 * presença (status, selo de autoria); os Agentes de IA ficam no roxo.
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
      {/* Halo goo atrás da orbe */}
      <span
        className="nico-orbe-halo absolute -inset-[22%] rounded-full"
        style={{
          background:
            'radial-gradient(circle at 32% 28%, color-mix(in srgb, var(--khub-lime) 55%, transparent), color-mix(in srgb, var(--brand) 38%, transparent) 62%, transparent 78%)',
          filter: 'blur(6px)',
        }}
        aria-hidden
      />
      <span
        className="nico-orbe relative flex h-full w-full items-center justify-center overflow-hidden"
        style={{
          background:
            'radial-gradient(circle at 30% 25%, var(--base-0), var(--khub-lime-soft) 62%, color-mix(in srgb, var(--brand-soft) 70%, var(--khub-lime-soft)))',
          boxShadow: 'inset 0 0 0 1px var(--khub-lime-border), 0 4px 14px -6px color-mix(in srgb, var(--brand) 35%, transparent)',
        }}
      >
        <Image src="/nico-avatar.png" alt="" width={256} height={256} unoptimized className="nico-orbe-estrela h-[78%] w-[78%] object-contain" />
      </span>
      {estado && (
        <span
          className={cx('absolute bottom-0 right-0 rounded-full ring-2 ring-[var(--base-0)]', estado === 'pensando' && 'animate-pulse')}
          style={{ width: ponto, height: ponto, background: estado === 'configurar' ? 'var(--warning)' : 'var(--lime-edge)' }}
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
    <span className={cx('inline-flex items-center gap-1.5 text-[12px] font-medium', estado === 'configurar' ? 'text-warning' : 'text-lime-ink')}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: estado === 'configurar' ? 'var(--warning)' : 'var(--lime-edge)' }} aria-hidden />
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
