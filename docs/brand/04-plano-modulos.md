# 04 · Plano por módulo (Fase 4) — 5 linhas cada

Regra do brief §12: pensar antes de codar. Ordem obrigatória: fundação → componentes → shell → módulos → refinamento.

## 4.1 Fundação
- **Objetivo:** ativar tokens v2 sem quebrar nada, matando os 3 `--brand`.
- **Muda:** `app/layout.tsx` importa `styles/tokens.css` + `styles/aliases-v1.css` após `globals.css`; fontes Space Grotesk/JetBrains Mono via `next/font/local`; `tailwind.config.ts` ganha cores/raios/escala novos.
- **Risco:** aliases mudam valores globais → regressão visual em telas não migradas (aceitável e temporário: é o mecanismo do brief).
- **Teste:** build + typecheck verdes; screenshot comparativo dashboard/leads/login vs `antes/`; contraste re-rodado.

## 4.2 Componentes (kit)
- **Objetivo:** todo estado de todo componente do `components/kit/` + `ui.tsx` com tokens v2.
- **Muda:** Button (primary lime / ai violeta), Input/Select/Switch, Modal/Drawer/Confirm, Toast (+ação "Desfazer"), Tabs, Tooltip, Skeleton, EmptyState ilustrado, `AnimatedNumber` próprio, badges de status com ponto.
- **Risco:** kit é usado por 67 rotas — mudança visual ampla.
- **Teste:** nova rota `/design-system` renderizando cada componente em todos os estados, nos 2 temas; Playwright clica nos estados.

## 4.3 Shell
- **Objetivo:** sidebar/topbar com identidade e **provider único de conta** (corrige B2).
- **Muda:** `components/shell/Sidebar.tsx` (logo sem caixa branca — usar `khub-logo-white.png` no dark, item ativo barra lime 2px, switcher único), `Topbar.tsx` (glass, ⌘K, "Perguntar à NICO" violeta), `AgencyProvider` vira fonte única (AccountMenu consome o mesmo estado), `loading.tsx` nas rotas principais.
- **Risco:** troca de conta é fluxo crítico (reload completo hoje) — não alterar a mecânica, só a fonte de verdade visual.
- **Teste:** login → trocar de cliente → sidebar e topbar mostram o mesmo cliente; screenshots.

## 4.4 Módulos (na ordem)
1. **Login/Cadastro** — hero aurora (mesh CSS + crystal-video progressivo), headline display com palavra lime, form glass. Teste: LCP + screenshot 1440/390.
2. **Dashboard** — faixa boas-vindas aurora sutil, KPIs `AnimatedNumber` + delta, "Precisa de atenção" violeta, funil/receita com `--data-*`. Teste: comparar números antes/depois (dados intocados).
3. **Conversas/Inbox** — bolhas com tokens do tema (sem wallpaper WhatsApp — B9), IA em violeta, nota interna âmbar, sugestões NICO violeta. Teste: enviar mensagem demo, ver bolhas/atalhos.
4. **Leads** — toolbar reestruturada (corrige B1), chips de filtro, avatar com anel de canal, seleção em massa, drawer com transição. Teste: criar lead, filtrar, abrir drawer.
5. **Pipeline** — Kanban com framer-motion (mantém alternativa teclado), colunas com cor de etapa discreta, desfazer via Toast. Teste: arrastar card, reordenar, desfazer; 60 fps.
6. **Agenda** — grade por profissional, status por cor, linha "agora" lime. Teste: criar agendamento demo.
7. **Automações** — canvas: gatilho lime, condição neutra, ação IA violeta; logs. Teste: abrir editor reactflow, nó renderiza cores novas.
8. **NICO/Agentes** — universo violeta, `.ai-border` ao responder, halo no avatar. Teste: enviar mensagem à NICO, ver borda animada.
9. **Demais** (Financeiro, Analytics, Campanhas, Redes, Google — B4, Formulários, Tarefas — B5, Studio, Calendário, Configurações, Agência, Clientes, Equipe) — mesmos padrões. Teste: screenshots + fluxo principal de cada.

## 4.5 Refinamento
- Microinterações (120/180/240 ms, `--ease-khub`), foco visível, `prefers-reduced-motion`, responsivo 390/768/1280/1440, tema claro tela a tela, remoção de `aliases-v1.css`, lint zero-arbitrary, medição final de Web Vitals/bundle.
