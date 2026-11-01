// Derived from talktome public/client.js chooseProduction @ bbb8e09.

export type Production = {
  id: number;
  name: string;
};

export type ProductionChoice = {
  id: number | null;
  name: string;
};

export const DEFAULT_PRODUCTION: ProductionChoice = { id: null, name: 'Default' };

export function productionChoices(productions: Production[]): ProductionChoice[] {
  // A nonempty list contains the user's assigned productions. A missing
  // Default entry is not permission to add it. Legacy servers without a list
  // retain their implicit default production.
  return productions.length > 0 ? [...productions] : [DEFAULT_PRODUCTION];
}

export function resolveProduction(
  productions: Production[],
  id: number | null,
): ProductionChoice {
  if (id === null) {
    return DEFAULT_PRODUCTION;
  }
  return productions.find((item) => item.id === id) ?? DEFAULT_PRODUCTION;
}

export function visibleProductionName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed || trimmed.toLowerCase() === 'default') {
    return null;
  }
  return trimmed;
}

export function parseProductions(value: unknown): Production[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const row = item as { id?: unknown; name?: unknown };
    const id = Number(row.id);
    if (!Number.isFinite(id) || typeof row.name !== 'string') {
      return [];
    }
    return [{ id, name: row.name }];
  });
}

export function parseProductionId(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
}
