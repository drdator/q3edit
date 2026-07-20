export type PanelCollapseState = Record<string, boolean>;

export function soloPanelCollapseState(panelIds: readonly string[], targetId: string): PanelCollapseState {
  return Object.fromEntries(panelIds.map(id => [id, id !== targetId]));
}
