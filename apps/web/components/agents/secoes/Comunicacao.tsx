'use client';

import { useEffect, useRef, useState } from 'react';
import { agentesApi, type Fragmentacao } from '@/lib/agents';
import { Alternar, BarraSalvar, Campo, Numero, Painel, Selecao, mensagemDeErro } from '../kit';
import { useSecaoConfig, type SecaoProps } from '../editor';

const EXEMPLO = 'Olá, Ana! Tudo bem? Vi que você demonstrou interesse no nosso tratamento. Gostaria de entender melhor o que está procurando para conseguir te orientar da melhor maneira. Me conta, o que você está procurando exatamente?';

/**
 * Communication Settings: Message Chunking Engine + naturalidade. A prévia
 * chama o MESMO motor do atendimento (POST /agents/fragmentar-previa).
 */
export function Comunicacao({ agente, onAtualizado }: SecaoProps) {
  const c = useSecaoConfig(agente, 'comunicacao', onAtualizado);
  const f = c.rascunho.fragmentacao;
  const setF = <K extends keyof Fragmentacao>(k: K, v: Fragmentacao[K]) => c.set('fragmentacao', { ...f, [k]: v });
  const [texto, setTexto] = useState(EXEMPLO);
  const [previa, setPrevia] = useState<{ blocos: { ordem: number; texto: string; atrasoMs: number }[]; estrategia: string; ajustes: string[] } | null>(null);
  const [erroPrevia, setErroPrevia] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!texto.trim()) return setPrevia(null);
      agentesApi
        .previaFragmentacao(texto, f)
        .then((r) => { setPrevia(r); setErroPrevia(null); })
        .catch((e) => setErroPrevia(mensagemDeErro(e)));
    }, 350);
    return () => clearTimeout(timer.current);
  }, [texto, f]);

  const total = previa?.blocos.reduce((t, b) => t + b.atrasoMs, 0) ?? 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Painel titulo="Fragmentação de mensagens" descricao="O agente escreve como no WhatsApp: ideias separadas viram mensagens curtas, enviadas em ordem, com pausa de digitação.">
          <div className="space-y-4">
            <Alternar ligado={f.ativo} onChange={(v) => setF('ativo', v)} rotulo="Fragmentar respostas" descricao="Desligado, a resposta sai em uma mensagem só (até o limite de caracteres do agente)." />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Campo rotulo="Mínimo de blocos"><Numero valor={f.minBlocos} onChange={(v) => setF('minBlocos', v)} min={1} max={5} /></Campo>
              <Campo rotulo="Máximo de blocos"><Numero valor={f.maxBlocos} onChange={(v) => setF('maxBlocos', v)} min={1} max={8} /></Campo>
              <Campo rotulo="Tamanho médio desejado"><Numero valor={f.tamanhoMedio} onChange={(v) => setF('tamanhoMedio', v)} min={20} max={600} sufixo="car." /></Campo>
              <Campo rotulo="Máx. de caracteres por bloco"><Numero valor={f.maxCaracteresBloco} onChange={(v) => setF('maxCaracteresBloco', v)} min={40} max={1000} /></Campo>
              <Campo rotulo="Máx. de palavras por bloco"><Numero valor={f.maxPalavrasBloco} onChange={(v) => setF('maxPalavrasBloco', v)} min={5} max={200} /></Campo>
              <Campo rotulo="Máx. de emojis por bloco"><Numero valor={f.maxEmojisBloco} onChange={(v) => setF('maxEmojisBloco', v)} min={0} max={5} /></Campo>
              <Campo rotulo="Intervalo mínimo"><Numero valor={f.intervaloMinMs} onChange={(v) => setF('intervaloMinMs', v)} min={0} max={60000} passo={100} sufixo="ms" /></Campo>
              <Campo rotulo="Intervalo máximo"><Numero valor={f.intervaloMaxMs} onChange={(v) => setF('intervaloMaxMs', v)} min={0} max={60000} passo={100} sufixo="ms" /></Campo>
              <Campo rotulo="Velocidade de digitação" dica="Define a pausa proporcional ao tamanho do bloco"><Numero valor={f.digitacaoCps} onChange={(v) => setF('digitacaoCps', v)} min={5} max={80} sufixo="car./s" /></Campo>
              <Campo rotulo="Quebra semântica">
                <Selecao valor={f.quebraSemantica} onChange={(v) => setF('quebraSemantica', v)} opcoes={[{ valor: 'ideias', rotulo: 'Por ideia (recomendado)' }, { valor: 'frases', rotulo: 'Uma frase por bloco' }, { valor: 'paragrafos', rotulo: 'Por parágrafo' }]} />
              </Campo>
              <Campo rotulo="Pontuação">
                <Selecao valor={f.pontuacao} onChange={(v) => setF('pontuacao', v)} opcoes={[{ valor: 'preservar', rotulo: 'Preservar' }, { valor: 'leve', rotulo: 'Leve (sem ponto final)' }]} />
              </Campo>
            </div>
            <Alternar ligado={f.preferirCurtas} onChange={(v) => setF('preferirCurtas', v)} rotulo="Preferir mensagens curtas" descricao="Quebra antes de atingir o tamanho médio." />
          </div>
        </Painel>

        <Painel titulo="Prévia" descricao="Resultado do motor real com a configuração acima (ainda não salva).">
          <textarea className="textarea" rows={5} maxLength={4000} value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Texto de exemplo" />
          {erroPrevia && <p className="mt-2 text-xs text-danger">{erroPrevia}</p>}
          {previa && (
            <div className="mt-4 rounded-2xl bg-surface2 p-3">
              <div className="space-y-1.5">
                {previa.blocos.map((b) => (
                  <div key={b.ordem} className="max-w-[88%] rounded-2xl rounded-tl-md border border-line bg-surface px-3 py-2 text-[13.5px] leading-snug text-fg shadow-sm">
                    {b.texto}
                    <span className="mt-1 block text-right text-[10.5px] tabular text-faint">+{(b.atrasoMs / 1000).toFixed(1)}s · {b.texto.length} car.</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11.5px] text-muted">
                {previa.blocos.length} bloco(s) · estratégia {previa.estrategia} · {(total / 1000).toFixed(1)}s no total
                {previa.ajustes.length > 0 && <> · ajustes: {previa.ajustes.join('; ')}</>}
              </p>
            </div>
          )}
        </Painel>
      </div>

      <Painel titulo="Naturalidade" descricao="Regras que evitam respostas robóticas. A validação roda depois da geração, antes do envio.">
        <div className="grid gap-4 md:grid-cols-2">
          <Campo rotulo="Emojis">
            <Selecao valor={c.rascunho.emojis} onChange={(v) => c.set('emojis', v)} opcoes={[{ valor: 'nunca', rotulo: 'Nunca' }, { valor: 'raro', rotulo: 'Raramente' }, { valor: 'moderado', rotulo: 'Com moderação' }]} />
          </Campo>
          <Campo rotulo="Uso do nome do contato">
            <Selecao valor={c.rascunho.usarNome} onChange={(v) => c.set('usarNome', v)} opcoes={[{ valor: 'natural', rotulo: 'Natural (às vezes)' }, { valor: 'sempre', rotulo: 'Sempre no início' }, { valor: 'nunca', rotulo: 'Nunca' }]} />
          </Campo>
          <Alternar ligado={c.rascunho.evitarRepeticao} onChange={(v) => c.set('evitarRepeticao', v)} rotulo="Evitar perguntas repetidas" descricao="Remove pergunta igual a uma já feita nas últimas mensagens." />
          <Alternar ligado={c.rascunho.reapresentar} onChange={(v) => c.set('reapresentar', v)} rotulo="Permitir se reapresentar" descricao="Desligado: o agente se apresenta só na primeira mensagem." />
        </div>
      </Painel>

      <BarraSalvar sujo={c.sujo} salvando={c.salvando} onSalvar={c.salvar} onDescartar={c.descartar} />
    </div>
  );
}
