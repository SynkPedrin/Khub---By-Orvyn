'use client';

import { ROTULO_COMPORTAMENTO } from '@/lib/agents';
import { BarraSalvar, Painel, Texto } from '../kit';
import { useCamposAgente, useSecaoConfig, type SecaoProps } from '../editor';
import { RegrasEditor } from './Regras';

/** Behavior Editor: instruções da empresa + 14 situações + regras de conduta. */
export function Comportamento(props: SecaoProps) {
  const { agente, catalogo, onAtualizado } = props;
  const c = useSecaoConfig(agente, 'comportamento', onAtualizado);
  const inst = useCamposAgente(agente, (a) => ({ instrucoes: a.instrucoes }), onAtualizado);

  return (
    <div className="space-y-5">
      <Painel titulo="Instruções da empresa" descricao="O roteiro principal do agente: o que a empresa faz, como vende, o que nunca prometer. Precisa de pelo menos 20 caracteres para ativar.">
        <Texto valor={inst.rascunho.instrucoes} onChange={(v) => inst.setRascunho({ instrucoes: v })} max={8000} linhas={8} placeholder="Ex.: Somos a Clínica Aurora, especializada em tratamento capilar. Entenda a queixa do lead, informe valores da base e conduza para a avaliação." />
        <BarraSalvar sujo={inst.sujo} salvando={inst.salvando} onSalvar={() => void inst.salvar()} onDescartar={inst.descartar} aviso="Instruções alteradas" />
      </Painel>

      <Painel titulo="Como o agente se comporta" descricao="Descreva, em poucas linhas, o comportamento em cada situação. Campos vazios seguem o padrão seguro do agente.">
        <div className="grid gap-4 md:grid-cols-2">
          {catalogo.comportamento.map((campo) => (
            <label key={campo} className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-fg">{ROTULO_COMPORTAMENTO[campo].titulo}</span>
              <Texto valor={c.rascunho[campo]} onChange={(v) => c.set(campo, v)} max={1000} linhas={3} placeholder={ROTULO_COMPORTAMENTO[campo].dica} />
            </label>
          ))}
        </div>
        <BarraSalvar sujo={c.sujo} salvando={c.salvando} onSalvar={c.salvar} onDescartar={c.descartar} />
      </Painel>

      <RegrasEditor {...props} modo="conduta" />
    </div>
  );
}
