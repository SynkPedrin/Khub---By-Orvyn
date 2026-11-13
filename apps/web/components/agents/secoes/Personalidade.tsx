'use client';

import { useState } from 'react';
import { agentesApi, ROTULO_DIMENSAO, type Dimensao } from '@/lib/agents';
import { cx } from '@/components/ui';
import { BarraSalvar, Campo, Deslizante, Modal, Painel, Selecao, Texto, mensagemDeErro, useToast } from '../kit';
import { useCamposAgente, useSecaoConfig, type SecaoProps } from '../editor';

/** Personality Editor: 12 dimensões + perfis (embutidos e do tenant) + tom e complemento livre. */
export function Personalidade({ agente, catalogo, onAtualizado }: SecaoProps) {
  const toast = useToast();
  const p = useSecaoConfig(agente, 'personalidade', onAtualizado);
  const col = useCamposAgente(agente, (a) => ({ tom: a.tom, personalidade: a.personalidade }), onAtualizado);
  const [salvarPerfil, setSalvarPerfil] = useState(false);
  const [nomePerfil, setNomePerfil] = useState('');
  const [perfis, setPerfis] = useState(catalogo.personalidade.perfis);

  const aplicarPerfil = (id: string) => {
    const perfil = perfis.find((x) => x.id === id);
    if (perfil) p.setRascunho({ ...p.rascunho, ...perfil.valores, perfil: id });
  };
  const salvar = async () => {
    // Uma requisição só: colunas + seção da config.
    try {
      const a = await agentesApi.atualizar(agente.id, { tom: col.rascunho.tom, personalidade: col.rascunho.personalidade, config: { personalidade: p.rascunho } });
      onAtualizado(a);
      toast('ok', 'Personalidade salva no rascunho');
    } catch (e) {
      toast('erro', mensagemDeErro(e));
    }
  };
  const criarPerfil = async () => {
    const valores = Object.fromEntries(catalogo.personalidade.dimensoes.map((d) => [d, p.rascunho[d]]));
    try {
      const r = await agentesApi.salvarPerfilPersonalidade(nomePerfil, valores);
      setPerfis((x) => [...x.filter((y) => y.id !== r.id), { id: r.id, nome: nomePerfil, valores: valores as Record<Dimensao, number>, embutido: false }]);
      p.set('perfil', r.id);
      setSalvarPerfil(false);
      setNomePerfil('');
      toast('ok', 'Perfil salvo para toda a conta');
    } catch (e) {
      toast('erro', mensagemDeErro(e));
    }
  };

  return (
    <div className="space-y-5">
      <Painel titulo="Perfil de personalidade" descricao="Comece por um perfil e ajuste os controles. Perfis salvos ficam disponíveis para todos os agentes da conta." acao={<button className="btn btn-ghost btn-sm" onClick={() => setSalvarPerfil(true)}>Salvar como perfil</button>}>
        <div className="flex flex-wrap gap-2">
          {perfis.map((pf) => (
            <button key={pf.id} onClick={() => aplicarPerfil(pf.id)} className={cx('pill', p.rascunho.perfil === pf.id && 'pill-brand')} aria-pressed={p.rascunho.perfil === pf.id}>
              {pf.nome}{!pf.embutido && ' (conta)'}
            </button>
          ))}
        </div>
        <div className="mt-6 grid gap-x-8 gap-y-6 md:grid-cols-2 xl:grid-cols-3">
          {catalogo.personalidade.dimensoes.map((d) => {
            const [rot, esq, dir] = ROTULO_DIMENSAO[d];
            return <Deslizante key={d} rotulo={rot} esquerda={esq} direita={dir} valor={p.rascunho[d]} onChange={(v) => p.setRascunho({ ...p.rascunho, [d]: v, perfil: 'personalizado' })} />;
          })}
        </div>
      </Painel>

      <Painel titulo="Tom de voz" descricao="O tom vira uma instrução curta; o complemento descreve traços que os controles não cobrem.">
        <div className="grid gap-4 md:grid-cols-[260px_1fr]">
          <Campo rotulo="Tom">
            <Selecao valor={col.rascunho.tom} onChange={(v) => col.setRascunho({ ...col.rascunho, tom: v })} opcoes={catalogo.tons.map((t) => ({ valor: t.id, rotulo: t.nome }))} />
            <span className="mt-1.5 block text-xs text-muted">{catalogo.tons.find((t) => t.id === col.rascunho.tom)?.instrucao}</span>
          </Campo>
          <Campo rotulo="Complemento de personalidade">
            <Texto valor={col.rascunho.personalidade} onChange={(v) => col.setRascunho({ ...col.rascunho, personalidade: v })} max={1000} placeholder="Ex.: fala com leveza, usa exemplos do dia a dia, nunca é invasiva." />
          </Campo>
        </div>
      </Painel>

      <BarraSalvar sujo={p.sujo || col.sujo} salvando={p.salvando || col.salvando} onSalvar={salvar} onDescartar={() => { p.descartar(); col.descartar(); }} />

      <Modal aberto={salvarPerfil} onFechar={() => setSalvarPerfil(false)} titulo="Salvar perfil de personalidade" rodape={<><button className="btn btn-ghost" onClick={() => setSalvarPerfil(false)}>Cancelar</button><button className="btn btn-primary" disabled={!nomePerfil.trim()} onClick={criarPerfil}>Salvar</button></>}>
        <Campo rotulo="Nome do perfil" dica="Os valores atuais dos 12 controles serão gravados neste perfil."><input className="input" maxLength={60} value={nomePerfil} onChange={(e) => setNomePerfil(e.target.value)} autoFocus /></Campo>
      </Modal>
    </div>
  );
}
