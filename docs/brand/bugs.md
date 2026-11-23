# Bugs funcionais encontrados durante a auditoria de marca (v2)

Regra: bugs não são maquiados com visual. Esta lista é viva; cada item marca status.

| # | Bug | Evidência | Status |
|---|---|---|---|
| B1 | Toolbar de Leads com controles espremidos/sobrepostos em larguras intermediárias | `components/crm/leads/ListaLeads.tsx:242` | **corrigido** (toolbar reestruturada; causa raiz: `btn-icon` do kit nos gatilhos de Menu) |
| B2 | Seletor de conta desincronizado — dois switchers com `clienteAtivo` derivado de JWT + `agency.seletor()` | auditado 22/11 | mitigado: ambos consomem o memo único do `AgencyProvider`; transição por reload completo mantida por ADR. Monitorar na 4.5 |
| B3 | Dashboard: agendamentos > leads (suspeita de métrica) | reportado | aberto (backend, fora do escopo visual) |
| B4 | Página Google exibe nomes de env vars | `ConfigRequired.tsx` | **won't fix (contratual)** — `docs/ENV.md` define que a UI mostra exatamente as variáveis para quem configura. Polimento visual herdado do EmptyState |
| B5 | "Todas as tarefas" com grupos vazios ("Nada aqui.") | `TarefasView.tsx:432` | **corrigido** (grupos vazios filtrados no agrupamento por status) |
| B6 | Mês com maiúscula indevida ("Novembro De 2026") | `financeiro/page.tsx` (classe `capitalize`) | **corrigido** (`first-letter:uppercase`). As 4 casas de `dolar()` são intencionais p/ custo USD do provedor |
| B7 | E-mails com logo quebrada (`/logo-revenue.png` inexistente) | `apps/api/src/common/*email.ts` | **corrigido** → `/khub-logo.png`; CTA no lime de marca |
| B8 | Asset `public/cristais png` sem extensão | ls public | aberto (decidir: renomear ou apagar — sem referências no código) |
| B9 | Bolhas Inbox hardcoded WhatsApp + wallpaper invertido | `InboxAtendimento.tsx:839`, `globals.css:48` | **em correção** (migração Inbox v2) |
| B10 | `/ia` demo-only redireciona para `/nyro` | `ia/page.tsx:44-47` | aberto (avaliar remoção da rota na 4.5 — fora do visual) |
| B11 | Contraste: texto branco sobre lime em ~20 badges/toggles | grep `bg-brand text-white` | **corrigido** com a utilidade `.text-on-brand` |
