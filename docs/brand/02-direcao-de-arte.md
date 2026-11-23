# 02 · Direção de Arte — "Signal + Intelligence" (v2)

Data: 2026-11-22 · Base: `01-auditoria-identidade.md` · Status: aprovada por modo autônomo (registrado no intake)

## Decisões tomadas onde o brief conflitava com a realidade

1. **FK Grotesk Neue não existe no repositório.** Substituta de mesmo caráter (grotesca técnica, OFL): **Space Grotesk** (500/700), servida localmente como as demais fontes. Fallback se a fonte não puder ser adicionada: Manrope 800 com tracking −3% (já em casa).
2. **ADR-0040 ("NICO = lime, Agentes = violeta") é revogado pelo brief.** Nova semântica única: **violeta = inteligência (toda IA, inclusive NICO)**; **lime = sinal/ação do usuário**. O comentário do ADR em `components/nico/Nico.tsx` será atualizado na Fase 4.
3. **Tailwind é v3.4.10** (não v4) → preset v3 + tokens CSS; lint `no-arbitrary-value` via config equivalente.
4. **Violetas do código ≠ violetas do logo.** O sistema usa os violetas do logo (#331177–#5511CC família), não os #7b2eff/#a855f7 atuais.
5. **Dois limes morrem.** `--brand` vira um só (#B6FF00) em todos os contextos dark; o #9bee45 do :root default é alinhado.

## Conceito

O KHUB é uma **central de comando noturna**. Dark-first: o tema escuro recebe o melhor acabamento; o claro é projetado, não invertido. Duas cores com função, nunca decoração:

- **Lime = Sinal.** Ação do usuário, foco, item ativo, deltas positivos, série principal. Nunca em grandes áreas, nunca como texto no tema claro.
- **Violeta = Inteligência.** NICO, agentes, sugestões, insights, automações rodando. O usuário aprende: "violeta = a IA está fazendo algo".
- **Vidro = Camada.** Glass só no que flutua: topbar, ⌘K, popovers, modais, dock da NICO. Nunca em listas/tabelas.
- **Aurora = Momento.** Mesh violeta+lime com grão só em: login, boas-vindas do dashboard, empty states de destaque, tela da NICO, onboarding, celebrações. Máx. 1 por tela.

## Tokens (Fase 4.1 — `styles/tokens.css`)

Neutros dark (viés frio p/ conversar com o violeta): `--bg-0 #050506` · `--bg-1 #0A0A0C` · `--surface-1 #0F0F12` · `--surface-2 #15151A` · `--surface-3 #1C1C22` · `--line-1 rgba(255,255,255,.07)` · `--line-2 .12` · `--fg-1 #F4F4F6` · `--fg-2 #A9A9B4` · `--fg-3 #7F7F89` (ajustado de #75757F → 4.83:1 AA; o valor original falhava com 4.20:1) · `--fg-4 #4E4E57` (só desabilitado/placeholder, isento de AA).

**Lime (sinal):** `--lime-500 #B6FF00` (fill) · `--lime-400 #C8FF4D` (hover) · `--lime-300 #D6FF8F` (texto de marca no dark) · `--lime-950 #141A03` / `--lime-900 #1D2605` (fundos) · `--lime-ink #0B1000` (texto sobre lime).
**Violeta (inteligência):** `--violet-950 #12062E` · `--violet-900 #1E0B4A` · `--violet-800 #331177` · `--violet-700 #4411AA` · `--violet-600 #5511CC` · `--violet-400 #8F6BFF` · `--violet-300 #B8A2FF` (texto de IA no dark).
**Gradiente assinatura:** `linear-gradient(135deg,#331177 0%,#5511CC 45%,#B6FF00 120%)` — logo, borda animada da NICO, progresso de onboarding, destaque de meta. Máx. 1/tela.
**Semânticas (≠ lime):** sucesso `#2EE6A6` · atenção `#FFB547` · erro `#FF5D6C` · info `#5EB0FF`, cada uma com `-soft` ~12%.
**Dados (ordem fixa):** lime `#B6FF00`, violeta `#8F6BFF`, ciano `#4FE3FF`, âmbar `#FFB547`, rosa `#FF6BD5`, cinza `#6E6E78`. Substitui `--cat-*`.
**Canais:** WhatsApp `#25D366`, Instagram gradiente oficial só no ícone, e-mail neutro.

**Tema claro:** canvas `#F8F8F5`, superfície `#FFFFFF`, texto `#111114`. Lime nunca como texto → `#4C7A00` para texto/ícone de marca; `#B6FF00` só como preenchimento com `--lime-ink`. Violeta de texto `#4411AA`.

**Contraste:** AA em todos os pares; tabela gerada em `docs/brand/contraste.md` (script).

## Tipografia

- **Display:** Space Grotesk 500/700, tracking −2% a −3% — títulos de página, números-chave, hero do login, NICO. (Justificativa da substituição no topo.)
- **UI:** Manrope 400/500/600 (já carregada, variável 200–800 — sem custo novo).
- **Mono:** JetBrains Mono — IDs, chaves, horários, valores tabulares (OFL, vendida localmente como as demais).
- **Editorial:** Instrument Serif (mantida) só para acentos de marca (login, empty states hero).
- **Escala fechada (7):** 11/12/13/14/16/20/28 (+40/56 só login/hero). Corpo de UI 13px. `font-variant-numeric: tabular-nums` em dados.

## Forma e profundidade

Raios: 4 (badge) · 6 (controle) · 10 (card/popover) · 14 (modal/drawer) · full (avatar/pill). Espaçamento base 4px. Elevação no dark por luz (superfície mais clara + `inset 0 1px 0 rgba(255,255,255,.05)`); sombra só em overlays. Glass: `blur(16px) saturate(140%)` + `color-mix(in oklab, var(--surface-1) 72%, transparent)` + `--line-2`, com fallback `@supports not (backdrop-filter)`. Grão SVG 2–3% só nas áreas Aurora.

## Iconografia e ilustração

Lucide único, stroke 1.75, tamanhos 14/16/20 (verificar set atual: o projeto tem `components/icons.tsx` próprio — migrar ou adotar lucide, decidido na Fase 4.2 por custo). Ícones de IA ganham variante violeta. Empty states: ilustração SVG linear própria (traço 1.5px) com o gradiente assinatura em pontos de destaque.

## Brand board

Rota interna `/design-system` (app): logo, cores com contraste ao vivo, tipografia, gradientes, glass, ícones, ilustrações e componentes com todos os estados.

## Antipadrões reafirmados (do brief §9)

Sem neon em área grande · sem glow em todo card · sem gradiente atrás de tabela/form · sem glass em lista rolável · lime e violeta nunca competem na mesma ação · sem emoji como ícone · animação de interação ≤ 400 ms · cada efeito responde "comunica marca, estado ou hierarquia?" — senão, sai.
