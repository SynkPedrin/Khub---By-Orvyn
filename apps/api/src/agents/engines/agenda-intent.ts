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

/** Hora de parede "09:00" no fuso. */
function hhmm(isoUtc: string, fuso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(isoUtc));
}

/**
 * Bloco de contexto com os horários livres em hora LOCAL, já filtrados pelo
 * período pedido. O modelo só escolhe 2–3 e oferece.
 */
export function contextoAgenda(p: PedidoAgenda, livres: { inicio: string; fim: string }[], fuso: string, agora: Date): string {
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
  linhas.push('- Você JÁ verificou: não diga que vai verificar. Ofereça até 3 desses horários e pergunte qual prefere. Só chame solicitar_agendamento depois que o contato escolher.');
  return linhas.join('\n');
}
