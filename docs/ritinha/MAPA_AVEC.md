# MAPA AVEC — o que existe de verdade (verificado em 2026-11-16)

## Arquitetura atual: extração + importação (NÃO é integração viva)

```
Avec (web do salão, id 62338)
  │  login headless Playwright (entrar.mjs) — credenciais em ~/.khub/avec.env
  ▼
Relatórios /admin/relatorios/listar (puxar-tudo.mjs, puxar-mensal.mjs) + telas (telas.mjs, servicos.mjs, listar.mjs, filtros.mjs)
  │  → ~/Downloads/avec-export/<data>/ (CSV+JSON, pasta 700)
  ▼
converter.py → khub/{contatos,agenda,financeiro}.json
  ▼
importar.mjs → rotas oficiais da API KHUB (lotes de 200, idempotente)
```

**Sentido único, somente leitura, sob demanda (manual).** Sem webhooks, sem job agendado, sem cliente de API, sem escrita.

## O que já foi extraído/importado (14/11, Tasks AVEC-1/2)

- 21.985 agendamentos (desde 02/2020) → 20.890 no Neon (1.094 duplicatas do próprio Avec ignoradas; 13.732 ligados a contato; 4.130 futuros).
- Financeiro conferido 1:1 com o Avec: 44.611 entradas = R$ 4.379.594,60; 715 saídas = R$ 642.739,34; 0 erros. Importação não vinculada a atendimentos (sem receita em dobro).
- 10 profissionais, 5.840 clientes, serviços, regras de comissão extraídos para arquivos locais.

## Lacunas verificadas (Neon, 16/11)

| Item | Estado |
|---|---|
| `agenda_compromissos.profissional_id` | **0/20.890 preenchidos** |
| `agenda_compromissos.servico_id` | **0/20.890** |
| `agenda_compromissos.valor_centavos` | **0/20.890** |
| Catálogo `servicos` / `profissionais` (db/071) | **0 registros** no tenant |
| Correção pronta | `corrigir-agenda.mjs`: QA 20.888 corrigidos; Neon simulado OK; **gravação aguarda autorização** |
| Profissionais como equipe KHUB (AVEC-3) | não feito (aguarda decisão de e-mails) |
| Comissões como entidade (AVEC-4) | não feito (depende de AVEC-3) |
| Sincronização contínua (AVEC-5) | **não existe** — dados de 14/11, já defasados |

## Capacidades do contrato funcional (master §4) × realidade

| Capacidade | Estado | Caminho |
|---|---|---|
| Consultar serviços | ✅ via extração (snapshot 14/11) | `servicos.mjs` / relatórios |
| Consultar profissionais | ✅ via extração | `telas.mjs` |
| Disponibilidade real | ❌ não implementado | verificar se o Avec expõe agenda por relatório/tela de grade |
| Criar agendamento | ❌ | Avec tem API pública? investigar; alternativa: equipe confirma (modelo v2) |
| Reagendar / cancelar / confirmar | ❌ | idem |
| Detectar alterações externas | ❌ (re-extração periódica manual) | AVEC-5 |
| Idempotência na importação | ✅ provada (2ª rodada 0 criados) | `importar.mjs` |

## Decisão de design já registrada (LEIAME.md)

Agenda importada **sem valor** (dinheiro só do financeiro por competência) para não contar receita duas vezes; contatos só com telefone; profissional não-membro fica no título.

## Riscos

- Scraping quebra com mudança de layout do Avec (sem contrato).
- Credencial web do salão em `~/.khub/avec.env` (fora do repo, ok).
- Enquanto o Avec for a fonte oficial e o KHUB tiver agenda própria desatualizada, **qualquer "disponibilidade" calculada pelo KHUB é inválida** — a regra do master (KHUB = projeção/cache, nunca confirma sozinho) está violável hoje: `ver_agendamentos` calcula slots só com dados KHUB (BUG-039).
