import { Injectable } from '@nestjs/common';

export interface Chunk {
  ordem: number;
  breadcrumb: string | null;
  conteudo: string;
  tokens: number;
}

export interface ChunkingOptions {
  maxTokens: number; // RAG_CHUNK_TOKENS (default 600)
  overlap: number; // fração 0..1 (default 0.15)
}

/** Estimativa barata de tokens (~4 chars/token em PT-BR). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

type Segment = { text: string; kind: 'heading' | 'code' | 'table' | 'block'; level?: number };

/**
 * Chunking estrutural-semântico (R1.1). Nunca corta um bloco de código nem uma
 * tabela ao meio; agrupa por heading (breadcrumb) e empacota segmentos até
 * maxTokens, com sobreposição por segmentos inteiros. Ver RAG.md §5.
 */
@Injectable()
export class ChunkingService {
  chunk(markdown: string, opts: Partial<ChunkingOptions> = {}): Chunk[] {
    const maxTokens = opts.maxTokens ?? 600;
    const overlap = Math.min(Math.max(opts.overlap ?? 0.15, 0), 0.9);
    const overlapTokens = Math.floor(maxTokens * overlap);

    const segments = this.segment(markdown);
    const chunks: Chunk[] = [];
    let current: Segment[] = [];
    let currentTokens = 0;
    let headingStack: { level: number; text: string }[] = [];
    let chunkHeadingStack: { level: number; text: string }[] = [];

    const flush = () => {
      if (!current.length) return;
      const conteudo = current
        .map((s) => s.text)
        .join('\n\n')
        .trim();
      if (!conteudo) {
        current = [];
        currentTokens = 0;
        return;
      }
      chunks.push({
        ordem: chunks.length,
        breadcrumb: chunkHeadingStack.length ? chunkHeadingStack.map((h) => h.text).join(' > ') : null,
        conteudo,
        tokens: estimateTokens(conteudo),
      });
      // sobreposição: mantém apenas os PARÁGRAFOS finais (nunca duplica tabela
      // nem bloco de código) até atingir overlapTokens
      if (overlapTokens > 0) {
        const carry: Segment[] = [];
        let t = 0;
        for (let i = current.length - 1; i >= 0; i--) {
          if (current[i].kind !== 'block') break;
          const st = estimateTokens(current[i].text);
          if (t + st > overlapTokens) break;
          carry.unshift(current[i]);
          t += st;
        }
        current = carry;
        currentTokens = t;
      } else {
        current = [];
        currentTokens = 0;
      }
    };

    for (const seg of segments) {
      if (seg.kind === 'heading') {
        // atualiza a pilha de headings (breadcrumb)
        while (headingStack.length && headingStack[headingStack.length - 1].level >= (seg.level ?? 1)) {
          headingStack.pop();
        }
        headingStack.push({ level: seg.level ?? 1, text: seg.text.replace(/^#+\s*/, '').trim() });
        // heading inicia contexto de um novo chunk quando o atual já tem conteúdo
        if (currentTokens > 0) flush();
        chunkHeadingStack = [...headingStack];
        continue;
      }

      const segTokens = estimateTokens(seg.text);
      // bloco atômico maior que o limite: vira um chunk sozinho (não quebra tabela/código)
      if (segTokens >= maxTokens) {
        if (currentTokens > 0) flush();
        chunkHeadingStack = [...headingStack];
        current = [seg];
        currentTokens = segTokens;
        flush();
        continue;
      }

      if (currentTokens + segTokens > maxTokens && currentTokens > 0) {
        flush();
        chunkHeadingStack = [...headingStack];
      }
      if (!current.length) chunkHeadingStack = [...headingStack];
      current.push(seg);
      currentTokens += segTokens;
    }
    flush();
    // reindexa ordem (o carry de overlap pode ter gerado chunk vazio já filtrado)
    return chunks.map((c, i) => ({ ...c, ordem: i }));
  }

  /** Quebra o markdown em segmentos atômicos: heading | code | table | block. */
  private segment(markdown: string): Segment[] {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const segments: Segment[] = [];
    let i = 0;

    const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);

    while (i < lines.length) {
      const line = lines[i];

      // bloco de código cercado
      const fence = line.match(/^\s*(```+|~~~+)/);
      if (fence) {
        const marker = fence[1][0];
        const buf = [line];
        i++;
        while (i < lines.length && !new RegExp(`^\\s*${marker === '`' ? '```' : '~~~'}`).test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        if (i < lines.length) {
          buf.push(lines[i]);
          i++;
        }
        segments.push({ text: buf.join('\n'), kind: 'code' });
        continue;
      }

      // heading
      const heading = line.match(/^(#{1,6})\s+\S/);
      if (heading) {
        segments.push({ text: line.trim(), kind: 'heading', level: heading[1].length });
        i++;
        continue;
      }

      // tabela (linhas contíguas com |)
      if (isTableRow(line)) {
        const buf: string[] = [];
        while (i < lines.length && isTableRow(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        segments.push({ text: buf.join('\n'), kind: 'table' });
        continue;
      }

      // parágrafo/bloco: acumula até linha em branco
      if (line.trim() === '') {
        i++;
        continue;
      }
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^\s*(```+|~~~+)/.test(lines[i]) && !/^#{1,6}\s+\S/.test(lines[i]) && !isTableRow(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      segments.push({ text: buf.join('\n'), kind: 'block' });
    }
    return segments;
  }
}
