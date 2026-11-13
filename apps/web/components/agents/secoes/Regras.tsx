'use client';

import { useState } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { ROTULO_ACAO_REGRA, ROTULO_CAMPO_PERFIL, ROTULO_CONDICAO, ROTULO_INTENCAO, ROTULO_OBJECAO, ROTULO_OPERADOR, type AcaoRegra, type Condicao, type Regra, type TipoAcaoRegra } from '@/lib/agents';
import { BarraSalvar, Painel, Vazio } from '../kit';
import { useSecaoConfig, type SecaoProps } from '../editor';

const DE_CONDUTA: TipoAcaoRegra[] = ['instrucao', 'transferir', 'silenciar', 'consultar_base'];
const DE_AUTOMACAO: TipoAcaoRegra[] = ['adicionar_tag', 'remover_tag', 'acionar_workflow', 'iniciar_followup', 'mover_etapa', 'notificar_equipe'];

const OPCOES_FIXAS: Partial<Record<Condicao['campo'], { valor: string; rotulo: string }[]>> = {
  sentimento: [{ valor: 'positivo', rotulo: 'Positivo' }, { valor: 'neutro', rotulo: 'Neutro' }, { valor: 'negativo', rotulo: 'Negativo' }],
  urgencia: [{ valor: 'baixa', rotulo: 'Baixa' }, { valor: 'media', rotulo: 'Média' }, { valor: 'alta', rotulo: 'Alta' }],
  temperatura: [{ valor: 'fria', rotulo: 'Fria' }, { valor: 'morna', rotulo: 'Morna' }, { valor: 'quente', rotulo: 'Quente' }],
};

function novaRegra(modo: 'conduta' | 'automacao'): Regra {
  return {
    id: `r_${Date.now().toString(36)}`,
    nome: modo === 'conduta' ? 'Nova regra de conduta' : 'Nova automação',
    ativo: true,
    logica: 'e',
    umaVezPorConversa: modo === 'automacao',
    condicoes: [{ campo: 'intencao', operador: 'igual', valor: 'compra' }],
    acoes: [modo === 'conduta' ? { tipo: 'instrucao', valor: '' } : { tipo: 'adicionar_tag', valor: '' }],
  };
}

/**
 * Editor de regras SE/ENTÃO (`config.regras`). As mesmas regras alimentam
 * "Comportamento" (instruções, transferência, silêncio) e "Automações"
 * (tags, workflow, etapa, follow-up, notificação): o modo só filtra a lista.
 * Ações executáveis passam pelas MESMAS permissões das ferramentas.
 */
export function RegrasEditor({ agente, catalogo, onAtualizado, modo }: SecaoProps & { modo: 'conduta' | 'automacao' }) {
  const r = useSecaoConfig(agente, 'regras', onAtualizado);
  const [aberta, setAberta] = useState<string | null>(null);
  // Mesma lista nas duas abas (uma regra pode instruir E agir); o modo só
  // define o modelo de regra nova e a explicação.
  const visiveis = r.rascunho;
  const atualizar = (id: string, f: (x: Regra) => Regra) => r.setRascunho(r.rascunho.map((x) => (x.id === id ? f(x) : x)));
  const remover = (id: string) => r.setRascunho(r.rascunho.filter((x) => x.id !== id));
  const adicionar = () => {
    const n = novaRegra(modo);
    r.setRascunho([...r.rascunho, n]);
    setAberta(n.id);
  };

  return (
    <Painel
      titulo={modo === 'conduta' ? 'Regras de conduta' : 'Regras de automação'}
      descricao={modo === 'conduta' ? 'SE a análise da mensagem bater com as condições, ENTÃO o agente recebe a instrução, transfere ou fica em silêncio.' : 'SE a mensagem bater com as condições, ENTÃO o agente executa a ação no CRM, com as mesmas permissões das ferramentas.'}
      acao={<button className="btn btn-soft btn-sm" onClick={adicionar} disabled={r.rascunho.length >= 50}><Icon name="plus" size={14} /> Nova regra</button>}
    >
      {visiveis.length === 0 ? (
        <Vazio icone="filter" titulo="Nenhuma regra ainda" descricao={modo === 'conduta' ? 'Ex.: SE objeção é preço ENTÃO "pergunte o contexto antes de falar de valores".' : 'Ex.: SE intenção é compra ENTÃO adicionar a tag "quente".'} />
      ) : (
        <ul className="space-y-2.5">
          {visiveis.map((regra) => (
            <li key={regra.id} className={cx('rounded-xl border border-line', !regra.ativo && 'opacity-70')}>
              <div className="flex flex-wrap items-center gap-2 px-3.5 py-3">
                <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setAberta(aberta === regra.id ? null : regra.id)} aria-expanded={aberta === regra.id}>
                  <Icon name={aberta === regra.id ? 'minus' : 'plus'} size={13} />
                  <span className="truncate text-[14px] font-medium text-fg">{regra.nome}</span>
                </button>
                <span className="text-xs text-muted">{resumo(regra)}</span>
                <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" className="checkbox" checked={regra.ativo} onChange={(e) => atualizar(regra.id, (x) => ({ ...x, ativo: e.target.checked }))} /> Ativa</label>
                <button className="btn btn-ghost btn-icon btn-sm" aria-label="Remover regra" onClick={() => remover(regra.id)}><Icon name="trash" size={13} /></button>
              </div>
              {aberta === regra.id && (
                <div className="space-y-4 border-t border-line px-3.5 py-4">
                  <input className="input" maxLength={120} value={regra.nome} onChange={(e) => atualizar(regra.id, (x) => ({ ...x, nome: e.target.value }))} aria-label="Nome da regra" />
                  <div>
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-fg">
                      SE
                      <select className="select h-8 w-auto" value={regra.logica} onChange={(e) => atualizar(regra.id, (x) => ({ ...x, logica: e.target.value as 'e' | 'ou' }))} aria-label="Combinação das condições">
                        <option value="e">todas as condições</option>
                        <option value="ou">qualquer condição</option>
                      </select>
                    </div>
                    <ul className="space-y-2">
                      {regra.condicoes.map((c, i) => (
                        <li key={i}>
                          <LinhaCondicao
                            c={c}
                            intencoes={catalogo.intencoesBase}
                            objecoes={catalogo.objecoes}
                            camposPerfil={catalogo.camposPerfil}
                            onChange={(nc) => atualizar(regra.id, (x) => ({ ...x, condicoes: x.condicoes.map((y, j) => (j === i ? nc : y)) }))}
                            onRemover={regra.condicoes.length > 1 ? () => atualizar(regra.id, (x) => ({ ...x, condicoes: x.condicoes.filter((_, j) => j !== i) })) : undefined}
                          />
                        </li>
                      ))}
                    </ul>
                    {regra.condicoes.length < 8 && <button className="btn btn-ghost btn-sm mt-2" onClick={() => atualizar(regra.id, (x) => ({ ...x, condicoes: [...x.condicoes, { campo: 'intencao', operador: 'igual', valor: '' }] }))}><Icon name="plus" size={13} /> Condição</button>}
                  </div>
                  <div>
                    <p className="mb-2 text-[13px] font-semibold text-fg">ENTÃO</p>
                    <ul className="space-y-2">
                      {regra.acoes.map((a, i) => (
                        <li key={i}>
                          <LinhaAcao
                            a={a}
                            tipos={[...DE_CONDUTA, ...DE_AUTOMACAO]}
                            estrategias={catalogo.estrategiasFollowup.map((e) => ({ valor: e.id, rotulo: e.nome }))}
                            workflows={agente.config.permissoes.workflowsPermitidos}
                            onChange={(na) => atualizar(regra.id, (x) => ({ ...x, acoes: x.acoes.map((y, j) => (j === i ? na : y)) }))}
                            onRemover={regra.acoes.length > 1 ? () => atualizar(regra.id, (x) => ({ ...x, acoes: x.acoes.filter((_, j) => j !== i) })) : undefined}
                          />
                        </li>
                      ))}
                    </ul>
                    {regra.acoes.length < 6 && <button className="btn btn-ghost btn-sm mt-2" onClick={() => atualizar(regra.id, (x) => ({ ...x, acoes: [...x.acoes, { tipo: modo === 'conduta' ? 'instrucao' : 'adicionar_tag', valor: '' }] }))}><Icon name="plus" size={13} /> Ação</button>}
                  </div>
                  <label className="flex items-center gap-2 text-[13px] text-muted"><input type="checkbox" className="checkbox" checked={regra.umaVezPorConversa} onChange={(e) => atualizar(regra.id, (x) => ({ ...x, umaVezPorConversa: e.target.checked }))} /> Disparar no máximo uma vez por conversa</label>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <BarraSalvar sujo={r.sujo} salvando={r.salvando} onSalvar={r.salvar} onDescartar={r.descartar} />
    </Painel>
  );
}

function resumo(r: Regra): string {
  const c = r.condicoes.map((x) => `${ROTULO_CONDICAO[x.campo]} ${ROTULO_OPERADOR[x.operador]}${x.valor ? ` ${x.valor}` : ''}`).join(r.logica === 'e' ? ' e ' : ' ou ');
  const a = r.acoes.map((x) => ROTULO_ACAO_REGRA[x.tipo]).join(', ');
  return `SE ${c} ENTÃO ${a}`.slice(0, 110);
}

function LinhaCondicao({ c, intencoes, objecoes, camposPerfil, onChange, onRemover }: { c: Condicao; intencoes: string[]; objecoes: string[]; camposPerfil: string[]; onChange: (c: Condicao) => void; onRemover?: () => void }) {
  const opcoes =
    c.campo === 'intencao' ? intencoes.map((i) => ({ valor: i, rotulo: ROTULO_INTENCAO[i] ?? i }))
    : c.campo === 'objecao' ? objecoes.map((o) => ({ valor: o, rotulo: ROTULO_OBJECAO[o] ?? o }))
    : OPCOES_FIXAS[c.campo];
  const semValor = c.operador === 'existe' || c.operador === 'nao_existe';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="select h-9 w-auto" value={c.campo} onChange={(e) => onChange({ campo: e.target.value as Condicao['campo'], operador: c.operador, valor: '' })} aria-label="Campo">
        {(Object.keys(ROTULO_CONDICAO) as Condicao['campo'][]).map((k) => <option key={k} value={k}>{ROTULO_CONDICAO[k]}</option>)}
      </select>
      {c.campo === 'perfil' && (
        <select className="select h-9 w-auto" value={c.chave ?? ''} onChange={(e) => onChange({ ...c, chave: e.target.value })} aria-label="Campo do perfil">
          <option value="">Escolha o campo</option>
          {camposPerfil.map((k) => <option key={k} value={k}>{ROTULO_CAMPO_PERFIL[k] ?? k}</option>)}
        </select>
      )}
      <select className="select h-9 w-auto" value={c.operador} onChange={(e) => onChange({ ...c, operador: e.target.value as Condicao['operador'] })} aria-label="Operador">
        {(Object.keys(ROTULO_OPERADOR) as Condicao['operador'][]).map((k) => <option key={k} value={k}>{ROTULO_OPERADOR[k]}</option>)}
      </select>
      {!semValor && (opcoes ? (
        <select className="select h-9 min-w-[160px] flex-1" value={c.valor} onChange={(e) => onChange({ ...c, valor: e.target.value })} aria-label="Valor">
          <option value="">Escolha</option>
          {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
        </select>
      ) : (
        <input className="input h-9 min-w-[160px] flex-1" maxLength={200} value={c.valor} onChange={(e) => onChange({ ...c, valor: e.target.value })} placeholder={c.campo === 'palavra_chave' ? 'Ex.: desconto|promoção|mais barato' : 'Valor'} aria-label="Valor" />
      ))}
      {onRemover && <button className="btn btn-ghost btn-icon btn-sm" aria-label="Remover condição" onClick={onRemover}><Icon name="close" size={13} /></button>}
    </div>
  );
}

function LinhaAcao({ a, tipos, estrategias, workflows, onChange, onRemover }: { a: AcaoRegra; tipos: TipoAcaoRegra[]; estrategias: { valor: string; rotulo: string }[]; workflows: string[]; onChange: (a: AcaoRegra) => void; onRemover?: () => void }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <select className="select h-9 w-auto" value={a.tipo} onChange={(e) => onChange({ tipo: e.target.value as TipoAcaoRegra, valor: '' })} aria-label="Ação">
        {tipos.map((t) => <option key={t} value={t}>{ROTULO_ACAO_REGRA[t]}</option>)}
      </select>
      {a.tipo === 'silenciar' ? (
        <span className="self-center text-xs text-muted">O agente não responde esta mensagem.</span>
      ) : a.tipo === 'instrucao' ? (
        <textarea className="textarea min-h-[64px] flex-1" maxLength={1000} value={a.valor} onChange={(e) => onChange({ ...a, valor: e.target.value })} placeholder="Ex.: identifique o contexto da objeção e use só condições comerciais da base." aria-label="Instrução" />
      ) : a.tipo === 'iniciar_followup' ? (
        <select className="select h-9 flex-1" value={a.valor} onChange={(e) => onChange({ ...a, valor: e.target.value })} aria-label="Estratégia">
          <option value="">Escolha a estratégia</option>
          {estrategias.map((e) => <option key={e.valor} value={e.valor}>{e.rotulo}</option>)}
        </select>
      ) : a.tipo === 'acionar_workflow' ? (
        <div className="flex-1">
          <input className="input h-9" value={a.valor} onChange={(e) => onChange({ ...a, valor: e.target.value.trim() })} placeholder="ID do workflow" list="workflows-permitidos" aria-label="Workflow" />
          <datalist id="workflows-permitidos">{workflows.map((w) => <option key={w} value={w} />)}</datalist>
          {a.valor && !workflows.includes(a.valor) && <span className="mt-1 block text-xs text-warning">Este workflow não está na lista de permitidos (aba Permissões): a ação será recusada.</span>}
        </div>
      ) : (
        <input
          className="input h-9 flex-1"
          maxLength={1000}
          value={a.valor}
          onChange={(e) => onChange({ ...a, valor: e.target.value })}
          placeholder={{ transferir: 'Motivo da transferência', adicionar_tag: 'Nome da tag', remover_tag: 'Nome da tag', mover_etapa: 'Nome da etapa do funil', notificar_equipe: 'Mensagem para a equipe', consultar_base: 'O que buscar na base' }[a.tipo as string] ?? 'Valor'}
          aria-label="Valor da ação"
        />
      )}
      {onRemover && <button className="btn btn-ghost btn-icon btn-sm" aria-label="Remover ação" onClick={onRemover}><Icon name="close" size={13} /></button>}
    </div>
  );
}
