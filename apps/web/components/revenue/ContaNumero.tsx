'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Primeiro número no formato pt-BR: "48.200", "48,2", "404", "1.234,56". */
const NUMERO = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/;
const DURACAO_MS = 950;

interface Partes {
  antes: string;
  depois: string;
  alvo: number;
  casas: number;
  agrupar: boolean;
}

/** Separa "R$ 48,2 mil" em prefixo, número e sufixo. `null` = nada a animar. */
export function partesDoNumero(texto: string): Partes | null {
  const m = NUMERO.exec(texto);
  if (!m) return null;
  const token = m[0];
  const [inteiro, frac = ''] = token.split(',');
  const alvo = Number(`${inteiro.replace(/\./g, '')}.${frac || '0'}`);
  if (!Number.isFinite(alvo)) return null;
  return {
    antes: texto.slice(0, m.index),
    depois: texto.slice(m.index + token.length),
    alvo,
    casas: frac.length,
    // Respeita o original: "1234" sem ponto continua sem ponto.
    agrupar: inteiro.includes('.'),
  };
}

export function formatarParte(p: Partes, valor: number): string {
  const n = valor.toLocaleString('pt-BR', { minimumFractionDigits: p.casas, maximumFractionDigits: p.casas, useGrouping: p.agrupar });
  return `${p.antes}${n}${p.depois}`;
}

const suave = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Número de KPI que conta até o valor (ADR-0034).
 *
 * Termina SEMPRE no texto original, sem reformatar. Sem número no valor, com
 * "Reduzir movimento" ou com valor que não é texto/número, mostra o valor
 * direto. Leitores de tela recebem só o valor final, nunca a contagem.
 */
export function ContaNumero({ value }: { value: ReactNode }) {
  const texto = typeof value === 'number' ? value.toLocaleString('pt-BR') : typeof value === 'string' ? value : null;
  const partes = texto ? partesDoNumero(texto) : null;
  const [exibido, setExibido] = useState<string | null>(texto);
  const anterior = useRef(0);

  useEffect(() => {
    if (!texto || !partes) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setExibido(texto);
      anterior.current = partes.alvo;
      return;
    }
    const de = anterior.current;
    const inicio = performance.now();
    let frame = 0;
    const passo = (agora: number) => {
      const t = Math.min(1, (agora - inicio) / DURACAO_MS);
      if (t >= 1) {
        setExibido(texto);
        anterior.current = partes.alvo;
        return;
      }
      setExibido(formatarParte(partes, de + (partes.alvo - de) * suave(t)));
      frame = requestAnimationFrame(passo);
    };
    frame = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(frame);
    // `partes` deriva de `texto`; reanimar só quando o texto muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  if (!texto || !partes) return <>{value}</>;
  return (
    <>
      <span aria-hidden>{exibido}</span>
      <span className="sr-only">{texto}</span>
    </>
  );
}
