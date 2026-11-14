'use client';

import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { cx } from '@/components/ui';
import { agentesApi, type Agente, type CatalogoAgentes } from '@/lib/agents';
import { Alternar, Gaveta, mensagemDeErro, useToast } from '../kit';
import { useCamposAgente, type SecaoProps } from '../editor';
import { Ferramentas } from '../secoes/Ferramentas';
import { Followup } from '../secoes/Followup';
import { Permissoes } from '../secoes/Permissoes';
import { Automacoes } from '../secoes/Automacoes';
import { Conhecimento } from '../secoes/Conhecimento';
import { Comunicacao } from '../secoes/Comunicacao';
import { Horario } from '../secoes/Horario';
import { Identidade } from '../secoes/Identidade';
import { Personalidade } from '../secoes/Personalidade';
import { Comportamento } from '../secoes/Comportamento';
import { PainelTeste } from './PainelTeste';

const LIMITE_PROMPT = 8000;

type ModoTela = 'desativado' | 'sugestivo' | 'automatico';
export function modoDoAgente(a: Pick<Agente, 'status' | 'config'>): ModoTela {
  if (a.status !== 'ativo') return 'desativado';
  return a.config.modo === 'sugestivo' ? 'sugestivo' : 'automatico';
}
export const ROTULO_MODO: Record<ModoTela, string> = { desativado: 'Desativado', sugestivo: 'Sugestivo', automatico: 'Piloto automático' };

/**
 * Construtor do agente no estilo do Conversation AI do GHL: o PROMPT no centro,
 * as configurações em acordeões à direita e o "Testar" ao lado. Cada
 * configuração reaproveita a seção que já existia (abre numa gaveta), então a
 * lógica de salvar/validar é a mesma das abas avançadas.
 */
export function Construtor({ agente, catalogo, onAtualizado }: SecaoProps) {
  const [lado, setLado] = useState<'config' | 'testar'>('config');
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px] 3xl:grid-cols-[minmax(0,1fr)_340px_360px]">
      <EditorPrompt agente={agente} catalogo={catalogo} onAtualizado={onAtualizado} />

      {/* Abaixo de 2xl as duas colunas da direita viram uma, alternável. */}
      <div className="segbar w-full 3xl:hidden xl:col-start-2 xl:row-start-1 xl:self-start" role="tablist" aria-label="Painel lateral">
        <button type="button" role="tab" aria-selected={lado === 'config'} className="seg flex-1" onClick={() => setLado('config')}>
          <Icon name="settings" size={13} /> Configurações
        </button>
        <button type="button" role="tab" aria-selected={lado === 'testar'} className="seg flex-1" onClick={() => setLado('testar')}>
          <Icon name="chat" size={13} /> Testar
        </button>
      </div>

      <div className={cx('min-w-0 xl:col-start-2 xl:row-start-1 xl:mt-12 3xl:mt-0', lado === 'testar' && 'hidden 3xl:block')}>
        <Configuracoes agente={agente} catalogo={catalogo} onAtualizado={onAtualizado} />
      </div>
      <div className={cx('min-w-0 xl:col-start-2 xl:row-start-1 xl:mt-12 3xl:col-start-3 3xl:mt-0', lado === 'config' && 'hidden 3xl:block')}>
        <PainelTeste agente={agente} className="xl:sticky xl:top-4 xl:h-[calc(100dvh-180px)]" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ prompt */

function EditorPrompt({ agente, catalogo, onAtualizado }: SecaoProps) {
  const p = useCamposAgente(
    agente,
    (a) => ({ instrucoes: a.instrucoes, modelo: a.modelo, config: { identidade: { empresaRepresentada: a.config.identidade.empresaRepresentada } } }),
    onAtualizado,
  );
  const r = p.rascunho;
  const texto = r.instrucoes ?? '';
  const palavras = texto.trim() ? texto.trim().split(/\s+/).length : 0;
  const empresa = r.config?.identidade?.empresaRepresentada ?? '';

  return (
    <section className="card flex min-w-0 flex-col overflow-hidden p-0" aria-label="Prompt do agente">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3">
        <label className="flex items-center gap-2 text-[13px] font-medium text-fg">
          Modelo
          <select className="input h-9 w-auto min-w-[180px]" value={r.modelo} onChange={(e) => p.setRascunho({ ...r, modelo: e.target.value })}>
            {catalogo.modelos.map((m) => (
              <option key={m.id} value={m.id}>{m.nome}</option>
            ))}
            {!catalogo.modelos.some((m) => m.id === r.modelo) && <option value={r.modelo}>{r.modelo}</option>}
          </select>
        </label>
        <label className="flex min-w-[260px] flex-1 items-center gap-2 text-[13px] font-medium text-fg">
          <span className="shrink-0">Nome da empresa</span>
          <input
            className="input h-9 min-w-[140px] flex-1"
            maxLength={120}
            value={empresa}
            placeholder="Vazio usa o nome da conta"
            onChange={(e) => p.setRascunho({ ...r, config: { identidade: { empresaRepresentada: e.target.value } } })}
          />
        </label>
      </div>

      <textarea
        className="min-h-[60vh] w-full flex-1 resize-y bg-transparent px-5 py-4 font-[inherit] text-[14px] leading-relaxed text-fg outline-none placeholder:text-faint"
        maxLength={LIMITE_PROMPT}
        value={texto}
        spellCheck
        aria-label="Instruções do agente (prompt)"
        placeholder={'Você é a Paty, recepcionista do Studio…\n\n1. QUEM VOCÊ É\n2. COMO PENSAR ANTES DE CADA RESPOSTA\n3. O QUE NUNCA FAZER\n\nEscreva aqui como o agente deve atender. Ctrl+Z desfaz.'}
        onChange={(e) => p.setRascunho({ ...r, instrucoes: e.target.value })}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">
        <p className="min-w-0 flex-1 text-xs text-muted">
          <span className="tabular">{texto.length.toLocaleString('pt-BR')}/{LIMITE_PROMPT.toLocaleString('pt-BR')} caracteres · {palavras.toLocaleString('pt-BR')} palavras</span>
          {' · '}
          {p.sujo ? 'Alterações não salvas.' : 'Diga quem o agente é, o que faz, como decide o próximo passo e quando passa para a equipe.'}
        </p>
        <div className="flex gap-2">
          {p.sujo && <button type="button" className="btn btn-ghost btn-sm" onClick={p.descartar} disabled={p.salvando}>Descartar</button>}
          <button type="button" className="btn btn-primary btn-sm" disabled={!p.sujo || p.salvando} onClick={() => void p.salvar()}>
            {p.salvando ? 'Salvando…' : 'Salvar rascunho'}
          </button>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ configurações */

type GavetaId = 'ferramentas' | 'followup' | 'permissoes' | 'automacoes' | 'conhecimento' | 'horario' | 'comunicacao' | 'identidade' | 'personalidade' | 'comportamento';
const GAVETAS: Record<GavetaId, { titulo: string; C: ComponentType<SecaoProps>; largura?: string }> = {
  ferramentas: { titulo: 'Ferramentas do CRM', C: Ferramentas, largura: 'sm:w-[760px]' },
  followup: { titulo: 'Acompanhamento automático (follow-up)', C: Followup, largura: 'sm:w-[820px]' },
  permissoes: { titulo: 'Transferência e permissões', C: Permissoes, largura: 'sm:w-[680px]' },
  automacoes: { titulo: 'Automações que o agente pode disparar', C: Automacoes },
  conhecimento: { titulo: 'Base de conhecimento', C: Conhecimento, largura: 'sm:w-[860px]' },
  horario: { titulo: 'Horário de atendimento', C: Horario, largura: 'sm:w-[620px]' },
  comunicacao: { titulo: 'Ritmo das mensagens', C: Comunicacao, largura: 'sm:w-[860px]' },
  identidade: { titulo: 'Identidade e missão', C: Identidade, largura: 'sm:w-[720px]' },
  personalidade: { titulo: 'Personalidade', C: Personalidade, largura: 'sm:w-[680px]' },
  comportamento: { titulo: 'Situações e regras de conduta', C: Comportamento, largura: 'sm:w-[860px]' },
};

function Configuracoes(props: SecaoProps) {
  const { agente } = props;
  const [aberto, setAberto] = useState<string | null>('modo');
  const [gaveta, setGaveta] = useState<GavetaId | null>(null);
  const alternar = (id: string) => setAberto((a) => (a === id ? null : id));
  const G = gaveta ? GAVETAS[gaveta] : null;
  const h = agente.config.horario;
  const diasAbertos = h ? (['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'] as const).filter((d) => h.dias[d]?.length).length : 0;

  return (
    <div className="card divide-y divide-line overflow-hidden p-0">
      <Acordeao id="modo" icone="bolt" titulo="Modo" descricao="Como o agente funciona" aberto={aberto === 'modo'} onAlternar={alternar}>
        <BlocoModo {...props} />
      </Acordeao>

      <Acordeao id="acoes" icone="zap" titulo="Ações" descricao="O que o agente pode fazer" aberto={aberto === 'acoes'} onAlternar={alternar}>
        <ListaItens
          itens={[
            { id: 'ferramentas', icone: 'bolt', titulo: 'Ferramentas do CRM', resumo: `${agente.ferramentas.length} ligada(s): contato, pipeline, agenda, tarefas…` },
            { id: 'followup', icone: 'refresh', titulo: 'Acompanhamento automático', resumo: 'Quando o contato para de responder' },
            { id: 'permissoes', icone: 'users', titulo: 'Transferência humana e permissões', resumo: `${agente.config.permissoes.exigirConfirmacao.length} ação(ões) pedem aprovação` },
            { id: 'automacoes', icone: 'zap', titulo: 'Automações', resumo: 'Fluxos que o agente pode disparar' },
          ]}
          abrir={setGaveta}
        />
      </Acordeao>

      <Acordeao id="conhecimento" icone="knowledge" titulo="Base de conhecimento" descricao="Fontes que o agente consulta" aberto={aberto === 'conhecimento'} onAlternar={alternar}>
        <ListaItens
          itens={[{ id: 'conhecimento', icone: 'knowledge', titulo: 'Fontes de conhecimento', resumo: agente.conhecimentoAtivo ? 'Ligada: responde com base nas fontes' : 'Desligada' }]}
          abrir={setGaveta}
        />
      </Acordeao>

      <Acordeao id="tempo" icone="clock" titulo="Tempo e ritmo" descricao="Quando e como o agente responde" aberto={aberto === 'tempo'} onAlternar={alternar}>
        <ListaItens
          itens={[
            { id: 'horario', icone: 'clock', titulo: 'Horário de atendimento', resumo: h?.ativo ? `${diasAbertos} dia(s) por semana` : 'Responde 24 horas' },
            { id: 'comunicacao', icone: 'chat', titulo: 'Ritmo das mensagens', resumo: `Mensagens curtas com pausa de digitação · emojis ${agente.config.comunicacao.emojis}` },
          ]}
          abrir={setGaveta}
        />
      </Acordeao>

      <Acordeao id="comportamento" icone="user" titulo="Comportamento de resposta" descricao="Quem é e como responde" aberto={aberto === 'comportamento'} onAlternar={alternar}>
        <ListaItens
          itens={[
            { id: 'identidade', icone: 'user', titulo: 'Identidade e missão', resumo: agente.config.identidade.cargo || 'Cargo, objetivo, público e limites' },
            { id: 'personalidade', icone: 'sparkles', titulo: 'Personalidade', resumo: 'Formalidade, energia, empatia…' },
            { id: 'comportamento', icone: 'target', titulo: 'Situações e regras', resumo: 'Objeções, preço, reclamação, regras de conduta' },
          ]}
          abrir={setGaveta}
        />
      </Acordeao>

      {G && (
        <Gaveta aberto onFechar={() => setGaveta(null)} titulo={G.titulo} largura={G.largura}>
          <G.C {...props} />
        </Gaveta>
      )}
    </div>
  );
}

function Acordeao({ id, icone, titulo, descricao, aberto, onAlternar, children }: { id: string; icone: IconName; titulo: string; descricao: string; aberto: boolean; onAlternar: (id: string) => void; children: ReactNode }) {
  return (
    <div>
      <button type="button" className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-surface2" aria-expanded={aberto} onClick={() => onAlternar(id)}>
        <span className="icon-tile h-9 w-9 shrink-0 rounded-xl"><Icon name={icone} size={16} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-fg">{titulo}</span>
          <span className="block truncate text-xs text-muted">{descricao}</span>
        </span>
        <Icon name="chevronDown" size={16} className={cx('shrink-0 text-faint transition-transform', aberto && 'rotate-180')} />
      </button>
      {aberto && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function ListaItens({ itens, abrir }: { itens: { id: GavetaId; icone: IconName; titulo: string; resumo: string }[]; abrir: (id: GavetaId) => void }) {
  return (
    <ul className="space-y-2">
      {itens.map((i) => (
        <li key={i.id}>
          <button type="button" onClick={() => abrir(i.id)} className="group flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left transition hover:border-brand-border hover:bg-brand-softer">
            <Icon name={i.icone} size={15} className="shrink-0 text-brand" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-fg">{i.titulo}</span>
              <span className="block truncate text-xs text-muted">{i.resumo}</span>
            </span>
            <Icon name="edit" size={14} className="shrink-0 text-faint group-hover:text-brand" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/* --------------------------------------------------------------------- modo */

const OPCOES_MODO: { id: ModoTela; titulo: string; texto: string }[] = [
  { id: 'desativado', titulo: 'Desativado', texto: 'O agente não responde nem sugere. As conversas ficam com a equipe.' },
  { id: 'sugestivo', titulo: 'Sugestivo', texto: 'Não responde sozinho: sugere respostas no Inbox e só responde nas conversas em que for ativado (nó "Ativar IA" da automação ou botão na conversa).' },
  { id: 'automatico', titulo: 'Piloto automático', texto: 'Como agente principal, responde sozinho em todas as conversas do canal que não estão com alguém da equipe.' },
];

function BlocoModo({ agente, catalogo, onAtualizado }: SecaoProps) {
  const toast = useToast();
  const atual = modoDoAgente(agente);
  const [mudando, setMudando] = useState<ModoTela | null>(null);
  const [principal, setPrincipal] = useState({ padrao: agente.padrao, canais: agente.canais });
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    setPrincipal({ padrao: agente.padrao, canais: agente.canais });
  }, [agente.updatedAt, agente.padrao, agente.canais]);
  const principalSujo = principal.padrao !== agente.padrao || principal.canais.join() !== agente.canais.join();

  const mudar = async (m: ModoTela) => {
    if (m === atual || mudando) return;
    setMudando(m);
    try {
      let a: Agente = agente;
      if (m === 'desativado') {
        a = await agentesApi.status(agente.id, 'pausado');
      } else {
        if ((agente.config.modo ?? 'automatico') !== m) a = await agentesApi.atualizar(agente.id, { config: { modo: m } });
        if (agente.status !== 'ativo') a = await agentesApi.status(agente.id, 'ativo');
      }
      onAtualizado(a);
      toast('ok', `Modo: ${ROTULO_MODO[m]}`);
    } catch (e) {
      toast('erro', mensagemDeErro(e));
    } finally {
      setMudando(null);
    }
  };

  const salvarPrincipal = async () => {
    setSalvando(true);
    try {
      onAtualizado(await agentesApi.atualizar(agente.id, { padrao: principal.padrao, canais: principal.canais }));
      toast('ok', principal.padrao ? 'Agente principal definido' : 'Agente deixou de ser o principal');
    } catch (e) {
      toast('erro', mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2" role="radiogroup" aria-label="Modo do agente">
        {OPCOES_MODO.map((o) => {
          const sel = o.id === atual;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={sel}
              disabled={!!mudando}
              onClick={() => void mudar(o.id)}
              className={cx('flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-60', sel ? 'border-brand-border bg-brand-softer' : 'border-line hover:bg-surface2')}
            >
              <span className={cx('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border', sel ? 'border-brand' : 'border-line-strong')}>
                {sel && <span className="h-2 w-2 rounded-full bg-brand" />}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-fg">{o.titulo}{mudando === o.id ? '…' : ''}</span>
                <span className="block text-xs text-muted">{o.texto}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="pt-1">
        <Alternar
          ligado={principal.padrao}
          onChange={(v) => setPrincipal((p) => ({ ...p, padrao: v }))}
          rotulo="Agente principal"
          descricao="Conversas novas dos canais abaixo já começam com este agente (em piloto automático)."
        />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {catalogo.canais.map((c) => {
            const on = principal.canais.includes(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => setPrincipal((p) => ({ ...p, canais: on ? p.canais.filter((x) => x !== c) : [...p.canais, c] }))}
                className={cx('rounded-full border px-2.5 py-1 text-xs font-medium transition', on ? 'border-brand-border bg-brand-soft text-brand' : 'border-line text-muted hover:text-fg')}
              >
                {c}
              </button>
            );
          })}
        </div>
        {principalSujo && (
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPrincipal({ padrao: agente.padrao, canais: agente.canais })}>Descartar</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={salvando || !principal.canais.length} onClick={() => void salvarPrincipal()}>{salvando ? 'Salvando…' : 'Salvar'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
