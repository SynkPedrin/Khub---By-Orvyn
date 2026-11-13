'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { agentesApi, dataHora, ROTULO_CAMPO_PERFIL, ROTULO_INTENCAO, valorTexto, type AgentConfig, type FatoPerfil, type Memoria as MemoriaItem, type PerfilContato } from '@/lib/agents';
import { Abas, Alternar, BarraSalvar, Campo, Confirmar, Erro, Esqueleto, Modal, Numero, Painel, Vazio, mensagemDeErro, useAcao, useCarga, useToast } from '../kit';
import { useSecaoConfig, type SecaoProps } from '../editor';

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_CHAVE_CUSTOM = /^[a-zA-Z][a-zA-Z0-9_]{0,59}$/;

const CAMADAS: { valor: MemoriaItem['camada']; rotulo: string; dica: string }[] = [
  { valor: 'curto', rotulo: 'Curto prazo', dica: 'Resumo da conversa atual' },
  { valor: 'longo', rotulo: 'Longo prazo', dica: 'Fatos e preferências que valem entre conversas' },
  { valor: 'operacional', rotulo: 'Operacional', dica: 'Compromissos, tarefas e próximos passos' },
];
const ROTULO_CAMADA: Record<string, string> = { curto: 'Curto prazo', longo: 'Longo prazo', operacional: 'Operacional' };
const TIPOS_MEMORIA: { valor: string; rotulo: string }[] = [
  { valor: 'fato', rotulo: 'Fato' },
  { valor: 'preferencia', rotulo: 'Preferência' },
  { valor: 'evento', rotulo: 'Evento' },
  { valor: 'objetivo', rotulo: 'Objetivo' },
  { valor: 'tarefa', rotulo: 'Tarefa' },
  { valor: 'compromisso', rotulo: 'Compromisso' },
  { valor: 'proximo_passo', rotulo: 'Próximo passo' },
];
const ROTULO_TIPO_MEMORIA: Record<string, string> = Object.fromEntries(TIPOS_MEMORIA.map((t) => [t.valor, t.rotulo]));
const ROTULO_ORIGEM_MEMORIA: Record<string, string> = { agente: 'Agente', humano: 'Equipe' };
const ORIGEM_FATO: Record<FatoPerfil['origem'], { rotulo: string; tom: string }> = {
  declarado: { rotulo: 'Declarado', tom: 'pill-success' },
  inferido: { rotulo: 'Inferido', tom: 'pill-warning' },
  humano: { rotulo: 'Equipe', tom: 'pill-brand' },
  crm: { rotulo: 'CRM', tom: 'pill-info' },
};
const STATUS_FATO: Record<FatoPerfil['status'], { rotulo: string; tom: string }> = {
  confirmado: { rotulo: 'Confirmado', tom: 'pill-success' },
  pendente: { rotulo: 'Pendente', tom: 'pill-warning' },
  rejeitado: { rotulo: 'Rejeitado', tom: 'pill-danger' },
};
const ROTULO_DECISAO: Record<string, string> = {
  aplicado: 'Aplicado',
  pendente_revisao: 'Pendente de revisão',
  ignorado_confianca: 'Ignorado (confiança baixa)',
  ignorado_politica: 'Ignorado (campo não automático)',
  ignorado_confirmado: 'Ignorado (já confirmado)',
  sincronizado_crm: 'Sincronizado com o CRM',
};
const ROTULO_STATUS_FOLLOWUP: Record<string, { rotulo: string; tom: string }> = {
  agendado: { rotulo: 'Agendado', tom: 'pill-info' },
  gerando: { rotulo: 'Gerando', tom: 'pill-info' },
  enviado: { rotulo: 'Enviado', tom: 'pill-success' },
  cancelado: { rotulo: 'Cancelado', tom: '' },
  pulado: { rotulo: 'Pulado', tom: 'pill-warning' },
  falhou: { rotulo: 'Falhou', tom: 'pill-danger' },
};
const SINCRONIZAVEIS: { valor: 'nome' | 'email' | 'empresa'; rotulo: string }[] = [
  { valor: 'nome', rotulo: 'Nome' },
  { valor: 'email', rotulo: 'E-mail' },
  { valor: 'empresa', rotulo: 'Empresa' },
];

const rotuloCampo = (c: string) => ROTULO_CAMPO_PERFIL[c] ?? c;
const pct = (n: number) => `${Math.round(n * 100)}%`;

function Chips<T extends string>({ opcoes, valores, onChange, rotulo }: { opcoes: { valor: T; rotulo: string }[]; valores: T[]; onChange: (v: T[]) => void; rotulo: string }) {
  return (
    <div role="group" aria-label={rotulo} className="flex flex-wrap gap-1.5">
      {opcoes.map((o) => {
        const on = valores.includes(o.valor);
        return (
          <button key={o.valor} type="button" aria-pressed={on} onClick={() => onChange(on ? valores.filter((v) => v !== o.valor) : [...valores, o.valor])} className={cx('pill cursor-pointer', on ? 'pill-brand' : 'hover:bg-surface2')}>
            {on && <Icon name="check" size={11} />}
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}

export function Memoria({ agente, catalogo, onAtualizado }: SecaoProps) {
  const [contatoPerfil, setContatoPerfil] = useState<string | null>(null);
  const [versaoLista, setVersaoLista] = useState(0);

  return (
    <div className="space-y-5">
      <ConfigMemoria agente={agente} catalogo={catalogo} onAtualizado={onAtualizado} />
      <ListaMemorias agenteId={agente.id} versao={versaoLista} onVerPerfil={setContatoPerfil} />
      <PerfilManager
        contactId={contatoPerfil}
        onEscolher={setContatoPerfil}
        agenteId={agente.id}
        versao={versaoLista}
        onDadosExcluidos={() => setVersaoLista((v) => v + 1)}
      />
    </div>
  );
}

// ------------------------------------------------------------------ configuração (memoria + crm)

function ConfigMemoria({ agente, catalogo, onAtualizado }: SecaoProps) {
  const toast = useToast();
  const mem = useSecaoConfig(agente, 'memoria', onAtualizado);
  const crm = useSecaoConfig(agente, 'crm', onAtualizado);
  const [salvandoAmbos, setSalvandoAmbos] = useState(false);
  const m = mem.rascunho;
  const c = crm.rascunho;

  const problemas: string[] = [];
  if (!Number.isInteger(m.resumirAPartirDe) || m.resumirAPartirDe < 10 || m.resumirAPartirDe > 300) problemas.push('Resumir a partir de: entre 10 e 300 mensagens');
  if (!Number.isInteger(m.retencaoDias) || m.retencaoDias < 0 || m.retencaoDias > 3650) problemas.push('Retenção: entre 0 e 3.650 dias');
  if (!Number.isFinite(c.limiarConfiancaAuto) || c.limiarConfiancaAuto < 0 || c.limiarConfiancaAuto > 1) problemas.push('Confiança mínima: entre 0 e 1');
  const chavesInvalidas = Object.entries(c.mapaCamposCustom).filter(([, v]) => !RE_CHAVE_CUSTOM.test(v));
  if (chavesInvalidas.length) problemas.push(`Chave de campo personalizado inválida em ${chavesInvalidas.map(([k]) => rotuloCampo(k)).join(', ')}`);

  const salvar = async () => {
    if (problemas.length) {
      toast('erro', problemas.join(' · '));
      return;
    }
    if (mem.sujo && crm.sujo) {
      setSalvandoAmbos(true);
      try {
        const a = await agentesApi.atualizar(agente.id, { config: { memoria: m, crm: c } });
        onAtualizado(a);
        toast('ok', 'Rascunho salvo. Publique para valer no atendimento.');
      } catch (e) {
        toast('erro', mensagemDeErro(e));
      } finally {
        setSalvandoAmbos(false);
      }
    } else if (mem.sujo) await mem.salvar();
    else await crm.salvar();
  };

  return (
    <>
      <Painel titulo="Memória do agente" descricao="O que o agente lembra de cada contato. Dados de IA são apagados quando o contato é excluído ou a pedido (LGPD).">
        <div className="grid gap-3 md:grid-cols-3">
          <Alternar ligado={m.curtoPrazo} onChange={(v) => mem.set('curtoPrazo', v)} rotulo="Curto prazo" descricao="Resume conversas longas para não perder o contexto." />
          <Alternar ligado={m.longoPrazo} onChange={(v) => mem.set('longoPrazo', v)} rotulo="Longo prazo" descricao="Guarda fatos e preferências entre conversas." />
          <Alternar ligado={m.operacional} onChange={(v) => mem.set('operacional', v)} rotulo="Operacional" descricao="Lembra compromissos, tarefas e próximos passos." />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Resumir a partir de" dica="Quantidade de mensagens para gerar o resumo (10 a 300).">
            <Numero valor={m.resumirAPartirDe} onChange={(v) => mem.set('resumirAPartirDe', v)} min={10} max={300} sufixo="mensagens" />
          </Campo>
          <Campo rotulo="Retenção" dica={m.retencaoDias === 0 ? 'Sem expiração automática.' : '0 = sem expiração automática. Máximo 3.650 dias.'}>
            <Numero valor={m.retencaoDias} onChange={(v) => mem.set('retencaoDias', v)} min={0} max={3650} sufixo="dias" />
          </Campo>
        </div>
      </Painel>

      <Painel titulo="Perfil e CRM" descricao="O agente extrai dados do contato durante a conversa. Fato declarado pelo contato vale mais que inferência, e inferência nunca sobrescreve fato confirmado.">
        <div className="space-y-5">
          <div>
            <span className="mb-1 block text-[13px] font-medium text-fg">Campos que a IA atualiza sozinha</span>
            <p className="mb-2 text-xs text-muted">Os demais ficam pendentes para a equipe confirmar no perfil do contato.</p>
            <Chips rotulo="Campos automáticos" opcoes={catalogo.camposPerfil.map((k) => ({ valor: k, rotulo: rotuloCampo(k) }))} valores={c.camposAutomaticos} onChange={(v) => crm.set('camposAutomaticos', v)} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <span className="mb-1 block text-[13px] font-medium text-fg">Gravar no cadastro do contato</span>
              <p className="mb-2 text-xs text-muted">Só quando o próprio contato informou (fato declarado).</p>
              <Chips rotulo="Sincronizar com o contato" opcoes={SINCRONIZAVEIS} valores={c.sincronizarContato} onChange={(v) => crm.set('sincronizarContato', v)} />
            </div>
            <Campo rotulo="Confiança mínima para aplicar sozinho" dica="Abaixo disso, a extração fica pendente de revisão.">
              <div className="flex items-center gap-3">
                <input type="range" min={0} max={1} step={0.05} value={Number.isFinite(c.limiarConfiancaAuto) ? c.limiarConfiancaAuto : 0} onChange={(e) => crm.set('limiarConfiancaAuto', Number(e.target.value))} className="w-full accent-[var(--brand)]" aria-label="Confiança mínima" />
                <span className="w-12 shrink-0 text-right text-[13px] tabular text-fg">{pct(Number.isFinite(c.limiarConfiancaAuto) ? c.limiarConfiancaAuto : 0)}</span>
              </div>
            </Campo>
          </div>
          <MapaCustom campos={catalogo.camposPerfil} mapa={c.mapaCamposCustom} onChange={(v) => crm.set('mapaCamposCustom', v)} />
        </div>
        {problemas.length > 0 && (mem.sujo || crm.sujo) && (
          <div role="alert" className="mt-4 rounded-xl border border-warning-border bg-warning-soft px-3.5 py-2.5 text-[13px] text-fg">{problemas.join(' · ')}</div>
        )}
      </Painel>

      <BarraSalvar
        sujo={mem.sujo || crm.sujo}
        salvando={mem.salvando || crm.salvando || salvandoAmbos}
        onSalvar={() => void salvar()}
        onDescartar={() => { mem.descartar(); crm.descartar(); }}
        aviso={problemas.length ? 'Há valores inválidos' : undefined}
      />
    </>
  );
}

function MapaCustom({ campos, mapa, onChange }: { campos: string[]; mapa: AgentConfig['crm']['mapaCamposCustom']; onChange: (m: Record<string, string>) => void }) {
  const livres = campos.filter((k) => !(k in mapa));
  const [novoCampo, setNovoCampo] = useState('');
  const [novaChave, setNovaChave] = useState('');
  const campoNovo = livres.includes(novoCampo) ? novoCampo : livres[0] ?? '';
  const chaveOk = RE_CHAVE_CUSTOM.test(novaChave);

  const adicionar = () => {
    if (!campoNovo || !chaveOk) return;
    onChange({ ...mapa, [campoNovo]: novaChave });
    setNovaChave('');
    setNovoCampo('');
  };

  return (
    <div>
      <span className="mb-1 block text-[13px] font-medium text-fg">Campos personalizados do contato</span>
      <p className="mb-2 text-xs text-muted">Copia um campo do perfil para um campo personalizado do CRM. Use a chave exatamente como cadastrada no CRM (letras, números e _).</p>
      {Object.keys(mapa).length > 0 && (
        <ul className="mb-3 divide-y divide-line rounded-xl border border-line">
          {Object.entries(mapa).map(([campo, chave]) => (
            <li key={campo} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              <span className="min-w-[140px] text-[13px] font-medium text-fg">{rotuloCampo(campo)}</span>
              <Icon name="arrowRight" size={14} className="text-faint" />
              <label className="min-w-0 flex-1">
                <span className="sr-only">Chave do campo personalizado para {rotuloCampo(campo)}</span>
                <input className="input" value={chave} maxLength={60} aria-invalid={!RE_CHAVE_CUSTOM.test(chave)} onChange={(e) => onChange({ ...mapa, [campo]: e.target.value })} />
              </label>
              <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Remover mapeamento de ${rotuloCampo(campo)}`} onClick={() => { const n = { ...mapa }; delete n[campo]; onChange(n); }}><Icon name="trash" size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      {livres.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="sm:w-56">
            <span className="sr-only">Campo do perfil</span>
            <select className="select" value={campoNovo} onChange={(e) => setNovoCampo(e.target.value)}>
              {livres.map((k) => <option key={k} value={k}>{rotuloCampo(k)}</option>)}
            </select>
          </label>
          <label className="min-w-0 flex-1">
            <span className="sr-only">Chave do campo personalizado</span>
            <input className="input" value={novaChave} maxLength={60} placeholder="chave_no_crm" aria-invalid={!!novaChave && !chaveOk} onChange={(e) => setNovaChave(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); adicionar(); } }} />
          </label>
          <button type="button" className="btn btn-soft btn-sm shrink-0" disabled={!campoNovo || !chaveOk} onClick={adicionar}><Icon name="plus" size={14} /> Mapear</button>
        </div>
      )}
      {novaChave && !chaveOk && <p className="mt-1 text-xs text-muted">A chave começa com letra e usa só letras, números e _ (até 60).</p>}
    </div>
  );
}

// ------------------------------------------------------------------ lista de memórias

type FiltroCamada = 'todas' | MemoriaItem['camada'];

function ListaMemorias({ agenteId, versao, onVerPerfil }: { agenteId: string; versao: number; onVerPerfil: (contactId: string) => void }) {
  const { ocupado, executar } = useAcao();
  const [camada, setCamada] = useState<FiltroCamada>('todas');
  const [itens, setItens] = useState<MemoriaItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [editar, setEditar] = useState<{ m: MemoriaItem; conteudo: string; importancia: number } | null>(null);
  const [remover, setRemover] = useState<MemoriaItem | null>(null);
  const [criar, setCriar] = useState<{ contactId: string; camada: MemoriaItem['camada']; tipo: string; conteudo: string; importancia: number } | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await agentesApi.memorias(agenteId, { camada: camada === 'todas' ? undefined : camada });
      setItens(r.itens);
      setCursor(r.nextCursor);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setCarregando(false);
    }
  }, [agenteId, camada]);
  useEffect(() => { void carregar(); }, [carregar, versao]);

  const mais = async () => {
    if (!cursor) return;
    setCarregandoMais(true);
    try {
      const r = await agentesApi.memorias(agenteId, { camada: camada === 'todas' ? undefined : camada, cursor });
      setItens((x) => [...x, ...r.itens.filter((n) => !x.some((o) => o.id === n.id))]);
      setCursor(r.nextCursor);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setCarregandoMais(false);
    }
  };

  const salvarEdicao = async () => {
    if (!editar) return;
    const { m, conteudo, importancia } = editar;
    const r = await executar('editar', () => agentesApi.atualizarMemoria(m.id, { conteudo: conteudo.trim(), importancia }), 'Memória atualizada');
    if (r) {
      setItens((x) => x.map((i) => (i.id === m.id ? { ...i, conteudo: conteudo.trim(), importancia } : i)));
      setEditar(null);
    }
  };
  const confirmarRemocao = async () => {
    if (!remover) return;
    const alvo = remover;
    setRemover(null);
    const r = await executar(`rem:${alvo.id}`, () => agentesApi.removerMemoria(alvo.id), 'Memória excluída');
    if (r) setItens((x) => x.filter((i) => i.id !== alvo.id));
  };
  const contatoOk = !criar?.contactId.trim() || RE_UUID.test(criar.contactId.trim());
  const salvarNova = async () => {
    if (!criar || !criar.conteudo.trim() || !contatoOk) return;
    const dados = { contactId: criar.contactId.trim() || undefined, camada: criar.camada, tipo: criar.tipo, conteudo: criar.conteudo.trim(), importancia: criar.importancia };
    const r = await executar('criar', () => agentesApi.criarMemoria(agenteId, dados), 'Memória criada');
    if (r) {
      setCriar(null);
      void carregar();
    }
  };

  return (
    <Painel
      titulo="Memórias"
      descricao="O que o agente guardou. Corrija o que estiver errado ou registre algo que ele precisa lembrar."
      acao={<button className="btn btn-soft btn-sm" onClick={() => setCriar({ contactId: '', camada: 'longo', tipo: 'fato', conteudo: '', importancia: 3 })}><Icon name="plus" size={14} /> Nova memória</button>}
      corpo="p-0"
    >
      <div className="px-5 pt-4">
        <Abas<FiltroCamada> valor={camada} onChange={setCamada} opcoes={[{ valor: 'todas', rotulo: 'Todas' }, ...CAMADAS.map((c) => ({ valor: c.valor, rotulo: c.rotulo }))]} />
      </div>
      {carregando ? (
        <Esqueleto linhas={4} />
      ) : erro && !itens.length ? (
        <Erro texto={erro} tentar={() => void carregar()} />
      ) : !itens.length ? (
        <Vazio icone="note" titulo="Nenhuma memória" descricao="As memórias aparecem conforme o agente conversa com os contatos." />
      ) : (
        <>
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {itens.map((m) => (
              <li key={m.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium text-fg">{m.contatoNome ?? (m.contactId ? 'Contato' : 'Sem contato (geral)')}</span>
                      <span className="pill pill-brand">{ROTULO_CAMADA[m.camada] ?? m.camada}</span>
                      <span className="pill">{ROTULO_TIPO_MEMORIA[m.tipo] ?? m.tipo}</span>
                      <span className="text-xs text-muted" aria-label={`Importância ${m.importancia} de 5`}>Importância {m.importancia}/5</span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] text-fg">{m.conteudo}</p>
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-faint">
                      <span>Origem: {ROTULO_ORIGEM_MEMORIA[m.origem] ?? m.origem}</span>
                      <span>Criada {dataHora(m.createdAt)}</span>
                      <span>{m.expiraEm ? `Expira ${dataHora(m.expiraEm)}` : 'Sem expiração'}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {m.contactId && (
                      <button className="btn btn-ghost btn-sm" onClick={() => onVerPerfil(m.contactId as string)}><Icon name="user" size={14} /> Perfil</button>
                    )}
                    <button className="btn btn-ghost btn-sm btn-icon" aria-label="Editar memória" onClick={() => setEditar({ m, conteudo: m.conteudo, importancia: m.importancia })}><Icon name="edit" size={14} /></button>
                    <button className="btn btn-ghost btn-sm btn-icon" aria-label="Excluir memória" disabled={ocupado === `rem:${m.id}`} onClick={() => setRemover(m)}><Icon name="trash" size={14} /></button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {erro && <p role="alert" className="px-5 pt-3 text-[13px] text-danger">{erro}</p>}
          {cursor && (
            <div className="flex justify-center border-t border-line p-4">
              <button className="btn btn-ghost btn-sm" disabled={carregandoMais} onClick={() => void mais()}>{carregandoMais ? 'Carregando…' : 'Carregar mais'}</button>
            </div>
          )}
        </>
      )}

      <Modal
        aberto={!!editar}
        onFechar={() => setEditar(null)}
        titulo="Editar memória"
        rodape={<><button className="btn btn-ghost" onClick={() => setEditar(null)}>Cancelar</button><button className="btn btn-primary" disabled={!editar?.conteudo.trim() || ocupado === 'editar'} onClick={() => void salvarEdicao()}>{ocupado === 'editar' ? 'Salvando…' : 'Salvar'}</button></>}
      >
        {editar && (
          <div className="space-y-4">
            <Campo rotulo="Conteúdo">
              <textarea className="textarea" rows={5} maxLength={6000} value={editar.conteudo} onChange={(e) => setEditar({ ...editar, conteudo: e.target.value })} />
            </Campo>
            <Campo rotulo="Importância" dica="1 = detalhe, 5 = essencial. Memórias mais importantes entram primeiro no contexto.">
              <select className="select" value={editar.importancia} onChange={(e) => setEditar({ ...editar, importancia: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Campo>
          </div>
        )}
      </Modal>

      <Modal
        aberto={!!criar}
        onFechar={() => setCriar(null)}
        titulo="Nova memória"
        rodape={<><button className="btn btn-ghost" onClick={() => setCriar(null)}>Cancelar</button><button className="btn btn-primary" disabled={!criar?.conteudo.trim() || !contatoOk || ocupado === 'criar'} onClick={() => void salvarNova()}>{ocupado === 'criar' ? 'Salvando…' : 'Criar'}</button></>}
      >
        {criar && (
          <div className="space-y-4">
            <Campo rotulo="ID do contato" dica={contatoOk ? 'Opcional. Vazio = memória geral do agente.' : 'Informe um UUID válido ou deixe vazio.'}>
              <input className="input" value={criar.contactId} placeholder="00000000-0000-0000-0000-000000000000" aria-invalid={!contatoOk} onChange={(e) => setCriar({ ...criar, contactId: e.target.value })} />
            </Campo>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo="Camada">
                <select className="select" value={criar.camada} onChange={(e) => setCriar({ ...criar, camada: e.target.value as MemoriaItem['camada'] })}>
                  {CAMADAS.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Tipo">
                <select className="select" value={criar.tipo} onChange={(e) => setCriar({ ...criar, tipo: e.target.value })}>
                  {TIPOS_MEMORIA.map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Importância">
                <select className="select" value={criar.importancia} onChange={(e) => setCriar({ ...criar, importancia: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Campo>
            </div>
            <p className="text-xs text-muted">{CAMADAS.find((c) => c.valor === criar.camada)?.dica}</p>
            <Campo rotulo="Conteúdo">
              <textarea className="textarea" rows={4} maxLength={6000} value={criar.conteudo} placeholder="Ex.: prefere ser contatado depois das 18h" onChange={(e) => setCriar({ ...criar, conteudo: e.target.value })} />
            </Campo>
          </div>
        )}
      </Modal>

      <Confirmar
        aberto={!!remover}
        titulo="Excluir memória"
        texto={<p>O agente deixa de lembrar disso nas próximas conversas.</p>}
        confirmar="Excluir"
        perigo
        onConfirmar={() => void confirmarRemocao()}
        onFechar={() => setRemover(null)}
      />
    </Painel>
  );
}

// ------------------------------------------------------------------ perfil do contato

function PerfilManager({ contactId, onEscolher, agenteId, versao, onDadosExcluidos }: { contactId: string | null; onEscolher: (id: string | null) => void; agenteId: string; versao: number; onDadosExcluidos: () => void }) {
  const [digitado, setDigitado] = useState(contactId ?? '');
  useEffect(() => { if (contactId) setDigitado(contactId); }, [contactId]);
  // Contatos conhecidos a partir das memórias deste agente (atalho de seleção).
  const conhecidos = useCarga(() => agentesApi.memorias(agenteId), [agenteId, versao]);
  const opcoes = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const m of conhecidos.dados?.itens ?? []) if (m.contactId && !mapa.has(m.contactId)) mapa.set(m.contactId, m.contatoNome ?? m.contactId);
    return [...mapa.entries()];
  }, [conhecidos.dados]);
  const valido = RE_UUID.test(digitado.trim());

  return (
    <Painel titulo="Perfil do contato" descricao="O que a IA sabe sobre um contato: fatos extraídos, histórico de decisões e follow-ups. Revise, corrija ou exclua.">
      <form className="flex flex-col gap-2 md:flex-row" onSubmit={(e) => { e.preventDefault(); if (valido) onEscolher(digitado.trim()); }}>
        {opcoes.length > 0 && (
          <label className="md:w-64">
            <span className="sr-only">Escolher contato recente</span>
            <select className="select" value={opcoes.some(([id]) => id === contactId) ? contactId ?? '' : ''} onChange={(e) => { if (e.target.value) { setDigitado(e.target.value); onEscolher(e.target.value); } }}>
              <option value="">Contatos com memória</option>
              {opcoes.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
            </select>
          </label>
        )}
        <label className="min-w-0 flex-1">
          <span className="sr-only">ID do contato</span>
          <input className="input" value={digitado} placeholder="ID do contato (UUID)" aria-invalid={!!digitado && !valido} onChange={(e) => setDigitado(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary btn-sm shrink-0" disabled={!valido}><Icon name="search" size={14} /> Abrir perfil</button>
      </form>
      {digitado && !valido && <p className="mt-1.5 text-xs text-muted">Informe um UUID válido.</p>}

      <div className="mt-5">
        {contactId ? (
          <DetalhePerfil key={contactId} contactId={contactId} agenteId={agenteId} onExcluido={() => { onEscolher(null); setDigitado(''); onDadosExcluidos(); }} />
        ) : (
          <Vazio icone="user" titulo="Nenhum contato selecionado" descricao="Escolha um contato com memória ou cole o ID do contato." />
        )}
      </div>
    </Painel>
  );
}

function DetalhePerfil({ contactId, agenteId, onExcluido }: { contactId: string; agenteId: string; onExcluido: () => void }) {
  const toast = useToast();
  const p = useCarga(() => agentesApi.perfil(contactId), [contactId]);
  const { ocupado, executar } = useAcao();
  const [editarFato, setEditarFato] = useState<{ campo: string; valor: string } | null>(null);
  const [naoConverteu, setNaoConverteu] = useState<string | null>(null);
  const [excluir, setExcluir] = useState(false);

  if (p.carregando && !p.dados) return <Esqueleto linhas={5} />;
  if (p.erro || !p.dados) return <Erro texto={p.erro ?? 'Perfil indisponível'} tentar={p.recarregar} />;
  const d: PerfilContato = p.dados;
  const followups = d.followups;

  const decidir = async (campo: string, acao: 'confirmar' | 'rejeitar' | 'editar', valor?: string) => {
    const r = await executar(`fato:${campo}:${acao}`, () => agentesApi.decidirFato(contactId, campo, acao, valor), acao === 'confirmar' ? 'Fato confirmado' : acao === 'rejeitar' ? 'Fato rejeitado' : 'Fato corrigido');
    if (r) {
      setEditarFato(null);
      void p.recarregar();
    }
  };
  const conversao = async (convertido: boolean, motivo?: string) => {
    const r = await executar('conversao', () => agentesApi.marcarConversao(contactId, convertido, motivo), convertido ? 'Marcado como convertido' : 'Marcado como não convertido');
    if (r !== null) {
      setNaoConverteu(null);
      void p.recarregar();
    }
  };
  const confirmarExclusao = async () => {
    setExcluir(false);
    const r = await executar('excluir', () => agentesApi.excluirPerfil(contactId));
    if (r) {
      const partes = Object.entries(r).map(([k, v]) => `${v} ${k}`).join(', ');
      toast('ok', `Dados de IA excluídos (${partes || 'nada a excluir'})`);
      onExcluido();
    }
  };

  const perfil = d.perfil;
  const resumo: [string, string | null][] = perfil
    ? [
        ['Temperatura', perfil.temperatura],
        ['Intenção', perfil.intencao ? ROTULO_INTENCAO[perfil.intencao] ?? perfil.intencao : null],
        ['Sentimento', perfil.sentimento],
        ['Urgência', perfil.urgencia],
        ['Etapa', perfil.etapa],
        ['Próxima ação', perfil.proximaAcao],
        ['Última interação', perfil.ultimaInteracaoAt ? dataHora(perfil.ultimaInteracaoAt) : null],
      ]
    : [];

  return (
    <div className="space-y-5">
      {/* Cabeçalho do contato */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line bg-surface2/60 p-4">
        <div className="min-w-0">
          <p className="t-title truncate">{d.contato.nome}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted">
            {d.contato.telefone && <span>{d.contato.telefone}</span>}
            {d.contato.email && <span>{d.contato.email}</span>}
            {d.contato.empresa && <span>{d.contato.empresa}</span>}
          </p>
          {(d.contato.tags.length > 0 || d.contato.optedOutAt) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {d.contato.optedOutAt && <span className="pill pill-danger">Pediu para não receber mensagens</span>}
              {d.contato.tags.map((t) => <span key={t} className="pill">{t}</span>)}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-soft btn-sm" disabled={ocupado === 'conversao'} onClick={() => void conversao(true)}><Icon name="check" size={14} /> Marcar como convertido</button>
          <button className="btn btn-ghost btn-sm" disabled={ocupado === 'conversao'} onClick={() => setNaoConverteu('')}>Não converteu</button>
        </div>
      </div>

      {/* Resumo */}
      {perfil ? (
        <div>
          <p className="t-label mb-2">Resumo do perfil</p>
          {perfil.resumo && <p className="mb-3 text-[13.5px] text-fg">{perfil.resumo}</p>}
          <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {resumo.map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line px-3 py-2">
                <dt className="text-[11.5px] text-muted">{k}</dt>
                <dd className="mt-0.5 break-words text-[13px] font-medium text-fg">{v || '-'}</dd>
              </div>
            ))}
          </dl>
          {(perfil.convertidoEm || perfil.motivoNaoConversao) && (
            <p className="mt-2.5 text-[13px] text-muted">
              {perfil.convertidoEm ? <span className="pill pill-success">Convertido em {dataHora(perfil.convertidoEm)}</span> : <span className="pill pill-warning">Não converteu{perfil.motivoNaoConversao ? `: ${perfil.motivoNaoConversao}` : ''}</span>}
            </p>
          )}
        </div>
      ) : (
        <Vazio icone="user" titulo="Sem perfil de IA ainda" descricao="O perfil é montado conforme o agente conversa com este contato." />
      )}

      {/* Fatos */}
      <div>
        <p className="t-label mb-2">Fatos do perfil</p>
        {d.fatos.length === 0 ? (
          <p className="text-[13px] text-muted">Nenhum fato extraído.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="tbl min-w-[720px]">
              <thead>
                <tr><th>Campo</th><th>Valor</th><th>Origem</th><th>Confiança</th><th>Status</th><th>Atualizado</th><th><span className="sr-only">Ações</span></th></tr>
              </thead>
              <tbody>
                {d.fatos.map((f) => (
                  <tr key={f.id}>
                    <td className="font-medium text-fg">{rotuloCampo(f.campo)}</td>
                    <td className="max-w-[260px] break-words">{valorTexto(f.valor) || '-'}</td>
                    <td><span className={cx('pill', ORIGEM_FATO[f.origem]?.tom)}>{ORIGEM_FATO[f.origem]?.rotulo ?? f.origem}</span></td>
                    <td className="tabular">{pct(f.confianca)}</td>
                    <td><span className={cx('pill', STATUS_FATO[f.status]?.tom)}>{STATUS_FATO[f.status]?.rotulo ?? f.status}</span></td>
                    <td className="whitespace-nowrap text-muted">{dataHora(f.atualizadoEm)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        {f.status !== 'confirmado' && <button className="btn btn-ghost btn-sm btn-icon" aria-label={`Confirmar ${rotuloCampo(f.campo)}`} title="Confirmar" disabled={!!ocupado} onClick={() => void decidir(f.campo, 'confirmar')}><Icon name="check" size={14} /></button>}
                        {f.status !== 'rejeitado' && <button className="btn btn-ghost btn-sm btn-icon" aria-label={`Rejeitar ${rotuloCampo(f.campo)}`} title="Rejeitar" disabled={!!ocupado} onClick={() => void decidir(f.campo, 'rejeitar')}><Icon name="close" size={14} /></button>}
                        <button className="btn btn-ghost btn-sm btn-icon" aria-label={`Editar ${rotuloCampo(f.campo)}`} title="Editar" onClick={() => setEditarFato({ campo: f.campo, valor: valorTexto(f.valor) })}><Icon name="edit" size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Histórico de extrações */}
      <div>
        <p className="t-label mb-2">Histórico de extrações</p>
        {d.extracoes.length === 0 ? (
          <p className="text-[13px] text-muted">Nenhuma extração registrada.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {d.extracoes.map((x) => (
              <li key={x.id} className="flex flex-wrap items-start justify-between gap-2 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-fg"><span className="font-medium">{rotuloCampo(x.campo)}</span>: {valorTexto(x.valor) || '-'}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {ROTULO_DECISAO[x.decisao] ?? x.decisao}{x.motivo ? ` · ${x.motivo}` : ''} · {ORIGEM_FATO[x.origem as FatoPerfil['origem']]?.rotulo ?? x.origem} · {pct(x.confianca)}
                  </p>
                </div>
                <span className="text-xs text-faint">{dataHora(x.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Follow-ups */}
      <div>
        <p className="t-label mb-2">Follow-ups deste contato</p>
        {followups.length === 0 ? (
          <p className="text-[13px] text-muted">Nenhum follow-up.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {followups.map((f) => {
              const st = ROTULO_STATUS_FOLLOWUP[f.status] ?? { rotulo: f.status, tom: '' };
              return (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[13px] text-fg">{f.estrategia} · tentativa {f.tentativa}</p>
                    <p className="text-xs text-muted">{f.executadoEm ? `Executado ${dataHora(f.executadoEm)}` : `Agendado para ${dataHora(f.agendadoPara)}`}{f.motivo ? ` · ${f.motivo}` : ''}</p>
                  </div>
                  <span className={cx('pill', st.tom)}>{st.rotulo}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* LGPD */}
      <div className="rounded-xl border border-danger-border bg-danger-soft p-4">
        <p className="text-[13.5px] font-medium text-fg">Excluir dados de IA deste contato (LGPD)</p>
        <p className="mt-1 text-[13px] text-muted">Apaga perfil, fatos, extrações e memórias, e cancela follow-ups agendados. O contato e as conversas no CRM continuam. A exclusão fica registrada na auditoria.</p>
        <button className="btn btn-danger btn-sm mt-3" disabled={ocupado === 'excluir'} onClick={() => setExcluir(true)}><Icon name="trash" size={14} /> Excluir dados de IA deste contato (LGPD)</button>
      </div>

      <Modal
        aberto={!!editarFato}
        onFechar={() => setEditarFato(null)}
        titulo={editarFato ? `Corrigir ${rotuloCampo(editarFato.campo)}` : 'Corrigir fato'}
        rodape={<><button className="btn btn-ghost" onClick={() => setEditarFato(null)}>Cancelar</button><button className="btn btn-primary" disabled={!editarFato?.valor.trim() || !!ocupado} onClick={() => editarFato && void decidir(editarFato.campo, 'editar', editarFato.valor.trim())}>Salvar como confirmado</button></>}
      >
        {editarFato && (
          <Campo rotulo="Valor correto" dica="O valor corrigido pela equipe fica confirmado e a IA não o sobrescreve.">
            <input className="input" value={editarFato.valor} maxLength={400} onChange={(e) => setEditarFato({ ...editarFato, valor: e.target.value })} autoFocus />
          </Campo>
        )}
      </Modal>

      <Modal
        aberto={naoConverteu !== null}
        onFechar={() => setNaoConverteu(null)}
        titulo="Não converteu"
        rodape={<><button className="btn btn-ghost" onClick={() => setNaoConverteu(null)}>Cancelar</button><button className="btn btn-primary" disabled={ocupado === 'conversao'} onClick={() => void conversao(false, naoConverteu?.trim() || undefined)}>Registrar</button></>}
      >
        <Campo rotulo="Motivo" dica="Opcional. Alimenta o aprendizado do agente.">
          <input className="input" value={naoConverteu ?? ''} maxLength={300} placeholder="Ex.: achou caro" onChange={(e) => setNaoConverteu(e.target.value)} autoFocus />
        </Campo>
      </Modal>

      <Confirmar
        aberto={excluir}
        titulo="Excluir dados de IA"
        texto={<p>Isso apaga definitivamente tudo o que a IA sabe sobre {d.contato.nome}. Não há como desfazer.</p>}
        confirmar="Excluir dados"
        perigo
        exigirTexto="EXCLUIR"
        onConfirmar={() => void confirmarExclusao()}
        onFechar={() => setExcluir(false)}
      />
    </div>
  );
}
