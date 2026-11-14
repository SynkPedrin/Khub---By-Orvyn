'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Select, Switch } from '@/components/kit';
import { mensagemFin } from '@/components/financeiro/fin-utils';
import { agenda } from '@/lib/agenda';
import { financeiro } from '@/lib/financeiro';
import { importacaoApi, type LinhaImportacao } from '@/lib/comercial';
import { FormatoNaoSuportado, comOcorrencia, lerPlanilha, lotes, relatorioProblemasCsv, type ProblemaLinha } from '@/lib/importacao-planilha';
import { XlsxInvalido } from '@/lib/xlsx';

/**
 * Importação de planilhas (CSV ou XLSX exportado do Avec, Excel ou Google
 * Planilhas). Três destinos: clientes (CRM), entradas e saídas (financeiro) e
 * agenda. A pessoa confere o mapeamento coluna → campo antes de importar; o
 * envio vai em lotes de 500 linhas, erros de linha voltam detalhados sem
 * perder o resto, e reimportar o mesmo arquivo não duplica (a API ignora o
 * que já entrou).
 */

type TipoImport = 'contatos' | 'financeiro' | 'agenda';

interface CampoDef { campo: string; rotulo: string; sinonimos: string[] }

const CAMPOS_CONTATOS: CampoDef[] = [
  { campo: 'nome', rotulo: 'Nome', sinonimos: ['nome', 'nome completo', 'cliente', 'contato', 'name', 'nome do cliente'] },
  { campo: 'telefone', rotulo: 'Telefone / WhatsApp', sinonimos: ['telefone', 'celular', 'whatsapp', 'fone', 'phone', 'telefone celular'] },
  { campo: 'email', rotulo: 'E-mail', sinonimos: ['email', 'e mail'] },
  { campo: 'observacao', rotulo: 'Observação', sinonimos: ['observacao', 'observacoes', 'obs', 'anotacoes'] },
];

// "forma de pagamento" e "cliente" ficam de fora de propósito: não são descrição do lançamento.
const CAMPOS_FINANCEIRO: CampoDef[] = [
  { campo: 'descricao', rotulo: 'Descrição', sinonimos: ['descricao', 'historico', 'lancamento', 'servico', 'servicos', 'item', 'produto', 'descricao do servico'] },
  { campo: 'valor', rotulo: 'Valor (R$)', sinonimos: ['valor', 'total', 'preco', 'valor total', 'valor pago', 'valor liquido', 'valor bruto', 'valor recebido'] },
  { campo: 'tipo', rotulo: 'Tipo (entrada/saída)', sinonimos: ['tipo', 'natureza', 'movimento', 'tipo de lancamento', 'operacao'] },
  { campo: 'data', rotulo: 'Data', sinonimos: ['data', 'data de pagamento', 'data do pagamento', 'data pagamento', 'data da venda', 'competencia', 'data vencimento', 'data de vencimento', 'data do lancamento'] },
  { campo: 'categoria', rotulo: 'Categoria', sinonimos: ['categoria', 'grupo', 'plano de contas', 'centro de custo'] },
  { campo: 'status', rotulo: 'Status (pago/pendente)', sinonimos: ['status', 'situacao'] },
  { campo: 'responsavel', rotulo: 'Profissional (nome ou e-mail)', sinonimos: ['profissional', 'responsavel', 'colaborador', 'funcionario', 'vendedor', 'email do profissional'] },
];

const CAMPOS_AGENDA: CampoDef[] = [
  { campo: 'titulo', rotulo: 'Serviço / título', sinonimos: ['servico', 'servicos', 'titulo', 'procedimento', 'agendamento'] },
  { campo: 'data', rotulo: 'Data', sinonimos: ['data', 'dia', 'data do agendamento', 'data agendamento'] },
  { campo: 'hora', rotulo: 'Hora', sinonimos: ['hora', 'horario', 'hora de inicio', 'hora inicio'] },
  { campo: 'inicio', rotulo: 'Data e hora juntas', sinonimos: ['inicio', 'data e hora', 'data hora', 'quando'] },
  { campo: 'fim', rotulo: 'Data e hora de fim', sinonimos: ['fim', 'termino', 'data e hora de fim'] },
  { campo: 'duracaoMin', rotulo: 'Duração (min)', sinonimos: ['duracao', 'duracao min', 'duracao minutos', 'tempo'] },
  { campo: 'contatoTelefone', rotulo: 'Telefone do cliente', sinonimos: ['telefone', 'celular', 'whatsapp', 'telefone do cliente', 'cliente telefone', 'telefone cliente', 'celular cliente'] },
  { campo: 'responsavel', rotulo: 'Profissional (nome ou e-mail)', sinonimos: ['profissional', 'responsavel', 'colaborador', 'funcionario', 'email do profissional', 'responsavel email', 'e mail profissional'] },
  { campo: 'valor', rotulo: 'Valor (R$)', sinonimos: ['valor', 'preco', 'total', 'valor do servico'] },
  { campo: 'status', rotulo: 'Status', sinonimos: ['status', 'situacao'] },
];

const TIPOS: { key: TipoImport; titulo: string; desc: string; campos: CampoDef[] }[] = [
  { key: 'contatos', titulo: 'Clientes', desc: 'Vai para o CRM (Contatos). O que já existe é só atualizado.', campos: CAMPOS_CONTATOS },
  { key: 'financeiro', titulo: 'Entradas e saídas', desc: 'Vai para o fluxo de caixa, com categoria e profissional.', campos: CAMPOS_FINANCEIRO },
  { key: 'agenda', titulo: 'Agendamentos', desc: 'Vai para a agenda; concluídos com valor viram entrada no caixa.', campos: CAMPOS_AGENDA },
];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function sugerir(cabecalhos: string[], campos: CampoDef[]): string[] {
  const usados = new Set<string>();
  return cabecalhos.map((h) => {
    const n = norm(h);
    const c = campos.find((x) => !usados.has(x.campo) && x.sinonimos.includes(n));
    if (c) { usados.add(c.campo); return c.campo; }
    return '';
  });
}

interface Resultado {
  total: number;
  criados: number;
  atualizados: number;
  ignorados: number;
  erros: ProblemaLinha[];
  avisos: ProblemaLinha[];
}

const VAZIO: Resultado = { total: 0, criados: 0, atualizados: 0, ignorados: 0, erros: [], avisos: [] };

/** Primeira linha de dados no arquivo é a 2 (a 1 é o cabeçalho). */
const PRIMEIRA_LINHA = 2;

export default function ImportacaoPage() {
  const [tipo, setTipo] = useState<TipoImport>('financeiro');
  const [arquivo, setArquivo] = useState<{ nome: string; cabecalhos: string[]; linhas: string[][] } | null>(null);
  const [mapa, setMapa] = useState<string[]>([]);
  const [gerarComissoes, setGerarComissoes] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [falhaLote, setFalhaLote] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const def = TIPOS.find((t) => t.key === tipo)!;

  const trocarTipo = (t: TipoImport) => {
    setTipo(t); setArquivo(null); setMapa([]); setResultado(null); setMsg(null); setFalhaLote(null); setGerarComissoes(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const lerArquivo = async (f: File) => {
    setMsg(null); setResultado(null); setFalhaLote(null); setArquivo(null); setLendo(true);
    try {
      const todas = await lerPlanilha(f.name, await f.arrayBuffer());
      if (todas.length < 2) { setMsg('Não achei linhas nesse arquivo. Exporte do Avec em CSV (vírgula ou ponto e vírgula) ou XLSX, com o cabeçalho na primeira linha.'); return; }
      const [cabecalhos, ...linhas] = todas;
      setArquivo({ nome: f.name, cabecalhos, linhas });
      setMapa(sugerir(cabecalhos, def.campos));
    } catch (e) {
      if (e instanceof FormatoNaoSuportado || e instanceof XlsxInvalido) setMsg(e.message.endsWith('.') ? e.message : `${e.message.charAt(0).toUpperCase()}${e.message.slice(1)}. Salve de novo como .xlsx ou CSV e tente outra vez.`);
      else setMsg('Não consegui ler esse arquivo. Salve como CSV ou .xlsx e tente de novo.');
    } finally { setLendo(false); }
  };

  const montarLinhas = (): Record<string, string>[] =>
    (arquivo?.linhas ?? []).map((cols) => {
      const l: Record<string, string> = {};
      mapa.forEach((campo, i) => {
        const v = (cols[i] ?? '').trim();
        if (!campo || !v) return;
        l[campo] = v;
      });
      return l;
    });

  const previa = useMemo(() => {
    if (!arquivo) return [];
    return arquivo.linhas.slice(0, 3).map((cols) => {
      const l: Record<string, string> = {};
      mapa.forEach((campo, i) => { if (campo) l[campo] = (cols[i] ?? '').trim(); });
      return l;
    });
  }, [arquivo, mapa]);

  const obrigatorioOk = useMemo(() => {
    if (!arquivo) return false;
    const tem = (c: string) => mapa.includes(c);
    if (tipo === 'contatos') return tem('nome') || tem('telefone') || tem('email');
    if (tipo === 'financeiro') return tem('descricao') && tem('valor');
    return tem('titulo') && (tem('inicio') || tem('data'));
  }, [arquivo, mapa, tipo]);

  const enviarLote = async (linhas: Record<string, unknown>[], linhaInicial: number): Promise<Resultado> => {
    if (tipo === 'contatos') {
      const r = await importacaoApi.contatos(linhas as LinhaImportacao[], { origem: 'importacao_planilha', atualizarExistentes: true }, linhaInicial);
      return { total: r.total, criados: r.criados, atualizados: r.atualizados, ignorados: r.ignorados, erros: r.erros, avisos: [] };
    }
    const r = tipo === 'financeiro'
      ? await financeiro.importar(linhas, { gerarComissoes }, linhaInicial)
      : await agenda.importar(linhas, { gerarComissoes }, linhaInicial);
    return { total: r.total, criados: r.criados, atualizados: 0, ignorados: r.ignorados ?? 0, erros: r.erros ?? [], avisos: r.avisos ?? [] };
  };

  const importar = async () => {
    if (!arquivo) return;
    setBusy(true); setMsg(null); setFalhaLote(null); setResultado(null);
    const mapeadas = montarLinhas();
    const linhas: Record<string, unknown>[] = tipo === 'financeiro' ? comOcorrencia(mapeadas) : mapeadas;
    const partes = lotes(linhas);
    let acumulado: Resultado = VAZIO;
    for (let i = 0; i < partes.length; i++) {
      const { inicio, itens } = partes[i];
      setProgresso(partes.length > 1 ? `Importando lote ${i + 1} de ${partes.length}…` : 'Importando…');
      try {
        const r = await enviarLote(itens, PRIMEIRA_LINHA + inicio);
        acumulado = {
          total: acumulado.total + r.total,
          criados: acumulado.criados + r.criados,
          atualizados: acumulado.atualizados + r.atualizados,
          ignorados: acumulado.ignorados + r.ignorados,
          erros: [...acumulado.erros, ...r.erros],
          avisos: [...acumulado.avisos, ...r.avisos],
        };
      } catch (e) {
        const de = PRIMEIRA_LINHA + inicio;
        const ate = de + itens.length - 1;
        setFalhaLote(
          `${mensagemFin(e, `importar as linhas ${de} a ${ate}`)} ${acumulado.criados + acumulado.atualizados} linha(s) dos lotes anteriores já entraram. ` +
          'Pode importar o mesmo arquivo de novo: o que já entrou não é duplicado.',
        );
        break;
      }
    }
    if (acumulado.total > 0) setResultado(acumulado);
    setProgresso(null);
    setBusy(false);
  };

  const baixarRelatorio = () => {
    if (!resultado) return;
    const blob = new Blob(['﻿', relatorioProblemasCsv(resultado.erros, resultado.avisos)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `erros-importacao-${(arquivo?.nome ?? 'planilha').replace(/\.[^.]+$/, '')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tabelaProblemas = (titulo: string, itens: ProblemaLinha[], tom: string) => (
    <div className="mt-4">
      <h3 className={cx('text-sm font-bold', tom)}>{titulo}</h3>
      <div className="mt-2 max-h-56 overflow-auto rounded-xl border border-line">
        <table className="w-full text-left text-xs">
          <thead><tr className="border-b border-line bg-surface2"><th className="px-3 py-2 font-semibold text-muted">Linha</th><th className="px-3 py-2 font-semibold text-muted">Motivo</th></tr></thead>
          <tbody>
            {itens.map((e, i) => (
              <tr key={`${e.linha}-${i}`} className="border-b border-line last:border-0"><td className="px-3 py-1.5 text-fg">{e.linha}</td><td className="px-3 py-1.5 text-muted">{e.motivo}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="t-display">Importar dados</h1>
          <p className="mt-1 text-sm text-muted">Exporte os relatórios do Avec (ou de uma planilha) em CSV ou XLSX e traga tudo pra cá.</p>
        </div>
        <Link href="/financeiro" className="text-sm font-semibold text-brand hover:underline">← Voltar ao Financeiro</Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {TIPOS.map((t) => (
          <button key={t.key} type="button" aria-pressed={tipo === t.key} onClick={() => trocarTipo(t.key)} disabled={busy} className={cx('rounded-2xl border p-4 text-left transition', tipo === t.key ? 'border-brand/60 bg-brand/5' : 'border-line hover:border-brand/30')}>
            <p className="font-bold text-fg">{t.titulo}</p>
            <p className="mt-1 text-xs text-muted">{t.desc}</p>
          </button>
        ))}
      </div>

      <Card className="p-6">
        <h2 className="font-bold text-fg">1. Escolha o arquivo</h2>
        <p className="mt-1 text-xs text-muted">
          No Avec: Relatórios, escolha o relatório e exporte em CSV ou Excel (.xlsx). Arquivos .xls antigos: abra no Excel ou no Google Planilhas e salve como .xlsx ou CSV.
          Acentos de arquivos exportados em Latin-1 são reconhecidos automaticamente.
        </p>
        <div className="mt-4">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy || lendo}
            onChange={(e) => e.target.files?.[0] && lerArquivo(e.target.files[0])}
            aria-label="Arquivo da planilha"
            className="block w-full text-sm text-muted file:mr-4 file:rounded-xl file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:opacity-90"
          />
        </div>
        {lendo && <p className="mt-3 text-sm text-muted">Lendo o arquivo…</p>}
        {arquivo && <p className="mt-3 text-sm text-muted"><Badge tone="brand">{arquivo.nome}</Badge> <span className="ml-2">{arquivo.linhas.length} linhas · {arquivo.cabecalhos.length} colunas</span></p>}
        {msg && <p role="alert" className="mt-3 rounded-xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">{msg}</p>}
      </Card>

      {arquivo && (
        <Card className="p-6">
          <h2 className="font-bold text-fg">2. Confira o mapeamento das colunas</h2>
          <p className="mt-1 text-xs text-muted">Adivinhei pelo cabeçalho: ajuste o que estiver errado. Colunas marcadas como Ignorar não entram.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {arquivo.cabecalhos.map((h, i) => (
              <div key={`${h}-${i}`}>
                <p className="mb-1 truncate text-xs font-medium text-muted" title={h}>{h || `Coluna ${i + 1}`}</p>
                <Select
                  value={mapa[i] ?? ''}
                  onChange={(v) => setMapa(mapa.map((m, j) => (j === i ? v : m)))}
                  options={[{ value: '', label: 'Ignorar' }, ...def.campos.map((c) => ({ value: c.campo, label: c.rotulo }))]}
                  aria-label={`Destino da coluna ${h || i + 1}`}
                />
              </div>
            ))}
          </div>

          <h3 className="mt-6 text-sm font-bold text-fg">Prévia (3 primeiras linhas)</h3>
          <div className="mt-2 overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead>
                <tr className="border-b border-line bg-surface2">
                  {mapa.map((c, i) => c && <th key={`${c}-${i}`} className="px-3 py-2 font-semibold text-muted">{def.campos.find((x) => x.campo === c)?.rotulo ?? c}</th>)}
                </tr>
              </thead>
              <tbody>
                {previa.map((l, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    {mapa.map((c, j) => c && <td key={`${c}-${j}`} className="max-w-52 truncate px-3 py-2 text-fg">{l[c] || <span className="text-muted">vazio</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {tipo !== 'contatos' && (
            <div className="mt-5">
              <Switch
                checked={gerarComissoes}
                onChange={setGerarComissoes}
                label="Gerar comissões para os lançamentos importados"
                description="Deixe desmarcado se as comissões desse período já foram pagas no sistema antigo."
                disabled={busy}
              />
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            {!obrigatorioOk && (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                {tipo === 'contatos' && 'Mapeie ao menos nome, telefone ou e-mail.'}
                {tipo === 'financeiro' && 'Mapeie ao menos descrição e valor.'}
                {tipo === 'agenda' && 'Mapeie ao menos o serviço e a data (ou data e hora juntas).'}
              </p>
            )}
            {progresso && <p className="text-sm text-muted" role="status">{progresso}</p>}
            <div className="flex-1" />
            <Button onClick={importar} disabled={busy || !obrigatorioOk}>
              <Icon name="upload" size={16} /> {busy ? 'Importando…' : `Importar ${arquivo.linhas.length} linhas`}
            </Button>
          </div>
        </Card>
      )}

      {falhaLote && <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">{falhaLote}</p>}

      {resultado && (
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold text-fg">Resultado</h2>
            {(resultado.erros.length > 0 || resultado.avisos.length > 0) && (
              <Button variant="ghost" onClick={baixarRelatorio}><Icon name="download" size={15} /> Baixar relatório de erros (CSV)</Button>
            )}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <div className="rounded-xl bg-surface2 p-4"><p className="text-xs text-muted">Linhas lidas</p><p className="text-xl font-semibold text-fg">{resultado.total}</p></div>
            <div className="rounded-xl bg-emerald-500/10 p-4"><p className="text-xs text-muted">Importadas</p><p className="text-xl font-semibold text-emerald-600 dark:text-emerald-400">{resultado.criados}{resultado.atualizados ? ` (+${resultado.atualizados} atualizadas)` : ''}</p></div>
            <div className="rounded-xl bg-surface2 p-4"><p className="text-xs text-muted">{tipo === 'contatos' ? 'Ignoradas' : 'Ignoradas (já importadas antes)'}</p><p className="text-xl font-semibold text-fg">{resultado.ignorados}</p></div>
            <div className="rounded-xl bg-red-500/10 p-4"><p className="text-xs text-muted">Com erro</p><p className="text-xl font-semibold text-red-500">{resultado.erros.length}</p></div>
          </div>
          {resultado.erros.length > 0 && tabelaProblemas('Erros (linha não importada)', resultado.erros, 'text-red-500')}
          {resultado.avisos.length > 0 && tabelaProblemas('Avisos (importada com ressalva)', resultado.avisos, 'text-amber-700 dark:text-amber-400')}
          {resultado.erros.length === 0 && !falhaLote && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">Tudo importado. Já está visível na plataforma.</p>}
        </Card>
      )}
    </div>
  );
}
