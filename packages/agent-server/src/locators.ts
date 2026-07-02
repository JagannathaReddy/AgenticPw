import type { LearnedLocator } from './types.js';

export function locatorPlaywrightExpr(loc: LearnedLocator, page = 'page'): string {
  switch (loc.kind) {
    case 'placeholder':
      return `${page}.getByPlaceholder('${loc.value.replace(/'/g, "\\'")}')`;
    case 'label':
      return `${page}.getByLabel('${loc.value.replace(/'/g, "\\'")}')`;
    case 'testId':
      return `${page}.getByTestId('${loc.value.replace(/'/g, "\\'")}')`;
    case 'role':
      return loc.name?.includes('(')
        ? `${page}.getByRole('${loc.value}', { name: /${loc.name.replace(/[()]/g, '')}/i })`
        : `${page}.getByRole('${loc.value}', { name: '${(loc.name ?? loc.value).replace(/'/g, "\\'")}' })`;
    default:
      return `${page}.locator('body')`;
  }
}
