import type { Compromisso, ProfissionalAgenda, StatusAgenda } from '@/lib/agenda';

/** Janela fixa das mini-trilhas: o salão trabalha cedo, mas 06h–22h cobre tudo. */
export const TRILHA_INICIO_MIN = 6 * 60;
export const TRILHA_FIM_MIN = 22 * 60;

export interface BlocoTrilha {
  id: string;
  inicioMin: number;
  fimMin: number;
  status: StatusAgenda;
  titulo: string;
}

export interface TrilhaProfissional {
  id: string;
  nome: string;
  total: number;
  minutosOcupados: number;
  blocos: BlocoTrilha[];
}

export interface ResumoDia {
  total: number;
  profissionaisAtivas: number;
  primeiraHoraMin: number | null;
  ultimaHoraMin: number | null;
  minutosOcupados: number;
  porStatus: Partial<Record<StatusAgenda, number>>;
}

const minutos = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};

/** Nome exibido numa trilha: profissional do catálogo, nome gravado ou rótulo neutro. */
export function nomeDaTrilha(id: string, profissionais: ProfissionalAgenda[], nomeGravado?: string | null): string {
  if (id === '__sem__') return 'Sem profissional';
  return profissionais.find((p) => p.id === id)?.nome ?? nomeGravado ?? 'Profissional';
}

/**
 * Uma trilha por profissional com atendimento no dia: blocos posicionados em
 * minutos dentro da janela fixa (o componente converte para %). Só entra o
 * que se sobrepõe à janela; quem está todo fora é esticado para a borda mais
 * próxima para nunca sumir do mapa.
 */
export function trilhasDoDia(eventos: Compromisso[], profissionais: ProfissionalAgenda[]): TrilhaProfissional[] {
  const porId = new Map<string, Compromisso[]>();
  for (const e of eventos) {
    const k = e.profissionalId ?? '__sem__';
    porId.set(k, [...(porId.get(k) ?? []), e]);
  }
  const trilhas = [...porId.entries()].map(([id, evs]) => {
    const blocos = evs
      .map((e): BlocoTrilha => {
        const ini = Math.max(TRILHA_INICIO_MIN, Math.min(TRILHA_FIM_MIN - 5, minutos(e.inicio)));
        const fim = Math.max(ini + 5, Math.min(TRILHA_FIM_MIN, minutos(e.fim) || ini + 60));
        return { id: e.id, inicioMin: ini, fimMin: fim, status: e.status, titulo: e.servicoNome ?? e.titulo };
      })
      .sort((a, b) => a.inicioMin - b.inicioMin);
    const minutosOcupados = blocos.reduce((t, b) => t + (b.fimMin - b.inicioMin), 0);
    return { id, nome: nomeDaTrilha(id, profissionais, evs[0]?.profissionalNome), total: evs.length, minutosOcupados, blocos };
  });
  // Mais cheio primeiro; "Sem profissional" sempre por último.
  return trilhas.sort((a, b) => (a.id === '__sem__' ? 1 : b.id === '__sem__' ? -1 : b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR')));
}

/** Os números do dia para a faixa de KPIs (a "leitura de relance" da recepção). */
export function resumoDoDia(eventos: Compromisso[]): ResumoDia {
  const porStatus: Partial<Record<StatusAgenda, number>> = {};
  let primeira: number | null = null;
  let ultima: number | null = null;
  let ocupado = 0;
  const profs = new Set<string>();
  for (const e of eventos) {
    porStatus[e.status] = (porStatus[e.status] ?? 0) + 1;
    const ini = minutos(e.inicio);
    const fim = minutos(e.fim) || ini;
    primeira = primeira === null ? ini : Math.min(primeira, ini);
    ultima = Math.max(ultima ?? 0, fim);
    ocupado += Math.max(0, fim - ini);
    profs.add(e.profissionalId ?? '__sem__');
  }
  return { total: eventos.length, profissionaisAtivas: profs.size, primeiraHoraMin: primeira, ultimaHoraMin: ultima, minutosOcupados: ocupado, porStatus };
}

/** 450 → "7h30"; 55 → "55min". */
export function rotuloMinutos(min: number): string {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

export const rotuloHoraMin = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
