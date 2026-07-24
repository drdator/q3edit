import {
  collectComplexMapCounts,
  runComplexMapBenchmark,
  type ComplexMapBenchmarkReport,
  type ComplexMapFixtureSize,
} from './complex-map-performance';
import type { Editor } from './editor';

function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Unavailable';
  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit++; }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function download(report: ComplexMapBenchmarkReport): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `q3edit-${report.fixture}-map-benchmark.json`; link.click();
  URL.revokeObjectURL(url);
}

export function createPerformanceWorkspace(editor: Editor): HTMLElement {
  const root = document.createElement('div'); root.className = 'performance-workspace';
  const current = collectComplexMapCounts(editor);
  const currentSummary = document.createElement('div'); currentSummary.className = 'diagnostics-summary performance-summary';
  for (const [label, value] of [
    ['Entities', current.entities], ['Brushes', current.brushes], ['Faces', current.faces],
    ['Patches', current.patches], ['Patch controls', current.patchControlPoints], ['Textures', current.textures],
  ] as const) {
    const item = document.createElement('div'); item.innerHTML = `<span>${label}</span><strong>${value.toLocaleString()}</strong>`; currentSummary.appendChild(item);
  }
  const textureMemory = editor.textureManager?.memoryStats();
  const assetMemory = editor.textureManager?.assetMemoryStats();
  const modelMemory = editor.modelManager?.memoryStats();
  const currentMemory = document.createElement('div'); currentMemory.className = 'performance-current-memory';
  currentMemory.innerHTML = `<h3>Current editor memory</h3>
    <span>Spatial index <strong>${bytes(editor.spatialIndex().estimatedBytes())}</strong></span>
    <span>Decoded assets <strong>${bytes(assetMemory?.decodedBytes)}</strong> / ${bytes(assetMemory?.decodedLimitBytes)}</span>
    <span>Texture GPU estimate <strong>${bytes(textureMemory?.estimatedGpuBytes)}</strong></span>
    <span>Models <strong>${bytes(modelMemory?.estimatedBytes)}</strong></span>
    <span>Compile worker <strong>isolated and released after each build</strong></span>`;
  const controls = document.createElement('div'); controls.className = 'performance-controls';
  const fixture = document.createElement('select');
  for (const value of ['small', 'medium', 'large', 'stress'] as ComplexMapFixtureSize[]) {
    fixture.appendChild(Object.assign(document.createElement('option'), { value, textContent: `${value[0].toUpperCase()}${value.slice(1)} fixture` }));
  }
  fixture.value = current.brushes > 2_048 ? 'stress' : current.brushes > 512 ? 'large' : current.brushes > 64 ? 'medium' : 'small';
  const run = document.createElement('button'); run.type = 'button'; run.className = 'btn primary'; run.textContent = 'Run benchmark';
  const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.className = 'btn'; exportButton.textContent = 'Export report'; exportButton.disabled = true;
  const status = document.createElement('span'); status.textContent = 'Benchmarks use generated maps and do not alter the current document.';
  controls.append(fixture, run, exportButton, status);
  const results = document.createElement('div'); results.className = 'performance-results';
  let report: ComplexMapBenchmarkReport | null = null;
  const render = () => {
    results.innerHTML = '';
    if (!report) return;
    const memory = document.createElement('section');
    memory.innerHTML = `<h3>Memory instrumentation</h3>
      <div class="performance-memory">
        <span>Map text <strong>${bytes(report.memory.mapTextBytes)}</strong></span>
        <span>Document estimate <strong>${bytes(report.memory.estimatedDocumentBytes)}</strong></span>
        <span>Spatial index <strong>${bytes(report.memory.spatialIndexBytes)}</strong></span>
        <span>JavaScript heap <strong>${bytes(report.memory.jsHeapBytes)}</strong></span>
        <span>Texture GPU estimate <strong>${bytes(report.memory.textures?.estimatedGpuBytes)}</strong></span>
        <span>Decoded asset cache <strong>${bytes(report.memory.assets?.decodedBytes)}</strong></span>
        <span>Decoded models <strong>${bytes(report.memory.models?.estimatedBytes)}</strong></span>
      </div>`;
    const table = document.createElement('table'); table.className = 'performance-table';
    table.innerHTML = '<thead><tr><th>Workload</th><th>Measured</th><th>Budget</th><th>Status</th><th>Detail</th></tr></thead>';
    const body = document.createElement('tbody');
    for (const item of report.metrics) {
      const row = document.createElement('tr'); row.className = item.status;
      row.innerHTML = `<td>${item.name}</td><td>${item.milliseconds.toFixed(2)} ms</td><td>${item.budgetMilliseconds.toFixed(1)} ms</td><td>${item.status}</td><td>${item.detail ?? ''}</td>`;
      body.appendChild(row);
    }
    table.appendChild(body);
    results.append(memory, table);
  };
  run.onclick = () => {
    run.disabled = true; status.textContent = 'Running…';
    requestAnimationFrame(() => {
      try {
        report = runComplexMapBenchmark(fixture.value as ComplexMapFixtureSize);
        const over = report.metrics.filter(item => item.status === 'over-budget').length;
        status.textContent = over ? `${over} workload${over === 1 ? '' : 's'} over budget` : 'All measured workloads are within budget';
        exportButton.disabled = false; render();
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        run.disabled = false;
      }
    });
  };
  exportButton.onclick = () => { if (report) download(report); };
  root.append(currentSummary, currentMemory, controls, results);
  return root;
}
