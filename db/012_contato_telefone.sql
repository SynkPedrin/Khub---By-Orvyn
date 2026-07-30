-- =====================================================================
-- ORVYN OS · Busca de contato por telefone normalizado (BUG-012)
-- Migration 012. Aditiva e idempotente. Rodar com owner/superuser APÓS 011.
--
-- Motivo: o inbox procurava o contato comparando dígitos crus ("77771234")
-- com o valor formatado do banco ("+55 11 97777-1234"). O traço quebrava o
-- match e cada resposta de WhatsApp criava um contato DUPLICADO — e a
-- automação, que esperava a resposta do contato original, nunca acordava.
--
-- A comparação passa a ser sempre `right(só_dígitos, 8)` dos dois lados. Este
-- índice funcional é o que faz isso ser uma busca por igualdade indexada, e
-- não um scan da tabela inteira a cada mensagem recebida.
-- =====================================================================

-- `[^0-9]` e NÃO `\D`: em template literal do JS a barra invertida some
-- ('\D' vira 'D') e a aplicação mandaria uma expressão diferente desta —
-- o índice não seria usado e, pior, a query apagaria a letra D em vez da
-- máscara. Manter as duas pontas escritas igual é o que faz o índice valer.
DROP INDEX IF EXISTS idx_contacts_fone_cauda;
CREATE INDEX IF NOT EXISTS idx_contacts_fone_cauda
  ON contacts (tenant_id, right(regexp_replace(telefone, '[^0-9]', '', 'g'), 8))
  WHERE telefone IS NOT NULL;
