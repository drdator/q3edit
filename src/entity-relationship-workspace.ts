import type { Editor } from './editor';
import type { MapDocumentRef } from './map-operations';
import {
  analyzeEntityRelationships,
  entityRelationshipOverlayLines,
  type EntityGraphIssue,
  type EntityGraphNode,
  type EntityRelationshipAnalysis,
} from './entity-relationship-analysis';
import { selectDocumentRef } from './document-navigation';

function button(label: string, action: () => void): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button'; result.className = 'btn'; result.textContent = label; result.onclick = action;
  return result;
}

function select(options: Array<[string, string]>): HTMLSelectElement {
  const result = document.createElement('select');
  for (const [value, label] of options) result.appendChild(Object.assign(document.createElement('option'), { value, textContent: label }));
  return result;
}

function refButton(editor: Editor, ref: string): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button'; result.className = 'entity-logic-ref'; result.textContent = ref;
  result.onclick = () => selectDocumentRef(editor, ref as MapDocumentRef);
  return result;
}

function issueRow(editor: Editor, issue: EntityGraphIssue): HTMLElement {
  const row = document.createElement('div');
  row.className = `entity-logic-issue ${issue.severity}`;
  const header = document.createElement('div');
  header.append(
    Object.assign(document.createElement('span'), { className: 'diagnostic-severity', textContent: issue.severity }),
    Object.assign(document.createElement('strong'), { textContent: issue.message }),
  );
  const refs = document.createElement('div'); refs.className = 'entity-logic-refs';
  for (const ref of issue.refs) refs.appendChild(refButton(editor, ref));
  row.append(header, refs);
  return row;
}

function nodeRow(editor: Editor, node: EntityGraphNode, analysis: EntityRelationshipAnalysis): HTMLElement {
  const row = document.createElement('div');
  row.className = `entity-logic-node${node.selected ? ' selected' : ''}`;
  const main = button(node.label, () => selectDocumentRef(editor, node.ref as MapDocumentRef));
  main.classList.add('entity-logic-node-main');
  const properties = document.createElement('span');
  properties.textContent = [
    node.targetname && `targetname ${node.targetname}`,
    node.target && `target ${node.target}`,
    node.groupName && `group ${node.groupName}`,
    node.areaId && `area ${node.areaId}`,
  ].filter(Boolean).join(' · ') || 'No relationship properties';
  const outgoing = analysis.edges.filter(edge => edge.sourceRef === node.ref);
  const links = document.createElement('div'); links.className = 'entity-logic-node-links';
  for (const edge of outgoing) {
    links.append(document.createTextNode('→ '), refButton(editor, edge.targetRef), document.createTextNode(` ${edge.value} `));
  }
  row.append(main, properties, links);
  return row;
}

export function createEntityRelationshipWorkspace(editor: Editor): HTMLElement {
  const root = document.createElement('div');
  root.className = 'entity-relationship-workspace';
  let analysis = analyzeEntityRelationships(editor);
  const controls = document.createElement('div'); controls.className = 'entity-logic-controls';
  const query = document.createElement('input'); query.type = 'search'; query.placeholder = 'Search class, name, target, group, or area…';
  const severity = select([['all', 'All severities'], ['error', 'Errors'], ['warning', 'Warnings'], ['info', 'Info']]);
  const groupValues = [...new Set(analysis.nodes.map(node => node.groupName).filter((value): value is string => Boolean(value)))].sort();
  const group = select([['all', 'All groups'], ...groupValues.map(value => [value, value] as [string, string])]);
  const areaValues = [...new Set(analysis.nodes.map(node => node.areaId).filter((value): value is string => Boolean(value)))].sort();
  const area = select([['all', 'All areas'], ...areaValues.map(value => [value, value] as [string, string])]);
  const overlayControls = document.createElement('div'); overlayControls.className = 'entity-logic-overlays';
  const overlayState = { links: true, triggers: false, movement: false, jumps: false };
  for (const [key, label] of [['links', 'Relationships'], ['triggers', 'Trigger volumes'], ['movement', 'Movement bounds'], ['jumps', 'Jump trajectories']] as const) {
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = overlayState[key];
    input.onchange = () => { overlayState[key] = input.checked; updateOverlay(); };
    const wrapper = document.createElement('label'); wrapper.append(input, document.createTextNode(label)); overlayControls.appendChild(wrapper);
  }
  controls.append(query, severity, group, area, button('Refresh', () => {
    analysis = analyzeEntityRelationships(editor); render(); updateOverlay();
  }), overlayControls);

  const summary = document.createElement('div'); summary.className = 'diagnostics-summary entity-logic-summary';
  const content = document.createElement('div'); content.className = 'entity-logic-content';
  const updateOverlay = () => {
    editor.entityRelationshipOverlayLines = entityRelationshipOverlayLines(analysis, overlayState);
    editor.redrawRequested = true;
  };
  const render = () => {
    summary.innerHTML = '';
    for (const [label, value] of [
      ['Entities', analysis.nodes.length], ['Relationships', analysis.edges.length],
      ['Errors', analysis.issues.filter(issue => issue.severity === 'error').length],
      ['Warnings', analysis.issues.filter(issue => issue.severity === 'warning').length],
      ['Movers', analysis.movements.length], ['Simulations', analysis.simulations.length],
    ] as const) {
      const cell = document.createElement('div'); cell.innerHTML = `<span>${label}</span><strong>${value}</strong>`; summary.appendChild(cell);
    }
    content.innerHTML = '';
    const normalized = query.value.trim().toLowerCase();
    const issues = analysis.issues.filter(issue =>
      (severity.value === 'all' || issue.severity === severity.value) &&
      (!normalized || `${issue.message} ${issue.refs.join(' ')}`.toLowerCase().includes(normalized)));
    const issueSection = document.createElement('section');
    issueSection.appendChild(Object.assign(document.createElement('h3'), { textContent: `Relationship diagnostics (${issues.length})` }));
    if (issues.length === 0) issueSection.appendChild(Object.assign(document.createElement('p'), { textContent: 'No matching relationship issues.' }));
    else for (const issue of issues) issueSection.appendChild(issueRow(editor, issue));

    const nodes = analysis.nodes.filter(node => {
      if (group.value !== 'all' && node.groupName !== group.value) return false;
      if (area.value !== 'all' && node.areaId !== area.value) return false;
      return !normalized || `${node.label} ${node.target ?? ''} ${node.targetname ?? ''} ${node.groupName ?? ''} ${node.areaId ?? ''}`.toLowerCase().includes(normalized);
    });
    const graphSection = document.createElement('section');
    graphSection.appendChild(Object.assign(document.createElement('h3'), { textContent: `Target graph (${nodes.length} nodes)` }));
    for (const node of nodes) graphSection.appendChild(nodeRow(editor, node, analysis));

    const runtimeSection = document.createElement('section');
    runtimeSection.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Movement and activation simulation' }));
    for (const movement of analysis.movements) {
      const row = document.createElement('div'); row.className = 'entity-logic-runtime-row';
      row.append(refButton(editor, movement.ref), document.createTextNode(`${movement.classname} · ${movement.note}`)); runtimeSection.appendChild(row);
    }
    for (const simulation of analysis.simulations) {
      const details = document.createElement('details');
      const title = document.createElement('summary');
      title.textContent = `${simulation.rootRef} activation chain · ${simulation.steps.length} steps${simulation.truncated ? ' · cycle/limit reached' : ''}`;
      details.appendChild(title);
      for (const step of simulation.steps) {
        const row = document.createElement('div'); row.className = 'entity-logic-runtime-row';
        const timing = step.earliestSeconds === step.latestSeconds
          ? `${step.earliestSeconds.toFixed(2)}s`
          : `${step.earliestSeconds.toFixed(2)}–${step.latestSeconds.toFixed(2)}s`;
        row.append(refButton(editor, step.ref), document.createTextNode(`${timing} · ${step.classname}${step.note ? ` · ${step.note}` : ''}`));
        details.appendChild(row);
      }
      runtimeSection.appendChild(details);
    }
    if (analysis.movements.length === 0 && analysis.simulations.length === 0) {
      runtimeSection.appendChild(Object.assign(document.createElement('p'), { textContent: 'No movers or common activation roots found.' }));
    }
    content.append(issueSection, graphSection, runtimeSection);
  };
  query.oninput = render; severity.onchange = render; group.onchange = render; area.onchange = render;
  root.append(controls, summary, content);
  render(); updateOverlay();
  return root;
}
