'use client';

import { useEffect, useState } from 'react';
import { Field, Input } from '@/components/ui';
import { Icon } from '@/components/icons';
import { CAMPOS_CONDICAO, type NoGrafo } from '@/lib/automations';
import { agentesApi } from '@/lib/agents';
import { crm, type PipelineData } from '@/lib/crm';
import { customFields, type CampoDef } from '@/lib/custom-fields';
import { pipelineApi, type MotivoPerda } from '@/lib/pipeline';
import {
  CAMPOS_CONDICAO_MOTOR, DIAS_SEMANA, EVENTOS_ESPERA, amanha, motorApi, rotuloResponsavel,
  type FormularioResumo, type Responsavel,
} from '@/lib/automations-motor';

/** Tipos cujo painel mora aqui (Q3.1/Q3.2). */
export const TIPOS_MOTOR = new Set([
  'controle.esperar_ate', 'controle.meta', 'acao.remover_de_fluxo', 'acao.atribuir_usuario', 'acao.nao_perturbe',
  'acao.ativar_ia', 'acao.passar_humano',
  'acao.atualizar_negocio', 'acao.atualizar_contato', 'gatilho.agendado', 'gatilho.data_contato',
  'gatilho.formulario_enviado', 'gatilho.pagamento_recebido',
]);

type Cfg = Record<string, any>;
type Lista<T> = { itens: T[]; erro: boolean; carregando: boolean };

/** Carrega uma lista só quando o painel precisa dela; erro vira aviso no painel, não tela quebrada. */
function useLista<T>(ativo: boolean, carregar: () => Promise<T[]>): Lista<T> {
  const [estado, setEstado] = useState<Lista<T>>({ itens: [], erro: false, carregando: ativo });
  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    setEstado((e) => ({ ...e, carregando: true }));
    carregar()
      .then((itens) => vivo && setEstado({ itens, erro: false, carregando: false }))
      .catch(() => vivo && setEstado({ itens: [], erro: true, carregando: false }));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo]);
  return estado;
}

const Aviso = ({ children, tom = 'neutro' }: { children: React.ReactNode; tom?: 'neutro' | 'marca' | 'erro' }) => (
  <p className={tom === 'marca'
    ? 'rounded-lg bg-brand/10 px-3 py-2 text-[11px] leading-snug text-brand'
    : tom === 'erro' ? 'rounded-lg bg-red-500/10 px-3 py-2 text-[11px] leading-snug text-red-600 dark:text-red-400'
      : 'rounded-lg bg-[var(--fill-4)] px-3 py-2 text-[11px] leading-snug text-muted'}>{children}</p>
);

const FalhaLista = ({ lista, oque }: { lista: Lista<unknown>; oque: string }) =>
  lista.erro ? <Aviso tom="erro">Não foi possível carregar {oque}. Feche e abra o nó para tentar de novo.</Aviso> : null;

/** Painel de configuração dos nós da Q3.1/Q3.2. O PainelNo delega para cá. */
export function PainelNoMotor({ no, set, outrosFluxos }: {
  no: NoGrafo;
  set: (patch: Cfg) => void;
  outrosFluxos: { id: string; nome: string }[];
}) {
  const cfg = no.config as Cfg;
  const t = no.tipo;
  const precisaMembros = t === 'acao.atribuir_usuario' || (t === 'acao.atualizar_negocio' && cfg.dono === 'usuario');
  const precisaEtapas = t === 'acao.atualizar_negocio' || t === 'gatilho.agendado'
    || ((t === 'controle.meta' || (t === 'controle.esperar_ate' && cfg.modo === 'evento')) && cfg.evento === 'etapa_mudou');
  const precisaForms = t === 'gatilho.formulario_enviado' || ((t === 'controle.meta' || t === 'controle.esperar_ate') && cfg.evento === 'formulario_enviado');
  const membros = useLista<Responsavel>(precisaMembros, motorApi.responsaveis);
  const agentes = useLista<{ id: string; nome: string; status: string }>(t === 'acao.ativar_ia', () => agentesApi.listar().then((l) => l.filter((a) => a.status === 'ativo')));
  const etapas = useLista<{ id: string; nome: string }>(precisaEtapas, () => crm.pipeline().then((p: PipelineData) => p.stages.map((s) => ({ id: s.id, nome: s.nome }))));
  const forms = useLista<FormularioResumo>(precisaForms, motorApi.formularios);
  const camposContato = useLista<CampoDef>(['acao.atualizar_contato', 'gatilho.data_contato', 'controle.esperar_ate'].includes(t), () => customFields.list('contact').then((l) => l.filter((c) => !c.arquivado)));
  const camposNegocio = useLista<CampoDef>(['acao.atualizar_negocio', 'controle.esperar_ate'].includes(t), () => customFields.list('deal').then((l) => l.filter((c) => !c.arquivado)));
  const motivos = useLista<MotivoPerda>(t === 'acao.atualizar_negocio' && cfg.status === 'perdido', () => pipelineApi.motivos(true));

  switch (t) {
    // ------------------------------------------------------------ gatilhos
    case 'gatilho.agendado':
      return (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Quando">
              <select className="input" value={cfg.frequencia ?? 'diario'} onChange={(e) => set(e.target.value === 'uma_vez' && !cfg.data ? { frequencia: 'uma_vez', data: amanhaIso() } : { frequencia: e.target.value })}>
                <option value="uma_vez">Uma vez</option><option value="diario">Todo dia</option><option value="semanal">Toda semana</option><option value="mensal">Todo mês</option>
              </select>
            </Field>
            <Field label="Horário"><Input type="time" value={cfg.hora ?? '09:00'} onChange={(e) => set({ hora: e.target.value || '09:00' })} /></Field>
          </div>
          {cfg.frequencia === 'uma_vez' && (
            <Field label="Data" hint="Dispara uma única vez, no fuso do fluxo. Precisa estar publicado e ativo até lá.">
              <Input type="date" value={cfg.data ?? ''} min={hojeIso()} onChange={(e) => set({ data: e.target.value || undefined })} />
            </Field>
          )}
          {cfg.frequencia === 'semanal' && (
            <Field label="Dias da semana">
              <div className="flex flex-wrap gap-1">
                {DIAS_SEMANA.map((d, i) => {
                  const on = (cfg.diasSemana ?? [1]).includes(i);
                  return (
                    <button key={d} type="button" aria-pressed={on}
                      onClick={() => set({ diasSemana: on ? (cfg.diasSemana ?? [1]).filter((x: number) => x !== i) : [...(cfg.diasSemana ?? [1]), i].sort() })}
                      className={on ? 'rounded-lg bg-brand px-2 py-1 text-xs font-semibold text-white' : 'rounded-lg border border-line px-2 py-1 text-xs text-muted hover:text-fg'}>
                      {d}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}
          {cfg.frequencia === 'mensal' && (
            <Field label="Dia do mês" hint="31 em mês curto roda no último dia.">
              <Input type="number" min={1} max={31} value={cfg.diaMes ?? 1} onChange={(e) => set({ diaMes: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} />
            </Field>
          )}
          <Field label="Para quem">
            <select className="input" value={cfg.alvo ?? 'sem_contato'} onChange={(e) => set({ alvo: e.target.value })}>
              <option value="sem_contato">Uma execução, sem contato (avisos, relatórios, webhook)</option>
              <option value="segmento">Cada contato de um segmento</option>
            </select>
          </Field>
          {cfg.alvo === 'segmento' && (
            <>
              <Field label="Com alguma destas tags" hint="Separe por vírgula.">
                <Input value={(cfg.tags ?? []).join(', ')} onChange={(e) => set({ tags: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="vip, cliente" />
              </Field>
              <Field label="Com negócio aberto na etapa">
                <select className="input" value={cfg.stageId ?? ''} onChange={(e) => set({ stageId: e.target.value || undefined })}>
                  <option value="">Qualquer etapa</option>
                  {etapas.itens.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              </Field>
              <Aviso>Até 2.000 contatos por execução. Para listas grandes, use o nó Liberar em lotes logo depois.</Aviso>
            </>
          )}
          <Aviso tom="marca">O horário segue o fuso do fluxo (Configurações do fluxo). Começa a valer quando o fluxo é publicado; pausar desliga.</Aviso>
        </>
      );

    case 'gatilho.data_contato':
      return (
        <>
          <Field label="Data do contato">
            <select className="input" value={cfg.campo ?? 'contato.criadoEm'} onChange={(e) => set({ campo: e.target.value })}>
              <option value="contato.criadoEm">Data de cadastro</option>
              {camposContato.itens.filter((c) => c.tipo === 'date').map((c) => <option key={c.chave} value={`contato.campos.${c.chave}`}>{c.rotulo}</option>)}
            </select>
          </Field>
          <FalhaLista lista={camposContato} oque="os campos de data" />
          {!camposContato.carregando && !camposContato.erro && !camposContato.itens.some((c) => c.tipo === 'date') && (
            <Aviso>Para aniversário, crie um campo personalizado do tipo Data em Configurações, Campos.</Aviso>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Quando">
              <select className="input" value={cfg.quando ?? 'no_dia'} onChange={(e) => set({ quando: e.target.value, dias: e.target.value === 'no_dia' ? 0 : Math.max(1, cfg.dias ?? 1) })}>
                <option value="antes">Dias antes</option><option value="no_dia">No dia</option><option value="depois">Dias depois</option>
              </select>
            </Field>
            {cfg.quando !== 'no_dia' && cfg.quando && (
              <Field label="Dias"><Input type="number" min={1} max={365} value={cfg.dias ?? 1} onChange={(e) => set({ dias: Math.min(365, Math.max(1, Number(e.target.value) || 1)) })} /></Field>
            )}
          </div>
          <Field label="Horário do envio"><Input type="time" value={cfg.hora ?? '09:00'} onChange={(e) => set({ hora: e.target.value || '09:00' })} /></Field>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={cfg.anual ?? true} onChange={(e) => set({ anual: e.target.checked })} />
            Repetir todo ano (compara só dia e mês)
          </label>
          <Aviso tom="marca">Dispara uma vez por data (uma vez por ano no modo anual). Para repetir todo ano, deixe a reentrada do fluxo em &quot;sempre&quot;.</Aviso>
        </>
      );

    case 'gatilho.formulario_enviado':
      return (
        <>
          <Field label="Formulário" hint="Vazio = qualquer formulário.">
            <select className="input" value={cfg.formId ?? ''} onChange={(e) => set({ formId: e.target.value || undefined })}>
              <option value="">Qualquer formulário</option>
              {forms.itens.map((f) => <option key={f.id} value={f.id}>{f.nome}{f.ativo ? '' : ' (inativo)'}</option>)}
            </select>
          </Field>
          <FalhaLista lista={forms} oque="os formulários" />
          <Aviso tom="marca">Use as respostas na mensagem como <span className="font-mono">{'{{formulario.nome_do_campo}}'}</span>.</Aviso>
        </>
      );

    case 'gatilho.pagamento_recebido':
      return (
        <>
          <Field label="Valor mínimo (R$)" hint="Vazio = qualquer pagamento.">
            <Input type="number" min={0} step="0.01" className="tabular" value={cfg.valorMinimo ?? ''} onChange={(e) => set({ valorMinimo: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} />
          </Field>
          <Aviso tom="marca">Dispara quando uma cobrança do Financeiro vira paga. Use <span className="font-mono">{'{{pagamento.valorFormatado}}'}</span> e <span className="font-mono">{'{{pagamento.descricao}}'}</span>.</Aviso>
        </>
      );

    // ------------------------------------------------------------ controle
    case 'controle.esperar_ate': {
      const datas = [
        { valor: 'agendamento.inicio', rotulo: 'Agendamento (data e hora)' },
        { valor: 'contato.proximaAcaoAt', rotulo: 'Próxima ação do contato' },
        ...camposContato.itens.filter((c) => c.tipo === 'date').map((c) => ({ valor: `contato.campos.${c.chave}`, rotulo: `Contato · ${c.rotulo}` })),
        ...camposNegocio.itens.filter((c) => c.tipo === 'date').map((c) => ({ valor: `negocio.campos.${c.chave}`, rotulo: `Negócio · ${c.rotulo}` })),
      ];
      return (
        <>
          <Field label="Esperar até">
            <select className="input" value={cfg.modo ?? 'campo'} onChange={(e) => {
              const modo = e.target.value;
              if (modo === 'data') set({ modo, data: amanha(), hora: '09:00', seJaPassou: 'seguir', campo: undefined, evento: undefined });
              else if (modo === 'evento') set({ modo, evento: 'mensagem_recebida', duracao: 1, unidade: 'dias', campo: undefined, data: undefined });
              else set({ modo, campo: 'agendamento.inicio', deslocamento: 1, unidade: 'dias', direcao: 'antes', seJaPassou: 'seguir', data: undefined, evento: undefined });
            }}>
              <option value="campo">Uma data do contato ou do agendamento</option>
              <option value="data">Uma data e hora fixas</option>
              <option value="evento">Um acontecimento, com prazo</option>
            </select>
          </Field>

          {cfg.modo === 'data' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Data"><Input type="date" value={cfg.data ?? ''} onChange={(e) => set({ data: e.target.value })} /></Field>
              <Field label="Hora"><Input type="time" value={cfg.hora ?? '09:00'} onChange={(e) => set({ hora: e.target.value || '09:00' })} /></Field>
            </div>
          )}

          {(cfg.modo ?? 'campo') === 'campo' && (
            <>
              <Field label="Campo de data">
                <select className="input" value={cfg.campo ?? 'agendamento.inicio'} onChange={(e) => set({ campo: e.target.value })}>
                  {datas.map((d) => <option key={d.valor} value={d.valor}>{d.rotulo}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Quanto"><Input type="number" min={0} value={cfg.deslocamento ?? 0} onChange={(e) => set({ deslocamento: Math.max(0, Number(e.target.value) || 0) })} /></Field>
                <Field label="Unidade">
                  <select className="input" value={cfg.unidade ?? 'dias'} onChange={(e) => set({ unidade: e.target.value, hora: e.target.value === 'dias' ? cfg.hora : undefined })}>
                    <option value="minutos">minutos</option><option value="horas">horas</option><option value="dias">dias</option>
                  </select>
                </Field>
                <Field label="Quando">
                  <select className="input" value={cfg.direcao ?? 'antes'} onChange={(e) => set({ direcao: e.target.value })}>
                    <option value="antes">antes</option><option value="depois">depois</option>
                  </select>
                </Field>
              </div>
              {(cfg.unidade ?? 'dias') === 'dias' && (
                <Field label="No horário" hint="Vazio = mesma hora do campo (ou 09:00 se o campo não tem hora).">
                  <Input type="time" value={cfg.hora ?? ''} onChange={(e) => set({ hora: e.target.value || undefined })} />
                </Field>
              )}
              <FalhaLista lista={camposContato} oque="os campos de data" />
            </>
          )}

          {cfg.modo !== 'evento' && (
            <Field label="Se a data já passou ou estiver vazia">
              <select className="input" value={cfg.seJaPassou ?? 'seguir'} onChange={(e) => set({ seJaPassou: e.target.value })}>
                <option value="seguir">Seguir o fluxo agora</option>
                <option value="encerrar">Encerrar a execução</option>
              </select>
            </Field>
          )}

          {cfg.modo === 'evento' && (
            <>
              <FiltroEvento cfg={cfg} set={set} etapas={etapas.itens} forms={forms.itens} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Prazo"><Input type="number" min={1} value={cfg.duracao ?? 1} onChange={(e) => set({ duracao: Math.max(1, Number(e.target.value) || 1) })} /></Field>
                <Field label="Unidade">
                  <select className="input" value={cfg.unidade ?? 'dias'} onChange={(e) => set({ unidade: e.target.value })}>
                    <option value="minutos">minutos</option><option value="horas">horas</option><option value="dias">dias</option>
                  </select>
                </Field>
              </div>
              <Aviso tom="marca">Duas saídas: <strong>Aconteceu</strong> e <strong>Prazo expirou</strong>. Ligue as duas antes de publicar.</Aviso>
            </>
          )}
          <Aviso>A espera fica gravada na execução: sobrevive a reinício e a deploy.</Aviso>
        </>
      );
    }

    case 'controle.meta':
      return (
        <>
          <FiltroEvento cfg={cfg} set={set} etapas={etapas.itens} forms={forms.itens} />
          <Field label="Se o contato chegar aqui sem a meta">
            <select className="input" value={cfg.seNaoAtingida ?? 'seguir'} onChange={(e) => set({ seNaoAtingida: e.target.value })}>
              <option value="seguir">Seguir o fluxo mesmo assim</option>
              <option value="esperar">Esperar até a meta acontecer</option>
              <option value="encerrar">Encerrar a execução</option>
            </select>
          </Field>
          <Aviso tom="marca">Quando o evento acontece, o contato pula para cá de qualquer ponto anterior do fluxo e as esperas pendentes são canceladas.</Aviso>
        </>
      );

    // ------------------------------------------------------------ ações
    case 'acao.remover_de_fluxo':
      return (
        <>
          <Field label="Remover o contato">
            <select className="input" value={cfg.alvo ?? 'este'} onChange={(e) => set({ alvo: e.target.value })}>
              <option value="este">Deste fluxo (encerra aqui)</option>
              <option value="outros">Dos fluxos escolhidos</option>
              <option value="todos">De todos os outros fluxos</option>
            </select>
          </Field>
          {cfg.alvo === 'outros' && (
            <Field label="Fluxos">
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-line p-2 scrollbar-thin">
                {outrosFluxos.length === 0 && <p className="text-xs text-muted">Nenhum outro fluxo publicado.</p>}
                {outrosFluxos.map((f) => {
                  const on = (cfg.workflowIds ?? []).includes(f.id);
                  return (
                    <label key={f.id} className="flex items-center gap-2 text-sm text-fg">
                      <input type="checkbox" checked={on} onChange={() => set({ workflowIds: on ? cfg.workflowIds.filter((x: string) => x !== f.id) : [...(cfg.workflowIds ?? []), f.id] })} />
                      <span className="truncate">{f.nome}</span>
                    </label>
                  );
                })}
              </div>
            </Field>
          )}
          <Aviso>Cancela as execuções em andamento do contato. Ele pode entrar de novo depois, conforme a regra de reentrada de cada fluxo.</Aviso>
        </>
      );

    case 'acao.atribuir_usuario':
      return (
        <>
          <Field label="Como atribuir">
            <select className="input" value={cfg.modo ?? 'fixo'} onChange={(e) => set({ modo: e.target.value })}>
              <option value="fixo">Sempre para a mesma pessoa</option>
              <option value="rodizio">Rodízio entre pessoas</option>
            </select>
          </Field>
          <FalhaLista lista={membros} oque="a equipe" />
          {(cfg.modo ?? 'fixo') === 'fixo' ? (
            <Field label="Responsável">
              <select className="input" value={cfg.usuarioId ?? ''} onChange={(e) => set({ usuarioId: e.target.value || undefined })}>
                <option value="">Escolha…</option>
                {membros.itens.map((m) => <option key={m.identityId} value={m.identityId}>{rotuloResponsavel(m)}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Pessoas no rodízio" hint="Quem sair da conta deixa de receber automaticamente.">
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-line p-2 scrollbar-thin">
                {membros.itens.map((m) => {
                  const on = (cfg.usuarios ?? []).includes(m.identityId);
                  return (
                    <label key={m.identityId} className="flex items-center gap-2 text-sm text-fg">
                      <input type="checkbox" checked={on} onChange={() => set({ usuarios: on ? cfg.usuarios.filter((x: string) => x !== m.identityId) : [...(cfg.usuarios ?? []), m.identityId] })} />
                      <span className="truncate">{rotuloResponsavel(m)}</span>
                    </label>
                  );
                })}
              </div>
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={!!cfg.soSemDono} onChange={(e) => set({ soSemDono: e.target.checked })} />
            Só se o contato ainda não tiver responsável
          </label>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={!!cfg.negocio} onChange={(e) => set({ negocio: e.target.checked })} />
            Também no negócio aberto do contato
          </label>
        </>
      );

    case 'acao.ativar_ia':
      return (
        <>
          <FalhaLista lista={agentes} oque="os agentes" />
          <Field label="Agente">
            <select className="input" value={cfg.agentId ?? ''} onChange={(e) => set({ agentId: e.target.value || undefined })}>
              <option value="">Agente padrão do canal</option>
              {agentes.itens.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </select>
          </Field>
          <Aviso>Liga a IA na conversa do contato: a partir da próxima mensagem, quem responde é o agente. Se ele estiver pausado, o passo falha e cai na fila de erros.</Aviso>
        </>
      );

    case 'acao.passar_humano':
      return (
        <>
          <Field label="Motivo (opcional)">
            <input className="input" maxLength={300} value={cfg.motivo ?? ''} onChange={(e) => set({ motivo: e.target.value || undefined })} placeholder="Ex.: lead pediu proposta personalizada" />
          </Field>
          <Aviso>Tira a conversa da IA e distribui para quem da equipe tem menos conversas abertas.</Aviso>
        </>
      );

    case 'acao.nao_perturbe':
      return (
        <>
          <Field label="Não perturbe">
            <select className="input" value={cfg.ativar === false ? 'desligar' : 'ligar'} onChange={(e) => set({ ativar: e.target.value === 'ligar' })}>
              <option value="ligar">Ligar (parar de enviar mensagens)</option>
              <option value="desligar">Desligar (voltar a enviar)</option>
            </select>
          </Field>
          <Aviso>Vale para SMS, WhatsApp e e-mail ao contato, em todos os fluxos e envios. Avisos para a equipe continuam saindo.</Aviso>
        </>
      );

    case 'acao.atualizar_negocio':
      return (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Status">
              <select className="input" value={cfg.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined, motivoPerdaId: e.target.value === 'perdido' ? cfg.motivoPerdaId : undefined })}>
                <option value="">Manter</option><option value="aberto">Aberto</option><option value="ganho">Ganho</option><option value="perdido">Perdido</option>
              </select>
            </Field>
            <Field label="Valor (R$)" hint="Aceita {{variaveis.x}}.">
              <Input className="tabular" value={cfg.valor ?? ''} onChange={(e) => set({ valor: e.target.value || undefined })} placeholder="Manter" />
            </Field>
          </div>
          {cfg.status === 'perdido' && (
            <Field label="Motivo da perda">
              <select className="input" value={cfg.motivoPerdaId ?? ''} onChange={(e) => set({ motivoPerdaId: e.target.value || undefined })}>
                <option value="">Sem motivo</option>
                {motivos.itens.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </select>
            </Field>
          )}
          <Field label="Etapa">
            <select className="input" value={cfg.stageId ?? ''} onChange={(e) => set({ stageId: e.target.value || undefined })}>
              <option value="">Manter</option>
              {etapas.itens.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </Field>
          <Field label="Responsável">
            <select className="input" value={cfg.dono ?? 'manter'} onChange={(e) => set({ dono: e.target.value, ownerId: e.target.value === 'usuario' ? cfg.ownerId : undefined })}>
              <option value="manter">Manter</option>
              <option value="contato">O mesmo do contato</option>
              <option value="usuario">Uma pessoa específica</option>
              <option value="nenhum">Ninguém</option>
            </select>
          </Field>
          {cfg.dono === 'usuario' && (
            <Field label="Pessoa">
              <select className="input" value={cfg.ownerId ?? ''} onChange={(e) => set({ ownerId: e.target.value || undefined })}>
                <option value="">Escolha…</option>
                {membros.itens.map((m) => <option key={m.identityId} value={m.identityId}>{rotuloResponsavel(m)}</option>)}
              </select>
            </Field>
          )}
          <EditorCampos campos={cfg.campos ?? []} defs={camposNegocio.itens} onMudar={(campos) => set({ campos })} />
          <FalhaLista lista={camposNegocio} oque="os campos do negócio" />
          <Aviso>Usa o negócio da execução (gatilho de negócio ou criado antes no fluxo).</Aviso>
        </>
      );

    case 'acao.atualizar_contato':
      return (
        <>
          <Field label="Campo padrão" hint="Opcional.">
            <select className="input" value={cfg.campo ?? ''} onChange={(e) => set({ campo: e.target.value || undefined, valor: e.target.value ? cfg.valor ?? '' : undefined })}>
              <option value="">Nenhum</option>
              {[['nome', 'Nome'], ['email', 'E-mail'], ['telefone', 'Telefone'], ['empresa', 'Empresa'], ['tag', 'Tag principal'], ['valorEstimado', 'Valor estimado']].map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
          </Field>
          {cfg.campo && (
            <Field label="Novo valor" hint="Aceita {{contato.nome}} etc.">
              <Input value={cfg.valor ?? ''} onChange={(e) => set({ valor: e.target.value })} />
            </Field>
          )}
          <EditorCampos campos={cfg.campos ?? []} defs={camposContato.itens} onMudar={(campos) => set({ campos })} />
          <FalhaLista lista={camposContato} oque="os campos do contato" />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Adicionar tags"><Input value={(cfg.tagsAdicionar ?? []).join(', ')} onChange={(e) => set({ tagsAdicionar: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="cliente, vip" /></Field>
            <Field label="Remover tags"><Input value={(cfg.tagsRemover ?? []).join(', ')} onChange={(e) => set({ tagsRemover: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="lead" /></Field>
          </div>
        </>
      );

    default:
      return null;
  }
}

/** Evento + filtro (Meta e "Esperar até" no modo evento). */
function FiltroEvento({ cfg, set, etapas, forms }: { cfg: Cfg; set: (p: Cfg) => void; etapas: { id: string; nome: string }[]; forms: FormularioResumo[] }) {
  const limpar = { tag: undefined, stageId: undefined, status: undefined, formId: undefined, valorMinimo: undefined, contem: undefined };
  return (
    <>
      <Field label="Evento">
        <select className="input" value={cfg.evento ?? 'mensagem_recebida'} onChange={(e) => set({ ...limpar, evento: e.target.value })}>
          {EVENTOS_ESPERA.map((ev) => <option key={ev.valor} value={ev.valor}>{ev.rotulo}</option>)}
        </select>
      </Field>
      {cfg.evento === 'mensagem_recebida' && (
        <Field label="Só se a mensagem contiver" hint="Vazio = qualquer resposta."><Input value={cfg.contem ?? ''} onChange={(e) => set({ contem: e.target.value || undefined })} placeholder="sim, confirmo" /></Field>
      )}
      {cfg.evento === 'tag_adicionada' && (
        <Field label="Tag" hint="Vazio = qualquer tag."><Input value={cfg.tag ?? ''} onChange={(e) => set({ tag: e.target.value || undefined })} placeholder="pagou" /></Field>
      )}
      {cfg.evento === 'etapa_mudou' && (
        <Field label="Etapa">
          <select className="input" value={cfg.stageId ?? ''} onChange={(e) => set({ stageId: e.target.value || undefined })}>
            <option value="">Qualquer etapa</option>
            {etapas.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </Field>
      )}
      {cfg.evento === 'negocio_status' && (
        <Field label="Status">
          <select className="input" value={cfg.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}>
            <option value="">Ganho ou perdido</option><option value="ganho">Ganho</option><option value="perdido">Perdido</option>
          </select>
        </Field>
      )}
      {cfg.evento === 'formulario_enviado' && (
        <Field label="Formulário">
          <select className="input" value={cfg.formId ?? ''} onChange={(e) => set({ formId: e.target.value || undefined })}>
            <option value="">Qualquer formulário</option>
            {forms.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </Field>
      )}
      {cfg.evento === 'pagamento_recebido' && (
        <Field label="Valor mínimo (R$)" hint="Vazio = qualquer valor.">
          <Input type="number" min={0} step="0.01" className="tabular" value={cfg.valorMinimo ?? ''} onChange={(e) => set({ valorMinimo: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} />
        </Field>
      )}
    </>
  );
}

/** Lista de campos personalizados a gravar: campo (pela definição) + valor. */
function EditorCampos({ campos, defs, onMudar }: { campos: { chave: string; valor: string }[]; defs: CampoDef[]; onMudar: (c: { chave: string; valor: string }[]) => void }) {
  const dica = (chave: string) => {
    const tipo = defs.find((d) => d.chave === chave)?.tipo;
    if (tipo === 'multiselect') return 'Várias opções: separe por vírgula.';
    if (tipo === 'boolean') return 'Sim ou não.';
    if (tipo === 'date') return 'AAAA-MM-DD ou DD/MM/AAAA.';
    return 'Aceita {{...}}. Vazio limpa o campo.';
  };
  return (
    <Field label="Campos personalizados">
      <div className="space-y-2">
        {campos.map((c, i) => (
          <div key={i} className="space-y-1 rounded-lg bg-surface2 p-2">
            <div className="flex gap-1">
              <select className="input h-8 flex-1 text-xs" value={c.chave} onChange={(e) => onMudar(campos.map((x, j) => (j === i ? { ...x, chave: e.target.value } : x)))}>
                <option value="">Escolha o campo…</option>
                {defs.map((d) => <option key={d.chave} value={d.chave}>{d.rotulo}</option>)}
              </select>
              <button type="button" aria-label="Remover campo" className="px-1 text-muted hover:text-red-500" onClick={() => onMudar(campos.filter((_, j) => j !== i))}>
                <Icon name="close" size={12} />
              </button>
            </div>
            <Input className="h-8 text-xs" value={c.valor} onChange={(e) => onMudar(campos.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))} placeholder="valor" />
            {c.chave && <p className="text-[11px] text-muted">{dica(c.chave)}</p>}
          </div>
        ))}
        {defs.length > 0 ? (
          <button type="button" className="w-full rounded-lg border border-dashed border-line py-1 text-xs text-muted hover:text-brand" onClick={() => onMudar([...campos, { chave: defs[0].chave, valor: '' }])}>
            + campo
          </button>
        ) : <p className="text-xs text-muted">Nenhum campo personalizado criado (Configurações, Campos).</p>}
      </div>
    </Field>
  );
}

/** Operandos do If/Else: os de sempre + os da Q3.1 + campos personalizados da conta. */
export function useCamposCondicao(): { valor: string; rotulo: string }[] {
  const contato = useLista<CampoDef>(true, () => customFields.list('contact').then((l) => l.filter((c) => !c.arquivado)));
  const negocio = useLista<CampoDef>(true, () => customFields.list('deal').then((l) => l.filter((c) => !c.arquivado)));
  return [
    ...CAMPOS_CONDICAO,
    ...CAMPOS_CONDICAO_MOTOR,
    ...contato.itens.map((c) => ({ valor: `contato.campos.${c.chave}`, rotulo: `Contato · ${c.rotulo}` })),
    ...negocio.itens.map((c) => ({ valor: `negocio.campos.${c.chave}`, rotulo: `Negócio · ${c.rotulo}` })),
  ];
}

/** AAAA-MM-DD no fuso do navegador (o input date trabalha no dia local). */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const hojeIso = () => isoLocal(new Date());
const amanhaIso = () => isoLocal(new Date(Date.now() + 864e5));
