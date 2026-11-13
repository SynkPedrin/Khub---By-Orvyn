import { BadRequestException } from '@nestjs/common';
import { condicaoStatus, etiquetasDoContato, filtroConversasDaQuery, literalLike, whereConversas } from './conversas-filtro';

// Filtros e contagens de Conversas (db/063). Puro: o SQL gerado é conferido
// pelo texto + parâmetros (o valor do usuário NUNCA entra concatenado).

describe('filtroConversasDaQuery', () => {
  it('padrão: todas, sem canal', () => {
    expect(filtroConversasDaQuery({})).toEqual({ canal: undefined, status: 'todas', etiqueta: undefined, tipo: undefined, q: undefined });
  });
  it('canal "todos" vira sem filtro; canal conhecido passa', () => {
    expect(filtroConversasDaQuery({ canal: 'todos' }).canal).toBeUndefined();
    expect(filtroConversasDaQuery({ canal: 'Instagram', status: 'aguardando', tipo: 'comentario', etiqueta: ' VIP ', q: ' maria ' })).toEqual({
      canal: 'Instagram', status: 'aguardando', tipo: 'comentario', etiqueta: 'VIP', q: 'maria',
    });
  });
  it.each([
    [{ canal: 'Orkut' }],
    [{ status: 'arquivadas' }],
    [{ tipo: 'story' }],
    [{ etiqueta: 'x'.repeat(41) }],
    [{ q: 'y'.repeat(121) }],
  ])('valor desconhecido = 400, nunca ignorado: %j', (q) => {
    expect(() => filtroConversasDaQuery(q)).toThrow(BadRequestException);
  });
  it('query repetida usa o primeiro valor', () => {
    expect(filtroConversasDaQuery({ canal: ['YouTube', 'TikTok'] }).canal).toBe('YouTube');
  });
});

describe('whereConversas', () => {
  it('todas = TRUE, sem parâmetro', () => {
    const w = whereConversas({ status: 'todas' });
    expect(w.sql).toBe('TRUE');
    expect(w.values).toEqual([]);
  });
  it('canal, tipo e etiqueta viram parâmetros (sem injeção)', () => {
    const w = whereConversas({ status: 'todas', canal: 'Instagram', tipo: 'dm', etiqueta: "x' OR 1=1 --" });
    expect(w.text).toContain('c.canal = $1');
    expect(w.text).toContain('c.tipo = $2');
    expect(w.text).toContain('lower(ct.tag) = lower($3)');
    expect(w.values).toEqual(['Instagram', 'dm', "x' OR 1=1 --", "x' OR 1=1 --"]);
    expect(w.sql).not.toContain('OR 1=1');
  });
  it('busca com 4+ dígitos também procura no telefone (só dígitos)', () => {
    const w = whereConversas({ status: 'todas', q: '(11) 9988' });
    expect(w.sql).toContain('regexp_replace');
    expect(w.values).toContain('%119988%');
  });
  it('busca curta não toca o telefone', () => {
    const w = whereConversas({ status: 'todas', q: 'ana' });
    expect(w.sql).not.toContain('regexp_replace');
    expect(w.values).toEqual(['%ana%', '%ana%']);
  });
});

describe('condicaoStatus (mesma regra da lista e das contagens)', () => {
  it('não lidas exclui resolvidas', () => expect(condicaoStatus('nao_lidas').sql).toBe("c.nao_lidas > 0 AND c.status <> 'resolvida'"));
  it('em atendimento = responsável humano OU IA, aberta', () => expect(condicaoStatus('em_atendimento').sql).toContain("c.assignee_id IS NOT NULL OR c.atendimento = 'ia'"));
  it('aguardando = última mensagem do cliente', () => {
    const s = condicaoStatus('aguardando').sql;
    expect(s).toContain('ORDER BY m.created_at DESC LIMIT 1');
    expect(s).toContain("= 'contato'");
  });
  it('resolvidas', () => expect(condicaoStatus('resolvidas').sql).toBe("c.status = 'resolvida'"));
});

describe('helpers', () => {
  it('literalLike escapa curingas', () => expect(literalLike('50%_off\\')).toBe('%50\\%\\_off\\\\%'));
  it('etiquetasDoContato: tag principal + tags, sem duplicar nem vazias', () => {
    expect(etiquetasDoContato({ tag: 'Lead', tags: ['VIP', 'lead', '', ' Cliente '] })).toEqual(['Lead', 'VIP', 'Cliente']);
    expect(etiquetasDoContato(null)).toEqual([]);
  });
});
