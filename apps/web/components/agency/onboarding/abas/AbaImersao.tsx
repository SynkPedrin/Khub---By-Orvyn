'use client';

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/icons';
import { Field } from '@/components/ui';
import { Button, Drawer, Textarea, useToast } from '@/components/kit';
import { Section } from '@/components/revenue/Page';
import { Quando } from '@/components/revenue/Quando';
import { SECOES_CONHECIMENTO, mensagemErro, normalizarEscopo, onboardingApi, pautaParaEscopo, rotuloCampo, type Reuniao } from '@/lib/onboarding';
import { VazioLocal } from '../pecas';
import type { TabProps } from '../OnboardingDetalhe';

const paraLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const linhas = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

/**
 * Imersão: pauta sugerida pelo escopo (a API sugere a mesma quando a reunião
 * é salva sem pauta), registro/edição de reuniões e o que falta coletar.
 */
export function AbaImersao({ ob, podeEditar, recarregar, irParaAba }: TabProps) {
  const [editando, setEditando] = useState<Reuniao | null>(null);
  const [criando, setCriando] = useState(false);
  const pauta = useMemo(() => pautaParaEscopo(normalizarEscopo(ob.escopo)), [ob.escopo]);
  const finalizado = ob.status === 'pronto';

  // O que falta coletar: seções de conhecimento ainda pendentes.
  const faltando = useMemo(() => {
    const porSecao = new Map(ob.knowledge.map((k) => [k.secao, k]));
    return SECOES_CONHECIMENTO.filter((s) => (porSecao.get(s.chave)?.pendente ?? true));
  }, [ob.knowledge]);

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Section
          title="Reuniões registradas"
          action={
            podeEditar && !finalizado ? (
              <Button size="sm" variant="primary" icon="plus" onClick={() => setCriando(true)}>
                Registrar reunião
              </Button>
            ) : undefined
          }
        >
          {ob.meetings.length === 0 ? (
            <VazioLocal
              icone="calendar"
              titulo="Nenhuma reunião registrada"
              texto="Registre a imersão com o cliente: participantes, decisões e pendências ficam na linha do tempo do onboarding."
              acao={podeEditar && !finalizado ? <Button size="sm" icon="plus" onClick={() => setCriando(true)}>Registrar imersão</Button> : undefined}
            />
          ) : (
            <ul className="divide-y divide-line">
              {ob.meetings.map((m) => (
                <li key={m.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-surface3 px-1.5 py-px text-[11px] font-medium capitalize text-muted">{m.tipo}</span>
                    <span className="text-[13px] font-medium text-fg">{m.data ? <Quando data={m.data} formato="data" /> : 'Sem data'}</span>
                    <span className="text-[11.5px] text-faint">
                      registrada <Quando data={m.createdAt} />
                    </span>
                    {podeEditar && !finalizado && (
                      <button type="button" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline" onClick={() => setEditando(m)}>
                        <Icon name="edit" size={12} /> Editar
                      </button>
                    )}
                  </div>
                  {m.participantes.length > 0 && <p className="mt-1 text-xs text-muted">Participantes: {m.participantes.join(', ')}</p>}
                  {m.resumo && <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-fg">{m.resumo}</p>}
                  {m.decisoes.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Decisões</p>
                      <ul className="mt-1 list-inside list-disc space-y-0.5 text-[13px] text-fg">
                        {m.decisoes.map((d, i) => (
                          <li key={i}>{d}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {m.pendencias.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-warning">Pendências</p>
                      <ul className="mt-1 list-inside list-disc space-y-0.5 text-[13px] text-fg">
                        {m.pendencias.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="space-y-5">
        <Section title="Pauta sugerida" info="Montada pelo escopo contratado; entra automaticamente se a reunião for salva sem pauta">
          <ol className="list-inside list-decimal space-y-1 text-[13px] text-fg">
            {pauta.map((t) => (
              <li key={t.chave} className={t.escopoKey ? 'text-brand' : undefined}>
                {t.titulo}
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Ainda falta coletar" info="Seções de conhecimento ainda pendentes">
          {faltando.length === 0 ? (
            <p className="text-[13px] text-success">Todas as seções de conhecimento estão confirmadas.</p>
          ) : (
            <ul className="space-y-1.5">
              {faltando.map((s) => (
                <li key={s.chave}>
                  <button type="button" onClick={() => irParaAba('dados')} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline">
                    <Icon name="chevronRight" size={12} /> {s.rotulo}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <ReuniaoDrawer open={criando || !!editando} onClose={() => { setCriando(false); setEditando(null); }} obId={ob.id} reuniao={editando} onSalva={recarregar} />
    </div>
  );
}

/** Formulário de reunião (criar ou editar): data, participantes, resumo, decisões, pendências. */
function ReuniaoDrawer({ open, onClose, obId, reuniao, onSalva }: { open: boolean; onClose: () => void; obId: string; reuniao: Reuniao | null; onSalva: () => void }) {
  const toast = useToast();
  const [data, setData] = useState('');
  const [participantes, setParticipantes] = useState('');
  const [resumo, setResumo] = useState('');
  const [decisoes, setDecisoes] = useState('');
  const [pendencias, setPendencias] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setData(paraLocal(reuniao?.data ?? null));
    setParticipantes((reuniao?.participantes ?? []).join('\n'));
    setResumo(reuniao?.resumo ?? '');
    setDecisoes((reuniao?.decisoes ?? []).join('\n'));
    setPendencias((reuniao?.pendencias ?? []).join('\n'));
    setErro(null);
  }, [open, reuniao]);

  const salvar = async () => {
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    // Sem pauta: o backend sugere a pauta do escopo automaticamente.
    const corpo = {
      ...(reuniao ? {} : { tipo: 'imersao' }),
      data: data ? new Date(data).toISOString() : null,
      participantes: linhas(participantes),
      resumo: resumo.trim() || null,
      decisoes: linhas(decisoes),
      pendencias: linhas(pendencias),
    };
    try {
      if (reuniao) await onboardingApi.atualizarReuniao(obId, reuniao.id, corpo);
      else await onboardingApi.registrarReuniao(obId, corpo);
      toast.success(reuniao ? 'Reunião atualizada' : 'Reunião registrada');
      onClose();
      onSalva();
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível salvar a reunião.'));
      setSalvando(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={reuniao ? 'Editar reunião' : 'Registrar reunião'}
      width="sm:max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button variant="primary" loading={salvando} onClick={() => void salvar()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Data e hora">
          <input type="datetime-local" className="input" value={data} onChange={(e) => setData(e.target.value)} />
        </Field>
        <Field label="Participantes" hint="Um por linha.">
          <Textarea value={participantes} onChange={(e) => setParticipantes(e.target.value)} rows={2} placeholder={'Ana (cliente)\nMarcos (agência)'} />
        </Field>
        <Field label="Resumo">
          <Textarea value={resumo} onChange={(e) => setResumo(e.target.value)} rows={4} maxLength={20000} showCount placeholder="O que foi dito e combinado na reunião" />
        </Field>
        <Field label="Decisões" hint="Uma por linha.">
          <Textarea value={decisoes} onChange={(e) => setDecisoes(e.target.value)} rows={3} />
        </Field>
        <Field label="Pendências" hint="Uma por linha.">
          <Textarea value={pendencias} onChange={(e) => setPendencias(e.target.value)} rows={3} />
        </Field>
        {erro && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {erro}
          </p>
        )}
      </div>
    </Drawer>
  );
}
