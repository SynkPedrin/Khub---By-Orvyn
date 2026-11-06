# Brand Assets — auditoria (Brand Integration Pass)

Estado real dos assets de marca usados em `apps/web`, levantado antes de qualquer
integração visual. Sem invenção de caminho: cada item abaixo é o que **existe**
no repositório, não o que o brief pedia idealmente.

## O que existe

| Asset | Caminho real | Uso |
|---|---|---|
| Símbolo ORVYN (ícone) | `apps/web/public/logo.png` | Único arquivo de marca gráfica real. Usado no Sidebar, AuthShell (desktop e mobile). |
| Vídeo de cristal | `apps/web/public/crystal-video.mp4` | É o `videoROXO.mp4` fornecido pelo usuário — MD5 idêntico ao original, confirmado bit a bit antes de renomear. Renomeado para refletir o conteúdo (cristal roxo), não o nome do arquivo de origem. |
| Poster do login | `apps/web/public/Background-login.png` | Frame estático pré-existente, usado como poster/fallback do vídeo no `AuthShell`. |

## O que NÃO existe (documentado, não fabricado)

- **Não existe um arquivo de logotipo "ORVYN Revenue OS"** (wordmark oficial do
  produto, distinto do wordmark corporativo "ORVYN"). Não foi criado nenhum
  substituto em CSS/texto fazendo-se passar por logo oficial — onde a marca do
  produto precisa aparecer, usa-se o símbolo real (`logo.png`) + tipografia
  (`OrvynMark`), nunca um arquivo inventado.
- **NYRO não tem asset de logo próprio.** Mantém identidade só tipográfica
  (nome "NYRO" em componentes como `CommandBar`), sem ganhar nenhum elemento
  visual do Revenue OS — não foi criado um logo para preencher essa lacuna.
- **O vídeo não está otimizado para streaming** (`moov` atom a ~99,8% do
  arquivo, não no início — verificado via parsing manual dos átomos MP4, sem
  `ffmpeg`/`ffprobe` disponíveis neste ambiente). Efeito prático: o navegador
  não consegue tocar progressivamente enquanto baixa; o arquivo precisa
  chegar quase inteiro antes do primeiro frame. Mitigado no componente
  (`OrvynBrandMotion`) com poster instantâneo + crossfade só no `onCanPlay` +
  carregamento adiado (`requestIdleCallback`) fora do login. Resolver na raiz
  exigiria reexportar com `ffmpeg -movflags +faststart`, fora do escopo desta
  sessão por falta de ferramenta no ambiente.
- **Sidebar não tem estado "recolhido"** — o brief pedia comportamento
  "símbolo-only quando colapsada", mas essa feature de collapse não existe no
  componente atual. Não foi implementada como parte deste pass (fora de
  escopo: seria uma mudança estrutural de navegação, não de branding).

## Componentes de marca legados (não tocados, candidatos a remoção)

Encontrados durante a auditoria, confirmados como código morto (sem import
ativo em nenhuma rota): `TopCenterLogo.tsx`, `DynamicIsland`, `NyroDock`,
`components/Logo.tsx`. Não foram removidos nesta sessão — escopo desta pass
era aplicar assets existentes, não fazer limpeza de código morto.
