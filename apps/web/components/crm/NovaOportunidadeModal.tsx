'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Avatar, Card } from '@/components/ui';
import { useDialogFocus } from '@/lib/use-dialog-focus';
import { Icon } from '@/components/icons';
import { crm, type Contato } from '@/lib/crm';
import { lerValor, mensagemErroCrm } from './erro-api';

interface Props {
  stages: { id: string; nome: string }[];
  /** Etapa pré-selecionada (padrão: a primeira). */
  stageInicial?: string;
  onClose: () => void;
  /** Chamado depois que a API confirmou a criação. */
  onCreated: (id: string) => void;
}

type ContatoEscolhido = Pick<Contato, 'id' | 'nome'> & { detalhe: string | null };

/** Cria uma oportunidade real via `POST /crm/deals`. Montado só enquanto aberto. */
export function NovaOportunidadeModal({ stages, stageInicial, onClose, onCreated }: Props) {
  const [form, setForm] = useState({
    titulo: '',
    stageId: stageInicial ?? stages[0]?.id ?? '',
    valor: '',
    origem: '',
  });
  const [contato, setContato] = useState<ContatoEscolhido | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const foco = useDialogFocus(true, () => { if (!salvando) onClose(); });

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const titulo = form.titulo.trim();
    if (!titulo) {
      setErro('Informe o título da oportunidade.');
      return;
    }
    if (!form.stageId) {
      setErro('Escolha a etapa do funil.');
      return;
    }
    const valor = lerValor(form.valor);
    if (valor === 'invalido') {
      setErro('Valor precisa ser um número igual ou maior que zero.');
      return;
    }

    const corpo: Record<string, unknown> = { titulo, stageId: form.stageId };
    if (valor !== null) corpo.valor = valor;
    if (contato) corpo.contactId = contato.id;
    if (form.origem.trim()) corpo.origem = form.origem.trim();

    setSalvando(true);
    setErro('');
    try {
      const r = await crm.createDeal(corpo);
      onCreated(r.id);
    } catch (err) {
      setErro(mensagemErroCrm(err));
      setSalvando(false);
    }
  };

  const semEtapas = stages.length === 0;

  return (
    <div
      className="lg-backdrop fixed inset-0 z-50 flex items-center justify-center px-4"
      onClick={() => !salvando && onClose()}
    >
      <Card
        ref={(el) => { foco.current = el; }}
        tabIndex={-1}
        className="lg-sheet max-h-[90vh] w-full max-w-md animate-scale-in overflow-y-auto p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nova-op-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={salvar} className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="nova-op-titulo" className="t-section text-fg">Nova oportunidade</h2>
              <p className="mt-0.5 text-[13px] text-muted">Ela entra no funil na etapa escolhida.</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={salvando} aria-label="Fechar">
              <Icon name="close" size={16} />
            </button>
          </div>

          {semEtapas ? (
            <div className="space-y-3">
              <p className="text-[13px] text-muted">
                Seu funil ainda não tem etapas. Configure as etapas de venda antes de criar oportunidades.
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  Fechar
                </button>
                <Link href="/configuracoes?aba=pipeline" className="btn btn-primary">
                  <Icon name="settings" size={15} />
                  Configurar etapas
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="no-titulo">Título *</label>
                <input
                  id="no-titulo"
                  className="input w-full"
                  value={form.titulo}
                  onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
                  placeholder="Ex.: Plano anual, Consultoria tributária"
                  maxLength={200}
                  autoFocus
                  required
                  aria-required="true"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="field">
                  <label htmlFor="no-etapa">Etapa *</label>
                  <select
                    id="no-etapa"
                    className="select w-full"
                    value={form.stageId}
                    onChange={(e) => setForm((f) => ({ ...f, stageId: e.target.value }))}
                    required
                    aria-required="true"
                  >
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nome}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="no-valor">Valor (R$)</label>
                  <input
                    id="no-valor"
                    className="input w-full"
                    inputMode="decimal"
                    value={form.valor}
                    onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))}
                    placeholder="0,00"
                  />
                </div>
              </div>

              <BuscaContato escolhido={contato} onEscolher={setContato} desabilitado={salvando} />

              <div className="field">
                <label htmlFor="no-origem">Origem</label>
                <input
                  id="no-origem"
                  className="input w-full"
                  value={form.origem}
                  onChange={(e) => setForm((f) => ({ ...f, origem: e.target.value }))}
                  placeholder="Ex.: WhatsApp, Indicação, Site"
                  maxLength={80}
                />
              </div>

              {erro && (
                <p className="flex items-start gap-2 text-[13px] text-danger" role="alert">
                  <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
                  {erro}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="btn btn-ghost" onClick={onClose} disabled={salvando}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={salvando}>
                  {salvando ? 'Salvando…' : 'Criar oportunidade'}
                </button>
              </div>
            </>
          )}
        </form>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Busca de contato (opcional) sobre `GET /crm/contacts?q=`, com espera de 250 ms entre teclas. */
function BuscaContato({
  escolhido,
  onEscolher,
  desabilitado,
}: {
  escolhido: ContatoEscolhido | null;
  onEscolher: (c: ContatoEscolhido | null) => void;
  desabilitado: boolean;
}) {
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<Contato[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    const q = termo.trim();
    if (q.length < 2) {
      setResultados(null);
      setBuscando(false);
      setFalhou(false);
      return;
    }
    let cancelado = false;
    setBuscando(true);
    const t = setTimeout(() => {
      crm
        .contacts({ q, limit: 6 })
        .then((p) => {
          if (cancelado) return;
          setResultados(p.items);
          setFalhou(false);
        })
        .catch(() => {
          if (cancelado) return;
          setResultados(null);
          setFalhou(true);
        })
        .finally(() => {
          if (!cancelado) setBuscando(false);
        });
    }, 250);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [termo]);

  if (escolhido) {
    return (
      <div className="field">
        <span className="text-[12px] font-medium text-muted">Contato</span>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar name={escolhido.nome} size={26} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-fg">{escolhido.nome}</p>
              {escolhido.detalhe && <p className="truncate text-xs text-muted">{escolhido.detalhe}</p>}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm shrink-0"
            onClick={() => onEscolher(null)}
            disabled={desabilitado}
          >
            Trocar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="field">
      <label htmlFor="no-contato">Contato (opcional)</label>
      <div className="relative">
        <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          id="no-contato"
          type="search"
          className="input w-full pl-9"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Buscar por nome, e-mail ou telefone"
          autoComplete="off"
          disabled={desabilitado}
          aria-describedby="no-contato-status"
        />
      </div>
      <div id="no-contato-status" aria-live="polite">
        {buscando && <p className="text-xs text-muted">Buscando…</p>}
        {!buscando && falhou && <p className="text-xs text-danger">Não foi possível buscar contatos agora.</p>}
        {!buscando && resultados && resultados.length === 0 && (
          <p className="text-xs text-muted">Nenhum contato encontrado para esse termo.</p>
        )}
      </div>
      {!buscando && resultados && resultados.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {resultados.map((c) => {
            const detalhe = c.telefone ?? c.email ?? c.empresa;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-surface2"
                  onClick={() => {
                    onEscolher({ id: c.id, nome: c.nome, detalhe });
                    setTermo('');
                  }}
                >
                  <Avatar name={c.nome} size={24} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-fg">{c.nome}</span>
                    {detalhe && <span className="block truncate text-xs text-muted">{detalhe}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
