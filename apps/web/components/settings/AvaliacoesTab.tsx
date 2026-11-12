'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Field, Input, Card, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Button, Select, Switch, Textarea, SkeletonLines, SkeletonRows, useToast } from '@/components/kit';
import { EmptyState, ErrorState } from '@/components/revenue/States';
import { numero, percentual } from '@/lib/format';
import { avaliacoes, type ConfigAvaliacao, type PedidoAvaliacao, type RespostaConfig, type ResumoAvaliacoes } from '@/lib/avaliacoes';

const VAZIA: Omit<ConfigAvaliacao, 'updatedAt'> = { plataforma: 'google', link: '', mensagemPadrao: '', assuntoEmail: 'Como foi sua experiência?', filtroSatisfacao: false, notaMinima: 4 };

/**
 * Configurações > Avaliações (Q4.4): link de avaliação, mensagem padrão,
 * filtro de satisfação e o relatório simples dos pedidos.
 */
export function AvaliacoesTab() {
  return (
    <div className="space-y-5">
      <ConfigForm />
      <Relatorio />
    </div>
  );
}

function ConfigForm() {
  const toast = useToast();
  const [resp, setResp] = useState<RespostaConfig | null>(null);
  const [c, setC] = useState(VAZIA);
  const [erro, setErro] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(() => {
    setErro(false);
    avaliacoes.config().then((r) => {
      setResp(r);
      setC(r.config ? { plataforma: r.config.plataforma, link: r.config.link, mensagemPadrao: r.config.mensagemPadrao, assuntoEmail: r.config.assuntoEmail, filtroSatisfacao: r.config.filtroSatisfacao, notaMinima: r.config.notaMinima }
        : { ...VAZIA, mensagemPadrao: r.sugestao.mensagemPadrao, assuntoEmail: r.sugestao.assuntoEmail });
    }).catch(() => setErro(true));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const linkOk = /^https:\/\/\S+\.\S+/.test(c.link.trim());
  const salvar = async () => {
    setSalvando(true);
    try {
      await avaliacoes.salvarConfig({ ...c, link: c.link.trim(), mensagemPadrao: c.mensagemPadrao.trim(), assuntoEmail: c.assuntoEmail.trim() });
      toast.success('Configuração de avaliações salva');
      carregar();
    } catch (e) {
      toast.error('Não foi possível salvar', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSalvando(false);
    }
  };

  if (erro) return <Card className="p-6"><ErrorState description="Não foi possível carregar a configuração." onRetry={carregar} /></Card>;
  if (!resp) return <Card className="p-6"><SkeletonLines lines={5} label="Carregando avaliações" /></Card>;

  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-start gap-3">
        <span className="icon-tile h-10 w-10 rounded-xl"><Icon name="star" size={18} /></span>
        <div>
          <h2 className="text-base font-semibold text-fg">Pedido de avaliação</h2>
          <p className="text-sm text-muted">O link enviado ao cliente é curto e rastreável: registra o clique e leva à sua página de avaliação. Use no perfil do contato ou no nó “Pedir avaliação” das automações.</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
        <Field label="Onde avaliar">
          <Select value={c.plataforma} onChange={(v) => setC({ ...c, plataforma: v })} options={[{ value: 'google', label: 'Google' }, { value: 'outro', label: 'Outro site' }]} />
        </Field>
        <Field label="Link de avaliação" hint={c.plataforma === 'google' ? 'No Perfil da Empresa do Google: “Pedir avaliações” > copiar link.' : 'Precisa começar com https://'}>
          <Input value={c.link} maxLength={500} onChange={(e) => setC({ ...c, link: e.target.value })} placeholder="https://g.page/r/..." inputMode="url" />
        </Field>
      </div>
      <div>
        <label htmlFor="msg-avaliacao" className="mb-1.5 block text-sm font-medium text-fg">Mensagem padrão</label>
        <Textarea id="msg-avaliacao" rows={4} maxLength={1000} showCount value={c.mensagemPadrao} onChange={(e) => setC({ ...c, mensagemPadrao: e.target.value })} />
        <p className="mt-1 text-xs text-muted">Variáveis: {resp.variaveis.map((v) => <code key={v.chave} className="mr-1 rounded-sm bg-surface3 px-1">{`{{${v.chave}}}`}</code>)}. Sem <code className="rounded-sm bg-surface3 px-1">{'{{link}}'}</code>, o link vai no fim.</p>
      </div>
      <Field label="Assunto do e-mail">
        <Input value={c.assuntoEmail} maxLength={200} onChange={(e) => setC({ ...c, assuntoEmail: e.target.value })} />
      </Field>
      <Switch
        checked={c.filtroSatisfacao}
        onChange={(v) => setC({ ...c, filtroSatisfacao: v })}
        layout="row"
        label="Filtro de satisfação"
        description="Antes de ir para a avaliação pública, o cliente dá uma nota de 1 a 5. Notas baixas abrem um formulário interno e a equipe é avisada."
      />
      {c.filtroSatisfacao && (
        <Field label="Nota mínima para seguir à avaliação pública">
          <Select value={String(c.notaMinima)} onChange={(v) => setC({ ...c, notaMinima: Number(v) })} options={[2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} ou mais` }))} />
        </Field>
      )}
      <div className="flex items-center gap-3">
        <Button onClick={() => void salvar()} loading={salvando} disabled={!linkOk || !c.mensagemPadrao.trim()}>Salvar</Button>
        {!linkOk && c.link && <p className="text-xs text-warning">O link precisa começar com https://</p>}
        {resp.config?.updatedAt && <p className="text-xs text-muted">Atualizado em {new Date(resp.config.updatedAt).toLocaleString('pt-BR')}</p>}
      </div>
    </Card>
  );
}

function Relatorio() {
  const [resumo, setResumo] = useState<ResumoAvaliacoes | null>(null);
  const [pedidos, setPedidos] = useState<PedidoAvaliacao[] | null>(null);
  const [erro, setErro] = useState(false);
  const carregar = useCallback(() => {
    setErro(false);
    Promise.all([avaliacoes.resumo(90), avaliacoes.pedidos()]).then(([r, p]) => { setResumo(r); setPedidos(p); }).catch(() => setErro(true));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  if (erro) return <Card className="p-6"><ErrorState description="Não foi possível carregar o relatório." onRetry={carregar} /></Card>;
  if (!resumo || !pedidos) return <Card className="p-6"><SkeletonRows rows={4} label="Carregando relatório" /></Card>;
  const maxDist = Math.max(1, ...resumo.distribuicao.map((d) => d.total));

  return (
    <Card className="space-y-5 p-6">
      <div>
        <h2 className="text-base font-semibold text-fg">Relatório</h2>
        <p className="text-sm text-muted">Últimos {resumo.dias} dias.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { l: 'Pedidos enviados', v: numero(resumo.enviados) },
          { l: 'Cliques no link', v: numero(resumo.clicados), s: resumo.enviados ? `${percentual(resumo.taxaClique)} dos enviados` : undefined },
          { l: 'Nota média (interna)', v: resumo.mediaInterna !== null ? resumo.mediaInterna.toFixed(1).replace('.', ',') : '-', s: `${numero(resumo.avaliacoesInternas)} nota(s)` },
          { l: 'Seguiram para o público', v: numero(resumo.encaminhadosAoPublico) },
        ].map((k) => (
          <div key={k.l} className="card-inset p-3.5">
            <p className="text-xs text-muted">{k.l}</p>
            <p className="mt-1 text-xl font-semibold tabular text-fg">{k.v}</p>
            {k.s && <p className="text-xs text-muted">{k.s}</p>}
          </div>
        ))}
      </div>
      {resumo.avaliacoesInternas > 0 && (
        <div className="space-y-1.5" aria-label="Distribuição das notas">
          {[...resumo.distribuicao].reverse().map((d) => (
            <div key={d.nota} className="flex items-center gap-2 text-xs">
              <span className="w-6 tabular text-muted">{d.nota}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface3">
                <div className={cx('h-full rounded-full', d.nota >= 4 ? 'bg-brand' : 'bg-warning')} style={{ width: `${(d.total / maxDist) * 100}%` }} />
              </div>
              <span className="w-8 text-right tabular text-fg">{d.total}</span>
            </div>
          ))}
        </div>
      )}
      {pedidos.length === 0 ? (
        <EmptyState icon="star" title="Nenhum pedido ainda" description="Peça a primeira avaliação no perfil de um contato ou com o nó “Pedir avaliação” numa automação." />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-semibold">Contato</th>
                <th className="px-3 py-2 font-semibold">Situação</th>
                <th className="px-3 py-2 text-right font-semibold">Nota</th>
                <th className="py-2 pl-3 font-semibold">Comentário</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.slice(0, 30).map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3">
                    <Link href={`/contatos/${p.contactId}`} className="font-medium text-fg hover:text-brand">{p.contatoNome || 'Contato'}</Link>
                    <p className="text-xs text-muted">{p.canal === 'whatsapp' ? 'WhatsApp' : 'E-mail'} · {new Date(p.createdAt).toLocaleDateString('pt-BR')}{p.origem === 'automacao' ? ' · automação' : ''}</p>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {p.status === 'enviado' ? (p.clicadoEm ? `Clicou (${p.cliques}x)` : 'Enviado') : p.status === 'config_required' ? 'Canal não conectado' : p.status === 'falhou' ? `Falhou${p.erro ? `: ${p.erro}` : ''}` : 'Pendente'}
                  </td>
                  <td className="px-3 py-2 text-right tabular text-fg">{p.avaliacaoInterna ?? '-'}</td>
                  <td className="max-w-xs truncate py-2 pl-3 text-xs text-muted" title={p.comentario ?? undefined}>{p.comentario ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
