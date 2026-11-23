'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Button, Confirm, Select, Switch, Textarea, useToast } from '@/components/kit';
import { gennaApi, mensagemErroGenna, type FerramentaGenna as Ferramenta, type ResultadoGenna as Resultado } from '@/lib/genna';
import { campos, montarArgumentos, rotulo, tipoDe, valoresIniciais, type ValorCampo } from '@/lib/genna-formato';
import { ResultadoGenna } from './ResultadoGenna';

const ROTULO_ACAO = { leitura: 'Consultar', escrita: 'Criar no Genna', publicacao: 'Pedir aprovação' } as const;

/**
 * Uma ferramenta do Genna: formulário montado do JSON Schema dela, execução e
 * resultado. Leitura roda direto; escrita pede confirmação; publicação vira
 * pedido em NICO > Aprovações (só sai para o Instagram depois que alguém aprova).
 */
export function FerramentaGenna({ f, admin }: { f: Ferramenta; admin: boolean }) {
  const toast = useToast();
  const lista = useMemo(() => campos(f), [f]);
  const [aberta, setAberta] = useState(false);
  const [valores, setValores] = useState<Record<string, ValorCampo>>(() => valoresIniciais(f));
  const [rodando, setRodando] = useState(false);
  const [confirmar, setConfirmar] = useState<Record<string, unknown> | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aprovacao, setAprovacao] = useState<string | null>(null);

  const bloqueada = f.classe !== 'leitura' && !admin;

  const rodar = async (args: Record<string, unknown>) => {
    setRodando(true);
    setErro(null);
    setAprovacao(null);
    try {
      if (f.classe === 'leitura') {
        setResultado(await gennaApi.consultar(f.nome, args));
      } else {
        const r = await gennaApi.executar(f.nome, args);
        if ('aprovacao' in r) {
          setResultado(null);
          setAprovacao(r.aprovacao.resumo);
          toast.success('Pedido enviado para aprovação', { description: 'Aprove em NICO > Aprovações para publicar.' });
        } else {
          setResultado(r);
          if (r.ok) toast.success('Feito no Genna.');
        }
      }
    } catch (e) {
      setErro(mensagemErroGenna(e, 'O Genna não respondeu. Tente de novo.'));
    } finally {
      setRodando(false);
      setConfirmar(null);
    }
  };

  const enviar = (ev: React.FormEvent) => {
    ev.preventDefault();
    const m = montarArgumentos(f, valores);
    if (!m.ok) {
      setErro(m.erro);
      return;
    }
    if (f.classe === 'leitura') void rodar(m.args);
    else setConfirmar(m.args);
  };

  const mudar = (chave: string, v: ValorCampo) => setValores((s) => ({ ...s, [chave]: v }));

  return (
    <Card className="overflow-hidden p-0">
      <button
        type="button"
        onClick={() => setAberta((a) => !a)}
        aria-expanded={aberta}
        className="flex w-full items-start gap-3 px-5 py-4 text-left hover:bg-surface2"
      >
        <span className={cx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', f.classe === 'leitura' ? 'bg-brand/12 text-brand' : f.classe === 'escrita' ? 'bg-amber-500/12 text-amber-600' : 'bg-danger/10 text-danger')}>
          <Icon name={f.classe === 'leitura' ? 'chart' : f.classe === 'escrita' ? 'sparkles' : 'send'} size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-fg">{f.titulo === f.nome ? rotulo(f.nome) : f.titulo}</span>
          {f.descricao && <span className={cx('mt-0.5 block text-sm text-muted', !aberta && 'line-clamp-2')}>{f.descricao}</span>}
        </span>
        <Icon name="expand" size={16} className={cx('mt-1 shrink-0 text-muted transition-transform', aberta && 'rotate-180')} />
      </button>

      {aberta && (
        <div className="space-y-4 border-t border-line px-5 py-4">
          {bloqueada ? (
            <p className="text-sm text-muted">Só dono ou administrador da conta pode criar ou publicar pelo Genna.</p>
          ) : (
            <form onSubmit={enviar} className="space-y-3">
              {lista.length === 0 && <p className="text-sm text-muted">Esta ferramenta não pede parâmetros.</p>}
              {lista.map(({ chave, prop, obrigatorio }) => {
                const tipo = tipoDe(prop);
                const id = `genna-${f.nome}-${chave}`;
                const titulo = (
                  <label htmlFor={id} className="mb-1 block text-xs font-medium text-fg">
                    {rotulo(chave)} {obrigatorio && <span className="text-danger" aria-hidden>*</span>}
                  </label>
                );
                const ajuda = prop.description && <p className="mt-1 text-[11px] text-muted">{prop.description}</p>;
                if (tipo === 'booleano') {
                  return <Switch key={chave} checked={valores[chave] === true} onChange={(v) => mudar(chave, v)} label={rotulo(chave)} description={prop.description} />;
                }
                if (tipo === 'escolha') {
                  return (
                    <div key={chave}>
                      {titulo}
                      <Select id={id} value={String(valores[chave] ?? '')} onChange={(v) => mudar(chave, v)} placeholder={obrigatorio ? 'Escolha' : 'Qualquer'} options={(prop.enum ?? []).map((o) => ({ value: String(o), label: String(o) }))} />
                      {ajuda}
                    </div>
                  );
                }
                if (tipo === 'json' || tipo === 'lista' || (tipo === 'texto' && /(caption|legenda|texto|text|prompt|descri|content|instruc)/i.test(chave))) {
                  return (
                    <div key={chave}>
                      {titulo}
                      <Textarea id={id} rows={tipo === 'json' ? 4 : 3} value={String(valores[chave] ?? '')} onChange={(e) => mudar(chave, e.target.value)} placeholder={tipo === 'lista' ? 'Separe por vírgula' : tipo === 'json' ? '{ }' : undefined} className={tipo === 'json' ? 'font-mono text-xs' : undefined} />
                      {ajuda}
                    </div>
                  );
                }
                return (
                  <div key={chave}>
                    {titulo}
                    <input
                      id={id}
                      className="input"
                      inputMode={tipo === 'numero' || tipo === 'inteiro' ? 'decimal' : undefined}
                      type={prop.format === 'date' ? 'date' : prop.format === 'date-time' ? 'datetime-local' : 'text'}
                      value={String(valores[chave] ?? '')}
                      onChange={(e) => mudar(chave, e.target.value)}
                      required={obrigatorio}
                    />
                    {ajuda}
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" variant={f.classe === 'leitura' ? 'primary' : 'soft'} size="sm" loading={rodando} icon={f.classe === 'leitura' ? 'search' : f.classe === 'escrita' ? 'sparkles' : 'lock'}>
                  {ROTULO_ACAO[f.classe]}
                </Button>
                {f.classe === 'publicacao' && <span className="text-xs text-muted">Nada vai para o Instagram antes de alguém aprovar.</span>}
              </div>
            </form>
          )}

          {erro && (
            <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger/5 px-4 py-3 text-sm text-danger">
              <Icon name="alert" size={16} className="mt-0.5 shrink-0" /> {erro}
            </p>
          )}
          {aprovacao && (
            <p className="flex flex-wrap items-center gap-2 rounded-xl bg-brand/8 px-4 py-3 text-sm text-fg">
              <Icon name="lock" size={16} className="text-brand" /> Aguardando aprovação: {aprovacao}.
              <Link href="/nyro" className="font-semibold text-brand underline">Abrir NICO</Link>
            </p>
          )}
          {resultado && <ResultadoGenna r={resultado} />}
        </div>
      )}

      <Confirm
        open={!!confirmar}
        onClose={() => setConfirmar(null)}
        onConfirm={() => (confirmar ? rodar(confirmar) : undefined)}
        loading={rodando}
        tone={f.classe === 'publicacao' ? 'danger' : 'primary'}
        title={f.classe === 'publicacao' ? 'Pedir aprovação para publicar?' : 'Criar no Genna?'}
        description={
          f.classe === 'publicacao'
            ? 'O KHUB cria um pedido em NICO > Aprovações. A publicação no Instagram do cliente só acontece quando alguém aprovar.'
            : 'O Genna vai criar ou alterar conteúdo na conta conectada. Nada é publicado na rede social por esta ação.'
        }
        confirmLabel={f.classe === 'publicacao' ? 'Pedir aprovação' : 'Criar'}
      />
    </Card>
  );
}
