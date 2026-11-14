'use client';

import type { DiaSemanaAgente } from '@/lib/agents';
import { cx } from '@/components/ui';
import { Alternar, BarraSalvar, Campo, Painel, Selecao, Texto } from '../kit';
import { useSecaoConfig, type SecaoProps } from '../editor';

const DIAS: { id: DiaSemanaAgente; rotulo: string }[] = [
  { id: 'seg', rotulo: 'Segunda' },
  { id: 'ter', rotulo: 'Terça' },
  { id: 'qua', rotulo: 'Quarta' },
  { id: 'qui', rotulo: 'Quinta' },
  { id: 'sex', rotulo: 'Sexta' },
  { id: 'sab', rotulo: 'Sábado' },
  { id: 'dom', rotulo: 'Domingo' },
];

/**
 * Horário de atendimento do agente (`config.horario`, ADR-0042). Desligado =
 * responde 24h. Edita a PRIMEIRA faixa de cada dia; faixas extras que já
 * existirem (ex.: almoço) são preservadas.
 */
export function Horario({ agente, onAtualizado }: SecaoProps) {
  const c = useSecaoConfig(agente, 'horario', onAtualizado);
  const h = c.rascunho;
  const setDia = (dia: DiaSemanaAgente, faixa: { inicio: string; fim: string } | null) => {
    const resto = h.dias[dia].slice(1);
    c.set('dias', { ...h.dias, [dia]: faixa ? [faixa, ...resto] : [] });
  };

  return (
    <div className="space-y-5">
      <Painel titulo="Horário de atendimento" descricao="Fora do horário o agente segue a regra abaixo. Desligado, ele responde a qualquer hora.">
        <Alternar ligado={h.ativo} onChange={(v) => c.set('ativo', v)} rotulo="Respeitar horário de atendimento" descricao={h.ativo ? 'Ligado' : 'Desligado: responde 24 horas'} />
        <div className={cx('mt-4 space-y-2', !h.ativo && 'pointer-events-none opacity-50')} aria-disabled={!h.ativo}>
          {DIAS.map(({ id, rotulo }) => {
            const faixa = h.dias[id][0];
            return (
              <div key={id} className="grid grid-cols-[96px_auto_minmax(0,1fr)] items-center gap-3">
                <span className="text-[13.5px] font-medium text-fg">{rotulo}</span>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <input type="checkbox" className="checkbox" checked={!!faixa} onChange={(e) => setDia(id, e.target.checked ? { inicio: '08:00', fim: '18:00' } : null)} />
                  Aberto
                </label>
                {faixa ? (
                  <span className="flex items-center gap-2">
                    <input type="time" className="input h-9 w-28" value={faixa.inicio} onChange={(e) => setDia(id, { ...faixa, inicio: e.target.value || faixa.inicio })} aria-label={`${rotulo}: abre`} />
                    <span className="text-xs text-muted">às</span>
                    <input type="time" className="input h-9 w-28" value={faixa.fim} onChange={(e) => setDia(id, { ...faixa, fim: e.target.value || faixa.fim })} aria-label={`${rotulo}: fecha`} />
                    {h.dias[id].length > 1 && <span className="text-xs text-faint">+{h.dias[id].length - 1} faixa(s)</span>}
                  </span>
                ) : (
                  <span className="text-xs text-faint">Fechado</span>
                )}
              </div>
            );
          })}
        </div>
      </Painel>

      <Painel titulo="Fora do horário">
        <div className="grid gap-4">
          <Campo rotulo="O que o agente faz">
            <Selecao
              valor={h.foraDoHorario}
              onChange={(v) => c.set('foraDoHorario', v)}
              opcoes={[
                { valor: 'responder_na_abertura', rotulo: 'Fica quieto e responde quando abrir' },
                { valor: 'avisar_e_responder_na_abertura', rotulo: 'Avisa uma vez e responde quando abrir' },
                { valor: 'transferir_para_equipe', rotulo: 'Passa a conversa para a equipe' },
              ]}
            />
          </Campo>
          {h.foraDoHorario === 'avisar_e_responder_na_abertura' && (
            <Campo rotulo="Aviso" dica="{{horario}} vira o resumo dos horários e {{abertura}} o próximo horário de abertura.">
              <Texto valor={h.mensagemFora} onChange={(v) => c.set('mensagemFora', v)} max={500} linhas={3} />
            </Campo>
          )}
          <Campo rotulo="Fuso horário"><input className="input" value={h.fuso} maxLength={60} onChange={(e) => c.set('fuso', e.target.value)} /></Campo>
        </div>
      </Painel>

      <BarraSalvar sujo={c.sujo} salvando={c.salvando} onSalvar={c.salvar} onDescartar={c.descartar} />
    </div>
  );
}
