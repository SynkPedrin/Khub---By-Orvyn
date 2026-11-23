'use client';

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/icons';
import { Button, Modal, SkeletonLines, Switch, Textarea, useToast } from '@/components/kit';
import { Section } from '@/components/revenue/Page';
import { Quando } from '@/components/revenue/Quando';
import { cx } from '@/components/ui';
import {
  SECOES_CONHECIMENTO,
  mensagemErro,
  onboardingApi,
  rotuloCampo,
  type KnowledgeHist,
  type KnowledgeSecao,
  type SecaoConhecimento,
} from '@/lib/onboarding';
import { nomeMembro } from '../pecas';
import type { TabProps } from '../OnboardingDetalhe';

/** Valor do campo para o editor: arrays viram linhas; objetos viram JSON. */
function paraTexto(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n');
  return JSON.stringify(v, null, 2);
}

/** Volta do editor para o dado: preserva a forma original (array ↔ linhas). */
function doTexto(texto: string, original: unknown): unknown {
  if (Array.isArray(original)) return texto.split('\n').map((l) => l.trim()).filter(Boolean);
  return texto;
}

/**
 * Dados do negócio: as 7 seções de conhecimento. Editor por seção com os
 * campos obrigatórios do catálogo (+ campos extras já salvos), marcação de
 * pendente (nunca presumir), selo de confirmação e histórico de alterações.
 */
export function AbaConhecimento({ ob, membros, podeEditar, recarregar }: TabProps) {
  const [historico, setHistorico] = useState<SecaoConhecimento | null>(null);
  const porSecao = useMemo(() => new Map(ob.knowledge.map((k) => [k.secao, k])), [ob.knowledge]);
  const finalizado = ob.status === 'pronto';

  return (
    <div className="space-y-5">
      {SECOES_CONHECIMENTO.map((s) => (
        <SecaoEditor
          key={s.chave}
          secao={s}
          knowledge={porSecao.get(s.chave) ?? null}
          obId={ob.id}
          membros={membros}
          podeEditar={podeEditar && !finalizado}
          recarregar={recarregar}
          onHistorico={() => setHistorico(s.chave)}
        />
      ))}
      <HistoricoModal obId={ob.id} secao={historico} membros={membros} onClose={() => setHistorico(null)} />
    </div>
  );
}

function SecaoEditor({
  secao,
  knowledge,
  obId,
  membros,
  podeEditar,
  recarregar,
  onHistorico,
}: {
  secao: (typeof SECOES_CONHECIMENTO)[number];
  knowledge: KnowledgeSecao | null;
  obId: string;
  membros: TabProps['membros'];
  podeEditar: boolean;
  recarregar: () => void;
  onHistorico: () => void;
}) {
  const toast = useToast();
  const dados = useMemo(() => knowledge?.dados ?? {}, [knowledge]);
  // Campos do catálogo primeiro; extras salvos (fora do catálogo) aparecem depois.
  const campos = useMemo(() => {
    const base = [...secao.camposObrigatorios];
    const extras = Object.keys(dados).filter((k) => !(secao.camposObrigatorios as readonly string[]).includes(k));
    return [...base, ...extras];
  }, [secao, dados]);

  const [valores, setValores] = useState<Record<string, string>>({});
  const [pendente, setPendente] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setValores(Object.fromEntries(campos.map((c) => [c, paraTexto(dados[c])])));
    setPendente(knowledge?.pendente ?? true);
  }, [knowledge, campos, dados]);

  const sujo = useMemo(
    () => campos.some((c) => valores[c] !== paraTexto(dados[c])) || pendente !== (knowledge?.pendente ?? true),
    [campos, valores, dados, pendente, knowledge],
  );

  const salvar = async () => {
    if (salvando) return;
    setSalvando(true);
    try {
      const dadosNovos = Object.fromEntries(campos.map((c) => [c, doTexto(valores[c] ?? '', dados[c])]).filter(([, v]) => v !== '' && !(Array.isArray(v) && !v.length)));
      await onboardingApi.salvarConhecimento(obId, secao.chave, dadosNovos, pendente);
      toast.success(pendente ? `${secao.rotulo} salva (pendente)` : `${secao.rotulo} confirmada`);
      recarregar();
    } catch (e) {
      toast.error('Não foi possível salvar', { description: mensagemErro(e, 'Tente novamente.') });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Section
      title={secao.rotulo}
      action={
        <div className="flex items-center gap-2">
          {knowledge && !knowledge.pendente && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">
              <Icon name="check" size={11} /> Confirmada {knowledge.confirmadoPor ? `por ${nomeMembro(membros, knowledge.confirmadoPor)}` : ''} <Quando data={knowledge.confirmadoEm} formato="data" />
            </span>
          )}
          {(!knowledge || knowledge.pendente) && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">
              <Icon name="clock" size={11} /> Pendente
            </span>
          )}
          <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline" onClick={onHistorico}>
            <Icon name="history" size={12} /> Histórico
          </button>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        {campos.map((c) => (
          <label key={c} className={cx('block', (secao.camposObrigatorios as readonly string[]).includes(c) ? '' : 'md:col-span-2')}>
            <span className="mb-1.5 block text-[13px] font-medium text-fg">
              {rotuloCampo(c)}
              {(secao.camposObrigatorios as readonly string[]).includes(c) && <span className="ml-1 text-danger">*</span>}
            </span>
            <Textarea value={valores[c] ?? ''} onChange={(e) => setValores((v) => ({ ...v, [c]: e.target.value }))} rows={2} disabled={!podeEditar} placeholder="Ainda não coletado" />
          </label>
        ))}
      </div>
      {podeEditar && (
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Switch checked={!pendente} onChange={(v) => setPendente(!v)} label="Informações confirmadas" description="Desmarcar volta a seção para pendente, sem presumir dado." />
          <Button size="sm" variant="primary" className="ml-auto" loading={salvando} disabled={!sujo} onClick={() => void salvar()}>
            Salvar seção
          </Button>
          {sujo && <span className="text-xs text-muted">Alterações não salvas</span>}
        </div>
      )}
      {knowledge?.atualizadoPor && (
        <p className="mt-3 text-[11.5px] text-faint">
          Última edição por {nomeMembro(membros, knowledge.atualizadoPor)} · <Quando data={knowledge.updatedAt} />
        </p>
      )}
    </Section>
  );
}

/** Snapshots do conteúdo ANTERIOR a cada edição da seção (auditoria de edição). */
function HistoricoModal({ obId, secao, membros, onClose }: { obId: string; secao: SecaoConhecimento | null; membros: TabProps['membros']; onClose: () => void }) {
  const [itens, setItens] = useState<KnowledgeHist[] | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (!secao) return;
    setItens(null);
    setErro(false);
    onboardingApi.historicoConhecimento(obId, secao).then(setItens).catch(() => setErro(true));
  }, [obId, secao]);

  return (
    <Modal open={!!secao} onClose={onClose} title={`Histórico — ${secao ? rotuloCampo(secao) : ''}`} size="lg">
      {!secao ? null : erro ? (
        <p role="alert" className="text-sm text-danger">Não foi possível carregar o histórico.</p>
      ) : !itens ? (
        <SkeletonLines lines={4} label="Carregando histórico" />
      ) : itens.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma alteração anterior registrada — o histórico guarda o conteúdo de antes de cada edição.</p>
      ) : (
        <ul className="space-y-4">
          {itens.map((h) => (
            <li key={h.id} className="rounded-lg border border-line p-3">
              <p className="mb-2 text-[11.5px] text-faint">
                Antes da edição de {h.alteradoPor ? nomeMembro(membros, h.alteradoPor) : 'alguém da equipe'} · <Quando data={h.createdAt} />
              </p>
              <dl className="space-y-1.5">
                {Object.entries(h.dados).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{rotuloCampo(k)}</dt>
                    <dd className="whitespace-pre-wrap text-[13px] text-fg">{paraTexto(v) || <span className="text-faint">(vazio)</span>}</dd>
                  </div>
                ))}
                {Object.keys(h.dados).length === 0 && <p className="text-[13px] text-faint">(seção vazia)</p>}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
