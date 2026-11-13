'use client';

import { useEffect, useState } from 'react';
import { Button, Field, Input } from '@/components/ui';
import { Icon } from '@/components/icons';
import { OPERADORES, type MetaNo, type NoGrafo, type Ramo } from '@/lib/automations';
import { crm, type Contato, type PipelineData } from '@/lib/crm';
import { FiltroGatilhoAgenda, ehGatilhoAgenda } from '@/components/agenda/FiltroGatilhoAgenda';
import { PainelNoMotor, TIPOS_MOTOR, useCamposCondicao } from './PainelNoMotor';

interface Props {
  no: NoGrafo;
  meta: MetaNo;
  onMudar: (config: Record<string, unknown>, extra?: { rotulo?: string; aoFalhar?: 'parar' | 'seguir' }) => void;
  onExcluir: () => void;
  onFechar: () => void;
  outrosNos: { id: string; rotulo: string }[];
  /** Outros fluxos publicados (para "Acionar outro fluxo"). */
  outrosFluxos?: { id: string; nome: string }[];
}

const rid = () => Math.random().toString(36).slice(2, 9);

/** Configura o nó selecionado. Cada tipo mostra só o que faz sentido para ele. */
export function PainelNo({ no, meta, onMudar, onExcluir, onFechar, outrosNos, outrosFluxos = [] }: Props) {
  const [stages, setStages] = useState<{ id: string; nome: string }[]>([]);
  const cfg = no.config as Record<string, any>;

  useEffect(() => {
    if (['acao.criar_oportunidade', 'acao.mover_etapa', 'gatilho.etapa_mudou', 'gatilho.negocio_criado'].includes(no.tipo)) {
      crm.pipeline().then((p: PipelineData) => setStages(p.stages.map((s) => ({ id: s.id, nome: s.nome })))).catch(() => setStages([]));
    }
  }, [no.tipo]);

  const set = (patch: Record<string, unknown>) => onMudar({ ...cfg, ...patch });

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-start justify-between gap-2 border-b border-line p-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-fg">{meta.nome}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted">{meta.descricao}</p>
        </div>
        <button onClick={onFechar} className="shrink-0 rounded-lg p-1 text-muted hover:bg-surface2 hover:text-fg" aria-label="Fechar"><Icon name="close" size={15} /></button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 scrollbar-thin">
        <Field label="Rótulo no canvas">
          <Input value={no.rotulo ?? ''} onChange={(e) => onMudar(cfg, { rotulo: e.target.value })} placeholder={meta.nome} />
        </Field>

        {/* ---------------- Gatilhos ---------------- */}
        {no.tipo === 'gatilho.contato_criado' && (
          <Field label="Só quando a origem for" hint="Vazio = qualquer origem.">
            <Input value={cfg.origem ?? ''} onChange={(e) => set({ origem: e.target.value || undefined })} placeholder="Meta Lead Ads, WhatsApp…" />
          </Field>
        )}
        {no.tipo === 'gatilho.etapa_mudou' && (
          <Field label="Etapa de destino" hint="Vazio = qualquer etapa.">
            <select className="input" value={cfg.stageId ?? ''} onChange={(e) => set({ stageId: e.target.value || undefined })}>
              <option value="">Qualquer etapa</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </Field>
        )}
        {no.tipo === 'gatilho.mensagem_recebida' && (
          <Field label="Só se a mensagem contiver" hint="Vazio = qualquer mensagem. Só mensagens do contato disparam.">
            <Input value={cfg.contem ?? ''} onChange={(e) => set({ contem: e.target.value || undefined })} placeholder="orçamento, preço…" />
          </Field>
        )}
        {no.tipo === 'gatilho.tag_adicionada' && (
          <Field label="Tag">
            <Input value={cfg.tag ?? ''} onChange={(e) => set({ tag: e.target.value })} placeholder="metaads" />
          </Field>
        )}

        {/* ---------------- Controle ---------------- */}
        {no.tipo === 'controle.esperar' && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Esperar"><Input type="number" min={1} value={cfg.duracao ?? 10} onChange={(e) => set({ duracao: Number(e.target.value) || 1 })} /></Field>
            <Field label="Unidade">
              <select className="input" value={cfg.unidade ?? 'minutos'} onChange={(e) => set({ unidade: e.target.value })}>
                <option value="segundos">segundos</option><option value="minutos">minutos</option>
                <option value="horas">horas</option><option value="dias">dias</option>
              </select>
            </Field>
          </div>
        )}

        {no.tipo === 'controle.condicao' && <EditorRamos ramos={(cfg.ramos ?? []) as Ramo[]} onMudar={(ramos) => set({ ramos })} />}

        {no.tipo === 'controle.split' && <EditorSplit ramos={(cfg.ramos ?? []) as SplitRamo[]} onMudar={(ramos) => set({ ramos })} />}

        {no.tipo === 'controle.drip' && (
          <Field label="Liberar por janela" hint="O restante espera a próxima janela e entra em seguida.">
            <div className="flex items-center gap-2">
              <input type="number" min={1} className="input w-24 text-center" value={cfg.porJanela ?? 50} onChange={(e) => set({ porJanela: Math.max(1, Number(e.target.value) || 1) })} />
              <span className="text-sm text-muted">por</span>
              <select className="input flex-1" value={cfg.janela ?? 'hora'} onChange={(e) => set({ janela: e.target.value })}>
                <option value="minuto">minuto</option>
                <option value="hora">hora</option>
                <option value="dia">dia</option>
              </select>
            </div>
          </Field>
        )}

        {no.tipo === 'acao.ia' && (
          <>
            <Field label="Tarefa">
              <select className="input" value={cfg.tarefa ?? 'classificar'} onChange={(e) => set({ tarefa: e.target.value })}>
                <option value="classificar">Classificar (rótulo curto)</option>
                <option value="pontuar">Pontuar (0–100)</option>
                <option value="resumir">Resumir</option>
                <option value="responder">Redigir resposta</option>
                <option value="extrair">Extrair valor</option>
              </select>
            </Field>
            <Field label="Instrução" hint="O que a IA faz com o contato / a última mensagem.">
              <textarea className="input min-h-24 resize-y" value={cfg.instrucao ?? ''} onChange={(e) => set({ instrucao: e.target.value })} placeholder="O lead está quente ou frio? Responda só 'quente' ou 'frio'." />
            </Field>
            <Field label="Salvar em"><Input value={cfg.salvarEm ?? 'ia'} onChange={(e) => set({ salvarEm: e.target.value })} placeholder="temperatura" /></Field>
            <p className="rounded-lg bg-brand/10 px-3 py-2 text-[11px] leading-snug text-brand-deep dark:text-brand-lilac">
              Roda pela NICO (precisa da chave Anthropic). Depois use <span className="font-mono">{'{{variaveis.' + (cfg.salvarEm || 'ia') + '}}'}</span> em mensagens e condições.
            </p>
          </>
        )}
        {no.tipo === 'acao.formatar_texto' && (
          <>
            <Field label="Valor" hint="Aceita {{contato.telefone}}, {{negocio.valor}}, {{variaveis.x}}…"><Input value={cfg.valor ?? ''} onChange={(e) => set({ valor: e.target.value })} placeholder="{{contato.telefone}}" /></Field>
            <Field label="Formato">
              <select className="input" value={cfg.formato ?? 'telefone'} onChange={(e) => set({ formato: e.target.value })}>
                <option value="telefone">Telefone, (11) 99999-9999</option>
                <option value="moeda">Moeda · R$ 1.234,56</option>
                <option value="maiuscula">MAIÚSCULAS</option>
                <option value="minuscula">minúsculas</option>
                <option value="capitalizar">Capitalizar Cada Palavra</option>
                <option value="digitos">Só dígitos</option>
              </select>
            </Field>
            <Field label="Salvar em"><Input value={cfg.salvarEm ?? 'texto'} onChange={(e) => set({ salvarEm: e.target.value })} placeholder="telefone_fmt" /></Field>
          </>
        )}
        {no.tipo === 'acao.definir_variavel' && (
          <>
            <Field label="Nome da variável"><Input value={cfg.nome ?? ''} onChange={(e) => set({ nome: e.target.value })} placeholder="desconto" /></Field>
            <Field label="Valor" hint="Aceita {{contato.nome}}, {{negocio.valor}}, etc."><Input value={cfg.valor ?? ''} onChange={(e) => set({ valor: e.target.value })} placeholder="10%" /></Field>
            <p className="rounded-lg bg-brand/8 px-3 py-2 text-[11px] leading-snug text-brand-deep dark:text-brand-lilac">
              Use depois como <span className="font-mono">{'{{variaveis.' + (cfg.nome || 'nome') + '}}'}</span> em mensagens e condições.
            </p>
          </>
        )}

        {no.tipo === 'controle.ir_para' && (
          <Field label="Pular para o nó">
            <select className="input" value={cfg.alvoNoId ?? ''} onChange={(e) => set({ alvoNoId: e.target.value })}>
              <option value="">Escolha…</option>
              {outrosNos.map((n) => <option key={n.id} value={n.id}>{n.rotulo}</option>)}
            </select>
          </Field>
        )}

        {/* ---------------- Ações ---------------- */}
        {no.tipo === 'acao.enviar_sms' && (
          <>
            <Field label="Mensagem" hint="Use {{contato.nome}} para personalizar.">
              <textarea
                className="input min-h-28 resize-y"
                value={cfg.texto ?? ''}
                onChange={(e) => set({ texto: e.target.value })}
                placeholder="Oi {{contato.nome}}, vi que você se interessou…"
              />
            </Field>
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
              Entregue no WhatsApp pelo STEVO, que é <strong>API não oficial</strong>: texto simples, sem mídia e sem template aprovado, por isso o nó se chama SMS.
            </p>
          </>
        )}
        {no.tipo === 'acao.notificar_equipe' && (
          <>
            <Field label="WhatsApp da equipe" hint="Com DDI e DDD, só números. Ex.: 5518999990000">
              <Input value={cfg.telefone ?? ''} onChange={(e) => set({ telefone: e.target.value.replace(/[^\d+]/g, '') })} placeholder="5518999990000" inputMode="tel" />
            </Field>
            <Field label="Aviso" hint="Use {{contato.nome}} e {{contato.telefone}} para dizer de quem é o aviso.">
              <textarea
                className="input min-h-28 resize-y"
                value={cfg.texto ?? ''}
                onChange={(e) => set({ texto: e.target.value })}
                placeholder={'+1 lead para atender\n\nNOME: {{contato.nome}}\nTELEFONE: {{contato.telefone}}'}
              />
            </Field>
            <p className="rounded-lg bg-[var(--fill-4)] px-3 py-2 text-[11px] leading-snug text-muted">
              Vai para o número da equipe, não para o contato. Sai pela mesma instância de WhatsApp da conta.
            </p>
          </>
        )}
        {no.tipo === 'acao.enviar_email' && (
          <>
            <Field label="Assunto" hint="Aceita {{contato.nome}}.">
              <Input value={cfg.assunto ?? ''} onChange={(e) => set({ assunto: e.target.value })} placeholder="{{contato.nome}}, um recado rápido" />
            </Field>
            <Field label="Corpo" hint="Texto do e-mail. Quebras de linha viram parágrafos.">
              <textarea
                className="input min-h-32 resize-y"
                value={cfg.corpo ?? ''}
                onChange={(e) => set({ corpo: e.target.value })}
                placeholder={'Olá {{contato.nome}},\n\nVi que você se interessou e queria falar sobre os próximos passos.'}
              />
            </Field>
            <p className="rounded-lg bg-brand/10 px-3 py-2 text-[11px] leading-snug text-brand-deep dark:text-brand-lilac">
              Enviado pelo canal oficial (SMTP). Sem o SMTP conectado, o e-mail fica <strong>pendente</strong> e o passo mostra “Configurar e-mail”.
            </p>
          </>
        )}
        {(no.tipo === 'acao.adicionar_tag' || no.tipo === 'acao.remover_tag') && (
          <Field label="Tag"><Input value={cfg.tag ?? ''} onChange={(e) => set({ tag: e.target.value })} placeholder="cliente-vip" /></Field>
        )}
        {/* Q3.1/Q3.2: nós e gatilhos novos (e o "Atualizar contato" com campos personalizados e tags) */}
        {TIPOS_MOTOR.has(no.tipo) && <PainelNoMotor no={no} set={set} outrosFluxos={outrosFluxos} />}
        {no.tipo === 'acao.criar_oportunidade' && (
          <>
            <Field label="Título"><Input value={cfg.titulo ?? ''} onChange={(e) => set({ titulo: e.target.value })} placeholder="Proposta · {{contato.nome}}" /></Field>
            <Field label="Etapa">
              <select className="input" value={cfg.stageId ?? ''} onChange={(e) => set({ stageId: e.target.value })}>
                <option value="">Escolha…</option>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Valor (R$)"><Input type="number" value={cfg.valor ?? ''} onChange={(e) => set({ valor: Number(e.target.value) || 0 })} /></Field>
              <Field label="Origem"><Input value={cfg.origem ?? ''} onChange={(e) => set({ origem: e.target.value })} placeholder="Automação" /></Field>
            </div>
          </>
        )}
        {no.tipo === 'acao.mover_etapa' && (
          <Field label="Mover para" hint="Usa o negócio do contexto da execução.">
            <select className="input" value={cfg.stageId ?? ''} onChange={(e) => set({ stageId: e.target.value })}>
              <option value="">Escolha…</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </Field>
        )}
        {no.tipo === 'acao.criar_tarefa' && (
          <>
            <Field label="Título"><Input value={cfg.titulo ?? ''} onChange={(e) => set({ titulo: e.target.value })} placeholder="Ligar para {{contato.nome}}" /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Prioridade">
                <select className="input" value={cfg.prioridade ?? 'media'} onChange={(e) => set({ prioridade: e.target.value })}>
                  <option value="baixa">Baixa</option><option value="media">Média</option><option value="alta">Alta</option>
                </select>
              </Field>
              <Field label="Vence em (dias)"><Input type="number" min={0} value={cfg.emDias ?? 0} onChange={(e) => set({ emDias: Number(e.target.value) || 0 })} /></Field>
            </div>
          </>
        )}
        {no.tipo === 'acao.pedir_avaliacao' && (
          <>
            <Field label="Canal">
              <select className="input" value={cfg.canal ?? 'whatsapp'} onChange={(e) => set({ canal: e.target.value })}>
                <option value="whatsapp">WhatsApp</option><option value="email">E-mail</option>
              </select>
            </Field>
            <Field label="Mensagem (opcional)" hint="Vazio = mensagem padrão de Configurações > Avaliações. Use {{link}} onde o link deve entrar.">
              <textarea className="input min-h-24 resize-y" value={cfg.mensagem ?? ''} maxLength={1000} onChange={(e) => set({ mensagem: e.target.value || undefined })} placeholder="Oi, {{contato.primeiroNome}}! Pode avaliar nosso atendimento? {{link}}" />
            </Field>
            <p className="rounded-lg bg-[var(--fill-4)] px-3 py-2 text-[11px] leading-snug text-muted">
              O link é curto e rastreável: o clique e a nota ficam no relatório de Avaliações. Com o filtro de satisfação ligado, notas baixas viram feedback interno.
            </p>
          </>
        )}
        {no.tipo === 'acao.webhook' && (
          <>
            <Field label="URL" hint="Endereços internos são bloqueados por segurança.">
              <Input value={cfg.url ?? ''} onChange={(e) => set({ url: e.target.value })} placeholder="https://exemplo.com/hook" />
            </Field>
            <Field label="Método">
              <select className="input" value={cfg.metodo ?? 'POST'} onChange={(e) => set({ metodo: e.target.value })}>
                <option value="POST">POST</option><option value="GET">GET</option>
              </select>
            </Field>
            {(cfg.metodo ?? 'POST') === 'POST' && (
              <Field label="Corpo (JSON)" hint="Vazio = manda contato e negócio.">
                <textarea className="input min-h-20 resize-y font-mono text-xs" value={cfg.corpo ?? ''} onChange={(e) => set({ corpo: e.target.value })} placeholder='{"nome":"{{contato.nome}}"}' />
              </Field>
            )}
          </>
        )}

        {no.tipo === 'gatilho.negocio_criado' && (
          <Field label="Só quando cair nesta etapa" hint="Vazio = qualquer etapa.">
            <select className="input" value={cfg.stageId ?? ''} onChange={(e) => set({ stageId: e.target.value || undefined })}>
              <option value="">Qualquer etapa</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </Field>
        )}
        {ehGatilhoAgenda(no.tipo) && <FiltroGatilhoAgenda tipo={cfg.tipo} responsavelId={cfg.responsavelId} onChange={set} />}
        {no.tipo === 'gatilho.negocio_status' && (
          <Field label="Quando o negócio for" hint="Vazio = qualquer (ganho ou perdido).">
            <select className="input" value={cfg.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}>
              <option value="">Ganho ou perdido</option>
              <option value="ganho">Ganho</option>
              <option value="perdido">Perdido</option>
            </select>
          </Field>
        )}
        {no.tipo === 'gatilho.webhook' && (
          <>
            <Field label="Achar o contato pelo" hint="O sistema externo manda esse dado no corpo.">
              <select className="input" value={cfg.identificarPor ?? 'email'} onChange={(e) => set({ identificarPor: e.target.value, campo: e.target.value })}>
                <option value="email">E-mail</option>
                <option value="telefone">Telefone</option>
              </select>
            </Field>
            <Field label="Campo no payload" hint='Aceita caminho: "cliente.email".'>
              <Input value={cfg.campo ?? 'email'} onChange={(e) => set({ campo: e.target.value })} placeholder="email" />
            </Field>
            <Field label="Se o contato não existir">
              <select className="input" value={cfg.seNaoAchar ?? 'criar'} onChange={(e) => set({ seNaoAchar: e.target.value })}>
                <option value="criar">Criar contato novo</option>
                <option value="ignorar">Ignorar o evento</option>
              </select>
            </Field>
            <p className="rounded-lg bg-brand/10 px-3 py-2 text-[11px] leading-snug text-brand">
              A URL fica em <strong>Configurações do fluxo</strong> (engrenagem no topo), só aparece depois de publicar.
            </p>
          </>
        )}
        {no.tipo === 'controle.esperar_resposta' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Esperar até"><Input type="number" min={1} value={cfg.duracao ?? 1} onChange={(e) => set({ duracao: Number(e.target.value) || 1 })} /></Field>
              <Field label="Unidade">
                <select className="input" value={cfg.unidade ?? 'dias'} onChange={(e) => set({ unidade: e.target.value })}>
                  <option value="minutos">minutos</option><option value="horas">horas</option><option value="dias">dias</option>
                </select>
              </Field>
            </div>
            <p className="rounded-lg bg-brand/10 px-3 py-2 text-[11px] leading-snug text-brand">
              Duas saídas: <strong>Respondeu</strong> (o contato mandou mensagem) e <strong>Não respondeu</strong> (o prazo estourou).
              Quem responde nunca recebe o follow-up automático.
            </p>
          </>
        )}
        {no.tipo === 'controle.encerrar' && (
          <Field label="Motivo (opcional)" hint="Aparece no log da execução.">
            <Input value={cfg.motivo ?? ''} onChange={(e) => set({ motivo: e.target.value })} placeholder="Lead desqualificado" />
          </Field>
        )}
        {no.tipo === 'acao.criar_nota' && (
          <Field label="Nota" hint="Aceita {{contato.nome}}. Fica no histórico do contato.">
            <textarea className="input min-h-24 resize-y" value={cfg.corpo ?? ''} onChange={(e) => set({ corpo: e.target.value })} placeholder="Lead veio da campanha X e pediu orçamento." />
          </Field>
        )}
        {no.tipo === 'acao.chamar_workflow' && (
          <Field label="Fluxo a acionar" hint="Só fluxos publicados e ativos. O contato entra lá com o mesmo contexto.">
            <select className="input" value={cfg.workflowId ?? ''} onChange={(e) => set({ workflowId: e.target.value })}>
              <option value="">Escolha…</option>
              {outrosFluxos.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </Field>
        )}

        {meta.categoria === 'acao' && (
          <Field label="Se este nó falhar">
            <select className="input" value={no.aoFalhar ?? 'parar'} onChange={(e) => onMudar(cfg, { aoFalhar: e.target.value as 'parar' | 'seguir' })}>
              <option value="parar">Parar a execução (vai para o DLQ)</option>
              <option value="seguir">Seguir mesmo assim</option>
            </select>
          </Field>
        )}
      </div>

      <div className="border-t border-line p-3">
        <Button variant="ghost" onClick={onExcluir} className="w-full text-red-600 hover:bg-red-500/10 dark:text-red-400">
          <Icon name="close" size={14} /> Excluir nó
        </Button>
      </div>
    </div>
  );
}

/** If/Else: ramos com AND/OR/NONE e regras. */
function EditorRamos({ ramos, onMudar }: { ramos: Ramo[]; onMudar: (r: Ramo[]) => void }) {
  const camposCondicao = useCamposCondicao();
  const alterar = (i: number, patch: Partial<Ramo>) => onMudar(ramos.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">Ramos</p>
        <button
          onClick={() => onMudar([...ramos, { id: rid(), rotulo: `Ramo ${ramos.length + 1}`, juncao: 'AND', regras: [] }])}
          className="text-xs font-semibold text-brand hover:underline"
        >
          + ramo
        </button>
      </div>
      <p className="text-[11px] leading-snug text-muted">
        Ganha o <strong>primeiro</strong> ramo que casar, de cima para baixo. Um ramo <strong>NONE</strong> sem regras é o “quando nada bate”.
      </p>

      {ramos.map((ramo, i) => (
        <div key={ramo.id} className="rounded-xl border border-line p-2.5">
          <div className="flex items-center gap-2">
            <input
              value={ramo.rotulo}
              onChange={(e) => alterar(i, { rotulo: e.target.value })}
              className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-fg outline-none"
              placeholder="Nome do ramo"
            />
            <select
              value={ramo.juncao}
              onChange={(e) => alterar(i, { juncao: e.target.value as Ramo['juncao'] })}
              className="rounded bg-surface2 px-1 py-0.5 text-[10px] font-bold text-muted outline-none"
            >
              <option value="AND">AND</option><option value="OR">OR</option><option value="NONE">NONE</option>
            </select>
            <button onClick={() => onMudar(ramos.filter((_, j) => j !== i))} className="text-muted hover:text-red-500" aria-label="Remover ramo">
              <Icon name="close" size={12} />
            </button>
          </div>

          <div className="mt-2 space-y-1.5">
            {ramo.regras.map((regra, k) => (
              <div key={k} className="space-y-1 rounded-lg bg-surface2 p-1.5">
                <select
                  value={regra.campo}
                  onChange={(e) => alterar(i, { regras: ramo.regras.map((r, x) => (x === k ? { ...r, campo: e.target.value } : r)) })}
                  className="input h-7 w-full text-[11px]"
                >
                  {camposCondicao.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
                </select>
                <div className="flex gap-1">
                  <select
                    value={regra.operador}
                    onChange={(e) => alterar(i, { regras: ramo.regras.map((r, x) => (x === k ? { ...r, operador: e.target.value } : r)) })}
                    className="input h-7 flex-1 text-[11px]"
                  >
                    {OPERADORES.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                  </select>
                  {!['existe', 'nao_existe'].includes(regra.operador) && (
                    <input
                      value={regra.valor ?? ''}
                      onChange={(e) => alterar(i, { regras: ramo.regras.map((r, x) => (x === k ? { ...r, valor: e.target.value } : r)) })}
                      className="input h-7 flex-1 text-[11px]"
                      placeholder="valor"
                    />
                  )}
                  <button onClick={() => alterar(i, { regras: ramo.regras.filter((_, x) => x !== k) })} className="px-1 text-muted hover:text-red-500" aria-label="Remover regra">
                    <Icon name="close" size={11} />
                  </button>
                </div>
              </div>
            ))}
            <button
              onClick={() => alterar(i, { regras: [...ramo.regras, { campo: 'contato.tags', operador: 'contem', valor: '' }] })}
              className="w-full rounded-lg border border-dashed border-line py-1 text-[11px] text-muted hover:text-brand"
            >
              + regra
            </button>
          </div>
        </div>
      ))}
      {ramos.length === 0 && <p className="rounded-lg border border-dashed border-line py-3 text-center text-[11px] text-muted">Sem ramos: adicione ao menos um.</p>}
    </div>
  );
}

type SplitRamo = { id: string; rotulo?: string; peso?: number };
const nidSplit = () => Math.random().toString(36).slice(2, 9);

/** Editor do teste A/B: cada variante tem rótulo e peso (proporção da divisão). */
function EditorSplit({ ramos, onMudar }: { ramos: SplitRamo[]; onMudar: (r: SplitRamo[]) => void }) {
  const set = (i: number, patch: Partial<SplitRamo>) => onMudar(ramos.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const total = ramos.reduce((s, r) => s + Math.max(1, r.peso ?? 1), 0);
  return (
    <Field label="Variantes" hint="Distribuídas por peso. O mesmo contato cai sempre na mesma variante (determinístico).">
      <div>
        <div className="space-y-2">
          {ramos.map((r, i) => (
            <div key={r.id} className="flex items-center gap-2">
              <Input value={r.rotulo ?? ''} onChange={(e) => set(i, { rotulo: e.target.value })} placeholder={`Variante ${i + 1}`} />
              <div className="flex shrink-0 flex-col items-center">
                <input type="number" min={1} max={100} className="input w-16 text-center" value={r.peso ?? 1} onChange={(e) => set(i, { peso: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })} />
                <span className="mt-0.5 text-[10px] text-muted">{Math.round((Math.max(1, r.peso ?? 1) / total) * 100)}%</span>
              </div>
              {ramos.length > 2 && (
                <button type="button" aria-label="Remover variante" className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-fg" onClick={() => onMudar(ramos.filter((_, j) => j !== i))}>
                  <Icon name="close" size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" className="mt-2 text-xs font-semibold text-brand hover:underline" onClick={() => onMudar([...ramos, { id: nidSplit(), rotulo: `Variante ${ramos.length + 1}`, peso: 1 }])}>
          + Adicionar variante
        </button>
      </div>
    </Field>
  );
}
