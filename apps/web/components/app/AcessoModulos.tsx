'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { Button, Drawer, useToast } from '@/components/kit';
import { MODULOS, MODULOS_PADRAO, papelRestringivel, type Modulo } from '@/lib/modulos';
import { settingsApi, type Member } from '@/lib/settings';

/**
 * Escolha do que o colaborador vê (ADR-0045). `null` = tudo que o papel
 * permite; lista = só aqueles módulos. A IA vem separada no fim porque é a
 * que o dono costuma liberar depois, pessoa por pessoa.
 */
export function SeletorModulos({ valor, onChange, disabled }: {
  valor: string[] | null;
  onChange: (v: string[] | null) => void;
  disabled?: boolean;
}) {
  const restrito = valor !== null;
  const lista = valor ?? [];
  const alternar = (m: Modulo) => onChange(lista.includes(m) ? lista.filter((x) => x !== m) : [...lista, m]);
  const comuns = MODULOS.filter((m) => m.chave !== 'ia');
  const ia = MODULOS.find((m) => m.chave === 'ia')!;

  return (
    <div className="space-y-3">
      <div className="segbar" role="tablist" aria-label="Alcance do acesso">
        <button type="button" role="tab" aria-selected={restrito} className="seg" disabled={disabled} onClick={() => !restrito && onChange([...MODULOS_PADRAO])}>
          Escolher módulos
        </button>
        <button type="button" role="tab" aria-selected={!restrito} className="seg" disabled={disabled} onClick={() => onChange(null)}>
          Tudo que o papel permite
        </button>
      </div>

      {restrito && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {comuns.map((m) => (
              <Bloco key={m.chave} ligado={lista.includes(m.chave)} onClick={() => alternar(m.chave)} disabled={disabled} icone={m.icone} nome={m.nome} descricao={m.descricao} />
            ))}
          </div>
          <Bloco ligado={lista.includes('ia')} onClick={() => alternar('ia')} disabled={disabled} icone={ia.icone} nome="Acesso à IA" descricao={ia.descricao} destaque />
          {lista.length === 0 && <p className="text-xs text-warning">Sem nenhum módulo a pessoa entra e só vê o próprio perfil.</p>}
        </>
      )}
    </div>
  );
}

function Bloco({ ligado, onClick, disabled, icone, nome, descricao, destaque }: {
  ligado: boolean;
  onClick: () => void;
  disabled?: boolean;
  icone: Parameters<typeof Icon>[0]['name'];
  nome: string;
  descricao: string;
  destaque?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60',
        ligado ? 'border-brand-border bg-brand-softer' : 'border-line hover:bg-surface2',
        destaque && 'py-3',
      )}
    >
      <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-xl', ligado ? 'bg-brand text-white' : 'bg-[var(--fill-3)] text-muted')}>
        <Icon name={icone} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{nome}</span>
        <span className="block truncate text-xs text-muted">{descricao}</span>
      </span>
      <span aria-hidden className={cx('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors', ligado ? 'bg-brand' : 'bg-[var(--fill-1)]')}>
        <span className={cx('absolute h-4 w-4 rounded-full bg-surface shadow-sm transition-transform', ligado ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </span>
    </button>
  );
}

/** Resumo curto para a linha do membro: "Vê tudo" ou os módulos liberados. */
export function ResumoModulos({ role, modulos }: { role: string; modulos: string[] | null }) {
  if (!papelRestringivel(role) || modulos === null) return <span className="text-xs text-muted">Vê tudo do papel</span>;
  if (modulos.length === 0) return <span className="text-xs text-warning">Nenhum módulo</span>;
  const nomes = MODULOS.filter((m) => m.chave !== 'ia' && modulos.includes(m.chave)).map((m) => m.nome);
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
      <span className="truncate">{nomes.join(', ') || 'Só IA'}</span>
      {modulos.includes('ia') && (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-brand-soft px-1.5 py-px text-[10.5px] font-semibold text-brand">
          <Icon name="sparkles" size={10} /> IA
        </span>
      )}
    </span>
  );
}

/** Gaveta "Acessos" de um membro: grava na hora em que salva (vale na próxima ação dele). */
export function EditarAcessos({ membro, onFechar, onSalvo }: { membro: Member | null; onFechar: () => void; onSalvo: () => void }) {
  const toast = useToast();
  const [valor, setValor] = useState<string[] | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setValor(membro?.modulos ?? null), [membro]);
  if (!membro) return null;

  const salvar = async () => {
    setSalvando(true);
    try {
      await settingsApi.changeModulos(membro.identityId, valor);
      toast.success('Acessos atualizados', { description: 'Vale na próxima ação da pessoa, sem precisar sair.' });
      onSalvo();
      onFechar();
    } catch (e) {
      toast.error('Não foi possível salvar', { description: e instanceof Error ? e.message : 'Tente novamente.' });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Drawer
      open
      onClose={onFechar}
      title={`Acessos de ${membro.nome ?? membro.email}`}
      description="O que essa pessoa vê no sistema. O papel continua dizendo o que ela pode alterar."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          <Button onClick={salvar} loading={salvando}>Salvar acessos</Button>
        </div>
      }
    >
      <SeletorModulos valor={valor} onChange={setValor} disabled={salvando} />
    </Drawer>
  );
}
