/** CSV compatível com planilhas em pt-BR; protege células interpretadas como fórmula. */
export function criarCsv(linhas: unknown[][]): string {
  return '\uFEFF' + linhas.map((linha) => linha.map((valor) => {
    const texto = String(valor ?? '');
    const seguro = /^[\s]*[=+@-]/.test(texto) && typeof valor !== 'number' ? `'${texto}` : texto;
    return `"${seguro.replace(/"/g, '""')}"`;
  }).join(';')).join('\r\n');
}
export function exportarCsv(nome: string, linhas: unknown[][]): void {
  const url = URL.createObjectURL(new Blob([criarCsv(linhas)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = nome; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
