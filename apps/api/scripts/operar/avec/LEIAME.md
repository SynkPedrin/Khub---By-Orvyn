# Avec → KHUB (extração e importação)

Somente leitura no Avec. Credenciais fora do repo: `~/.khub/avec.env` (AVEC_URL, AVEC_USUARIO, AVEC_SENHA) e `~/.khub/khub.env` (KHUB_EMAIL, KHUB_SENHA), ambos `chmod 600`. A sessão do navegador fica em `~/.khub/avec-sessao/` (crie com `mkdir -m 700`).

1. `node entrar.mjs` — login headless no Avec, salva a sessão.
2. `node puxar-tudo.mjs` e `node puxar-mensal.mjs` — relatórios (via `/admin/relatorios/listar`) para `~/Downloads/avec-export/<data>/` (CSV + JSON). Os pesados (0180, 0186, 8123) vão mês a mês.
3. `node telas.mjs` — profissionais, grupos de acesso, regras de comissão, serviços.
4. `python3 converter.py` — gera `khub/{contatos,agenda,financeiro}.json`.
5. `node importar.mjs <API>/v1 ~/.khub/khub.env "<subconta>" [contatos,agenda,financeiro]` — importa pelas rotas oficiais (lotes de 200, re-login e retry). Idempotente: rodar de novo só ignora.

Decisões: agenda sem valor (o dinheiro vem só do financeiro 0387 por competência: entradas = vendas, saídas = despesas e comissões pagas) para não contar receita duas vezes; contatos só com telefone (os sem telefone ficam com o nome no título do atendimento); profissional que não é membro da equipe vai no título.
Atenção: `listar.mjs` usa o id do salão (62338) do estabelecimento importado em 2026-11-14; ajuste para outro salão.
