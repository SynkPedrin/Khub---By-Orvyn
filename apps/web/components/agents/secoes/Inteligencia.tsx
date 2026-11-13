'use client';

import { useState } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { agentesApi, ROTULO_INTENCAO, type AgentConfig, type IntencaoPersonalizada } from '@/lib/agents';
import { Alternar, BarraSalvar, Campo, Confirmar, Erro, Esqueleto, ListaTextos, Modal, Numero, Painel, Selecao, Vazio, useAcao, useCarga, useToast } from '../kit';
import { useCamposAgente, useSecaoConfig, type SecaoProps } from '../editor';

type Inteligencia = AgentConfig['inteligencia'];

const AUTONOMIA: { valor: Inteligencia['autonomia']; rotulo: string; explicacao: string }[] = [
  { valor: 'conservadora', rotulo: 'Conservadora', explicacao: 'Executa ações no CRM só quando o contato pede explicitamente ou a informação é inequívoca.' },
  { valor: 'equilibrada', rotulo: 'Equilibrada', explicacao: 'Executa ações quando a conversa deixa claro que são úteis, como registrar um dado informado ou criar a tarefa combinada.' },
  { valor: 'proativa', rotulo: 'Proativa', explicacao: 'Registra por conta própria o que for útil para a equipe (dados, notas de qualificação, próximos passos), sempre dentro das ferramentas liberadas.' },
];

const EFFORT: { valor: Inteligencia['effort']; rotulo: string }[] = [
  { valor: 'low', rotulo: 'Baixo (mais rápido e barato)' },
  { valor: 'medium', rotulo: 'Médio' },
  { valor: 'high', rotulo: 'Alto (raciocina mais, custa mais)' },
];

const RE_CHAVE = /^[a-z][a-z0-9_]{1,39}$/;
const MESMO = '__mesmo__';
const NENHUM = '__nenhum__';

/** Limites idênticos ao schema do servidor (o servidor continua sendo quem valida). */
function problemas(r: Inteligencia): string[] {
  const p: string[] = [];
  const fora = (v: number, min: number, max: number) => !Number.isFinite(v) || v < min || v > max;
  if (fora(r.maxTokens, 512, 16000) || !Number.isInteger(r.maxTokens)) p.push('Máximo de tokens entre 512 e 16.000');
  if (fora(r.timeoutMs, 5000, 120000) || !Number.isInteger(r.timeoutMs)) p.push('Tempo limite entre 5 e 120 segundos');
  if (fora(r.janelaHistorico, 6, 80) || !Number.isInteger(r.janelaHistorico)) p.push('Janela de histórico entre 6 e 80 mensagens');
  if (fora(r.tentativas, 0, 3) || !Number.isInteger(r.tentativas)) p.push('Tentativas entre 0 e 3');
  if (fora(r.orcamentoUsdConversa, 0, 50)) p.push('Orçamento por conversa entre US$ 0 e US$ 50');
  if (fora(r.orcamentoUsdDiario, 0, 5000)) p.push('Orçamento diário entre US$ 0 e US$ 5.000');
  if (fora(r.limiarConfianca, 0, 1)) p.push('Limiar de confiança entre 0 e 1');
  return p;
}

export function Inteligencia({ agente, catalogo, onAtualizado }: SecaoProps) {
  const toast = useToast();
  const cfg = useSecaoConfig(agente, 'inteligencia', onAtualizado);
  const cols = useCamposAgente(agente, (a) => ({ modelo: a.modelo }), onAtualizado);
  const r = cfg.rascunho;

  const modelos = catalogo.modelos.some((m) => m.id === cols.rascunho.modelo)
    ? catalogo.modelos
    : [...catalogo.modelos, { id: cols.rascunho.modelo ?? agente.modelo, nome: cols.rascunho.modelo ?? agente.modelo, descricao: 'Modelo fora do catálogo atual', entradaUsdPorMilhao: 0, saidaUsdPorMilhao: 0 }];
  const rotuloModelo = (m: (typeof modelos)[number]) => (m.entradaUsdPorMilhao || m.saidaUsdPorMilhao ? `${m.nome} · US$ ${m.entradaUsdPorMilhao} entrada / US$ ${m.saidaUsdPorMilhao} saída por milhão de tokens` : m.nome);
  const modeloAtual = modelos.find((m) => m.id === cols.rascunho.modelo);

  const sujo = cfg.sujo || cols.sujo;
  const salvando = cfg.salvando || cols.salvando;
  const erros = problemas(r);

  const salvar = async () => {
    if (erros.length) {
      toast('erro', erros.join(' · '));
      return;
    }
    // Um único PATCH quando as duas partes mudaram.
    if (cols.sujo) await cols.salvar(cfg.sujo ? { config: { inteligencia: r } } : undefined);
    else await cfg.salvar();
  };
  const descartar = () => {
    cfg.descartar();
    cols.descartar();
  };

  return (
    <div className="space-y-5">
      <Painel titulo="Modelo de IA" descricao="O modelo que escreve as respostas. Preço por milhão de tokens, cobrado pelo provedor.">
        <div className="grid gap-4 md:grid-cols-2">
          <Campo rotulo="Modelo principal" dica={modeloAtual?.descricao}>
            <Selecao valor={cols.rascunho.modelo ?? agente.modelo} onChange={(v) => cols.setRascunho({ modelo: v })} opcoes={modelos.map((m) => ({ valor: m.id, rotulo: rotuloModelo(m) }))} />
          </Campo>
          <Campo rotulo="Modelo de reserva" dica="Usado só se o principal estiver indisponível.">
            <Selecao
              valor={r.modeloFallback ?? NENHUM}
              onChange={(v) => cfg.set('modeloFallback', v === NENHUM ? null : v)}
              opcoes={[{ valor: NENHUM, rotulo: 'Nenhum (transfere para a equipe)' }, ...catalogo.modelos.filter((m) => m.id !== cols.rascunho.modelo).map((m) => ({ valor: m.id, rotulo: rotuloModelo(m) }))]}
            />
          </Campo>
          <Campo rotulo="Esforço de raciocínio">
            <Selecao valor={r.effort} onChange={(v) => cfg.set('effort', v)} opcoes={EFFORT} />
          </Campo>
          <Campo rotulo="Máximo de tokens por resposta" dica="Entre 512 e 16.000.">
            <Numero valor={r.maxTokens} onChange={(v) => cfg.set('maxTokens', v)} min={512} max={16000} passo={256} />
          </Campo>
        </div>
      </Painel>

      <Painel titulo="Análise da mensagem" descricao="Antes de responder, o agente classifica intenção, problema, objeções e extrai dados do contato.">
        <div className="grid gap-4 md:grid-cols-2">
          <Alternar ligado={r.analiseAtiva} onChange={(v) => cfg.set('analiseAtiva', v)} rotulo="Análise estruturada ligada" descricao="Desligada, regras por intenção e extração de perfil usam só heurística." />
          <Campo rotulo="Modelo da análise" dica="Um modelo menor costuma bastar para classificar.">
            <select className="select" disabled={!r.analiseAtiva} value={r.modeloAnalise ?? MESMO} onChange={(e) => cfg.set('modeloAnalise', e.target.value === MESMO ? null : e.target.value)}>
              <option value={MESMO}>O mesmo do agente</option>
              {catalogo.modelos.map((m) => <option key={m.id} value={m.id}>{rotuloModelo(m)}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Limiar de confiança" dica="Abaixo disso a resposta fica registrada como baixa confiança e alimenta o aprendizado.">
            <div className="flex items-center gap-3">
              <input type="range" min={0} max={1} step={0.05} value={Number.isFinite(r.limiarConfianca) ? r.limiarConfianca : 0} onChange={(e) => cfg.set('limiarConfianca', Number(e.target.value))} className="w-full accent-[var(--brand)]" aria-label="Limiar de confiança" />
              <span className="w-12 shrink-0 text-right text-[13px] tabular text-fg">{Math.round((Number.isFinite(r.limiarConfianca) ? r.limiarConfianca : 0) * 100)}%</span>
            </div>
          </Campo>
          <Campo rotulo="Janela de histórico" dica="Quantas mensagens recentes o agente lê (6 a 80).">
            <Numero valor={r.janelaHistorico} onChange={(v) => cfg.set('janelaHistorico', v)} min={6} max={80} sufixo="mensagens" />
          </Campo>
        </div>
      </Painel>

      <Painel titulo="Autonomia" descricao="Quanto o agente age no CRM por iniciativa própria. Ações só acontecem com ferramentas liberadas.">
        <div role="radiogroup" aria-label="Autonomia" className="grid gap-2.5 md:grid-cols-3">
          {AUTONOMIA.map((a) => (
            <button
              key={a.valor}
              type="button"
              role="radio"
              aria-checked={r.autonomia === a.valor}
              onClick={() => cfg.set('autonomia', a.valor)}
              className={cx('rounded-xl border border-line p-3.5 text-left transition-colors hover:bg-surface2/70', r.autonomia === a.valor && 'border-brand-border bg-brand-softer/60')}
            >
              <span className="flex items-center gap-2 text-[13.5px] font-medium text-fg">
                <span className={cx('h-3.5 w-3.5 shrink-0 rounded-full border border-line', r.autonomia === a.valor && 'border-brand bg-brand')} />
                {a.rotulo}
              </span>
              <span className="mt-1 block text-xs text-muted">{a.explicacao}</span>
            </button>
          ))}
        </div>
      </Painel>

      <Painel titulo="Confiabilidade e custo" descricao="Limites de execução. Ao estourar um orçamento, a conversa vai para a equipe com o motivo registrado.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Campo rotulo="Tempo limite" dica="5 a 120 segundos.">
            <Numero valor={Number.isFinite(r.timeoutMs) ? r.timeoutMs / 1000 : Number.NaN} onChange={(v) => cfg.set('timeoutMs', Number.isFinite(v) ? Math.round(v * 1000) : Number.NaN)} min={5} max={120} sufixo="s" />
          </Campo>
          <Campo rotulo="Novas tentativas" dica="0 a 3, em falhas temporárias.">
            <Numero valor={r.tentativas} onChange={(v) => cfg.set('tentativas', v)} min={0} max={3} />
          </Campo>
          <Campo rotulo="Orçamento por conversa" dica="Até US$ 50.">
            <Numero valor={r.orcamentoUsdConversa} onChange={(v) => cfg.set('orcamentoUsdConversa', v)} min={0} max={50} passo={0.1} sufixo="US$" />
          </Campo>
          <Campo rotulo="Orçamento diário" dica="Até US$ 5.000.">
            <Numero valor={r.orcamentoUsdDiario} onChange={(v) => cfg.set('orcamentoUsdDiario', v)} min={0} max={5000} passo={1} sufixo="US$" />
          </Campo>
        </div>
        {erros.length > 0 && (
          <div role="alert" className="mt-4 rounded-xl border border-warning-border bg-warning-soft px-3.5 py-2.5 text-[13px] text-fg">
            {erros.join(' · ')}
          </div>
        )}
      </Painel>

      <Intencoes base={catalogo.intencoesBase} />

      <BarraSalvar sujo={sujo} salvando={salvando} onSalvar={() => void salvar()} onDescartar={descartar} aviso={erros.length ? 'Há valores fora do limite' : undefined} />
    </div>
  );
}

// ------------------------------------------------------------------ intenções personalizadas

type FormIntencao = Omit<IntencaoPersonalizada, 'id'>;
const VAZIA: FormIntencao = { chave: '', nome: '', descricao: '', exemplos: [], ativo: true };

function Intencoes({ base }: { base: string[] }) {
  const lista = useCarga(() => agentesApi.intencoes(), []);
  const { ocupado, executar } = useAcao();
  const [form, setForm] = useState<FormIntencao | null>(null);
  const [editando, setEditando] = useState(false);
  const [remover, setRemover] = useState<IntencaoPersonalizada | null>(null);

  const chaveOk = !!form && RE_CHAVE.test(form.chave);
  const chaveBase = !!form && base.includes(form.chave);
  const valido = !!form && chaveOk && !chaveBase && form.nome.trim().length > 0;

  const salvar = async () => {
    if (!form || !valido) return;
    const r = await executar('salvar', () => agentesApi.salvarIntencao({ ...form, nome: form.nome.trim(), descricao: form.descricao.trim() }), editando ? 'Intenção atualizada' : 'Intenção criada');
    if (r) {
      setForm(null);
      void lista.recarregar();
    }
  };
  const alternar = async (i: IntencaoPersonalizada) => {
    const r = await executar(`ativo:${i.id}`, () => agentesApi.salvarIntencao({ chave: i.chave, nome: i.nome, descricao: i.descricao, exemplos: i.exemplos, ativo: !i.ativo }), i.ativo ? 'Intenção desativada' : 'Intenção ativada');
    if (r) void lista.recarregar();
  };
  const confirmarRemocao = async () => {
    if (!remover) return;
    const alvo = remover;
    setRemover(null);
    const r = await executar(`rem:${alvo.id}`, () => agentesApi.removerIntencao(alvo.id), 'Intenção removida');
    if (r) void lista.recarregar();
  };

  return (
    <Painel
      titulo="Categorias de intenção"
      descricao="A análise classifica cada mensagem em uma intenção. As intenções da base valem para todos; as personalizadas valem para todos os agentes da empresa."
      acao={<button className="btn btn-soft btn-sm" onClick={() => { setEditando(false); setForm({ ...VAZIA }); }}><Icon name="plus" size={14} /> Nova intenção</button>}
      corpo="p-0"
    >
      <div className="px-5 pb-4 pt-4">
        <p className="t-label mb-2">Intenções da base</p>
        <ul className="flex flex-wrap gap-1.5" aria-label="Intenções da base">
          {base.map((b) => <li key={b} className="pill">{ROTULO_INTENCAO[b] ?? b}</li>)}
        </ul>
      </div>
      <div className="border-t border-line">
        {lista.carregando && !lista.dados ? (
          <Esqueleto linhas={3} />
        ) : lista.erro ? (
          <Erro texto={lista.erro} tentar={lista.recarregar} />
        ) : !lista.dados?.length ? (
          <Vazio icone="tag" titulo="Nenhuma intenção personalizada" descricao="Crie intenções do seu negócio (ex.: segunda_via_boleto) para usar em regras e relatórios." />
        ) : (
          <ul className="divide-y divide-line">
            {lista.dados.map((i) => (
              <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-medium text-fg">{i.nome}</span>
                    <code className="rounded bg-surface2 px-1.5 py-0.5 text-[11.5px] text-muted">{i.chave}</code>
                    <span className={cx('pill', i.ativo ? 'pill-success' : '')}>{i.ativo ? 'Ativa' : 'Inativa'}</span>
                  </div>
                  {i.descricao && <p className="mt-1 text-[13px] text-muted">{i.descricao}</p>}
                  {i.exemplos.length > 0 && <p className="mt-1 text-xs text-faint">Exemplos: {i.exemplos.join(' · ')}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button className="btn btn-ghost btn-sm" disabled={ocupado === `ativo:${i.id}`} onClick={() => void alternar(i)}>{i.ativo ? 'Desativar' : 'Ativar'}</button>
                  <button className="btn btn-ghost btn-sm btn-icon" aria-label={`Editar ${i.nome}`} onClick={() => { setEditando(true); setForm({ chave: i.chave, nome: i.nome, descricao: i.descricao, exemplos: [...i.exemplos], ativo: i.ativo }); }}><Icon name="edit" size={14} /></button>
                  <button className="btn btn-ghost btn-sm btn-icon" aria-label={`Remover ${i.nome}`} disabled={ocupado === `rem:${i.id}`} onClick={() => setRemover(i)}><Icon name="trash" size={14} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        aberto={!!form}
        onFechar={() => setForm(null)}
        titulo={editando ? 'Editar intenção' : 'Nova intenção'}
        rodape={<><button className="btn btn-ghost" onClick={() => setForm(null)}>Cancelar</button><button className="btn btn-primary" disabled={!valido || ocupado === 'salvar'} onClick={() => void salvar()}>{ocupado === 'salvar' ? 'Salvando…' : 'Salvar'}</button></>}
      >
        {form && (
          <div className="space-y-4">
            <Campo
              rotulo="Chave"
              dica={form.chave && !chaveOk ? 'Use letras minúsculas, números e _ (2 a 40 caracteres, começando por letra).' : chaveBase ? 'Essa intenção já existe na base.' : 'Identificador usado em regras. Não muda depois de criada.'}
            >
              <input className="input" value={form.chave} disabled={editando} maxLength={40} placeholder="segunda_via_boleto" onChange={(e) => setForm({ ...form, chave: e.target.value.toLowerCase().replace(/\s+/g, '_') })} aria-invalid={!!form.chave && (!chaveOk || chaveBase)} />
            </Campo>
            <Campo rotulo="Nome">
              <input className="input" value={form.nome} maxLength={60} placeholder="Segunda via de boleto" onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </Campo>
            <Campo rotulo="Descrição" dica="Explique para a IA quando uma mensagem se encaixa aqui.">
              <textarea className="textarea" rows={3} maxLength={400} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
            </Campo>
            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-fg">Exemplos de mensagens</span>
              <ListaTextos valores={form.exemplos} onChange={(v) => setForm({ ...form, exemplos: v })} placeholder="Ex.: me manda o boleto de novo" max={20} />
            </div>
            <Alternar ligado={form.ativo} onChange={(v) => setForm({ ...form, ativo: v })} rotulo="Ativa" descricao="Inativa, a análise deixa de usar esta categoria." />
          </div>
        )}
      </Modal>

      <Confirmar
        aberto={!!remover}
        titulo="Remover intenção"
        texto={<p>A intenção &quot;{remover?.nome}&quot; deixa de ser usada na análise. Regras que dependem dela param de disparar.</p>}
        confirmar="Remover"
        perigo
        onConfirmar={() => void confirmarRemocao()}
        onFechar={() => setRemover(null)}
      />
    </Painel>
  );
}
