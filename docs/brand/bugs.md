# Bugs funcionais encontrados durante a auditoria de marca (v2)

Regra: bugs não são maquiados com visual. Esta lista é viva; cada item marca status.

| # | Bug | Evidência | Status |
|---|---|---|---|
| B1 | Toolbar de Leads com controles espremidos/sobrepostos em larguras intermediárias | `components/crm/leads/ListaLeads.tsx:242` (flex-wrap sem min-width por item) | conhecido |
| B2 | Seletor de conta (agência × cliente) desincronizado — dois switchers (`components/agency/SubaccountSwitcher.tsx` e `components/shell/Topbar.tsx:138-291`) com `clienteAtivo` derivado de duas fontes (`AgencyProvider.tsx:104-107`) + transição por `sessionStorage` TTL 15s | auditado 22/11 | conhecido, correção prevista na Fase 4.3 (provider único) |
| B3 | Dashboard: agendamentos (21.304) > leads (3.978) — suspeita de métrica/contagem errada | reportado; verificar query do dashboard | aberto |
| B4 | Página Google exibe nomes de variáveis de ambiente ao usuário final | `app/(app)/marketing/google/page.tsx:103` + `components/app/ConfigRequired.tsx:20-24` | conhecido |
| B5 | "Todas as tarefas" sem estado vazio de verdade — grupos vazios renderizam "Nada aqui." cru | `components/agency/daily/TarefasView.tsx:432` | conhecido |
| B6 | Formatação de moeda com 4 casas (`dolar()` em `lib/format.ts:142-145` — intencional p/ USD de provedor, mas vaza para telas de Agentes) + mês com maiúscula indevida | conhecido; revisar call sites | aberto |
| B7 | **E-mails transacionais com logo quebrada**: referenciam `/logo-revenue.png` inexistente em `apps/web/public` | `apps/api/src/common/invite-email.ts:22`, `password-reset-email.ts:9` | novo |
| B8 | Asset `public/cristais png` sem extensão de arquivo (2,4 MB inutilizável) | ls public | novo |
| B9 | Bolhas do Inbox com cores hardcoded do WhatsApp (`#d9fdd3`/`#005c4b`) e wallpaper claro servindo o tema escuro | `components/inbox/InboxAtendimento.tsx:839`, `globals.css:48` | conhecido (será resolvido no redesign do Inbox, sem quebrar funcionalidade) |
| B10 | `/ia` é demo-only e redireciona para `/nyro` em modo real — rota duplicada confusa | `app/(app)/ia/page.tsx:44-47` | novo |
