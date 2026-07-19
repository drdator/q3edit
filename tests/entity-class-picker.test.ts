import { describe, expect, it } from 'vitest';
import { EntityClassRegistry, parseQuakedDefinitions } from '../src/entity-definitions';
import { filterPointEntityClasses, visibleEntityClassSelection } from '../src/entity-class-picker';

function registry(): EntityClassRegistry {
  const definitions = parseQuakedDefinitions(`
/*QUAKED info_player_start (1 0 1) (-16 -16 -24) (16 16 32)
Player spawn location
*/
/*QUAKED light (1 1 0) (-8 -8 -8) (8 8 8)
Illuminates nearby surfaces
*/
/*QUAKED trigger_once (0 0.5 0) ?
Brush trigger
*/
`).classes;
  return new EntityClassRegistry(definitions);
}

describe('entity class picker', () => {
  it('filters point entities by classname, description, or category', () => {
    const classes = (query: string) => filterPointEntityClasses(registry(), query)
      .flatMap(group => group.classes.map(definition => definition.classname));

    expect(classes('player')).toEqual(['info_player_start']);
    expect(classes('illuminates')).toEqual(['light']);
    expect(classes('lights')).toEqual(['light']);
    expect(classes('trigger')).toEqual([]);
  });

  it('keeps a visible selection and adopts the first match when filtering hides it', () => {
    const all = filterPointEntityClasses(registry(), '');
    const lights = filterPointEntityClasses(registry(), 'light');

    expect(visibleEntityClassSelection('light', all)).toBe('light');
    expect(visibleEntityClassSelection('info_player_start', lights)).toBe('light');
  });

  it('returns no selection when the filter has no matches', () => {
    expect(visibleEntityClassSelection('light', filterPointEntityClasses(registry(), 'missing'))).toBeNull();
  });
});
