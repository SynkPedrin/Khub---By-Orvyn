// Servidor de TESTE da Messages API para o stack QA (nunca produção).
//   node scripts/qa/agent-llm-stub.mjs            # 127.0.0.1:4099
// A API de QA aponta para cá com ANTHROPIC_BASE_URL=http://127.0.0.1:4099.
// Classificação: REAL_RUNTIME_TEST com provedor de IA roteirizado — exercita
// o pipeline INTEIRO (análise por structured outputs, busca, ferramentas,
// fragmentação, fila, follow-up, memória) sem chamar a Anthropic nem gastar
// chave. As respostas são determinísticas e derivadas do PRÓPRIO request
// (o que prova que o contexto chegou ao modelo: perfil, base, objeções).
import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_PORT ?? 4099);
const log = [];

const texto = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b.type === 'text' ? b.text : b.type === 'tool_result' ? `[tool_result ${b.content}]` : '')).join('\n') : '');
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function ultimaDoContato(body) {
  const u = [...body.messages].reverse().find((m) => m.role === 'user');
  const t = texto(u?.content ?? '');
  const linhas = t.split('\n').filter((l) => l.startsWith('CONTATO:'));
  return linhas.length ? linhas[linhas.length - 1].slice(8).trim() : t;
}

function analise(body) {
  const msg = norm(ultimaDoContato(body));
  const caro = /caro|desconto|puxado/.test(msg);
  const preco = /preco|quanto|valor|custa/.test(msg);
  const queda = /queda de cabelo|cabelo caindo/.test(msg);
  const voltei = /voltei|ainda tenho interesse|pensando/.test(msg);
  const intencao = caro ? 'objecao' : preco ? 'orcamento' : voltei ? 'interesse' : /humano|atendente/.test(msg) ? 'solicitacao_humana' : 'duvida';
  const extracoes = [];
  if (queda) extracoes.push({ campo: 'problema_principal', valor: 'queda de cabelo', origem: 'declarado', confianca: 0.92 });
  if (queda) extracoes.push({ campo: 'servico_interesse', valor: 'tratamento capilar', origem: 'inferido', confianca: 0.8 });
  if (caro) extracoes.push({ campo: 'objecoes', valor: 'preco', origem: 'declarado', confianca: 0.9 });
  extracoes.push({ campo: 'temperatura', valor: caro ? 'morna' : 'quente', origem: 'inferido', confianca: 0.7 });
  return {
    intencao,
    intencoesSecundarias: [],
    confiancaIntencao: 0.9,
    problema: queda ? 'queda de cabelo' : '',
    objecoes: caro ? ['preco'] : [],
    sentimento: caro ? 'neutro' : 'positivo',
    urgencia: 'media',
    temperatura: caro ? 'morna' : 'quente',
    interesse: 'tratamento capilar',
    precisaConhecimento: preco || caro || voltei,
    pedeHumano: intencao === 'solicitacao_humana',
    consultaBase: preco || caro || voltei ? 'preço avaliação tratamento queda de cabelo' : '',
    extracoes,
    proximoPasso: caro ? 'apresentar valor e condição de pagamento autorizada' : 'oferecer avaliação',
  };
}

function geracao(body) {
  const sys = body.system ?? '';
  const ultimo = body.messages[body.messages.length - 1];
  const veioDeFerramenta = Array.isArray(ultimo.content) && ultimo.content.some((b) => b.type === 'tool_result');
  const tools = (body.tools ?? []).map((t) => t.name);
  if (/TAREFA: escrever a mensagem de FOLLOW-UP/.test(sys)) {
    const problema = /problema_principal: ([^\[\n]+)/.exec(sys)?.[1]?.trim() ?? 'seu caso';
    return { text: `Oi! Passando para retomar sobre ${problema}.\n\nSei que o investimento pesou. Temos parcelamento no cartão, conforme a nossa tabela.\n\nQuer que eu reserve um horário de avaliação?` };
  }
  // Última fala do CONTATO (ignora o turno de tool_result do loop de ferramentas).
  const contato = norm(texto(body.messages.filter((m) => m.role === 'user' && typeof m.content === 'string').map((m) => m.content).at(-1) ?? ''));
  // Primeira mensagem com ferramenta liberada: registra nota de qualificação (exercita o Action Engine).
  if (!veioDeFerramenta && tools.includes('adicionar_nota') && /queda de cabelo/.test(contato)) {
    return { tool: { name: 'adicionar_nota', input: { texto: 'Lead relata queda de cabelo; perguntou preço do tratamento.' } } };
  }
  const preco = /<documento[^>]*>[\s\S]*?(R\$ ?[\d.,]+)/.exec(sys)?.[1];
  if (/caro|desconto/.test(contato)) {
    return { text: `Entendo, o investimento é uma decisão importante.\n\nA avaliação sai por ${preco ?? 'um valor que confirmo com a equipe'} e já define o plano certo para você.\n\nPosso te mostrar as condições de pagamento?` };
  }
  if (/voltei|pensando|interesse/.test(contato)) {
    return { text: `Que bom te ver de volta!\n\nComo você comentou da queda de cabelo, a avaliação é o melhor primeiro passo.\n\nQuer que eu veja um horário esta semana?` };
  }
  return { text: `Oi! Tudo bem?\n\nPara queda de cabelo, começamos com uma avaliação capilar, que custa ${preco ?? '— vou confirmar com a equipe'}.\n\nQuer que eu veja um horário para você?` };
}

function responder(body) {
  const schema = body.output_config?.format?.schema;
  const req = schema?.required ?? [];
  let content;
  let stop = 'end_turn';
  if (req.includes('intencao')) content = [{ type: 'text', text: JSON.stringify(analise(body)) }];
  else if (req.includes('resumo')) content = [{ type: 'text', text: JSON.stringify({ resumo: 'Contato relatou queda de cabelo, perguntou preço e achou caro.', memorias: [{ tipo: 'fato', conteudo: 'Tem queda de cabelo há meses', importancia: 4 }] }) }];
  else if (req.includes('qualidade')) content = [{ type: 'text', text: JSON.stringify({ qualidade: 4, precisao: 4, aderenciaBase: 4, naturalidade: 5, resolucao: 4, alucinacao: false, comentario: 'ok' }) }];
  else if (req.includes('justificativa')) content = [{ type: 'text', text: JSON.stringify({ campo: 'objecoes', texto: 'Na objeção de preço, reconheça, pergunte o contexto e apresente as condições da base.', justificativa: 'Objeção recorrente.' }) }];
  else {
    const g = geracao(body);
    if (g.tool) {
      content = [{ type: 'tool_use', id: `toolu_${Date.now()}`, name: g.tool.name, input: g.tool.input }];
      stop = 'tool_use';
    } else content = [{ type: 'text', text: g.text }];
  }
  return { id: `msg_qa_${Date.now()}`, type: 'message', role: 'assistant', model: body.model, content, stop_reason: stop, usage: { input_tokens: Math.ceil(JSON.stringify(body).length / 4), output_tokens: Math.ceil(JSON.stringify(content).length / 4) } };
}

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/__log') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(log));
  }
  if (req.method !== 'POST' || req.url !== '/v1/messages') {
    res.writeHead(404);
    return res.end();
  }
  if (!req.headers['x-api-key']) {
    res.writeHead(401, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'missing key' } }));
  }
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw);
    const out = responder(body);
    log.push({ em: new Date().toISOString(), model: body.model, temSchema: !!body.output_config?.format, effort: body.output_config?.effort ?? null, tools: (body.tools ?? []).map((t) => t.name), stop: out.stop_reason, systemTemDocumento: /<documento /.test(body.system ?? ''), systemTemPerfil: /<perfil_do_contato>/.test(body.system ?? '') });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });
}).listen(PORT, '127.0.0.1', () => console.log(`stub Messages API em 127.0.0.1:${PORT}`));
