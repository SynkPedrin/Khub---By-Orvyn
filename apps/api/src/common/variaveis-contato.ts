/**
 * Variáveis de mensagem para envio a contato (disparo em massa, pedido de
 * avaliação). Mesma sintaxe dos nós de automação: `{{contato.nome}}`.
 * Função pura: a pré-visualização da tela e o envio real usam a mesma.
 */
export interface ContatoParaVariaveis {
  nome: string;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  camposCustom?: unknown;
}

/** Variáveis oferecidas na UI (a chave é exatamente o que vai entre chaves). */
export const VARIAVEIS_CONTATO = [
  { chave: 'contato.primeiroNome', rotulo: 'Primeiro nome' },
  { chave: 'contato.nome', rotulo: 'Nome completo' },
  { chave: 'contato.empresa', rotulo: 'Empresa' },
  { chave: 'contato.email', rotulo: 'E-mail' },
  { chave: 'contato.telefone', rotulo: 'Telefone' },
] as const;

/** Primeiro nome capitalizado; nome que é só telefone vira vazio ("Olá, 5541…!" não). */
export function primeiroNome(nome: string): string {
  const p = (nome ?? '').trim().split(/\s+/)[0] ?? '';
  if (!p || /^[+\d()\s-]+$/.test(p)) return '';
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

function campo(c: ContatoParaVariaveis, chave: string): string {
  const cf = c.camposCustom && typeof c.camposCustom === 'object' && !Array.isArray(c.camposCustom) ? (c.camposCustom as Record<string, unknown>) : {};
  const v = cf[chave];
  if (v === undefined || v === null) return '';
  return Array.isArray(v) ? v.map(String).join(', ') : String(v);
}

/**
 * Substitui `{{contato.*}}`, `{{contato.campo.<chave>}}` e os `extras`
 * (ex.: `{{link}}`). Variável desconhecida ou vazia some sem deixar
 * pontuação órfã ("Oi, !" vira "Oi!").
 */
export function interpolarContato(texto: string, c: ContatoParaVariaveis, extras: Record<string, string> = {}): string {
  const r = texto.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, chave: string) => {
    if (chave in extras) return extras[chave];
    switch (chave) {
      case 'contato.nome': return c.nome ?? '';
      case 'contato.primeiroNome': return primeiroNome(c.nome);
      case 'contato.email': return c.email ?? '';
      case 'contato.telefone': return c.telefone ?? '';
      case 'contato.empresa': return c.empresa ?? '';
      default:
        return chave.startsWith('contato.campo.') ? campo(c, chave.slice('contato.campo.'.length)) : '';
    }
  });
  return r.replace(/,\s*([!?.])/g, '$1').replace(/[ \t]{2,}/g, ' ');
}

/** Corpo de e-mail: escapa HTML e quebra de linha vira <br>. */
export function htmlDeTexto(texto: string): string {
  const esc = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">${esc.replace(/\n/g, '<br>')}</div>`;
}
