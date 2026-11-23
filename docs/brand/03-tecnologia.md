# 03 · Tecnologias — adotadas e recusadas (v2)

Data: 2026-11-22 · Stack real confirmada: **Next.js 14.2.35 (App Router) · Tailwind 3.4.10 · framer-motion 11 · reactflow 11 · React 18.3**. Sem Radix/cmdk/sonner/recharts/vaul. Kit de UI próprio já existe (`components/kit/` + `components/ui.tsx`).

## Adotadas

| Tecnologia | Uso | Justificativa / custo |
|---|---|---|
| **Tokens CSS + preset Tailwind v3** (`@theme` não existe na v3 → `tailwind.config.ts` estendido) | 100% dos tokens da Fase 2 | Custo zero de bundle. Corrige os 3 `--brand` divergentes. |
| **`color-mix()` em oklab** | Derivar hover/soft/borda de um token base | Nativo, suporte ok nos alvos (Chrome/Safari recentes). |
| **`@property`** | Borda cônica animada violeta→lime da NICO "pensando" | Nativo; fallback: borda estática. |
| **Scroll-driven animations (`animation-timeline: view()`)** | Reveal de gráficos do dashboard | Nativo, sem JS; `@supports` fallback = visível sem animação. |
| **Container queries** | Cards/painéis responsivos (Inbox, Kanban, Dashboard) | Nativo. |
| **`:has()`** | Estados de form e linhas selecionadas sem JS | Nativo. |
| **`text-wrap: balance/pretty`, `tabular-nums`, `scrollbar-gutter`** | Polish tipográfico | Nativo, custo zero. |
| **framer-motion 11 (já instalada)** | Entrada de painéis, indicador ativo da sidebar (já usa `layoutId`), transições sutis | Sem custo novo. `useReducedMotion` obrigatório (o shell já usa `MotionConfig reducedMotion="user"`). **Kanban: decisão final — DnD nativo HTML5 MANTIDO** (mover negócio é fluxo de aceite; a reescrita com framer-motion foi avaliada e recusada por risco/benefício; a alternativa por teclado já existe e o movimento ganhou Desfazer via toast). |
| **`loading.tsx` por rota + skeletons do kit** | 0 → todas as rotas principais | Convenção do App Router; reusa `.skeleton` existente. |
| **playwright-core (devDependency, root)** | Screenshots de auditoria, testes visuais e fluxos da seção 10 | +~3 MB dev only, usa o Chrome do sistema (sem download de browser). |

## Adotadas com restrição

| Tecnologia | Decisão |
|---|---|
| **View Transitions** | **API nativa via CSS + `document.startViewTransition` no link da sidebar/topbar e drawer de lead**, sem a lib `next-view-transitions` (Next 14.2 não a suporta oficialmente; a lib é leve mas nativo basta). Fallback: sem transição. |
| **NumberFlow** | **Recusada como lib; implementado um `AnimatedNumber` próprio (~40 linhas, rAF + tabular-nums)** para KPIs. Evita +1 dep por um efeito simples. |
| **WebGL shader no login** | **Recusado WebGL (OGL/shaders-react); adotado mesh gradient CSS animado (`@property` + radiais conic) + o `crystal-video.mp4` já existente como enriquecimento progressivo**, `prefers-reduced-motion` → imagem estática. Zero JS adicional no login; mesmo efeito "aurora viva". |

## Recusadas

| Tecnologia | Motivo |
|---|---|
| **Radix UI / shadcn** | O `components/kit/` já cobre Modal/Drawer/Tooltip/Tabs/Menu/Toast com a11y (focus-trap, portal, aria). Trocar a base = risco de regressão em 67 rotas por benefício marginal. O kit será **estilizado** com os novos tokens. |
| **cmdk** | `components/app/CommandBar.tsx` já existe (atalho ⌘K, busca debounce). Estilizar o existente. |
| **Sonner** | `components/kit/Toast.tsx` já existe com aria-live; adicionar ação "Desfazer" nele (~1 dia) custa menos que nova dep. |
| **Vaul** | `Drawer` do kit já é bottom-sheet no mobile; sem necessidade de nova dep. |
| **Recharts/visx** | Charts já são SVG inline próprios (`components/revenue/charts.tsx`, `charts.tsx`) — manter e **tematizar** (ordem de séries lime→violeta→ciano…, grid 4%, tooltip glass). Zero KB novos. |
| **Tailwind v4** | Migração fora do escopo de marca; v3 atende com preset. |
| **OGL / @paper-design/shaders-react** | Ver WebGL acima — orçamento de 60 kB não comporta WebGL por uma tela. |
| **next-view-transitions** | Ver View Transitions acima. |

## Orçamentos assumidos (seção 6 do brief)

LCP ≤ 2,0 s · CLS ≤ 0,05 · INP ≤ 200 ms (Dashboard, Leads, Conversas — medidos antes/depois) · JS adicional ≤ 60 kB gzip na camada visual · ≤ 3 `backdrop-filter` visíveis simultâneos · animações só transform/opacity · 60 fps no Kanban com 150 cards (virtualizar se necessário).
