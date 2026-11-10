'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Icon, type IconName } from '@/components/icons';
import { Alternar, BarraSalvar, Painel } from '../kit';
import { useSecaoConfig, type SecaoProps } from '../editor';

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REGRAS_FIXAS: { icone: IconName; titulo: string; texto: string }[] = [
  { icone: 'user', titulo: 'Só o contato da conversa', texto: 'As ferramentas não recebem o contato como parâmetro: o servidor injeta o contato da conversa. O agente não lê nem altera outro contato.' },
  { icone: 'lock', titulo: 'Nunca outra empresa', texto: 'A empresa vem da sessão e do banco (isolamento por linha no Postgres), nunca do modelo. O agente não enxerga dados de outros clientes da KHUB.' },
  { icone: 'shield', titulo: 'Sem mudar permissões', texto: 'O agente não cria usuários, não muda papéis, não altera a própria configuração e não usa ferramenta desligada, nem por regra.' },
  { icone: 'alert', titulo: 'Proteção contra manipulação', texto: 'Mensagens do contato, trechos da base e dados do CRM são tratados como dados, não como instruções. Pedidos para mudar as regras, revelar o prompt, trocar de papel ou falar de outros clientes são ignorados.' },
  { icone: 'check2', titulo: 'Não inventa', texto: 'Sobre preço, prazo, condição ou política sem fonte, o agente diz que vai confirmar com a equipe. Nunca diz que fez algo que não passou por uma ferramenta.' },
  { icone: 'note', titulo: 'Tudo auditado', texto: 'Cada execução de ferramenta fica registrada com argumentos, resultado e origem. Ações aprovadas guardam quem aprovou.' },
];

function ListaUuids({ rotulo, dica, valores, onChange, max, placeholder }: { rotulo: string; dica: string; valores: string[]; onChange: (v: string[]) => void; max: number; placeholder: string }) {
  const [novo, setNovo] = useState('');
  const t = novo.trim().toLowerCase();
  const valido = RE_UUID.test(t);
  const repetido = valores.includes(t);
  const cheio = valores.length >= max;
  const add = () => {
    if (!valido || repetido || cheio) return;
    onChange([...valores, t]);
    setNovo('');
  };
  const id = `uuid-${rotulo.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-fg">{rotulo}</label>
      <p className="mb-2 text-xs text-muted">{dica}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={id}
          className="input font-mono text-[12.5px]"
          value={novo}
          placeholder={placeholder}
          aria-invalid={!!novo && !valido}
          onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
        <button type="button" className="btn btn-soft btn-sm shrink-0" disabled={!valido || repetido || cheio} onClick={add}><Icon name="plus" size={14} /> Adicionar</button>
      </div>
      {novo && !valido && <p className="mt-1 text-xs text-muted">Cole o identificador completo (UUID).</p>}
      {repetido && <p className="mt-1 text-xs text-muted">Esse identificador já está na lista.</p>}
      {cheio && <p className="mt-1 text-xs text-muted">Limite de {max} itens atingido.</p>}
      {valores.length > 0 ? (
        <ul className="mt-2.5 divide-y divide-line rounded-xl border border-line">
          {valores.map((v) => (
            <li key={v} className="flex items-center justify-between gap-2 px-3 py-2">
              <code className="min-w-0 truncate text-[12.5px] text-fg">{v}</code>
              <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Remover ${v}`} onClick={() => onChange(valores.filter((x) => x !== v))}><Icon name="close" size={13} /></button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Permissoes({ agente, catalogo, onAtualizado }: SecaoProps) {
  const cfg = useSecaoConfig(agente, 'permissoes', onAtualizado);
  const r = cfg.rascunho;
  const exigem = agente.config.permissoes.exigirConfirmacao;
  const rotulo = (nome: string) => catalogo.ferramentas.find((f) => f.nome === nome)?.rotulo ?? nome;

  return (
    <div className="space-y-5">
      <Painel titulo="Ações automáticas" descricao="Limites do que o agente pode fazer além de responder. Valem para decisões do agente e para regras de comportamento.">
        <div className="space-y-5">
          <Alternar
            ligado={r.acoesPorRegra}
            onChange={(v) => cfg.set('acoesPorRegra', v)}
            rotulo="Permitir ações disparadas por regras"
            descricao="Regras de comportamento podem adicionar tag, mover etapa, acionar workflow e outras ações. Mesmo ligadas, só usam ferramentas liberadas na aba Ferramentas."
          />
          <ListaUuids
            rotulo="Workflows que o agente pode acionar"
            dica={`Identificadores dos workflows criados em Automações (/automacoes). Lista vazia = nenhum workflow pode ser acionado. Até 30.`}
            valores={r.workflowsPermitidos}
            onChange={(v) => cfg.set('workflowsPermitidos', v)}
            max={30}
            placeholder="ID do workflow"
          />
          <p className="-mt-2 text-xs">
            <Link href="/automacoes" className="inline-flex items-center gap-1 text-brand hover:underline"><Icon name="external" size={12} /> Abrir Automações para copiar o ID</Link>
          </p>
          <ListaUuids
            rotulo="Etapas do funil que o agente pode atribuir"
            dica="Identificadores das etapas do pipeline. Lista vazia = qualquer etapa. Até 50."
            valores={r.etapasPermitidas}
            onChange={(v) => cfg.set('etapasPermitidas', v)}
            max={50}
            placeholder="ID da etapa"
          />
        </div>
      </Painel>

      <Painel
        titulo="Aprovação humana"
        descricao="Ferramentas de escrita que esperam alguém da equipe aprovar antes de executar."
        acao={<Link href={`/agentes/${agente.id}?aba=ferramentas`} className="btn btn-ghost btn-sm"><Icon name="bolt" size={14} /> Configurar em Ferramentas</Link>}
      >
        {exigem.length === 0 ? (
          <p className="text-[13.5px] text-muted">Nenhuma ferramenta exige aprovação: as ferramentas de escrita ligadas executam direto e ficam registradas no log.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5" aria-label="Ferramentas que exigem aprovação">
            {exigem.map((n) => <li key={n} className="pill pill-warning">{rotulo(n)}</li>)}
          </ul>
        )}
      </Painel>

      <Painel titulo="Regras fixas de segurança" descricao="Valem para todo agente, acima de qualquer instrução da empresa ou pedido do contato. Não são configuráveis.">
        <ul className="grid gap-3 md:grid-cols-2">
          {REGRAS_FIXAS.map((g) => (
            <li key={g.titulo} className="flex gap-3 rounded-xl border border-line bg-surface2/60 p-3.5">
              <span className="icon-tile icon-tile-neutral h-8 w-8 shrink-0 rounded-lg"><Icon name={g.icone} size={15} /></span>
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-fg">{g.titulo}</p>
                <p className="mt-0.5 text-xs text-muted">{g.texto}</p>
              </div>
            </li>
          ))}
        </ul>
      </Painel>

      <Painel titulo="Quem pode configurar agentes" descricao="O agente fala em nome da empresa, então só quem administra a conta altera sua configuração.">
        <div className="flex flex-wrap items-start gap-3 rounded-xl border border-info-border bg-info-soft px-4 py-3 text-[13.5px] text-fg">
          <Icon name="crown" size={16} className="mt-0.5 shrink-0" />
          <p className="min-w-0 flex-1">
            Apenas usuários com papel <strong>Proprietário</strong> ou <strong>Administrador</strong> salvam alterações, publicam versões, aprovam ações e excluem dados de IA. Os demais papéis podem ver, mas o servidor recusa a gravação (erro 403).
          </p>
        </div>
      </Painel>

      <BarraSalvar sujo={cfg.sujo} salvando={cfg.salvando} onSalvar={() => void cfg.salvar()} onDescartar={cfg.descartar} />
    </div>
  );
}
