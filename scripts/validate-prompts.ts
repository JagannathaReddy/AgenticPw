#!/usr/bin/env tsx
/**
 * Validate every prompt front-matter. Imports ops-prompts source directly so
 * CI does not require a prior `npm run build -w @poc/prompts`.
 */
import { validateAllPrompts } from '../packages/ops-prompts/src/loader.js';

async function main(): Promise<void> {
  const metas = await validateAllPrompts();
  console.log('✓', metas.length, 'prompts valid');
  for (const meta of metas) {
    console.log('  •', meta.id, '(' + meta.taskClass + ')');
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
