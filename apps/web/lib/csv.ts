import type { CampoImportacao } from './comercial';

/**
 * Leitor de CSV (RFC 4180) sem dependência: aspas, aspas escapadas (""),
 * quebra de linha dentro de campo, BOM do Excel e separador detectado
 * (vírgula, ponto e vírgula ou tab: o Excel em pt-BR exporta com ";").
 */
export function detectarSeparador(texto: string): ',' | ';' | '\t' {
  const primeira = texto.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const fora = primeira.replace(/"[^"]*"/g, '');
  const conta = (c: string) => fora.split(c).length - 1;
  const [melhor] = ([',', ';', '\t'] as const).map((c) => [c, conta(c)] as const).sort((a, b) => b[1] - a[1]);
  return melhor[1] > 0 ? melhor[0] : ',';
}

export function lerCsv(texto: string, separador = detectarSeparador(texto)): string[][] {
  const s = texto.replace(/^﻿/, '');
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (aspas) {
      if (c === '"') {
        if (s[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += c;
      continue;
    }
    if (c === '"' && campo === '') { aspas = true; continue; }
    if (c === separador) { linha.push(campo); campo = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.some((v) => v.trim() !== '')) linhas.push(linha);
      linha = [];
      continue;
    }
    campo += c;
  }
  linha.push(campo);
  if (linha.some((v) => v.trim() !== '')) linhas.push(linha);
  return linhas;
}

export const CAMPOS: { campo: CampoImportacao; rotulo: string }[] = [
  { campo: 'nome', rotulo: 'Nome completo' },
  { campo: 'primeiroNome', rotulo: 'Primeiro nome' },
  { campo: 'sobrenome', rotulo: 'Sobrenome' },
  { campo: 'telefone', rotulo: 'Telefone / WhatsApp' },
  { campo: 'email', rotulo: 'E-mail' },
  { campo: 'empresa', rotulo: 'Empresa' },
  { campo: 'cargo', rotulo: 'Cargo' },
  { campo: 'tags', rotulo: 'Tags' },
  { campo: 'origem', rotulo: 'Origem' },
  { campo: 'valor', rotulo: 'Valor estimado' },
  { campo: 'cidade', rotulo: 'Cidade' },
  { campo: 'observacao', rotulo: 'Observação' },
];

/** Destino de uma coluna: campo do KHUB, campo personalizado (`custom:chave`) ou ignorar (''). */
export type Destino = CampoImportacao | `custom:${string}` | '';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Cabeçalhos do export do GHL (inglês) e de planilhas comuns em português. */
const SINONIMOS: Record<CampoImportacao, string[]> = {
  nome: ['nome', 'nome completo', 'full name', 'name', 'contact name', 'cliente', 'contato'],
  primeiroNome: ['first name', 'primeiro nome', 'firstname'],
  sobrenome: ['last name', 'sobrenome', 'lastname', 'ultimo nome'],
  telefone: ['phone', 'telefone', 'celular', 'whatsapp', 'phone number', 'fone', 'tel', 'mobile'],
  email: ['email', 'e mail', 'email address'],
  empresa: ['company name', 'company', 'empresa', 'business name'],
  cargo: ['cargo', 'job title', 'title', 'funcao'],
  tags: ['tags', 'tag', 'etiquetas'],
  origem: ['source', 'contact source', 'origem', 'fonte', 'canal'],
  valor: ['valor', 'value', 'opportunity value', 'valor estimado', 'ticket'],
  cidade: ['city', 'cidade', 'municipio'],
  observacao: ['notes', 'note', 'observacao', 'observacoes', 'obs', 'comentario'],
};

export function sugerirMapeamento(cabecalhos: string[]): Destino[] {
  const usados = new Set<CampoImportacao>();
  return cabecalhos.map((h) => {
    const n = norm(h);
    const campo = (Object.keys(SINONIMOS) as CampoImportacao[]).find((c) => !usados.has(c) && SINONIMOS[c].includes(n));
    if (campo) { usados.add(campo); return campo; }
    return '';
  });
}

/** Chave de campo personalizado a partir do cabeçalho ("Data de Nascimento" → data_de_nascimento). */
export function chaveCustom(cabecalho: string): string {
  const k = norm(cabecalho).replace(/ /g, '_').replace(/^[^a-z]+/, '').slice(0, 60);
  return k || 'campo';
}

export function montarLinhas(dados: string[][], mapa: Destino[]) {
  return dados.map((cols) => {
    const l: Record<string, unknown> = {};
    const campos: Record<string, string> = {};
    mapa.forEach((d, i) => {
      const v = (cols[i] ?? '').trim();
      if (!d || !v) return;
      if (d.startsWith('custom:')) campos[d.slice(7)] = v;
      else l[d] = l[d] ? `${l[d]}, ${v}` : v; // duas colunas no mesmo campo (ex.: duas de tags) se somam
    });
    if (Object.keys(campos).length) l.campos = campos;
    return l;
  });
}
