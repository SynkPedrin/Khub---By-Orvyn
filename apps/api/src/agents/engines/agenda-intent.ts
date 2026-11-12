/**
 * PRÉ-CONSULTA DE AGENDA
 * ======================
 * "quero marcar pra sexta de manhã" → o core consulta `ver_agendamentos`
 * ANTES de gerar e entrega os horários livres prontos no contexto. Modelo
 * pequeno (local) quase nunca chama a ferramenta sozinho: respondia "vou
 * verificar a disponibilidade" e não verificava nada. Aqui ficam só as
 * partes puras (detectar dia/período, formatar horários) — testáveis sem I/O.
 */

const NORM = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const DIAS_SEMANA: [RegExp, number][] = [
  [/\bdomingo\b/, 0],
  [/\bsegunda\b/, 1],
  [/\bterca\b/, 2],
  [/\bquarta\b/, 3],
  [/\bquinta\b/, 4],
  [/\bsexta\b/, 5],
  [/\bsabado\b|\bsab\b/, 6],
];

const RE_QUER_AGENDAR = /\b(agend|marc|reserv|horario|hora\b|vaga|disponi|encaix|consegue|tem como|da pra|dá pra)/;

/** Partes de data/hora de parede no fuso. */
function parede(d: Date, fuso: string): { ano: number; mes: number; dia: number; dow: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { ano: Number(p.year), mes: Number(p.month), dia: Number(p.day), dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

const iso = (a: number, m: number, d: number) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export interface PedidoAgenda {
  data: string;
  periodo: 'manha' | 'tarde' | 'noite' | null;
}

/**
 * Detecta pedido de horário com dia identificável na mensagem do contato.
 * `null` quando não há dia ("quero agendar" sozinho) ou não é pedido de agenda.
 */
export function detectarPedidoAgenda(mensagem: string, agora: Date, fuso: string, intencao?: string): PedidoAgenda | null {
  const t = NORM(mensagem);
  const temDia = /\b(hoje|amanha|depois de amanha)\b|\d{1,2}\/\d{1,2}/.test(t) || DIAS_SEMANA.some(([re]) => re.test(t));
  if (!temDia) return null;
  if (intencao !== 'agendamento' && !RE_QUER_AGENDAR.test(t)) return null;

  const hoje = parede(agora, fuso);
  const somarDias = (n: number) => {
    const p = parede(new Date(agora.getTime() + n * 86_400_000), fuso);
    return iso(p.ano, p.mes, p.dia);
  };
  let data: string | null = null;
  const dm = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (/\bdepois de amanha\b/.test(t)) data = somarDias(2);
  else if (/\bamanha\b/.test(t)) data = somarDias(1);
  else if (/\bhoje\b/.test(t)) data = somarDias(0);
  else if (dm) {
    const dia = Number(dm[1]);
    const mes = Number(dm[2]);
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
      let ano = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : hoje.ano;
      // "05/01" dito em novembro é janeiro do ano que vem.
      if (!dm[3] && (mes < hoje.mes || (mes === hoje.mes && dia < hoje.dia))) ano += 1;
      data = iso(ano, mes, dia);
    }
  } else {
    const alvo = DIAS_SEMANA.find(([re]) => re.test(t))?.[1];
    if (alvo !== undefined) {
      // "sexta" dita na sexta = a próxima (hoje já está em andamento).
      const n = (alvo - hoje.dow + 7) % 7 || 7;
      data = somarDias(n);
    }
  }
  if (!data) return null;
  const periodo = /\bmanha\b|\bcedo\b/.test(t) ? 'manha' : /\btarde\b/.test(t) ? 'tarde' : /\bnoite\b/.test(t) ? 'noite' : null;
  return { data, periodo };
}

/** "pode ser às 9", "9h", "10:30 tá ótimo": o contato está escolhendo um horário. */
export function escolheuHorario(mensagem: string): boolean {
  const t = NORM(mensagem);
  return /\b\d{1,2}\s?h(\d{2})?\b|\b\d{1,2}:\d{2}\b|\bas \d{1,2}\b|\bpode ser\b|\besse (horario|ai)\b|\bo primeiro\b|\bo segundo\b|\bpode marcar\b|\bfechado\b/.test(t);
}

/** Resposta curta de aceite ("sim", "pode", "fechado", "isso mesmo"). */
export function confirmou(mensagem: string): boolean {
  const t = NORM(mensagem).replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return t.length <= 40 && /^(sim|s|ss|pode|pode sim|pode ser|pode marcar|pode agendar|isso|isso mesmo|confirmo|confirmado|confirma|fechado|fechou|ok|okay|beleza|blz|perfeito|certo|claro|combinado|bora|quero)\b/.test(t);
}

/** Hora citada pelo contato ("às 9", "9h30", "10:00") → "09:00"; null se não citou. */
export function horaEscolhida(mensagem: string): string | null {
  const t = NORM(mensagem);
  const m = t.match(/\b(?:as\s+)?(\d{1,2})\s?(?:h|:)(\d{2})?\b/) ?? t.match(/\bas\s+(\d{1,2})\b/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  // "às 2" num salão = 14h: horário comercial, hora de 1 a 6 é da tarde.
  const hora = h >= 1 && h <= 6 ? h + 12 : h;
  return `${String(hora).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** "2026-11-13T09:00:00-03:00": hora de parede com o deslocamento do fuso (o que solicitar_agendamento espera). */
export function isoLocal(isoUtc: string, fuso: string): string {
  const d = new Date(isoUtc);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  const parede = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  const off = Math.round((parede - d.getTime()) / 60_000);
  const sinal = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sinal}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Hora de parede "09:00" no fuso. */
function hhmm(isoUtc: string, fuso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(isoUtc));
}

/**
 * Bloco de contexto com os horários livres em hora LOCAL, já filtrados pelo
 * período pedido. O modelo só escolhe 2–3 e oferece.
 */
export function contextoAgenda(p: PedidoAgenda, livres: { inicio: string; fim: string }[], fuso: string, agora: Date, escolha = false, hora: string | null = null): string {
  const [a, m, d] = p.data.split('-');
  const rotulo = `${d}/${m}/${a}`;
  const faixa = (h: number) => (p.periodo === 'manha' ? h < 12 : p.periodo === 'tarde' ? h >= 12 && h < 18 : p.periodo === 'noite' ? h >= 18 : true);
  const futuros = livres.filter((l) => new Date(l.inicio).getTime() > agora.getTime());
  const doPeriodo = futuros.filter((l) => faixa(Number(hhmm(l.inicio, fuso).slice(0, 2))));
  const lista = (xs: typeof livres) => xs.map((l) => `${hhmm(l.inicio, fuso)}–${hhmm(l.fim, fuso)}`).join(', ');
  const periodoTxt = p.periodo === 'manha' ? ' de manhã' : p.periodo === 'tarde' ? ' à tarde' : p.periodo === 'noite' ? ' à noite' : '';
  const linhas = [`AGENDA JÁ CONSULTADA AGORA (ver_agendamentos, ${rotulo}):`];
  if (!futuros.length) linhas.push(`- Nenhum horário livre em ${rotulo}. Diga isso e ofereça ver outro dia.`);
  else if (p.periodo && !doPeriodo.length) linhas.push(`- Nada livre${periodoTxt} em ${rotulo}. Livres no resto do dia: ${lista(futuros)}.`);
  else linhas.push(`- Livres${periodoTxt} em ${rotulo}: ${lista(p.periodo ? doPeriodo : futuros)}.`);
  const candidatos = (p.periodo && doPeriodo.length ? doPeriodo : futuros).slice(0, 8);
  if (candidatos.length) linhas.push(`- Para solicitar_agendamento, o \`inicio\` de cada um: ${candidatos.map((l) => `${hhmm(l.inicio, fuso)} = ${isoLocal(l.inicio, fuso)}`).join('; ')}.`);
  const escolhido = hora ? futuros.find((l) => hhmm(l.inicio, fuso) === hora) : undefined;
  if (escolha && hora && escolhido) {
    linhas.push(`- O contato escolheu ${hora}, que ESTÁ LIVRE. Chame solicitar_agendamento AGORA com inicio=${isoLocal(escolhido.inicio, fuso)} e duracaoMin igual à duração do serviço; depois confirme dia, horário e serviço em uma frase. Não diga que vai verificar nem confirmar com a equipe.`);
    return linhas.join('\n');
  }
  if (escolha && hora && !escolhido) linhas.push(`- O contato pediu ${hora}, que NÃO está livre. Diga isso e ofereça os horários livres mais próximos.`);
  linhas.push(
    escolha && !hora
      ? '- O contato está escolhendo um horário. Se for um dos livres, chame solicitar_agendamento AGORA com esse `inicio` e a duração do serviço, e só depois confirme. Se não estiver livre, diga e ofereça os mais próximos.'
      : '- Você JÁ verificou: não diga que vai verificar. Ofereça até 3 desses horários e pergunte qual prefere. Só chame solicitar_agendamento depois que o contato escolher.',
  );
  return linhas.join('\n');
}

/** "1h", "1h30", "30min", "45min a 1h", "cerca de 3h", "20min de aplicação + 40min de ação" → minutos (o MAIOR da faixa). */
export function minutosDe(texto: string): number | null {
  const t = NORM(texto);
  if (t.includes('+')) {
    const partes = t.split('+').map((x) => minutosDe(x)).filter((x): x is number => x !== null);
    return partes.length ? partes.reduce((a, b) => a + b, 0) : null;
  }
  const vals = [...t.matchAll(/(\d{1,2})\s?h(?:\s?(\d{2}))?|(\d{1,3})\s?min/g)].map((m) => (m[3] ? Number(m[3]) : Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0)));
  return vals.length ? Math.max(...vals) : null;
}

/**
 * Serviços citados na conversa, com a duração lida da tabela das instruções
 * da empresa (linhas "- Serviço: R$ … · 1h a 1h30 · …"). Sem tabela ou sem
 * serviço reconhecido → lista vazia (quem chama usa 60 min).
 */
export function servicosCitados(instrucoes: string, conversa: string): { nome: string; minutos: number; sinal: boolean }[] {
  const alvo = NORM(conversa);
  const achados: { nome: string; minutos: number; pos: number; sinal: boolean }[] = [];
  for (const linha of instrucoes.split('\n')) {
    const m = linha.match(/^\s*-\s*([^:]{3,60}):\s*([^\n]*)$/);
    if (!m || !/R\$|a partir de/i.test(m[2])) continue;
    const nome = m[1].replace(/\([^)]*\)/g, '').trim();
    const campos = m[2].split('·').map((x) => x.trim());
    const minutos = campos.map((campo) => minutosDe(campo)).find((x): x is number => x !== null);
    const pos = alvo.indexOf(NORM(nome));
    if (pos >= 0 && minutos) achados.push({ nome, minutos, pos, sinal: /exige sinal/i.test(m[2]) });
  }
  // "design com henna" contém "design"? Fica só o nome mais específico de cada trecho.
  return achados
    .filter((a) => !achados.some((b) => b !== a && b.nome.length > a.nome.length && NORM(b.nome).includes(NORM(a.nome))))
    .sort((a, b) => a.pos - b.pos)
    .map(({ nome, minutos, sinal }) => ({ nome, minutos, sinal }));
}

/** Slot livre (futuro) que começa na hora escolhida, se houver. */
export function slotNaHora(livres: { inicio: string; fim: string }[], hora: string, fuso: string, agora: Date): { inicio: string; fim: string } | null {
  return livres.find((l) => new Date(l.inicio).getTime() > agora.getTime() && hhmm(l.inicio, fuso) === hora) ?? null;
}

/** Contexto depois que o SISTEMA tentou agendar (o modelo só comunica o resultado). */
export function contextoAgendado(r: { ok: boolean; pendente?: boolean; erro?: string }, quando: string, servicos: string, minutos: number, sinal: boolean | null = null): string {
  const sinalTxt = sinal === null ? '' : sinal ? ' Este serviço EXIGE SINAL: siga as instruções da empresa sobre o sinal.' : ' Estes serviços NÃO exigem sinal: não fale de sinal nem de PIX.';
  if (r.ok && r.pendente) return `AGENDAMENTO SOLICITADO AGORA (aguardando aprovação da equipe): ${servicos}, ${quando}. Diga que a equipe confirma o horário e passe as políticas. Não chame solicitar_agendamento de novo.${sinalTxt}`;
  if (r.ok) return `AGENDAMENTO FEITO AGORA pelo sistema: ${servicos}, ${quando} (${minutos} min). Confirme com estes dados EXATOS, sem mudar dia nem hora (ex.: "Agendei ${servicos.toLowerCase()} para ${quando} 💅"), e passe as políticas em uma frase. Não chame solicitar_agendamento de novo.${sinalTxt}`;
  return `TENTATIVA DE AGENDAR FALHOU (${(r.erro ?? 'erro').slice(0, 120)}): o horário ${quando} não pôde ser reservado. Não diga que está agendado: peça desculpas e ofereça outro horário.`;
}

/** "sexta-feira, 13/11, às 09:00" — com o dia da semana, para o modelo não errar a data ao copiar. */
export function quandoPorExtenso(data: string, hora: string, fuso: string): string {
  const [a, m, d] = data.split('-').map(Number);
  // meio-dia UTC do dia: o dia da semana não muda com o fuso
  const dow = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, weekday: 'long' }).format(new Date(Date.UTC(a, m - 1, d, 15)));
  return `${dow}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}, às ${hora}`;
}
