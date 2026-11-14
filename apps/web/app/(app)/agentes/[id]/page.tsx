'use client';

import { useCallback, useEffect, useState, type ComponentType } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Icon, type IconName } from '@/components/icons';
import { Avatar, cx } from '@/components/ui';
import { agentesApi, type Agente, type CatalogoAgentes } from '@/lib/agents';
import { Confirmar, Erro, Esqueleto, Modal, StatusAgentePill, mensagemDeErro, useAcao, useToast } from '@/components/agents/kit';
import type { SecaoProps } from '@/components/agents/editor';
import { VisaoGeral } from '@/components/agents/secoes/VisaoGeral';
import { Identidade } from '@/components/agents/secoes/Identidade';
import { Personalidade } from '@/components/agents/secoes/Personalidade';
import { Comportamento } from '@/components/agents/secoes/Comportamento';
import { Inteligencia } from '@/components/agents/secoes/Inteligencia';
import { Comunicacao } from '@/components/agents/secoes/Comunicacao';
import { Conhecimento } from '@/components/agents/secoes/Conhecimento';
import { Memoria } from '@/components/agents/secoes/Memoria';
import { Ferramentas } from '@/components/agents/secoes/Ferramentas';
import { Followup } from '@/components/agents/secoes/Followup';
import { Automacoes } from '@/components/agents/secoes/Automacoes';
import { Aprendizado } from '@/components/agents/secoes/Aprendizado';
import { Simulador } from '@/components/agents/secoes/Simulador';
import { Analytics } from '@/components/agents/secoes/Analytics';
import { Logs } from '@/components/agents/secoes/Logs';
import { Versoes } from '@/components/agents/secoes/Versoes';
import { Permissoes } from '@/components/agents/secoes/Permissoes';
import { AoVivo } from '@/components/agents/secoes/AoVivo';
import { Horario } from '@/components/agents/secoes/Horario';
import { Construtor, ROTULO_MODO, modoDoAgente } from '@/components/agents/construtor/Construtor';
import { Menu, type MenuEntry } from '@/components/kit';

type Aba = { id: string; rotulo: string; icone: IconName; grupo: string; C: ComponentType<SecaoProps> };

const ABAS: Aba[] = [
  // Ao vivo em primeiro: é a aba padrão — abrir o agente é ver ele trabalhando.
  { id: 'aovivo', rotulo: 'Ao vivo', icone: 'play', grupo: 'Agente', C: AoVivo },
  { id: 'visao', rotulo: 'Visão geral', icone: 'grid', grupo: 'Agente', C: VisaoGeral },
  { id: 'identidade', rotulo: 'Identidade', icone: 'user', grupo: 'Configuração', C: Identidade },
  { id: 'personalidade', rotulo: 'Personalidade', icone: 'sparkles', grupo: 'Configuração', C: Personalidade },
  { id: 'comportamento', rotulo: 'Comportamento', icone: 'target', grupo: 'Configuração', C: Comportamento },
  { id: 'inteligencia', rotulo: 'Inteligência', icone: 'ai', grupo: 'Configuração', C: Inteligencia },
  { id: 'comunicacao', rotulo: 'Comunicação', icone: 'whatsapp', grupo: 'Configuração', C: Comunicacao },
  { id: 'horario', rotulo: 'Horário de atendimento', icone: 'clock', grupo: 'Configuração', C: Horario },
  { id: 'conhecimento', rotulo: 'Base de conhecimento', icone: 'knowledge', grupo: 'Dados', C: Conhecimento },
  { id: 'memoria', rotulo: 'Memória e perfis', icone: 'users', grupo: 'Dados', C: Memoria },
  { id: 'ferramentas', rotulo: 'Ferramentas do CRM', icone: 'bolt', grupo: 'Ações', C: Ferramentas },
  { id: 'followup', rotulo: 'Follow-up', icone: 'clock', grupo: 'Ações', C: Followup },
  { id: 'automacoes', rotulo: 'Automações', icone: 'zap', grupo: 'Ações', C: Automacoes },
  { id: 'permissoes', rotulo: 'Permissões', icone: 'shield', grupo: 'Ações', C: Permissoes },
  { id: 'simulador', rotulo: 'Simulador', icone: 'chat', grupo: 'Qualidade', C: Simulador },
  { id: 'aprendizado', rotulo: 'Aprendizado e testes', icone: 'trophy', grupo: 'Qualidade', C: Aprendizado },
  { id: 'versoes', rotulo: 'Versões', icone: 'refresh', grupo: 'Qualidade', C: Versoes },
  { id: 'analytics', rotulo: 'Analytics', icone: 'trend', grupo: 'Operação', C: Analytics },
  { id: 'logs', rotulo: 'Logs de execução', icone: 'list', grupo: 'Operação', C: Logs },
];
const GRUPOS = [...new Set(ABAS.map((a) => a.grupo))];

export default function AgenteWorkspace() {
  const { id } = useParams<{ id: string }>();
  const busca = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { ocupado, executar } = useAcao();
  const [agente, setAgente] = useState<Agente | null>(null);
  const [catalogo, setCatalogo] = useState<CatalogoAgentes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [publicar, setPublicar] = useState(false);
  const [notas, setNotas] = useState('');
  const [arquivar, setArquivar] = useState(false);
  // Sem `?aba=` abre o CONSTRUTOR (prompt + configurações + testar, estilo GHL);
  // as áreas detalhadas continuam em `?aba=<id>` (menu "Avançado").
  const aba = ABAS.find((a) => a.id === busca.get('aba')) ?? null;

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [a, c] = await Promise.all([agentesApi.obter(id), agentesApi.catalogo()]);
      setAgente(a);
      setCatalogo(c);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }, [id]);
  useEffect(() => { void carregar(); }, [carregar]);

  // Mantém o indicador de "não publicado" verdadeiro depois de cada save.
  const onAtualizado = useCallback((a: Agente) => {
    setAgente((atual) => ({ ...a, versaoPublicada: atual?.versaoPublicada ?? null, alteracoesNaoPublicadas: atual?.versaoPublicada ? true : null }));
    void agentesApi.obter(a.id).then(setAgente).catch(() => undefined);
  }, []);

  const irPara = (abaId: string | null) => router.replace(abaId ? `/agentes/${id}?aba=${abaId}` : `/agentes/${id}`, { scroll: false });

  const mudarStatus = async (status: 'ativo' | 'pausado' | 'arquivado') => {
    const a = await executar(`status:${status}`, () => agentesApi.status(id, status), status === 'ativo' ? 'Agente ativado: já atende conversas novas' : status === 'pausado' ? 'Agente pausado: conversas vão para a equipe' : 'Agente arquivado');
    if (a) {
      if (status === 'arquivado') router.push('/agentes');
      else onAtualizado(a);
    }
  };

  const confirmarPublicacao = async (forcar = false) => {
    try {
      const r = await agentesApi.publicar(id, notas || undefined, forcar);
      toast('ok', `Versão ${r.versao.numero} publicada${r.avaliado ? ' (avaliada)' : ''}`);
      setPublicar(false);
      setNotas('');
      setAgente(await agentesApi.obter(id));
    } catch (e) {
      const msg = mensagemDeErro(e);
      if (/regressão/.test(msg) && !forcar && window.confirm(`${msg}\n\nPublicar mesmo assim?`)) return confirmarPublicacao(true);
      toast('erro', msg);
    }
  };

  if (erro) return <div className="mx-auto max-w-3xl p-6"><Erro texto={erro} tentar={carregar} /></div>;
  if (!agente || !catalogo) return <div className="mx-auto max-w-[1680px] p-6"><Esqueleto linhas={8} /></div>;

  const Secao = aba?.C ?? null;
  const modo = modoDoAgente(agente);
  const naoPublicado = agente.alteracoesNaoPublicadas === true || !agente.versaoPublicada;

  return (
    <div className="mx-auto w-full max-w-[1680px] px-4 py-6 lg:px-8 lg:py-8">
      {/* Cabeçalho */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <Link href="/agentes" className="btn btn-ghost btn-icon" aria-label="Voltar para agentes"><span aria-hidden className="text-lg leading-none">←</span></Link>
          <Avatar name={agente.nome} size={48} src={agente.config.identidade.avatarUrl ?? undefined} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="t-display truncate">{agente.nome}</h1>
              <StatusAgentePill status={agente.status} />
              {modo !== 'desativado' && <span className={cx('pill', modo === 'automatico' ? 'pill-brand' : 'pill-info')}>{ROTULO_MODO[modo]}</span>}
              {agente.padrao && <span className="pill pill-brand">Agente principal</span>}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
              <span>{agente.config.identidade.cargo || 'Agente de atendimento'}</span>
              <span>·</span>
              <span>{catalogo.modelos.find((m) => m.id === agente.modelo)?.nome ?? agente.modelo}</span>
              <span>·</span>
              {agente.versaoPublicada ? (
                <span>Versão publicada v{agente.versaoPublicada.numero}</span>
              ) : (
                <span>Sem versão publicada (atendimento usa o rascunho)</span>
              )}
              {agente.versaoPublicada && naoPublicado && <span className="pill pill-warning">Rascunho com alterações não publicadas</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {agente.status === 'ativo' ? (
            <button className="btn btn-soft btn-sm" disabled={!!ocupado} onClick={() => mudarStatus('pausado')}><Icon name="pause" size={14} /> Pausar</button>
          ) : (
            <button className="btn btn-soft btn-sm" disabled={!!ocupado} onClick={() => mudarStatus('ativo')}><Icon name="play" size={14} /> Ativar</button>
          )}
          <button className="btn btn-primary btn-sm" disabled={!!agente.versaoPublicada && !naoPublicado} onClick={() => setPublicar(true)} title={agente.versaoPublicada && !naoPublicado ? 'Nada novo para publicar' : undefined}>
            <Icon name="upload" size={14} /> Publicar
          </button>
          <button className="btn btn-ghost btn-sm btn-icon" aria-label="Arquivar agente" title="Arquivar" onClick={() => setArquivar(true)}><Icon name="trash" size={14} /></button>
        </div>
      </div>

      {!catalogo.ia.configurada && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-warning-border bg-warning-soft px-4 py-3 text-[13.5px] text-fg">
          <Icon name="lock" size={15} />
          <span className="flex-1">A IA ainda não está conectada (falta {catalogo.ia.faltando.join(', ')}). Sem ela o agente transfere toda conversa para a equipe, com o motivo registrado.</span>
          <a href="/configuracoes?aba=integracoes" className="btn btn-sm btn-ghost">Conectar IA</a>
        </div>
      )}

      {/* Construir (padrão) | Avançado (todas as áreas detalhadas) */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="segbar" role="tablist" aria-label="Modo de edição">
          <button type="button" role="tab" aria-selected={!aba} className="seg px-4" onClick={() => irPara(null)}>
            <Icon name="edit" size={13} /> Construir
          </button>
          <button type="button" role="tab" aria-selected={!!aba} className="seg px-4" onClick={() => irPara(aba?.id ?? 'aovivo')}>
            <Icon name="grid" size={13} /> Avançado
          </button>
        </div>
        <Menu
          label="Áreas avançadas do agente"
          triggerClassName="btn btn-ghost btn-sm !w-auto gap-1.5"
          menuClassName="w-64"
          trigger={<>{aba ? aba.rotulo : 'Ir para…'}<Icon name="chevronDown" size={14} /></>}
          items={GRUPOS.flatMap((g): MenuEntry[] => [
            { type: 'label', id: `g-${g}`, label: g } as MenuEntry,
            ...ABAS.filter((a) => a.grupo === g).map((a): MenuEntry => ({ id: a.id, label: a.rotulo, icon: a.icone, onSelect: () => irPara(a.id) })),
          ])}
        />
      </div>

      {!aba || !Secao ? (
        <Construtor agente={agente} catalogo={catalogo} onAtualizado={onAtualizado} />
      ) : (
      <div className="grid gap-5 lg:grid-cols-[232px_minmax(0,1fr)]">
        {/* Navegação das áreas */}
        <nav aria-label="Áreas do agente" className="card h-max p-2.5 max-lg:scroll-fade-x max-lg:flex max-lg:gap-1 max-lg:overflow-x-auto lg:sticky lg:top-4">
          {GRUPOS.map((g) => (
            <div key={g} className="max-lg:contents">
              <p className="nav-grupo px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-faint max-lg:hidden">{g}</p>
              {ABAS.filter((a) => a.grupo === g).map((a) => (
                <button
                  key={a.id}
                  onClick={() => irPara(a.id)}
                  aria-current={a.id === aba.id ? 'page' : undefined}
                  className={cx(
                    'flex w-full shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] font-medium transition-colors max-lg:w-auto max-lg:whitespace-nowrap',
                    a.id === aba.id ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface2 hover:text-fg',
                  )}
                >
                  <Icon name={a.icone} size={15} />
                  {a.rotulo}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <main className="min-w-0">
          <Secao key={aba.id} agente={agente} catalogo={catalogo} onAtualizado={onAtualizado} />
        </main>
      </div>
      )}

      <Modal
        aberto={publicar}
        onFechar={() => setPublicar(false)}
        titulo="Publicar nova versão"
        rodape={<><button className="btn btn-ghost" onClick={() => setPublicar(false)}>Cancelar</button><button className="btn btn-primary" onClick={() => confirmarPublicacao()}>Publicar</button></>}
      >
        <div className="space-y-3 text-[14px] text-muted">
          <p>A versão publicada é a que atende no WhatsApp. O rascunho continua editável sem afetar o atendimento até a próxima publicação.</p>
          <p>Se a última avaliação deste rascunho detectou regressão, a publicação pede confirmação.</p>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-fg">Notas da versão</span>
            <textarea className="textarea" rows={3} maxLength={2000} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="O que mudou nesta versão" />
          </label>
        </div>
      </Modal>
      <Confirmar
        aberto={arquivar}
        titulo="Arquivar agente"
        texto={<p>O agente para de atender, deixa de ser o padrão e os follow-ups agendados são cancelados. Conversas e histórico continuam. Depois de arquivado, ele pode ser excluído definitivamente na lista de agentes.</p>}
        confirmar="Arquivar"
        perigo
        onConfirmar={() => { setArquivar(false); void mudarStatus('arquivado'); }}
        onFechar={() => setArquivar(false)}
      />
    </div>
  );
}
