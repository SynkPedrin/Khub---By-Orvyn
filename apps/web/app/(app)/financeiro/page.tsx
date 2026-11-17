'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Modal, Tabs, useToast } from '@/components/kit';
import { financeiro as finApi } from '@/lib/financeiro';
import { mensagemFin } from '@/components/financeiro/fin-utils';
import { FinProdutos } from '@/components/financeiro/FinProdutos';
import { SenhaFinanceiroProvider, TravaFinanceiro, useSenhaFinanceiro } from '@/components/financeiro/SenhaFinanceiro';
import { Icon } from '@/components/icons';
import { FinVisaoGeral } from '@/components/financeiro/FinVisaoGeral';
import { FinLancamentos } from '@/components/financeiro/FinLancamentos';
import { FinComissoes } from '@/components/financeiro/FinComissoes';
import { FinCobrancas } from '@/components/financeiro/FinCobrancas';
import { FinCategorias } from '@/components/financeiro/FinCategorias';
import { mesAtual, navegarMes, rotuloMes, ehMesAtual } from '@/components/financeiro/fin-utils';

type Aba = 'visao' | 'lancamentos' | 'comissoes' | 'produtos' | 'cobrancas' | 'categorias';

/**
 * Financeiro: gestão completa do dinheiro da empresa: fluxo de caixa
 * (entradas/saídas por categoria), comissões da equipe, cobranças a clientes
 * e importação de planilhas (Avec).
 */
export default function FinanceiroPage() {
  return (
    <SenhaFinanceiroProvider>
      <Financeiro />
    </SenhaFinanceiroProvider>
  );
}

function Financeiro() {
  // O caixa é a tela do dia a dia da recepção; Visão geral e Comissões pedem a senha.
  const [aba, setAba] = useState<Aba>('lancamentos');
  const [periodo, setPeriodo] = useState(mesAtual());
  const [tick, setTick] = useState(0);
  const recarregar = () => setTick((t) => t + 1);

  const comPeriodo = aba === 'visao' || aba === 'lancamentos';

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="t-display">Financeiro</h1>
          <p className="mt-1 text-sm text-muted">Gestão completa: entradas, saídas, comissões da equipe e cobranças.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {comPeriodo && (
            <>
              {/* Navegação de mês: um clique para trás e para frente no fluxo de caixa. */}
              <div className="flex items-center gap-1 rounded-xl border border-line px-1 py-1">
                <button type="button" onClick={() => setPeriodo(navegarMes(periodo, -1))} className="btn btn-ghost btn-icon btn-sm h-7 w-7" aria-label="Mês anterior">
                  <Icon name="arrowLeft" size={14} />
                </button>
                <span className="min-w-[150px] text-center text-sm font-semibold capitalize text-fg" aria-live="polite">
                  {rotuloMes(periodo)}
                </span>
                <button type="button" onClick={() => setPeriodo(navegarMes(periodo, 1))} className="btn btn-ghost btn-icon btn-sm h-7 w-7" aria-label="Próximo mês">
                  <Icon name="arrowRight" size={14} />
                </button>
              </div>
              {!ehMesAtual(periodo) && (
                <button type="button" onClick={() => setPeriodo(mesAtual())} className="rounded-xl border border-line px-3 py-1.5 text-sm font-semibold text-fg hover:bg-surface2">
                  Mês atual
                </button>
              )}
              <div className="flex items-center gap-1.5 text-sm text-muted">
                <input type="date" value={periodo.de} onChange={(e) => setPeriodo({ ...periodo, de: e.target.value })} className="input" aria-label="Início do período" />
                <span>até</span>
                <input type="date" value={periodo.ate} onChange={(e) => setPeriodo({ ...periodo, ate: e.target.value })} className="input" aria-label="Fim do período" />
              </div>
            </>
          )}
          <ControleSenha />
          <Link href="/financeiro/importacao" className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-sm font-semibold text-fg hover:bg-surface2">
            <Icon name="upload" size={15} /> Importar planilha
          </Link>
        </div>
      </div>

      <Tabs<Aba>
        value={aba}
        onChange={setAba}
        label="Seções do financeiro"
        idBase="fin"
        items={[
          { value: 'lancamentos', label: 'Caixa: entradas e saídas' },
          { value: 'visao', label: 'Visão geral' },
          { value: 'comissoes', label: 'Comissões' },
          { value: 'produtos', label: 'Produtos e estoque' },
          { value: 'cobrancas', label: 'Cobranças' },
          { value: 'categorias', label: 'Categorias' },
        ]}
      />

      {aba === 'visao' && (
        <TravaFinanceiro titulo="Visão geral">
          <FinVisaoGeral de={periodo.de} ate={periodo.ate} key={`v${tick}`} />
        </TravaFinanceiro>
      )}
      {aba === 'lancamentos' && <FinLancamentos de={periodo.de} ate={periodo.ate} tick={tick} onMudou={recarregar} />}
      {aba === 'comissoes' && (
        <TravaFinanceiro titulo="Comissões">
          <FinComissoes />
        </TravaFinanceiro>
      )}
      {aba === 'produtos' && <FinProdutos />}
      {aba === 'cobrancas' && <FinCobrancas onMudou={recarregar} />}
      {aba === 'categorias' && <FinCategorias />}
    </div>
  );
}

/** Criar/trocar a senha do financeiro e trancar de novo antes dos 30 min. */
function ControleSenha() {
  const s = useSenhaFinanceiro();
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [conf, setConf] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  if (s.configurada === null) return null;

  const salvar = async () => {
    setErro(null);
    if (nova.length < 4) { setErro('A senha precisa ter pelo menos 4 caracteres.'); return; }
    if (nova !== conf) { setErro('A confirmação não bate com a senha nova.'); return; }
    setSalvando(true);
    try {
      await finApi.definirSenha({ ...(s.configurada ? { senhaAtual: atual } : {}), novaSenha: nova });
      toast.success(s.configurada ? 'Senha do financeiro trocada' : 'Senha do financeiro criada');
      setAberto(false);
      setAtual(''); setNova(''); setConf('');
      s.trancar();
      s.recarregar();
    } catch (e) {
      setErro(mensagemFin(e, 'salvar a senha'));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <>
      {s.configurada && s.liberado && (
        <button type="button" onClick={s.trancar} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-semibold text-fg hover:bg-surface2">
          <Icon name="lock" size={15} /> Trancar
        </button>
      )}
      {(!s.configurada || s.liberado) && (
        <button type="button" onClick={() => setAberto(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-semibold text-fg hover:bg-surface2">
          <Icon name="shield" size={15} /> {s.configurada ? 'Trocar senha' : 'Criar senha do financeiro'}
        </button>
      )}
      <Modal
        open={aberto}
        onClose={() => setAberto(false)}
        size="sm"
        title={s.configurada ? 'Trocar a senha do financeiro' : 'Criar a senha do financeiro'}
        description="Ela abre a Visão geral e as Comissões e é pedida para editar ou cancelar uma venda."
        footer={<><Button variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button><Button onClick={salvar} loading={salvando}>Salvar</Button></>}
      >
        <div className="space-y-3">
          {s.configurada && <input type="password" className="input" placeholder="Senha atual" value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="off" aria-label="Senha atual" />}
          <input type="password" className="input" placeholder="Senha nova" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" aria-label="Senha nova" />
          <input type="password" className="input" placeholder="Repita a senha nova" value={conf} onChange={(e) => setConf(e.target.value)} autoComplete="new-password" aria-label="Confirmar senha nova" />
          {erro && <p className="text-sm font-medium text-danger" role="alert">{erro}</p>}
        </div>
      </Modal>
    </>
  );
}
