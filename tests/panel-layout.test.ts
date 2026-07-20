import { describe, expect, it } from 'vitest';
import { soloPanelCollapseState } from '../src/panel-layout';

describe('panel layout', () => {
  it('expands the soloed panel and collapses every other docked panel', () => {
    expect(soloPanelCollapseState(
      ['brush-panel', 'groups-panel', 'camera-panel', 'entity-panel', 'texture-panel'],
      'entity-panel',
    )).toEqual({
      'brush-panel': true,
      'groups-panel': true,
      'camera-panel': true,
      'entity-panel': false,
      'texture-panel': true,
    });
  });
});
