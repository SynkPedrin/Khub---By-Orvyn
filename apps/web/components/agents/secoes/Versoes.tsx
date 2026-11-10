'use client';

import { useState, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { agentesApi, dataHora, type DiffVersao, type VersaoResumo } from '@/lib/agents';
import { Confirmar, Erro, Esqueleto, Gaveta, Painel, Vazio, mensagemDeErro, useAcao, useCarga, useToast } from '../kit';
import type { SecaoProps } from '../editor';

const ROTULO_CAMPO: Record<string, string> = {
  nome: 'Nome',
  descricao: 'Descrição',
  modelo: 'Modelo',
  instrucoes: 'Instruções',
  tom: 'Tom de voz',
  personalidade: 'Personalidade (texto)',
  ferramentas: 'Ferramentas do CRM',
  conhecimentoAtivo: 'Base de conhecimento ativa',
  conhecimentoEscopos: 'Escopos da base',
  maxRespostasConversa: 'Máximo de respostas por conversa',
  maxCaracteres: 'Máximo de caracteres',
  canais: 'Canais',
  'config.identidade': 'Identidade',
  'config.personalidade': 'Personalidade',
  'config.comportamento': 'Comportamento',
  'config.regras': 'Regras',
  'config.comunicacao': 'Comunicação',
  'config.inteligencia': 'Inteligência',
  'config.conhecimento': 'Conhecimento',
  'config.memoria': 'Memória',
  'config.crm': 'CRM',
  'config.permissoes': 'Permissões',
  'versão inicial': 'Versão inicial',
};
const ROTULO_ORIGEM: Record<VersaoResumo['origem'], string> = { publicacao: 'Publicação', restauracao: 'Restauração', proposta: 'Proposta de aprendizado' };
const rotuloCampo = (c: string) => ROTULO_CAMPO[c] ?? c.replace(/^config\./, '');

type EstadoDiff = { titulo: string; referencia: string; carregando: boolean; erro: string | null; diff: DiffVersao | null; versionId?: string };

/** Version History: versões publicadas, comparação com o rascunho e restauração. */
export function Versoes({ agente, onAtualizado }: SecaoProps) {
  const toast = useToast();
  const { ocupado, executar } = useAcao();
  const versoes = useCarga(() => agentesApi.versoes(agente.id), [agente.id]);
  const rascunho = useCarga(() => agentesApi.diffVersao(agente.id), [agente.id, agente.updatedAt]);
  const [gaveta, setGaveta] = useState<EstadoDiff | null>(null);
  const [restaurar, setRestaurar] = useState<VersaoResumo | null>(null);

  const comparar = async (v: VersaoResumo) => {
    const base: EstadoDiff = { titulo: `v${v.numero} comparada ao rascunho`, referencia: `Na v${v.numero}`, carregando: true, erro: null, diff: null, versionId: v.id };
    setGaveta(base);
    try {
      const diff = await agentesApi.diffVersao(agente.id, v.id);
      setGaveta((g) => (g?.versionId === v.id ? { ...g, carregando: false, diff } : g));
    } catch (e) {
      setGaveta((g) => (g?.versionId === v.id ? { ...g, carregando: false, erro: mensagemDeErro(e) } : g));
    }
  };

  const abrirRascunho = () => {
    const d = rascunho.dados;
    if (!d) return;
    setGaveta({ titulo: 'Rascunho comparado à versão publicada', referencia: d.publicada ? `Na v${d.publicada.numero}` : 'Publicada', carregando: false, erro: null, diff: d });
  };

  const confirmarRestauracao = async () => {
    const v = restaurar;
    setRestaurar(null);
    if (!v) return;
    const r = await executar(`restaurar:${v.id}`, () => agentesApi.restaurar(agente.id, v.id));
    if (!r) return;
    toast('ok', `v${v.numero} restaurada como nova versão v${r.versao.numero}. O rascunho foi reescrito.`);
    try {
      onAtualizado(await agentesApi.obter(agente.id));
    } catch (e) {
      toast('erro', mensagemDeErro(e));
    }
    void versoes.recarregar();
    void rascunho.recarregar();
  };

  return (
    <div className="space-y-5">
      <Painel titulo="Estado do rascunho" descricao="O rascunho é o que você edita. O atendimento no WhatsApp usa a versão publicada.">
        {rascunho.carregando && !rascunho.dados ? (
          <div className="skeleton h-16 w-full rounded-lg" />
        ) : rascunho.erro ? (
          <Erro texto={rascunho.erro} tentar={() => void rascunho.recarregar()} />
        ) : rascunho.dados ? (
          <div className="space-y-3">
            <div className={cx('flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3 text-[13.5px]', rascunho.dados.pendente ? 'border-warning-border bg-warning-soft' : 'border-success-border bg-success-soft')}>
              <Icon name={rascunho.dados.pendente ? 'alert' : 'check2'} size={16} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 text-fg">
                {!rascunho.dados.publicada ? (
                  <p>Ainda não há versão publicada: o atendimento usa o rascunho diretamente. Use <strong>Publicar</strong> no topo da página para congelar a primeira versão.</p>
                ) : rascunho.dados.pendente ? (
                  <p>O rascunho tem {rascunho.dados.mudancas.length} {rascunho.dados.mudancas.length === 1 ? 'área alterada' : 'áreas alteradas'} em relação à v{rascunho.dados.publicada.numero}. Use <strong>Publicar</strong> no topo da página para levar ao atendimento.</p>
                ) : (
                  <p>O rascunho está igual à versão publicada v{rascunho.dados.publicada.numero}.</p>
                )}
              </div>
              {rascunho.dados.publicada && rascunho.dados.pendente && (
                <button className="btn btn-ghost btn-sm" onClick={abrirRascunho}><Icon name="eye" size={14} /> Ver diferenças</button>
              )}
            </div>
            {rascunho.dados.pendente && rascunho.dados.mudancas.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Áreas alteradas">
                {rascunho.dados.mudancas.map((m) => <li key={m.campo} className="pill pill-warning">{rotuloCampo(m.campo)}</li>)}
              </ul>
            )}
          </div>
        ) : null}
      </Painel>

      <Painel titulo="Histórico de versões" descricao="Cada publicação congela uma cópia completa do agente. Restaurar cria uma nova versão publicada a partir de uma antiga." corpo="pb-2">
        {versoes.carregando && !versoes.dados ? (
          <Esqueleto linhas={4} />
        ) : versoes.erro ? (
          <Erro texto={versoes.erro} tentar={() => void versoes.recarregar()} />
        ) : !versoes.dados?.length ? (
          <Vazio icone="refresh" titulo="Nenhuma versão publicada" descricao="Quando você publicar o agente, as versões aparecem aqui para comparar e restaurar." />
        ) : (
          <ol className="divide-y divide-line">
            {versoes.dados.map((v) => (
              <li key={v.id} className={cx('px-5 py-4', v.atual && 'bg-brand-softer/50')}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="t-section">v{v.numero}</span>
                      {v.atual && <span className="pill pill-success">Atual</span>}
                      <span className={cx('pill', v.origem === 'proposta' ? 'pill-brand' : v.origem === 'restauracao' ? 'pill-info' : '')}>{ROTULO_ORIGEM[v.origem] ?? v.origem}</span>
                      {v.avaliacao && (
                        <span className={cx('pill', v.avaliacao.regressao ? 'pill-danger' : 'pill-success')}>
                          {v.avaliacao.nota !== null ? `Nota ${Number(v.avaliacao.nota).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}` : 'Avaliada'}
                          {v.avaliacao.regressao ? ' · regressão' : ''}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted">Publicada em {dataHora(v.createdAt)}</p>
                    {v.notas && <p className="mt-1.5 whitespace-pre-wrap break-words text-[13.5px] text-fg">{v.notas}</p>}
                    {v.mudancas.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`Mudanças da v${v.numero}`}>
                        {v.mudancas.map((m) => <li key={m} className="pill">{rotuloCampo(m)}</li>)}
                      </ul>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn btn-ghost btn-sm" onClick={() => void comparar(v)}><Icon name="eye" size={14} /> Comparar com o rascunho</button>
                    {!v.atual && (
                      <button className="btn btn-soft btn-sm" disabled={ocupado === `restaurar:${v.id}`} onClick={() => setRestaurar(v)}>
                        <Icon name="refresh" size={14} /> {ocupado === `restaurar:${v.id}` ? 'Restaurando…' : 'Restaurar'}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Painel>

      <Gaveta aberto={!!gaveta} onFechar={() => setGaveta(null)} titulo={gaveta?.titulo ?? 'Comparação'} largura="sm:w-[680px]">
        {gaveta && (gaveta.carregando ? (
          <Esqueleto linhas={5} />
        ) : gaveta.erro ? (
          <Erro texto={gaveta.erro} tentar={() => { const v = versoes.dados?.find((x) => x.id === gaveta.versionId); if (v) void comparar(v); }} />
        ) : gaveta.diff && gaveta.diff.mudancas.length === 0 ? (
          <Vazio icone="check2" titulo="Sem diferenças" descricao="Esta versão é igual ao rascunho atual." />
        ) : gaveta.diff ? (
          <div className="space-y-4">
            <p className="text-[13px] text-muted">{gaveta.diff.mudancas.length} {gaveta.diff.mudancas.length === 1 ? 'área difere' : 'áreas diferem'}. À esquerda o valor {gaveta.referencia.toLowerCase()}, à direita o do rascunho.</p>
            {gaveta.diff.mudancas.map((m) => <DiffCampo key={m.campo} campo={m.campo} antes={m.antes} depois={m.depois} referencia={gaveta.referencia} />)}
          </div>
        ) : null)}
      </Gaveta>

      <Confirmar
        aberto={!!restaurar}
        titulo={restaurar ? `Restaurar v${restaurar.numero}` : 'Restaurar versão'}
        texto={
          <>
            <p>Uma nova versão publicada será criada com o conteúdo da v{restaurar?.numero}, e ela passa a atender no WhatsApp imediatamente.</p>
            <p>O rascunho é reescrito com esse conteúdo: alterações não publicadas do rascunho atual serão perdidas. As versões existentes continuam no histórico.</p>
          </>
        }
        confirmar="Restaurar e publicar"
        onConfirmar={() => void confirmarRestauracao()}
        onFechar={() => setRestaurar(null)}
      />
    </div>
  );
}

// ------------------------------------------------------------------ exibição legível de valores

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const igualJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function DiffCampo({ campo, antes, depois, referencia }: { campo: string; antes: unknown; depois: unknown; referencia: string }) {
  // Seção de config: mostra só as chaves que mudaram.
  if (ehObjeto(antes) && ehObjeto(depois)) {
    const chaves = [...new Set([...Object.keys(antes), ...Object.keys(depois)])].filter((k) => !igualJson(antes[k], depois[k]));
    return (
      <section className="rounded-xl border border-line">
        <h3 className="border-b border-line px-4 py-2.5 text-[13.5px] font-semibold text-fg">{rotuloCampo(campo)}</h3>
        <div className="divide-y divide-line">
          {chaves.map((k) => (
            <div key={k} className="px-4 py-3">
              <p className="mb-1.5 text-[12.5px] font-medium text-muted">{k}</p>
              <AntesDepois antes={antes[k]} depois={depois[k]} referencia={referencia} />
            </div>
          ))}
        </div>
      </section>
    );
  }
  return (
    <section className="rounded-xl border border-line">
      <h3 className="border-b border-line px-4 py-2.5 text-[13.5px] font-semibold text-fg">{rotuloCampo(campo)}</h3>
      <div className="px-4 py-3"><AntesDepois antes={antes} depois={depois} referencia={referencia} /></div>
    </section>
  );
}

function AntesDepois({ antes, depois, referencia }: { antes: unknown; depois: unknown; referencia: string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="min-w-0 rounded-lg border border-danger-border bg-danger-soft/60 px-3 py-2">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{referencia}</p>
        <ValorLegivel v={antes} />
      </div>
      <div className="min-w-0 rounded-lg border border-success-border bg-success-soft/60 px-3 py-2">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">No rascunho</p>
        <ValorLegivel v={depois} />
      </div>
    </div>
  );
}

export function ValorLegivel({ v, nivel = 0 }: { v: unknown; nivel?: number }): ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-[13px] italic text-faint">(vazio)</span>;
  if (typeof v === 'boolean') return <span className="text-[13px] text-fg">{v ? 'Sim' : 'Não'}</span>;
  if (typeof v === 'number') return <span className="text-[13px] tabular text-fg">{v.toLocaleString('pt-BR')}</span>;
  if (typeof v === 'string') {
    return v.length > 80 || v.includes('\n') ? (
      <p className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-[13px] text-fg">{v}</p>
    ) : (
      <span className="break-words text-[13px] text-fg">{v}</span>
    );
  }
  if (Array.isArray(v)) {
    if (!v.length) return <span className="text-[13px] italic text-faint">(lista vazia)</span>;
    if (v.every((x) => typeof x !== 'object' || x === null)) {
      return (
        <ul className="flex flex-wrap gap-1">
          {v.map((x, i) => <li key={i} className="pill max-w-full"><span className="truncate">{String(x)}</span></li>)}
        </ul>
      );
    }
    return (
      <ol className="space-y-1.5">
        {v.map((x, i) => (
          <li key={i} className="rounded-md bg-surface/70 px-2 py-1.5">
            {ehObjeto(x) && typeof x.nome === 'string' ? <p className="text-[13px] font-medium text-fg">{x.nome}</p> : null}
            {nivel < 2 ? <ValorLegivel v={ehObjeto(x) && typeof x.nome === 'string' ? semChave(x, 'nome') : x} nivel={nivel + 1} /> : <JsonBloco v={x} />}
          </li>
        ))}
      </ol>
    );
  }
  if (ehObjeto(v)) {
    if (nivel >= 2) return <JsonBloco v={v} />;
    const entradas = Object.entries(v);
    if (!entradas.length) return <span className="text-[13px] italic text-faint">(vazio)</span>;
    return (
      <dl className="space-y-1">
        {entradas.map(([k, x]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11.5px] text-muted">{k}</dt>
            <dd className="min-w-0"><ValorLegivel v={x} nivel={nivel + 1} /></dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span className="text-[13px] text-fg">{String(v)}</span>;
}

function semChave(o: Record<string, unknown>, chave: string) {
  const { [chave]: _ignorado, ...resto } = o;
  void _ignorado;
  return resto;
}

function JsonBloco({ v }: { v: unknown }) {
  return <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface2 px-2 py-1.5 font-mono text-[11.5px] text-fg">{JSON.stringify(v, null, 2)}</pre>;
}
