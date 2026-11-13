'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { agentesApi, dataHora, DIAS_SEMANA, type Followup as ItemFollowup, type RegraFollowup } from '@/lib/agents';
import { Abas, Alternar, Campo, Confirmar, Erro, Esqueleto, Modal, Numero, Painel, Texto, Vazio, clonar, igual, mensagemDeErro, useAcao, useCarga, useToast } from '../kit';
import type { SecaoProps } from '../editor';

const CONDICOES: { valor: string; rotulo: string; dica: string }[] = [
  { valor: 'respondeu', rotulo: 'Contato respondeu', dica: 'Para a sequência quando o contato escreve depois do agendamento.' },
  { valor: 'converteu', rotulo: 'Contato converteu', dica: 'Para quando o perfil é marcado como convertido.' },
  { valor: 'optout', rotulo: 'Contato pediu para não receber', dica: 'Sempre ativa: opt-out para qualquer follow-up.' },
  { valor: 'humano_assumiu', rotulo: 'Humano assumiu a conversa', dica: 'Para quando alguém da equipe assume o atendimento.' },
  { valor: 'agendou', rotulo: 'Contato agendou', dica: 'Para quando existe agendamento confirmado.' },
  { valor: 'desinteresse', rotulo: 'Demonstrou desinteresse', dica: 'Para quando a análise identifica desinteresse.' },
];

const ROTULO_STATUS: Record<ItemFollowup['status'], string> = { agendado: 'Agendado', gerando: 'Gerando', enviado: 'Enviado', cancelado: 'Cancelado', pulado: 'Pulado', falhou: 'Falhou' };
const TOM_STATUS: Record<ItemFollowup['status'], string> = { agendado: 'pill-info', gerando: 'pill-info', enviado: 'pill-success', cancelado: '', pulado: 'pill-warning', falhou: 'pill-danger' };
type FiltroStatus = 'todos' | ItemFollowup['status'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 4 → "4 h", 24 → "1 dia", 72 → "3 dias", 168 → "1 semana". */
export function horasHumanas(h: number): string {
  if (h < 24) return `${h} h`;
  if (h % 24 !== 0) return `${Math.floor(h / 24)} d ${h % 24} h`;
  const d = h / 24;
  if (d % 7 === 0) return d / 7 === 1 ? '1 semana' : `${d / 7} semanas`;
  return d === 1 ? '1 dia' : `${d} dias`;
}

const diasTexto = (dias: number[]) => {
  const ord = [...dias].sort((a, b) => a - b);
  if (ord.length === 7) return 'todos os dias';
  if (igual(ord, [1, 2, 3, 4, 5])) return 'Seg a Sex';
  return ord.map((d) => DIAS_SEMANA[d]).join(', ') || 'nenhum dia';
};

const paraLocal = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

type Editavel = Pick<RegraFollowup, 'nome' | 'ativo' | 'maxTentativas' | 'intervalosHoras' | 'horarioInicio' | 'horarioFim' | 'diasSemana' | 'fuso' | 'objetivo' | 'tom' | 'instrucoes' | 'pararSe' | 'maxMensagensDia' | 'prioridade'>;
const editavel = (r: RegraFollowup): Editavel => ({
  nome: r.nome,
  ativo: r.ativo,
  maxTentativas: r.maxTentativas,
  intervalosHoras: [...r.intervalosHoras],
  horarioInicio: r.horarioInicio,
  horarioFim: r.horarioFim,
  diasSemana: [...r.diasSemana].sort((a, b) => a - b),
  fuso: r.fuso || 'America/Sao_Paulo',
  objetivo: r.objetivo,
  tom: r.tom,
  instrucoes: r.instrucoes,
  pararSe: r.pararSe.includes('optout') ? [...r.pararSe] : [...r.pararSe, 'optout'],
  maxMensagensDia: r.maxMensagensDia,
  prioridade: r.prioridade,
});

function validar(e: Editavel): string | null {
  if (!e.nome.trim()) return 'Dê um nome para a estratégia';
  if (!Number.isInteger(e.maxTentativas) || e.maxTentativas < 1 || e.maxTentativas > 10) return 'Tentativas: de 1 a 10';
  if (!e.intervalosHoras.length) return 'Informe ao menos um intervalo';
  if (!Number.isInteger(e.horarioInicio) || e.horarioInicio < 0 || e.horarioInicio > 23) return 'Início da janela: de 0 a 23 h';
  if (!Number.isInteger(e.horarioFim) || e.horarioFim < 1 || e.horarioFim > 24) return 'Fim da janela: de 1 a 24 h';
  if (e.horarioInicio >= e.horarioFim) return 'O início da janela precisa ser antes do fim';
  if (!e.diasSemana.length) return 'Escolha ao menos um dia da semana';
  if (!e.fuso.trim()) return 'Informe o fuso horário';
  if (!Number.isInteger(e.maxMensagensDia) || e.maxMensagensDia < 1 || e.maxMensagensDia > 5) return 'Mensagens por dia: de 1 a 5';
  if (!Number.isInteger(e.prioridade) || e.prioridade < 1 || e.prioridade > 10) return 'Prioridade: de 1 a 10';
  return null;
}

/** Follow-up Builder: estratégias do agente, histórico e disparo manual. */
export function Followup({ agente }: SecaoProps) {
  const regras = useCarga(() => agentesApi.regrasFollowup(agente.id), [agente.id]);
  const [versaoHistorico, setVersaoHistorico] = useState(0);

  const atualizarRegra = (r: RegraFollowup) => regras.setDados((lista) => (lista ?? []).map((x) => (x.estrategia === r.estrategia ? r : x)));

  return (
    <div className="space-y-5">
      <Painel
        titulo="Estratégias de follow-up"
        descricao="Quando o contato para de responder, o agente retoma a conversa seguindo a estratégia mais adequada ao contexto. Cada estratégia tem janela de envio, intervalos e condições de parada próprias."
        corpo="p-5 pt-4"
      >
        {regras.carregando && !regras.dados ? (
          <Esqueleto linhas={4} />
        ) : regras.erro ? (
          <Erro texto={regras.erro} tentar={() => void regras.recarregar()} />
        ) : !regras.dados?.length ? (
          <Vazio icone="clock" titulo="Nenhuma estratégia disponível" />
        ) : (
          <div className="space-y-3">
            {regras.dados.map((r) => <CartaoRegra key={r.estrategia} agenteId={agente.id} regra={r} onSalva={atualizarRegra} />)}
          </div>
        )}
      </Painel>

      <IniciarManual agenteId={agente.id} regras={regras.dados ?? []} onIniciado={() => setVersaoHistorico((v) => v + 1)} />

      <Historico agenteId={agente.id} versao={versaoHistorico} nomeEstrategia={(id) => regras.dados?.find((r) => r.estrategia === id)?.nome ?? id} />
    </div>
  );
}

function CartaoRegra({ agenteId, regra, onSalva }: { agenteId: string; regra: RegraFollowup; onSalva: (r: RegraFollowup) => void }) {
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState<Editavel>(() => editavel(regra));
  const [salvando, setSalvando] = useState(false);
  const [novoIntervalo, setNovoIntervalo] = useState('');
  useEffect(() => { setRascunho(editavel(regra)); }, [regra]);

  const original = editavel(regra);
  const sujo = !igual(rascunho, original);
  const set = <K extends keyof Editavel>(k: K, v: Editavel[K]) => setRascunho((r) => ({ ...r, [k]: v }));
  const idBase = `fu-${regra.estrategia}`;

  const salvar = async (dados: Partial<Editavel>, sucesso: string) => {
    setSalvando(true);
    try {
      const r = await agentesApi.salvarRegraFollowup(agenteId, regra.estrategia, dados);
      onSalva({ ...r, catalogo: r.catalogo ?? regra.catalogo });
      toast('ok', sucesso);
      return true;
    } catch (e) {
      toast('erro', mensagemDeErro(e));
      return false;
    } finally {
      setSalvando(false);
    }
  };

  const salvarTudo = async () => {
    const erro = validar(rascunho);
    if (erro) return toast('erro', erro);
    await salvar({ ...rascunho, nome: rascunho.nome.trim(), fuso: rascunho.fuso.trim() }, `Estratégia "${rascunho.nome.trim()}" salva`);
  };

  const alternarAtivo = async (v: boolean) => {
    // Regra ainda não salva: grava a configuração inteira junto, para não perder o que foi editado.
    const dados = regra.salva ? { ativo: v } : { ...rascunho, ativo: v };
    if (!regra.salva) {
      const erro = validar(rascunho);
      if (erro) return toast('erro', erro);
    }
    await salvar(dados, v ? 'Estratégia ativada' : 'Estratégia desativada');
  };

  const adicionarIntervalo = () => {
    const h = Number(novoIntervalo);
    if (!Number.isInteger(h) || h < 1 || h > 8760) return toast('erro', 'Intervalo em horas inteiras, de 1 a 8760');
    if (rascunho.intervalosHoras.length >= 10) return toast('erro', 'No máximo 10 intervalos');
    set('intervalosHoras', [...rascunho.intervalosHoras, h]);
    setNovoIntervalo('');
  };

  const restaurarCatalogo = () =>
    setRascunho((r) => ({ ...r, nome: regra.catalogo.nome, objetivo: regra.catalogo.objetivo, instrucoes: regra.catalogo.instrucoes, intervalosHoras: [...regra.catalogo.intervalos], maxTentativas: regra.catalogo.tentativas }));

  const resumo = `${original.maxTentativas} ${original.maxTentativas === 1 ? 'tentativa' : 'tentativas'} · ${original.intervalosHoras.map(horasHumanas).join(', ')} · ${diasTexto(original.diasSemana)}, ${original.horarioInicio} h às ${original.horarioFim} h`;

  return (
    <article className={cx('rounded-xl border', regra.ativo ? 'border-brand-border' : 'border-line')}>
      <header className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          role="switch"
          aria-checked={regra.ativo}
          aria-label={`${regra.ativo ? 'Desativar' : 'Ativar'} ${regra.nome}`}
          disabled={salvando}
          onClick={() => void alternarAtivo(!regra.ativo)}
          className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60', regra.ativo ? 'bg-brand' : 'bg-surface3')}
        >
          <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', regra.ativo ? 'translate-x-[18px]' : 'translate-x-0.5')} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-semibold text-fg">{regra.nome}</h3>
            {!regra.salva && <span className="pill">Padrão do catálogo, não salva</span>}
            {sujo && <span className="pill pill-warning">Alterações não salvas</span>}
          </div>
          <p className="mt-0.5 text-xs text-muted">{resumo}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={aberto} aria-controls={`${idBase}-corpo`} onClick={() => setAberto((a) => !a)}>
          <Icon name="edit" size={14} /> {aberto ? 'Fechar' : 'Editar'}
        </button>
      </header>

      {aberto && (
        <div id={`${idBase}-corpo`} className="space-y-4 border-t border-line px-4 py-4">
          <p className="text-[13px] text-muted">{regra.catalogo.objetivo}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Campo rotulo="Nome"><input className="input" maxLength={80} value={rascunho.nome} onChange={(e) => set('nome', e.target.value)} /></Campo>
            <Campo rotulo="Tom" dica="Opcional. Ex.: leve e cordial, sem pressão"><input className="input" maxLength={200} value={rascunho.tom} onChange={(e) => set('tom', e.target.value)} /></Campo>
            <Campo rotulo="Máximo de tentativas"><Numero valor={rascunho.maxTentativas} onChange={(v) => set('maxTentativas', v)} min={1} max={10} /></Campo>
            <Campo rotulo="Máximo de mensagens por dia"><Numero valor={rascunho.maxMensagensDia} onChange={(v) => set('maxMensagensDia', v)} min={1} max={5} /></Campo>
          </div>

          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-fg">Intervalos entre tentativas</span>
            <p className="mb-2 text-xs text-muted">Contados a partir da última interação. A tentativa N usa o intervalo N; se houver mais tentativas que intervalos, repete o último.</p>
            <ol className="mb-2 flex flex-wrap gap-1.5" aria-label="Intervalos">
              {rascunho.intervalosHoras.map((h, i) => (
                <li key={`${h}-${i}`} className="pill pill-brand">
                  <span>{i + 1}ª: {horasHumanas(h)}</span>
                  <button type="button" aria-label={`Remover intervalo ${i + 1}`} className="opacity-70 hover:opacity-100" onClick={() => set('intervalosHoras', rascunho.intervalosHoras.filter((_, k) => k !== i))}><Icon name="close" size={11} /></button>
                </li>
              ))}
              {!rascunho.intervalosHoras.length && <li className="text-xs text-danger">Adicione ao menos um intervalo.</li>}
            </ol>
            <div className="flex max-w-xs gap-2">
              <label htmlFor={`${idBase}-int`} className="sr-only">Novo intervalo em horas</label>
              <input
                id={`${idBase}-int`}
                className="input tabular"
                type="number"
                min={1}
                max={8760}
                placeholder="Horas (ex.: 24)"
                value={novoIntervalo}
                onChange={(e) => setNovoIntervalo(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); adicionarIntervalo(); } }}
              />
              <button type="button" className="btn btn-soft btn-sm shrink-0" disabled={!novoIntervalo} onClick={adicionarIntervalo}><Icon name="plus" size={14} /> Adicionar</button>
            </div>
            {rascunho.intervalosHoras.length > 0 && <p className="mt-1.5 text-xs text-muted">Sequência: {rascunho.intervalosHoras.map(horasHumanas).join(', ')}</p>}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Campo rotulo="Janela: início (h)"><Numero valor={rascunho.horarioInicio} onChange={(v) => set('horarioInicio', v)} min={0} max={23} sufixo="h" /></Campo>
            <Campo rotulo="Janela: fim (h)"><Numero valor={rascunho.horarioFim} onChange={(v) => set('horarioFim', v)} min={1} max={24} sufixo="h" /></Campo>
            <Campo rotulo="Fuso horário" dica="Ex.: America/Sao_Paulo, America/Manaus"><input className="input" maxLength={60} value={rascunho.fuso} onChange={(e) => set('fuso', e.target.value)} spellCheck={false} /></Campo>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-fg">Dias da semana</legend>
            <div className="flex flex-wrap gap-1.5">
              {DIAS_SEMANA.map((d, i) => {
                const on = rascunho.diasSemana.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set('diasSemana', on ? rascunho.diasSemana.filter((x) => x !== i) : [...rascunho.diasSemana, i].sort((a, b) => a - b))}
                    className={cx('min-w-[48px] rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors', on ? 'border-brand-border bg-brand-soft text-brand' : 'border-line text-muted hover:bg-surface2')}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <Campo rotulo="Objetivo"><Texto valor={rascunho.objetivo} onChange={(v) => set('objetivo', v)} max={500} linhas={2} /></Campo>
          <Campo rotulo="Instruções para a mensagem" dica="Como o agente deve escrever esta retomada. Valores e condições só da base de conhecimento."><Texto valor={rascunho.instrucoes} onChange={(v) => set('instrucoes', v)} max={2000} linhas={4} /></Campo>

          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-fg">Parar a sequência quando</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {CONDICOES.map((c) => {
                const forcada = c.valor === 'optout';
                const on = forcada || rascunho.pararSe.includes(c.valor);
                return (
                  <label key={c.valor} className={cx('flex items-start gap-2.5 rounded-lg border border-line px-3 py-2 text-[13px]', forcada ? 'cursor-not-allowed opacity-75' : 'cursor-pointer hover:bg-surface2/70')}>
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
                      checked={on}
                      disabled={forcada}
                      onChange={(e) => set('pararSe', e.target.checked ? [...rascunho.pararSe, c.valor] : rascunho.pararSe.filter((x) => x !== c.valor))}
                    />
                    <span>
                      <span className="block font-medium text-fg">{c.rotulo}</span>
                      <span className="block text-xs text-muted">{c.dica}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="max-w-[200px]">
            <Campo rotulo="Prioridade" dica="1 é a mais alta."><Numero valor={rascunho.prioridade} onChange={(v) => set('prioridade', v)} min={1} max={10} /></Campo>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
            <button type="button" className="btn btn-ghost btn-sm" onClick={restaurarCatalogo}><Icon name="refresh" size={14} /> Usar textos e intervalos do catálogo</button>
            <div className="flex gap-2">
              <button type="button" className="btn btn-ghost btn-sm" disabled={!sujo || salvando} onClick={() => setRascunho(editavel(regra))}>Descartar</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={(!sujo && regra.salva) || salvando} onClick={() => void salvarTudo()}>{salvando ? 'Salvando…' : 'Salvar estratégia'}</button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

function IniciarManual({ agenteId, regras, onIniciado }: { agenteId: string; regras: RegraFollowup[]; onIniciado: () => void }) {
  const { ocupado, executar } = useAcao();
  const toast = useToast();
  const [contactId, setContactId] = useState('');
  const [estrategia, setEstrategia] = useState('');
  const [resultado, setResultado] = useState<string | null>(null);
  const escolhida = estrategia || regras[0]?.estrategia || '';

  const iniciar = async () => {
    setResultado(null);
    const cid = contactId.trim();
    if (!UUID.test(cid)) return toast('erro', 'Informe o ID (UUID) do contato');
    if (!escolhida) return;
    const r = await executar('iniciar', () => agentesApi.iniciarFollowup(agenteId, cid, escolhida));
    if (!r) return;
    if (r.agendado) {
      toast('ok', 'Follow-up agendado');
      setContactId('');
      onIniciado();
    } else {
      setResultado(r.motivo ?? 'O follow-up não foi agendado.');
    }
  };

  return (
    <Painel titulo="Iniciar follow-up manual" descricao="Agenda a primeira tentativa de uma estratégia para um contato, respeitando a janela de envio e as condições de parada.">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
        <Campo rotulo="ID do contato"><input className="input font-mono text-[12.5px]" value={contactId} onChange={(e) => setContactId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" spellCheck={false} /></Campo>
        <Campo rotulo="Estratégia">
          <select className="select" value={escolhida} onChange={(e) => setEstrategia(e.target.value)} disabled={!regras.length}>
            {regras.map((r) => <option key={r.estrategia} value={r.estrategia}>{r.nome}{r.ativo ? '' : ' (inativa)'}</option>)}
          </select>
        </Campo>
        <button className="btn btn-primary" disabled={ocupado === 'iniciar' || !contactId.trim() || !escolhida} onClick={() => void iniciar()}>
          <Icon name="play" size={14} /> {ocupado === 'iniciar' ? 'Agendando…' : 'Iniciar'}
        </button>
      </div>
      {resultado && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-warning-border bg-warning-soft px-3.5 py-2.5 text-[13.5px] text-fg" role="status">
          <Icon name="info" size={15} className="mt-0.5 shrink-0" />
          <span>Não agendado: {resultado}</span>
        </div>
      )}
    </Painel>
  );
}

function Historico({ agenteId, versao, nomeEstrategia }: { agenteId: string; versao: number; nomeEstrategia: (id: string) => string }) {
  const { ocupado, executar } = useAcao();
  const [status, setStatus] = useState<FiltroStatus>('todos');
  const lista = useCarga(() => agentesApi.followups(agenteId, { status: status === 'todos' ? undefined : status }), [agenteId, status, versao]);
  const [cancelar, setCancelar] = useState<ItemFollowup | null>(null);
  const [reagendar, setReagendar] = useState<ItemFollowup | null>(null);
  const [quando, setQuando] = useState('');

  const confirmarCancelamento = async () => {
    const f = cancelar;
    setCancelar(null);
    if (!f) return;
    if (await executar(`cancelar:${f.id}`, () => agentesApi.cancelarFollowup(f.id), 'Follow-up cancelado')) void lista.recarregar();
  };

  const abrirReagendar = (f: ItemFollowup) => {
    setQuando(paraLocal(f.agendadoPara));
    setReagendar(f);
  };

  const quandoData = quando ? new Date(quando) : null;
  const quandoValido = !!quandoData && !Number.isNaN(quandoData.getTime()) && quandoData.getTime() > Date.now();

  const confirmarReagendamento = async () => {
    const f = reagendar;
    if (!f || !quandoData || !quandoValido) return;
    const ok = await executar(`reagendar:${f.id}`, () => agentesApi.reagendarFollowup(f.id, clonar(quandoData).toString() ? quandoData.toISOString() : quandoData.toISOString()), 'Follow-up reagendado');
    if (ok) {
      setReagendar(null);
      void lista.recarregar();
    }
  };

  return (
    <Painel titulo="Histórico de follow-ups" descricao="Tentativas agendadas e executadas por este agente." corpo="pb-2" acao={<button className="btn btn-ghost btn-sm" disabled={lista.carregando} onClick={() => void lista.recarregar()}><Icon name="refresh" size={14} /> Atualizar</button>}>
      <div className="px-5 pb-3 pt-4">
        <Abas
          valor={status}
          onChange={setStatus}
          opcoes={[
            { valor: 'todos', rotulo: 'Todos' },
            { valor: 'agendado', rotulo: 'Agendados' },
            { valor: 'gerando', rotulo: 'Gerando' },
            { valor: 'enviado', rotulo: 'Enviados' },
            { valor: 'cancelado', rotulo: 'Cancelados' },
            { valor: 'pulado', rotulo: 'Pulados' },
            { valor: 'falhou', rotulo: 'Falharam' },
          ]}
        />
      </div>
      {lista.carregando && !lista.dados ? (
        <Esqueleto linhas={5} />
      ) : lista.erro ? (
        <Erro texto={lista.erro} tentar={() => void lista.recarregar()} />
      ) : !lista.dados?.length ? (
        <Vazio icone="clock" titulo="Nenhum follow-up" descricao={status === 'todos' ? 'Os follow-ups agendados pelo agente aparecem aqui.' : 'Nenhum follow-up com este status.'} />
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl min-w-[980px]">
            <thead>
              <tr>
                <th>Contato</th>
                <th>Estratégia</th>
                <th className="text-right">Tentativa</th>
                <th>Status</th>
                <th>Agendado para</th>
                <th>Executado em</th>
                <th>Motivo</th>
                <th>Mensagem</th>
                <th><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {lista.dados.map((f) => (
                <tr key={f.id}>
                  <td className="max-w-[180px]">
                    <Link href={`/inbox?c=${f.conversationId}`} className="block truncate text-fg hover:text-brand" title="Abrir conversa">{f.contatoNome || `Contato ${f.contactId.slice(0, 8)}`}</Link>
                  </td>
                  <td className="whitespace-nowrap">{nomeEstrategia(f.estrategia)}</td>
                  <td className="text-right tabular">{f.tentativa}</td>
                  <td><span className={cx('pill', TOM_STATUS[f.status])}>{ROTULO_STATUS[f.status] ?? f.status}</span></td>
                  <td className="whitespace-nowrap tabular">{dataHora(f.agendadoPara)}</td>
                  <td className="whitespace-nowrap tabular">{dataHora(f.executadoEm)}</td>
                  <td className="max-w-[200px]"><span className="block truncate" title={f.motivo ?? undefined}>{f.motivo ?? '-'}</span></td>
                  <td className="max-w-[260px]">
                    {f.mensagem ? (
                      <details>
                        <summary className="cursor-pointer text-brand">Ver mensagem</summary>
                        <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-fg">{f.mensagem}</p>
                      </details>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {f.status === 'agendado' && (
                      <span className="inline-flex gap-1.5">
                        <button className="btn btn-ghost btn-sm" disabled={!!ocupado} onClick={() => abrirReagendar(f)}>Reagendar</button>
                        <button className="btn btn-ghost btn-sm text-danger" disabled={!!ocupado} onClick={() => setCancelar(f)}>Cancelar</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Confirmar
        aberto={!!cancelar}
        titulo="Cancelar follow-up"
        texto={<p>A tentativa {cancelar?.tentativa} de {cancelar ? nomeEstrategia(cancelar.estrategia) : ''} não será enviada. Esta ação fica registrada.</p>}
        confirmar="Cancelar follow-up"
        perigo
        onConfirmar={() => void confirmarCancelamento()}
        onFechar={() => setCancelar(null)}
      />

      <Modal
        aberto={!!reagendar}
        onFechar={() => setReagendar(null)}
        titulo="Reagendar follow-up"
        rodape={
          <>
            <button className="btn btn-ghost" onClick={() => setReagendar(null)}>Cancelar</button>
            <button className="btn btn-primary" disabled={!quandoValido || (!!reagendar && ocupado === `reagendar:${reagendar.id}`)} onClick={() => void confirmarReagendamento()}>Reagendar</button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13.5px] text-muted">Escolha a nova data e hora (no horário deste navegador). As condições de parada continuam valendo no momento do envio.</p>
          <Campo rotulo="Novo horário">
            <input className="input" type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} />
          </Campo>
          {quando && !quandoValido && <p className="text-xs text-danger">Escolha um horário no futuro.</p>}
        </div>
      </Modal>
    </Painel>
  );
}

// Mantém o tipo Alternar importável para quem estender este builder sem duplicar o switch.
export { Alternar as AlternarFollowup };
