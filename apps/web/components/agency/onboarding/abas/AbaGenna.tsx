'use client';

import { useEffect, useMemo, useState } from 'react';
import { Field } from '@/components/ui';
import { Button, Select, SkeletonLines, Textarea, useToast } from '@/components/kit';
import { Section } from '@/components/revenue/Page';
import { gennaApi, type FerramentaGenna } from '@/lib/genna';
import { ApiError } from '@/lib/api-error';
import { codigoErro, mensagemErro, onboardingApi } from '@/lib/onboarding';
import { VazioLocal } from '../pecas';
import type { TabProps } from '../OnboardingDetalhe';

/**
 * Genna: análise de LEITURA do Instagram da subconta (ADR-0053). As
 * ferramentas disponíveis vêm da API — nunca inventadas. Sem conexão, o
 * estado é o CTA "Conectar Genna" (fluxo OAuth real), nunca um erro vermelho
 * nem um resultado simulado.
 */
export function AbaGenna({ ob, podeEditar, recarregar, irParaAba }: TabProps) {
  const toast = useToast();
  const [ferramentas, setFerramentas] = useState<FerramentaGenna[] | null>(null);
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'desconectado' | 'config' | 'erro'>('carregando');
  const [perfil, setPerfil] = useState('');
  const [ferramenta, setFerramenta] = useState('');
  const [argumentos, setArgumentos] = useState('');
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [conectando, setConectando] = useState(false);
  const finalizado = ob.status === 'pronto';

  const carregarFerramentas = () => {
    setEstado('carregando');
    gennaApi
      .ferramentas()
      .then((lista) => {
        setFerramentas(lista);
        setEstado('ok');
      })
      .catch((e) => {
        const code = codigoErro(e);
        if (code === 'genna_nao_conectado') setEstado('desconectado');
        else if (e instanceof ApiError && (e.configRequired || e.status === 501)) setEstado('config');
        else setEstado('erro');
      });
  };

  useEffect(carregarFerramentas, []);

  const leitura = useMemo(() => (ferramentas ?? []).filter((f) => f.classe === 'leitura'), [ferramentas]);
  const selecionada = leitura.find((f) => f.nome === ferramenta);

  useEffect(() => {
    if (leitura.length && !leitura.some((f) => f.nome === ferramenta)) setFerramenta(leitura[0].nome);
  }, [leitura, ferramenta]);

  const conectar = async () => {
    setConectando(true);
    try {
      const { url } = await gennaApi.urlConexao();
      window.location.href = url;
    } catch (e) {
      toast.error('Não foi possível iniciar a conexão', { description: mensagemErro(e, 'Tente novamente.') });
      setConectando(false);
    }
  };

  const analisar = async () => {
    if (!perfil.trim() || !ferramenta || rodando) return;
    setRodando(true);
    setErro(null);
    try {
      let args: Record<string, unknown> | undefined;
      if (argumentos.trim()) {
        const parsed: unknown = JSON.parse(argumentos);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Os argumentos precisam ser um objeto JSON.');
        args = parsed as Record<string, unknown>;
      }
      await onboardingApi.relatorioGenna(ob.id, { perfil: perfil.trim(), ferramenta, argumentos: args });
      toast.success('Relatório salvo', { description: 'Veja o resultado na aba Inteligência e estratégia.' });
      setPerfil('');
      setArgumentos('');
      recarregar();
    } catch (e) {
      if (codigoErro(e) === 'genna_nao_conectado') {
        // A análise roda na SUBCONTA do cliente: sem conexão lá, o caminho é conectar.
        setEstado('desconectado');
      } else if (e instanceof SyntaxError || (e instanceof Error && e.message.includes('objeto JSON'))) {
        setErro('Argumentos inválidos: informe um objeto JSON, ex.: {"dias": 30}.');
      } else {
        setErro(mensagemErro(e, 'Não foi possível rodar a análise.'));
      }
    } finally {
      setRodando(false);
    }
  };

  if (estado === 'desconectado' || estado === 'config') {
    return (
      <Section title="Genna">
        <VazioLocal
          icone="lock"
          titulo={estado === 'config' ? 'Genna ainda não configurado' : 'Genna não conectado'}
          texto={
            estado === 'config'
              ? 'A integração com o Genna depende de uma credencial do ambiente. Peça a um administrador para configurá-la.'
              : 'A análise roda na subconta do cliente e precisa da conexão OAuth com o Genna. A conexão vale para a conta ativa desta sessão — se o cliente for outra subconta, entre nela pelo seletor antes de conectar.'
          }
          acao={
            estado === 'desconectado' ? (
              <Button size="sm" variant="primary" icon="link" loading={conectando} onClick={() => void conectar()}>
                Conectar Genna
              </Button>
            ) : undefined
          }
        />
      </Section>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Section title="Nova análise" info="Roda uma ferramenta de leitura do Genna na subconta do cliente e salva o relatório no onboarding">
          {estado === 'carregando' ? (
            <SkeletonLines lines={4} label="Carregando ferramentas do Genna" />
          ) : estado === 'erro' ? (
            <VazioLocal icone="alert" titulo="Não foi possível falar com o Genna" texto="Verifique a conexão e tente de novo." acao={<Button size="sm" onClick={carregarFerramentas}>Tentar de novo</Button>} />
          ) : leitura.length === 0 ? (
            <VazioLocal icone="info" titulo="Nenhuma ferramenta de leitura disponível" texto="O Genna conectado não expôs ferramentas de leitura nesta conta." />
          ) : (
            <div className="space-y-4">
              <Field label="Perfil do Instagram" hint="O @perfil analisado, ex.: @cliente.oficial">
                <input className="input" maxLength={200} value={perfil} onChange={(e) => setPerfil(e.target.value)} placeholder="@perfil" disabled={!podeEditar || finalizado} />
              </Field>
              <Field label="Ferramenta de leitura" hint={selecionada?.descricao}>
                <Select value={ferramenta} onChange={setFerramenta} options={leitura.map((f) => ({ value: f.nome, label: f.titulo || f.nome }))} disabled={!podeEditar || finalizado} />
              </Field>
              <Field label="Argumentos (opcional)" hint='Objeto JSON repassado à ferramenta, ex.: {"dias": 30}. Deixe vazio para o padrão.'>
                <Textarea value={argumentos} onChange={(e) => setArgumentos(e.target.value)} rows={3} className="font-mono text-[12.5px]" placeholder="{}" disabled={!podeEditar || finalizado} />
              </Field>
              {erro && (
                <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
                  {erro}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" size="sm" icon="sparkles" loading={rodando} disabled={!podeEditar || finalizado || !perfil.trim() || !ferramenta} onClick={() => void analisar()}>
                  Rodar análise e salvar relatório
                </Button>
                <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => irParaAba('inteligencia')}>
                  Ver relatórios salvos ({ob.reports.length})
                </button>
              </div>
            </div>
          )}
        </Section>
      </div>

      <Section title="Ferramentas de leitura" info="Catálogo ao vivo do Genna desta conta">
        {estado === 'carregando' ? (
          <SkeletonLines lines={3} label="Carregando ferramentas" />
        ) : (
          <ul className="space-y-2">
            {leitura.map((f) => (
              <li key={f.nome} className="rounded-lg border border-line px-3 py-2">
                <p className="text-[13px] font-medium text-fg">{f.titulo || f.nome}</p>
                {f.descricao && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{f.descricao}</p>}
              </li>
            ))}
            {estado === 'ok' && leitura.length === 0 && <li className="text-[13px] text-faint">Nenhuma.</li>}
          </ul>
        )}
      </Section>
    </div>
  );
}
