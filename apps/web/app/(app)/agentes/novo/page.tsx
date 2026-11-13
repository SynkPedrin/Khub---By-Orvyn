'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { agentesApi, ROTULO_FERRAMENTA_GRUPO, type CatalogoAgentes, type Dimensao } from '@/lib/agents';
import { Alternar, Campo, Erro, Esqueleto, ListaTextos, Selecao, Texto, mensagemDeErro, useCarga, useToast } from '@/components/agents/kit';

const PASSOS = ['Identidade', 'Personalidade', 'Instruções', 'Comunicação e ações', 'Conhecimento', 'Revisão'] as const;

interface Estado {
  nome: string;
  cargo: string;
  empresa: string;
  especialidade: string;
  segmento: string;
  objetivo: string;
  publico: string;
  limites: string[];
  perfil: string;
  tom: string;
  modelo: string;
  instrucoes: string;
  fragmentar: boolean;
  emojis: 'nunca' | 'raro' | 'moderado';
  ferramentas: string[];
  conhecimentoTitulo: string;
  conhecimentoTexto: string;
  padrao: boolean;
}

/** Agent Creation Wizard: cria o agente como RASCUNHO com a configuração inicial. */
export default function NovoAgente() {
  const cat = useCarga(() => agentesApi.catalogo(), []);
  if (cat.erro) return <div className="mx-auto max-w-3xl p-6"><Erro texto={cat.erro} tentar={cat.recarregar} /></div>;
  if (!cat.dados) return <div className="mx-auto max-w-3xl p-6"><Esqueleto linhas={6} /></div>;
  return <Wizard catalogo={cat.dados} />;
}

function Wizard({ catalogo }: { catalogo: CatalogoAgentes }) {
  const router = useRouter();
  const toast = useToast();
  const [passo, setPasso] = useState(0);
  const [criando, setCriando] = useState(false);
  const [e, setE] = useState<Estado>({
    nome: '',
    cargo: '',
    empresa: '',
    especialidade: '',
    segmento: '',
    objetivo: '',
    publico: '',
    limites: [],
    perfil: 'equilibrado',
    tom: 'cordial',
    modelo: catalogo.modeloPadrao,
    instrucoes: '',
    fragmentar: true,
    emojis: 'raro',
    ferramentas: ['buscar_conhecimento', 'ver_contato', 'atualizar_contato', 'adicionar_nota', 'criar_tarefa'].filter((f) => catalogo.ferramentas.some((x) => x.nome === f)),
    conhecimentoTitulo: '',
    conhecimentoTexto: '',
    padrao: false,
  });
  const set = <K extends keyof Estado>(k: K, v: Estado[K]) => setE((x) => ({ ...x, [k]: v }));

  // A NICO escreve as instruções a partir do que já foi preenchido no passo 1.
  const [gerando, setGerando] = useState(false);
  const nicoEscrever = async () => {
    if (!e.objetivo.trim()) return toast('erro', 'Defina o objetivo principal no passo 1 — a NICO precisa dele para escrever');
    setGerando(true);
    try {
      const r = await agentesApi.assistentePrompt({
        nome: e.nome.trim() || undefined,
        foco: e.objetivo.trim(),
        descricao: [
          e.empresa.trim() && `Empresa: ${e.empresa.trim()}`,
          e.segmento.trim() && `Segmento: ${e.segmento.trim()}`,
          e.especialidade.trim() && `Especialidade: ${e.especialidade.trim()}`,
          e.publico.trim() && `Público: ${e.publico.trim()}`,
        ].filter(Boolean).join('\n') || e.objetivo.trim(),
        instrucoesAtuais: e.instrucoes.trim() || undefined,
      });
      set('instrucoes', r.instrucoes);
      toast('ok', 'A NICO escreveu as instruções — revise e ajuste à vontade');
    } catch (err) {
      toast('erro', mensagemDeErro(err));
    } finally {
      setGerando(false);
    }
  };

  const problemas: Record<number, string | null> = {
    0: !e.nome.trim() ? 'Dê um nome ao agente' : !e.objetivo.trim() ? 'Defina o objetivo principal' : null,
    2: e.instrucoes.trim().length < 20 ? 'Escreva ao menos 20 caracteres de instruções (necessário para ativar)' : null,
    4: e.conhecimentoTexto.trim() && !e.conhecimentoTitulo.trim() ? 'Dê um título para o conteúdo da base' : null,
  };
  const bloqueio = problemas[passo] ?? null;

  const criar = async () => {
    setCriando(true);
    try {
      const perfil = catalogo.personalidade.perfis.find((p) => p.id === e.perfil);
      const a = await agentesApi.criar({
        nome: e.nome.trim(),
        modelo: e.modelo,
        tom: e.tom,
        instrucoes: e.instrucoes.trim(),
        ferramentas: e.ferramentas,
        padrao: e.padrao,
        config: {
          identidade: { cargo: e.cargo, empresaRepresentada: e.empresa, especialidade: e.especialidade, segmento: e.segmento, objetivoPrincipal: e.objetivo, publico: e.publico, limitesAtuacao: e.limites },
          ...(perfil ? { personalidade: { ...(perfil.valores as Record<Dimensao, number>), perfil: perfil.id } } : {}),
          comunicacao: { fragmentacao: { ...catalogo.configPadrao.comunicacao.fragmentacao, ativo: e.fragmentar }, emojis: e.emojis },
        },
      });
      if (e.conhecimentoTexto.trim()) {
        await agentesApi.adicionarFonte(a.id, { tipo: 'texto', titulo: e.conhecimentoTitulo.trim(), categoria: 'geral', texto: e.conhecimentoTexto }).catch((err) => toast('erro', `Agente criado, mas o conteúdo da base falhou: ${mensagemDeErro(err)}`));
      }
      toast('ok', 'Agente criado como rascunho. Teste ao vivo ou no simulador antes de ativar.');
      router.push(`/agentes/${a.id}?aba=aovivo`);
    } catch (err) {
      toast('erro', mensagemDeErro(err));
      setCriando(false);
    }
  };

  const grupos = [...new Set(catalogo.ferramentas.filter((f) => !f.obrigatoria).map((f) => f.grupo))];

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 lg:py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/agentes" className="btn btn-ghost btn-icon" aria-label="Voltar para agentes"><span aria-hidden className="text-lg leading-none">←</span></Link>
        <div>
          <h1 className="t-display">Novo agente</h1>
          <p className="mt-1 text-[14px] text-muted">Tudo pode ser ajustado depois. O agente nasce como rascunho e só atende quando você ativar.</p>
        </div>
      </div>

      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Passos">
        {PASSOS.map((p, i) => (
          <li key={p}>
            <button onClick={() => i < passo && setPasso(i)} disabled={i > passo} className={cx('pill', i === passo ? 'pill-brand' : i < passo ? 'pill-success' : '')} aria-current={i === passo ? 'step' : undefined}>
              {i < passo ? <Icon name="check" size={11} /> : <span className="tabular">{i + 1}</span>} {p}
            </button>
          </li>
        ))}
      </ol>

      <div className="card p-5 sm:p-6">
        {passo === 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            <Campo rotulo="Nome do agente"><input className="input" autoFocus maxLength={80} value={e.nome} onChange={(x) => set('nome', x.target.value)} placeholder="Ex.: Lia" /></Campo>
            <Campo rotulo="Cargo"><input className="input" maxLength={80} value={e.cargo} onChange={(x) => set('cargo', x.target.value)} placeholder="Ex.: Consultora de atendimento" /></Campo>
            <Campo rotulo="Empresa representada" dica="Vazio usa o nome da conta"><input className="input" maxLength={120} value={e.empresa} onChange={(x) => set('empresa', x.target.value)} /></Campo>
            <Campo rotulo="Segmento"><input className="input" maxLength={80} value={e.segmento} onChange={(x) => set('segmento', x.target.value)} placeholder="Ex.: Saúde estética" /></Campo>
            <Campo rotulo="Especialidade" className="md:col-span-2"><input className="input" maxLength={160} value={e.especialidade} onChange={(x) => set('especialidade', x.target.value)} /></Campo>
            <Campo rotulo="Objetivo principal" className="md:col-span-2"><Texto valor={e.objetivo} onChange={(v) => set('objetivo', v)} max={400} linhas={2} placeholder="Ex.: qualificar o lead e agendar a avaliação" /></Campo>
            <Campo rotulo="Público atendido" className="md:col-span-2"><Texto valor={e.publico} onChange={(v) => set('publico', v)} max={400} linhas={2} /></Campo>
            <Campo rotulo="Limites de atuação" className="md:col-span-2" dica="O que o agente nunca deve fazer"><ListaTextos valores={e.limites} onChange={(v) => set('limites', v)} placeholder="Ex.: não dar diagnóstico" /></Campo>
          </div>
        )}

        {passo === 1 && (
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-[13px] font-medium text-fg">Perfil de personalidade</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {catalogo.personalidade.perfis.map((p) => (
                  <button key={p.id} onClick={() => set('perfil', p.id)} className={cx('rounded-xl border p-3.5 text-left transition-colors', e.perfil === p.id ? 'border-brand-border bg-brand-softer' : 'border-line hover:bg-surface2')} aria-pressed={e.perfil === p.id}>
                    <span className="block text-[14px] font-medium text-fg">{p.nome}</span>
                    <span className="mt-1 block text-xs text-muted">Empatia {p.valores.empatia} · Formalidade {p.valores.formalidade} · Persuasão {p.valores.persuasao}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">Os 12 controles finos ficam na aba Personalidade, depois de criar.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Campo rotulo="Tom de voz"><Selecao valor={e.tom} onChange={(v) => set('tom', v)} opcoes={catalogo.tons.map((t) => ({ valor: t.id, rotulo: t.nome }))} /></Campo>
              <Campo rotulo="Modelo de IA"><Selecao valor={e.modelo} onChange={(v) => set('modelo', v)} opcoes={catalogo.modelos.map((m) => ({ valor: m.id, rotulo: m.nome }))} /></Campo>
            </div>
            <p className="text-xs text-muted">{catalogo.modelos.find((m) => m.id === e.modelo)?.descricao}</p>
          </div>
        )}

        {passo === 2 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[color-mix(in_srgb,var(--brand)_25%,transparent)] bg-brand-soft/50 px-3.5 py-2.5">
              <p className="text-[12.5px] text-muted">Sem inspiração? A NICO escreve as instruções a partir do objetivo e da identidade que você já preencheu.</p>
              <button type="button" className="btn btn-primary btn-sm shrink-0" onClick={nicoEscrever} disabled={gerando}>
                <Icon name="sparkles" size={14} /> {gerando ? 'NICO escrevendo…' : e.instrucoes.trim() ? 'Melhorar com a NICO' : 'Escrever com a NICO'}
              </button>
            </div>
            <Campo rotulo="Instruções da empresa" dica="O que a empresa faz, como o agente vende e o que nunca prometer. Preços e políticas detalhados vão na base de conhecimento.">
              <Texto valor={e.instrucoes} onChange={(v) => set('instrucoes', v)} max={8000} linhas={10} placeholder="Ex.: Somos a Clínica Aurora, especializada em tratamento capilar. Entenda a queixa, informe valores da base e conduza para a avaliação. Nunca prometa resultado." />
            </Campo>
          </div>
        )}

        {passo === 3 && (
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2">
              <Alternar ligado={e.fragmentar} onChange={(v) => set('fragmentar', v)} rotulo="Responder em mensagens curtas" descricao="Fragmenta a resposta em blocos naturais, com pausa de digitação." />
              <Campo rotulo="Emojis"><Selecao valor={e.emojis} onChange={(v) => set('emojis', v)} opcoes={[{ valor: 'nunca', rotulo: 'Nunca' }, { valor: 'raro', rotulo: 'Raramente' }, { valor: 'moderado', rotulo: 'Com moderação' }]} /></Campo>
            </div>
            <div>
              <p className="mb-2 text-[13px] font-medium text-fg">O que o agente pode fazer no CRM</p>
              <div className="grid gap-4 md:grid-cols-2">
                {grupos.map((g) => (
                  <fieldset key={g}>
                    <legend className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">{ROTULO_FERRAMENTA_GRUPO[g]}</legend>
                    {catalogo.ferramentas.filter((f) => f.grupo === g && !f.obrigatoria).map((f) => (
                      <label key={f.nome} className="flex items-start gap-2.5 py-1.5 text-[13.5px]">
                        <input type="checkbox" className="checkbox mt-0.5" checked={e.ferramentas.includes(f.nome)} onChange={(x) => set('ferramentas', x.target.checked ? [...e.ferramentas, f.nome] : e.ferramentas.filter((y) => y !== f.nome))} />
                        <span><span className="text-fg">{f.rotulo}</span>{f.critica && <span className="pill pill-warning ml-1.5 h-5 text-[10.5px]">Crítica</span>}<span className="block text-xs text-muted">{f.descricao}</span></span>
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">Transferir para humano está sempre disponível. Aprovação humana para ações críticas é configurada na aba Ferramentas.</p>
            </div>
          </div>
        )}

        {passo === 4 && (
          <div className="space-y-4">
            <p className="text-[14px] text-muted">Opcional: cole um texto inicial (serviços, preços, FAQ). PDFs, DOCX, planilhas e páginas da web são adicionados na aba Base de conhecimento, depois de criar.</p>
            <Campo rotulo="Título"><input className="input" maxLength={200} value={e.conhecimentoTitulo} onChange={(x) => set('conhecimentoTitulo', x.target.value)} placeholder="Ex.: Tabela de serviços 2026" /></Campo>
            <Campo rotulo="Conteúdo"><textarea className="textarea" rows={10} value={e.conhecimentoTexto} onChange={(x) => set('conhecimentoTexto', x.target.value)} /></Campo>
          </div>
        )}

        {passo === 5 && (
          <div className="space-y-4 text-[14px]">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {[
                ['Nome', e.nome],
                ['Cargo', e.cargo || 'Agente de atendimento'],
                ['Objetivo', e.objetivo],
                ['Personalidade', catalogo.personalidade.perfis.find((p) => p.id === e.perfil)?.nome ?? e.perfil],
                ['Tom', catalogo.tons.find((t) => t.id === e.tom)?.nome ?? e.tom],
                ['Modelo', catalogo.modelos.find((m) => m.id === e.modelo)?.nome ?? e.modelo],
                ['Ferramentas', `${e.ferramentas.length} ligadas + transferência`],
                ['Base de conhecimento', e.conhecimentoTexto.trim() ? e.conhecimentoTitulo : 'Adicionar depois'],
              ].map(([k, v]) => (
                <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="mt-0.5 text-fg">{v}</dd></div>
              ))}
            </dl>
            <label className="flex items-start gap-3 rounded-xl border border-line p-3.5">
              <input type="checkbox" className="checkbox mt-0.5" checked={e.padrao} onChange={(x) => set('padrao', x.target.checked)} />
              <span><span className="font-medium text-fg">Tornar o agente padrão do WhatsApp</span><span className="block text-xs text-muted">Só passa a atender quando estiver ativo.</span></span>
            </label>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <span className="text-[13px] text-warning">{bloqueio}</span>
          <div className="flex gap-2">
            {passo > 0 && <button className="btn btn-ghost" onClick={() => setPasso(passo - 1)} disabled={criando}>Voltar</button>}
            {passo < PASSOS.length - 1 ? (
              <button className="btn btn-primary" disabled={!!bloqueio} onClick={() => setPasso(passo + 1)}>Continuar</button>
            ) : (
              <button className="btn btn-primary" disabled={criando} onClick={criar}>{criando ? 'Criando…' : 'Criar agente'}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
