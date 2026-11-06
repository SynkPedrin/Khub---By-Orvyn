// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

// Regressão: `useLabel(...)` (alias de `t`) dentro de um .map violava react-hooks/rules-of-hooks
// e quebrava `next lint`. Roda o ESLint REAL do projeto nos arquivos tocados.
describe('regras de hooks nas telas de configurações', () => {
  it('configuracoes/page.tsx e TagsTab.tsx não têm erros de lint (rules-of-hooks incluída)', async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const resultados = await eslint.lintFiles(['app/(app)/configuracoes/page.tsx', 'components/settings/TagsTab.tsx']);
    const erros = resultados.flatMap((r) => r.messages.filter((m) => m.severity === 2).map((m) => `${r.filePath.split('/').pop()}:${m.line} ${m.ruleId} ${m.message}`));
    expect(erros).toEqual([]);
  }, 60_000);
});
