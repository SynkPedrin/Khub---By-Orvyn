'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/icons';
import { Avatar, cx } from '@/components/ui';
import { agentesApi, type Agente, type CatalogoAgentes } from '@/lib/agents';
import { Confirmar, Erro, Esqueleto, Modal, StatusAgentePill, mensagemDeErro, useAcao, useToast } from '@/components/agents/kit';
import type { SecaoProps } from '@/components/agents/editor';
import { Conhecimento } from '@/components/agents/secoes/Conhecimento';
import { Construtor, ROTULO_MODO, modoDoAgente, GAVETA_IDS, type GavetaId } from '@/components/agents/construtor/Construtor';

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
  const abaParam = busca.get('aba');
  const tela: 'visao' | 'conhecimento' = abaParam === 'conhecimento' ? 'conhecimento' : 'visao';
  // Links antigos (?aba=logs, ?aba=simulador…) abrem a gaveta correspondente na Visão geral.
  const gavetaInicial = (abaParam && GAVETA_IDS.includes(abaParam) && abaParam !== 'conhecimento' ? abaParam : null) as GavetaId | null;

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

      {/* Duas telas: Visão geral (configuração completa) e Base de conhecimento */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="segbar" role="tablist" aria-label="Telas do agente">
          <button type="button" role="tab" aria-selected={tela === 'visao'} className="seg px-4" onClick={() => irPara(null)}>
            <Icon name="grid" size={13} /> Visão geral
          </button>
          <button type="button" role="tab" aria-selected={tela === 'conhecimento'} className="seg px-4" onClick={() => irPara('conhecimento')}>
            <Icon name="knowledge" size={13} /> Base de conhecimento
          </button>
        </div>
      </div>

      {tela === 'conhecimento' ? (
        <Conhecimento agente={agente} catalogo={catalogo} onAtualizado={onAtualizado} />
      ) : (
        <Construtor agente={agente} catalogo={catalogo} onAtualizado={onAtualizado} gavetaInicial={gavetaInicial} />
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
