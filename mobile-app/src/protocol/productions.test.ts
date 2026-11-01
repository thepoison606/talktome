import { describe, expect, it } from 'vitest';

import { DEFAULT_PRODUCTION, parseProductionId, parseProductions, productionChoices, resolveProduction, visibleProductionName } from './productions';

describe('productionChoices', () => {
  it('offers only assigned productions when Default is not assigned', () => {
    expect(
      productionChoices([
        { id: 2, name: 'Test-von-Adi' },
        { id: 1, name: 'Studio' },
      ]),
    ).toEqual([
      { id: 2, name: 'Test-von-Adi' },
      { id: 1, name: 'Studio' },
    ]);
  });

  it('retains implicit Default for legacy servers without a production list', () => {
    expect(productionChoices([])).toEqual([DEFAULT_PRODUCTION]);
  });

  it('does not double Default when the server announces one', () => {
    expect(
      productionChoices([
        { id: 1, name: 'Default' },
        { id: 2, name: 'Studio' },
      ]),
    ).toEqual([
      { id: 1, name: 'Default' },
      { id: 2, name: 'Studio' },
    ]);
  });
});

describe('resolveProduction', () => {
  it('falls back to Default when the id is missing', () => {
    expect(resolveProduction([{ id: 2, name: 'Test-von-Adi' }], 99)).toEqual(DEFAULT_PRODUCTION);
    expect(resolveProduction([{ id: 2, name: 'Test-von-Adi' }], null).name).toBe('Default');
  });
});

describe('visibleProductionName', () => {
  it('hides Default and empty names', () => {
    expect(visibleProductionName('Default')).toBeNull();
    expect(visibleProductionName('default')).toBeNull();
    expect(visibleProductionName(null)).toBeNull();
    expect(visibleProductionName('Studio 2')).toBe('Studio 2');
  });
});

describe('parseProductions', () => {
  it('keeps numeric ids and names', () => {
    expect(parseProductions([{ id: '4', name: 'Studio' }, { id: 1 }])).toEqual([{ id: 4, name: 'Studio' }]);
  });
});

describe('parseProductionId', () => {
  it('accepts numbers and numeric strings', () => {
    expect(parseProductionId(4)).toBe(4);
    expect(parseProductionId('4')).toBe(4);
    expect(parseProductionId(null)).toBeNull();
    expect(parseProductionId('')).toBeNull();
  });
});
