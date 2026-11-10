'use client';

import { useState } from 'react';
import { agentesApi, type AgentConfig } from '@/lib/agents';
import { BarraSalvar, Campo, ListaTextos, Painel, Selecao, Texto, clonar, igual, mensagemDeErro, useToast } from '../kit';
import type { SecaoProps } from '../editor';

/** Identity Editor: colunas (nome, descrição, canais, padrão) + `config.identidade`. */
export function Identidade({ agente, onAtualizado }: SecaoProps) {
  const toast = useToast();
  const base = () => ({ nome: agente.nome, descricao: agente.descricao ?? '', padrao: agente.padrao, identidade: clonar(agente.config.identidade) });
  const [r, setR] = useState(base);
  const [salvando, setSalvando] = useState(false);
  const sujo = !igual(r, base());
  const id = r.identidade;
  const setId = <K extends keyof AgentConfig['identidade']>(k: K, v: AgentConfig['identidade'][K]) => setR((x) => ({ ...x, identidade: { ...x.identidade, [k]: v } }));

  const salvar = async () => {
    if (!r.nome.trim()) return toast('erro', 'O agente precisa de um nome');
    setSalvando(true);
    try {
      const a = await agentesApi.atualizar(agente.id, { nome: r.nome.trim(), descricao: r.descricao, padrao: r.padrao, config: { identidade: { ...r.identidade, avatarUrl: r.identidade.avatarUrl?.trim() || null } } });
      onAtualizado(a);
      toast('ok', 'Identidade salva no rascunho');
    } catch (e) {
      toast('erro', mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-5">
      <Painel titulo="Quem é o agente" descricao="Como o agente se apresenta e em nome de quem fala. Estes dados entram nas instruções fixas do agente.">
        <div className="grid gap-4 md:grid-cols-2">
          <Campo rotulo="Nome"><input className="input" maxLength={80} value={r.nome} onChange={(e) => setR({ ...r, nome: e.target.value })} /></Campo>
          <Campo rotulo="Cargo" dica="Ex.: Consultora de atendimento, SDR, Recepcionista"><input className="input" maxLength={80} value={id.cargo} onChange={(e) => setId('cargo', e.target.value)} /></Campo>
          <Campo rotulo="Empresa representada" dica="Vazio usa o nome da conta"><input className="input" maxLength={120} value={id.empresaRepresentada} onChange={(e) => setId('empresaRepresentada', e.target.value)} /></Campo>
          <Campo rotulo="Avatar (URL da imagem)"><input className="input" type="url" maxLength={500} value={id.avatarUrl ?? ''} onChange={(e) => setId('avatarUrl', e.target.value || null)} placeholder="https://" /></Campo>
          <Campo rotulo="Especialidade" className="md:col-span-2"><input className="input" maxLength={160} value={id.especialidade} onChange={(e) => setId('especialidade', e.target.value)} placeholder="Ex.: tratamentos capilares e dermatologia estética" /></Campo>
          <Campo rotulo="Segmento"><input className="input" maxLength={80} value={id.segmento} onChange={(e) => setId('segmento', e.target.value)} placeholder="Ex.: Saúde, Jurídico, Educação" /></Campo>
          <Campo rotulo="Idioma das respostas">
            <Selecao valor={id.idioma} onChange={(v) => setId('idioma', v)} opcoes={[{ valor: 'pt-BR', rotulo: 'Português (Brasil)' }, { valor: 'en', rotulo: 'Inglês' }, { valor: 'es', rotulo: 'Espanhol' }]} />
          </Campo>
          <Campo rotulo="Nível de conhecimento">
            <Selecao valor={id.nivelConhecimento} onChange={(v) => setId('nivelConhecimento', v)} opcoes={[{ valor: 'basico', rotulo: 'Básico (triagem)' }, { valor: 'intermediario', rotulo: 'Intermediário' }, { valor: 'especialista', rotulo: 'Especialista' }]} />
          </Campo>
          <Campo rotulo="Descrição interna" dica="Só para a equipe; não vai para o contato."><input className="input" maxLength={300} value={r.descricao} onChange={(e) => setR({ ...r, descricao: e.target.value })} /></Campo>
        </div>
      </Painel>

      <Painel titulo="Missão" descricao="O que o agente tenta alcançar em cada conversa e para quem.">
        <div className="grid gap-4">
          <Campo rotulo="Objetivo principal"><Texto valor={id.objetivoPrincipal} onChange={(v) => setId('objetivoPrincipal', v)} max={400} linhas={2} placeholder="Ex.: qualificar o lead e agendar a avaliação capilar" /></Campo>
          <Campo rotulo="Objetivos secundários"><ListaTextos valores={id.objetivosSecundarios} onChange={(v) => setId('objetivosSecundarios', v)} max={8} placeholder="Ex.: registrar o orçamento informado" /></Campo>
          <Campo rotulo="Público atendido"><Texto valor={id.publico} onChange={(v) => setId('publico', v)} max={400} linhas={2} placeholder="Ex.: adultos de 25 a 55 anos com queda de cabelo, vindos de anúncios" /></Campo>
          <Campo rotulo="Perfil profissional" dica="Como um especialista humano nesta função pensaria e agiria."><Texto valor={id.perfilProfissional} onChange={(v) => setId('perfilProfissional', v)} max={600} linhas={3} /></Campo>
          <Campo rotulo="Limites de atuação" dica="O que o agente nunca faz. Ex.: não fala de diagnóstico; não promete prazo de resultado."><ListaTextos valores={id.limitesAtuacao} onChange={(v) => setId('limitesAtuacao', v)} max={15} placeholder="Adicionar limite" /></Campo>
        </div>
      </Painel>

      <Painel titulo="Canal">
        <label className="flex items-start gap-3 text-[13.5px]">
          <input type="checkbox" className="checkbox mt-0.5" checked={r.padrao} onChange={(e) => setR({ ...r, padrao: e.target.checked })} />
          <span>
            <span className="font-medium text-fg">Agente padrão do WhatsApp</span>
            <span className="block text-xs text-muted">Conversas novas começam com este agente (só um agente ativo pode ser o padrão; marcar este desmarca o anterior).</span>
          </span>
        </label>
      </Painel>

      <BarraSalvar sujo={sujo} salvando={salvando} onSalvar={salvar} onDescartar={() => setR(base())} />
    </div>
  );
}
