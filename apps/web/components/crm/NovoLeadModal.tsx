'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { useDialogFocus } from '@/lib/use-dialog-focus';
import { Icon } from '@/components/icons';
import { crm } from '@/lib/crm';
import { lerValor, mensagemErroCrm } from './erro-api';

interface Props {
  onClose: () => void;
  /** Chamado depois que a API confirmou a criação. */
  onCreated: (id: string) => void;
}

/**
 * Cadastro manual de lead (cria um contato real via `POST /crm/contacts`).
 * Montado só enquanto aberto: o formulário nasce limpo a cada abertura.
 */
export function NovoLeadModal({ onClose, onCreated }: Props) {
  const [form, setForm] = useState({ nome: '', telefone: '', email: '', empresa: '', valor: '' });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const foco = useDialogFocus(true, () => { if (!salvando) onClose(); });

  const set = (campo: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [campo]: e.target.value }));

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const nome = form.nome.trim();
    if (!nome) {
      setErro('Informe o nome do lead.');
      return;
    }
    const valor = lerValor(form.valor);
    if (valor === 'invalido') {
      setErro('Valor estimado precisa ser um número igual ou maior que zero.');
      return;
    }

    const corpo: Record<string, unknown> = { nome };
    if (form.telefone.trim()) corpo.telefone = form.telefone.trim();
    if (form.email.trim()) corpo.email = form.email.trim();
    if (form.empresa.trim()) corpo.empresa = form.empresa.trim();
    if (valor !== null) corpo.valorEstimado = valor;

    setSalvando(true);
    setErro('');
    try {
      const r = await crm.createContact(corpo);
      onCreated(r.id);
    } catch (err) {
      setErro(mensagemErroCrm(err));
      setSalvando(false);
    }
  };

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
        aria-labelledby="novo-lead-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={salvar} className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="novo-lead-titulo" className="t-section text-fg">Novo lead</h2>
              <p className="mt-0.5 text-[13px] text-muted">Cadastre um lead manualmente. Só o nome é obrigatório.</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={salvando} aria-label="Fechar">
              <Icon name="close" size={16} />
            </button>
          </div>

          <div className="field">
            <label htmlFor="nl-nome">Nome *</label>
            <input
              id="nl-nome"
              className="input w-full"
              value={form.nome}
              onChange={set('nome')}
              placeholder="Nome completo"
              maxLength={160}
              autoFocus
              required
              aria-required="true"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="nl-telefone">Telefone</label>
              <input
                id="nl-telefone"
                className="input w-full"
                type="tel"
                inputMode="tel"
                value={form.telefone}
                onChange={set('telefone')}
                placeholder="+55 11 90000-0000"
                maxLength={40}
              />
            </div>
            <div className="field">
              <label htmlFor="nl-email">E-mail</label>
              <input
                id="nl-email"
                className="input w-full"
                type="email"
                inputMode="email"
                value={form.email}
                onChange={set('email')}
                placeholder="nome@empresa.com"
                maxLength={200}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="nl-empresa">Empresa</label>
              <input
                id="nl-empresa"
                className="input w-full"
                value={form.empresa}
                onChange={set('empresa')}
                placeholder="Nome da empresa"
                maxLength={160}
              />
            </div>
            <div className="field">
              <label htmlFor="nl-valor">Valor estimado (R$)</label>
              <input
                id="nl-valor"
                className="input w-full"
                inputMode="decimal"
                value={form.valor}
                onChange={set('valor')}
                placeholder="0,00"
              />
            </div>
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
              {salvando ? 'Salvando…' : 'Criar lead'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
