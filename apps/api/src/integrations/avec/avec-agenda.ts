/**
 * Agenda do Avec → agenda do KHUB: regras puras do sync (ADR-0052, BUG-050).
 *
 * O id que o Avec manda em cada reserva é cifrado e muda a cada leitura, então
 * a CHAVE de um atendimento é o que ele é: data + profissional + horário +
 * serviço + cliente. Remarcar no Avec = a chave antiga some (o KHUB cancela a
 * linha) e nasce outra (o KHUB cria).
 *
 * Por dia sincronizado:
 *   - reserva/bloqueio do Avec sem linha no KHUB → cria (origem 'avec');
 *   - linha 'avec' que mudou (horário, status, serviço) → atualiza;
 *   - linha 'avec' que não está mais no Avec → cancela;
 *   - linha antiga SEM origem que é cópia da exportação do Avec (legado) →
 *     adota se bate profissional + horário, senão cancela (não existe mais lá);
 *   - linha que nasceu no KHUB (IA ou equipe) → NUNCA mexe; só é adotada se
 *     a equipe lançou o mesmo atendimento no Avec (mesmo horário, profissional
 *     E mesma cliente). Se bate horário com OUTRA cliente, é conflito: fica e
 *     é reportado.
 * Status do Avec: 0 Cancelado, 0.6 Faltou, 1 Agendado, 1.5 Confirmado,
 * 2 Aguardando, 3 Em atendimento, 3.5 Finalizado, 4 Pago.
 */
import type { BloqueioAvec, DiaProfissionalAvec, ProfissionalAvec, ReservaAvec } from './avec.client';

export const ATIVOS = ['agendado', 'confirmado'] as const;
export const TITULO_BLOQUEIO = 'Bloqueio (Avec)';
/** Notas que marcam reserva feita por agente de IA no KHUB. */
const NOTA_IA = /^(Reservado pela|Solicitado pelo agente)/;

export function normalizarNome(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const soDigitos = (s: unknown) => String(s ?? '').replace(/[^0-9]/g, '');
/** Mesma pessoa pelo telefone (8 últimos dígitos) ou pelo nome normalizado. */
function mesmaCliente(a: { tel?: string | null; nome?: string | null }, b: { tel?: string | null; nome?: string | null }): boolean {
  const ta = soDigitos(a.tel);
  const tb = soDigitos(b.tel);
  if (ta.length >= 8 && tb.length >= 8 && ta.slice(-8) === tb.slice(-8)) return true;
  const na = normalizarNome(a.nome);
  const nb = normalizarNome(b.nome);
  return na.length >= 3 && na === nb;
}

/**
 * Profissional do Avec → do KHUB. O catálogo do KHUB veio do relatório do
 * Avec, que usa o APELIDO ("thaina", "mel"); a tela da agenda usa o nome.
 * Ordem: apelido, nome, primeiro nome. Ambíguo = sem vínculo (o serviço cria).
 */
export function mapearProfissionais(avec: ProfissionalAvec[], khub: { id: string; nome: string }[]): Map<string, string | null> {
  const porNome = new Map<string, string[]>();
  for (const k of khub) {
    const n = normalizarNome(k.nome);
    porNome.set(n, [...(porNome.get(n) ?? []), k.id]);
  }
  const unico = (n: string) => {
    const ids = porNome.get(n);
    return ids && ids.length === 1 ? ids[0] : null;
  };
  const m = new Map<string, string | null>();
  for (const p of avec) {
    const ap = normalizarNome(p.apelido);
    const nome = normalizarNome(p.nome);
    const primeiro = nome.split(' ')[0] ?? '';
    m.set(p.id, (ap && unico(ap)) || (nome && unico(nome)) || (primeiro.length >= 3 && unico(primeiro)) || null);
  }
  return m;
}

const minutos = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1440 ? Math.round(n) : null;
};

/** Status do Avec → KHUB. null = não ocupa (cancelado/faltou). */
export function statusDoAvec(status: unknown): 'agendado' | 'confirmado' | null {
  const n = Number(status);
  if (!Number.isFinite(n)) return 'agendado';
  if (n < 1) return null;
  return n >= 1.5 ? 'confirmado' : 'agendado';
}

/** Jornada do dia: {ini,fim} em minutos, ou null = folga. */
export function jornadaDoDia(d: DiaProfissionalAvec): { iniMin: number; fimMin: number } | null {
  const j = d.jornada;
  if (!j || Array.isArray(j)) return null;
  const h = j.horarios;
  if (!h || Array.isArray(h)) return null;
  const ini = minutos(h.hora_inicio);
  const fim = minutos(h.hora_fim);
  return ini !== null && fim !== null && ini < fim ? { iniMin: ini, fimMin: fim } : null;
}

export interface ItemAvec {
  externoId: string;
  avecProfId: string;
  iniMin: number;
  fimMin: number;
  status: 'agendado' | 'confirmado';
  bloqueio: boolean;
  servico: string | null;
  servicoAvecId: string | null;
  clienteNome: string | null;
  clienteTel: string | null;
}

/** Reservas e bloqueios ativos do dia, com chave estável e única. */
export function itensDoDia(data: string, dia: DiaProfissionalAvec[]): ItemAvec[] {
  const itens: ItemAvec[] = [];
  const vistos = new Map<string, number>();
  const chave = (base: string) => {
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  };
  for (const d of dia) {
    const prof = String(d.idProf);
    const reservas: ReservaAvec[] = Array.isArray(d.reservas) ? d.reservas : Object.values(d.reservas ?? {});
    for (const r of reservas) {
      const status = statusDoAvec(r.status);
      const ini = minutos(r.hora_inicio);
      const fimBruto = minutos(r.hora_fim);
      if (!status || ini === null) continue;
      if (r.data && r.data !== data) continue;
      const fim = fimBruto !== null && fimBruto > ini ? fimBruto : Math.min(ini + 30, 1440);
      const cliente = String(r.salao_cliente_id ?? '') || soDigitos(r.cliente_tel) || normalizarNome(r.cliente_nome);
      itens.push({
        externoId: chave(`r:${data}:${prof}:${ini}-${fim}:${r.servico_id ?? ''}:${cliente}`.slice(0, 190)),
        avecProfId: String(r.profissional_id ?? prof),
        iniMin: ini,
        fimMin: fim,
        status,
        bloqueio: false,
        servico: r.servico ? String(r.servico).replace(/\s+/g, ' ').trim() : null,
        servicoAvecId: r.servico_id != null ? String(r.servico_id) : null,
        clienteNome: r.cliente_nome ? String(r.cliente_nome).replace(/\s+/g, ' ').trim() : null,
        clienteTel: soDigitos(r.cliente_tel) || null,
      });
    }
    const j = d.jornada;
    const bloqueios: BloqueioAvec[] = j && !Array.isArray(j) && Array.isArray(j.bloqueado) ? j.bloqueado : [];
    for (const b of bloqueios) {
      const ini = minutos(b.hora_inicio);
      const fim = minutos(b.hora_fim);
      if (ini === null || fim === null || fim <= ini) continue;
      if (b.data_ini && b.data_ini !== data) continue;
      itens.push({
        externoId: chave(`b:${data}:${prof}:${ini}-${fim}`),
        avecProfId: String(b.profissional_id ?? prof),
        iniMin: ini,
        fimMin: fim,
        status: 'confirmado',
        bloqueio: true,
        servico: null,
        servicoAvecId: null,
        clienteNome: null,
        clienteTel: null,
      });
    }
  }
  return itens;
}

export interface LinhaKhub {
  id: string;
  origem: string | null;
  externoId: string | null;
  profissionalId: string | null;
  inicio: number;
  fim: number;
  status: string;
  titulo: string;
  servicoId: string | null;
  notas: string | null;
  createdAt: number;
  contatoTelefone: string | null;
  contatoNome: string | null;
}

export interface PlanoDia {
  inserir: (ItemAvec & { profissionalId: string; inicio: number; fim: number; servicoId: string | null; titulo: string })[];
  atualizar: { id: string; dados: { inicio?: number; fim?: number; status?: string; servicoId?: string | null; titulo?: string; profissionalId?: string; origem?: 'avec'; externoId?: string } }[];
  cancelar: { id: string; motivo: 'saiu_do_avec' | 'legado_fora_do_avec' }[];
  /** Linhas nascidas no KHUB (IA/equipe) que batem com outra cliente no Avec. */
  conflitos: { id: string; externoId: string }[];
  semProfissional: number;
}

/**
 * Plano de um dia. `instante(min)` converte minuto do dia (fuso do salão) em
 * epoch ms; `corteLegado` = quando a integração foi ligada (linha sem origem
 * criada antes disso e sem nota de IA é cópia da exportação do Avec).
 */
export function planejarDia(p: {
  itens: ItemAvec[];
  existentes: LinhaKhub[];
  profissional: Map<string, string | null>;
  servicoPorNome: Map<string, string>;
  instante: (min: number) => number;
  corteLegado: number;
}): PlanoDia {
  const plano: PlanoDia = { inserir: [], atualizar: [], cancelar: [], conflitos: [], semProfissional: 0 };
  const porChave = new Map(p.existentes.filter((e) => e.origem === 'avec' && e.externoId).map((e) => [e.externoId!, e]));
  const usados = new Set<string>();
  const ativo = (s: string) => (ATIVOS as readonly string[]).includes(s);
  const legado = (e: LinhaKhub) => e.origem === null && !NOTA_IA.test(e.notas ?? '') && e.createdAt < p.corteLegado;

  for (const it of p.itens) {
    const profissionalId = p.profissional.get(it.avecProfId) ?? null;
    if (!profissionalId) {
      plano.semProfissional++;
      continue;
    }
    const inicio = p.instante(it.iniMin);
    const fim = p.instante(it.fimMin);
    const servicoId = it.servico ? (p.servicoPorNome.get(normalizarNome(it.servico)) ?? null) : null;
    const titulo = it.bloqueio ? TITULO_BLOQUEIO : (it.servico || 'Atendimento').slice(0, 200);
    const ja = porChave.get(it.externoId);
    if (ja) {
      usados.add(ja.id);
      if (!ativo(ja.status) && ja.status !== 'cancelado') continue; // concluído/faltou no KHUB: não reabre
      const dados: PlanoDia['atualizar'][number]['dados'] = {};
      if (ja.inicio !== inicio) dados.inicio = inicio;
      if (ja.fim !== fim) dados.fim = fim;
      if (ja.profissionalId !== profissionalId) dados.profissionalId = profissionalId;
      if (ja.status !== it.status) dados.status = it.status;
      if (!it.bloqueio && servicoId && ja.servicoId !== servicoId) dados.servicoId = servicoId;
      if (ja.titulo !== titulo) dados.titulo = titulo;
      if (Object.keys(dados).length) plano.atualizar.push({ id: ja.id, dados });
      continue;
    }
    // Adoção: mesma profissional e mesmo início, linha ativa ainda sem origem.
    const candidata = it.bloqueio
      ? undefined
      : p.existentes.find(
          (e) =>
            e.origem === null &&
            !usados.has(e.id) &&
            ativo(e.status) &&
            e.profissionalId === profissionalId &&
            e.inicio === inicio &&
            (legado(e) || mesmaCliente({ tel: e.contatoTelefone, nome: e.contatoNome }, { tel: it.clienteTel, nome: it.clienteNome })),
        );
    if (candidata) {
      usados.add(candidata.id);
      const dados: PlanoDia['atualizar'][number]['dados'] = { origem: 'avec', externoId: it.externoId };
      if (candidata.fim !== fim) dados.fim = fim;
      if (candidata.status !== it.status) dados.status = it.status;
      if (servicoId && candidata.servicoId !== servicoId) dados.servicoId = servicoId;
      plano.atualizar.push({ id: candidata.id, dados });
      continue;
    }
    plano.inserir.push({ ...it, profissionalId, inicio, fim, servicoId, titulo });
  }

  for (const e of p.existentes) {
    if (usados.has(e.id) || !ativo(e.status)) continue;
    if (e.origem === 'avec') plano.cancelar.push({ id: e.id, motivo: 'saiu_do_avec' });
    else if (legado(e)) plano.cancelar.push({ id: e.id, motivo: 'legado_fora_do_avec' });
    else if (e.profissionalId) {
      // Nasceu no KHUB e não foi adotada: conflita com algo do Avec no mesmo horário?
      const choque = [...plano.inserir, ...p.existentes.filter((x) => usados.has(x.id))].find(
        (x) => x.profissionalId === e.profissionalId && x.inicio < e.fim && x.fim > e.inicio,
      );
      if (choque) plano.conflitos.push({ id: e.id, externoId: 'externoId' in choque && choque.externoId ? choque.externoId : '' });
    }
  }
  return plano;
}
