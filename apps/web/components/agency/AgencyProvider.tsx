'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { agency, type ClienteAgencia, type MeuContextoAgencia, type SubcontaSeletor } from '@/lib/agency';
import { useAuth } from '@/lib/auth';
import { PRIMARY_NAV, SECONDARY_NAV } from '@/components/shell/nav';

const ROTAS_SEGURAS = new Set([...PRIMARY_NAV, ...SECONDARY_NAV].map((i) => i.href));

interface AgencyCtxValue {
  /** `null` = identidade não pertence a nenhuma agência (cliente direto — seção 28, zero UI de agência). */
  contexto: MeuContextoAgencia | null;
  /** Lista COM métricas (contatos, negócios…): só carregada nas telas `/agency`. */
  clientes: ClienteAgencia[];
  /** Lista leve do seletor da sidebar (todas as telas): fixadas e recentes do usuário. */
  subcontas: SubcontaSeletor[];
  /** Subconta cujo tenantId bate com o tenant ativo da sessão agora. */
  clienteAtivo: SubcontaSeletor | null;
  /** Fixa/desfixa no seletor (otimista; desfaz se a API recusar). */
  fixar: (clientAccountId: string, fixado: boolean) => Promise<void>;
  carregando: boolean;
  erro: string | null;
  /** true durante a troca (chamada + reload) — UI usa pra esconder dado do cliente anterior (seção 21). */
  trocandoCliente: boolean;
  entrarNoCliente: (clientAccountId: string) => Promise<void>;
  recarregarClientes: () => Promise<void>;
}

const Ctx = createContext<AgencyCtxValue | null>(null);

export function AgencyProvider({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const pathname = usePathname() ?? '/dashboard';
  const [contexto, setContexto] = useState<MeuContextoAgencia | null>(null);
  const [clientes, setClientes] = useState<ClienteAgencia[]>([]);
  const [subcontas, setSubcontas] = useState<SubcontaSeletor[]>([]);
  // A lista com métricas chama o overview do CRM de CADA cliente: só vale a
  // pena nas telas da agência, não em todo carregamento de página.
  const naAgencia = pathname.startsWith('/agency');
  const [carregando, setCarregando] = useState(true);
  const [trocandoCliente, setTrocandoCliente] = useState(false);
  const [destinoNome, setDestinoNome] = useState('');
  const emTroca = useRef(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const ctx = await agency.meuContexto();
      setContexto(ctx);
      if (!ctx) {
        setSubcontas([]);
        setClientes([]);
        return;
      }
      const [leve, completa] = await Promise.all([agency.seletor(), naAgencia ? agency.listarClientes() : Promise.resolve(null)]);
      setSubcontas(leve);
      if (completa) setClientes(completa);
    } catch {
      setContexto(null);
      setClientes([]);
      setSubcontas([]);
      setErro('Não foi possível carregar a agência. Atualize a página para tentar novamente.');
    } finally {
      setCarregando(false);
    }
  }, [naAgencia]);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setContexto(null);
      setClientes([]);
      setSubcontas([]);
      setCarregando(false);
      return;
    }
    void carregar();
  }, [ready, user, carregar]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('khub:operation-transition');
      if (!raw) return;
      const target = JSON.parse(raw) as { tenantId: string; nome: string; at: number };
      if (Date.now() - target.at > 15000) { sessionStorage.removeItem('khub:operation-transition'); return; }
      setDestinoNome(target.nome);
      setTrocandoCliente(true);
      if (!ready) return;
      if (user?.tenantId !== target.tenantId) {
        sessionStorage.removeItem('khub:operation-transition');
        setTrocandoCliente(false);
        return;
      }
      const timer = setTimeout(() => {
        sessionStorage.removeItem('khub:operation-transition');
        setTrocandoCliente(false);
      }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650);
      return () => clearTimeout(timer);
    } catch { sessionStorage.removeItem('khub:operation-transition'); }
  }, [ready, user?.tenantId]);

  const clienteAtivo = useMemo(
    () => subcontas.find((c) => c.tenantId === user?.tenantId) ?? null,
    [subcontas, user?.tenantId],
  );

  const fixar = useCallback(async (clientAccountId: string, fixado: boolean) => {
    setSubcontas((xs) => xs.map((c) => (c.id === clientAccountId ? { ...c, fixado } : c)));
    try {
      await agency.fixar(clientAccountId, fixado);
    } catch {
      setSubcontas((xs) => xs.map((c) => (c.id === clientAccountId ? { ...c, fixado: !fixado } : c)));
      setErro('Não foi possível fixar esta subconta. Tente novamente.');
    }
  }, []);

  const entrarNoCliente = useCallback(
    async (clientAccountId: string) => {
      if (emTroca.current) return;
      const cliente = subcontas.find(c => c.id === clientAccountId);
      if (!cliente) return;
      emTroca.current = true;
      setDestinoNome(cliente.nome);
      setTrocandoCliente(true);
      setErro(null);
      try {
        await Promise.all([
          agency.ativarCliente(clientAccountId),
          new Promise(resolve => setTimeout(resolve, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650)),
        ]);
        try { sessionStorage.setItem('khub:operation-transition', JSON.stringify({ tenantId: cliente.tenantId, nome: cliente.nome, at: Date.now() })); } catch { /* transição continua sem persistência visual */ }
        // Reload completo (não router.push): garante que TODO componente
        // remonta e busca de novo — sem cache de query pra invalidar
        // seletivamente aqui, é o jeito mais simples de zerar qualquer
        // resquício do tenant anterior (seção 20/21 do brief).
        const destino = ROTAS_SEGURAS.has(pathname) ? pathname : '/dashboard';
        window.location.href = destino;
      } catch {
        emTroca.current = false;
        setTrocandoCliente(false);
        setErro('Não foi possível entrar nesta subconta. Tente novamente.');
      }
    },
    [pathname, subcontas],
  );

  const value = useMemo<AgencyCtxValue>(
    () => ({ contexto, clientes, subcontas, clienteAtivo, fixar, carregando, erro, trocandoCliente, entrarNoCliente, recarregarClientes: carregar }),
    [contexto, clientes, subcontas, clienteAtivo, fixar, carregando, erro, trocandoCliente, entrarNoCliente, carregar],
  );

  return (
    <Ctx.Provider value={value}>
      <div className={trocandoCliente ? 'operation-content operation-content-blurred' : 'operation-content'} ref={node => { if (node) node.inert = trocandoCliente; }} aria-hidden={trocandoCliente || undefined}>{children}</div>
      {trocandoCliente && <TransicaoCliente nome={destinoNome} />}
    </Ctx.Provider>
  );
}

export function useAgency(): AgencyCtxValue {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAgency fora do AgencyProvider');
  return c;
}

/** Overlay breve durante a troca — nunca deixa o dado do cliente antigo visível junto com o spinner. */
function TransicaoCliente({ nome }: { nome: string }) {
  return (
    <div className="operation-transition" role="status" aria-live="polite">
      <div className="operation-transition-glow" />
      <div className="relative flex max-w-lg flex-col items-center px-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/khub-logo.png" alt="KHUB" className="mb-14 w-44" />
        <span className="mb-5 text-[11px] uppercase tracking-[.32em] text-brand">Seu próximo movimento</span>
        <h2 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{nome}</h2>
        <p className="mt-4 text-sm text-muted">Preparando sua operação</p>
        <span className="operation-progress mt-9" aria-hidden="true" />
      </div>
    </div>
  );
}
