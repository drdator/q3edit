import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  runComplexMapBenchmark,
  type ComplexMapFixtureSize,
} from '../src/complex-map-performance';

const sizes: ComplexMapFixtureSize[] = process.argv.includes('--all')
  ? ['small', 'medium', 'large', 'stress']
  : [((process.argv.find(value => ['small', 'medium', 'large', 'stress'].includes(value)) ?? 'medium') as ComplexMapFixtureSize)];
const reports = sizes.map(runComplexMapBenchmark);
const outputFlag = process.argv.indexOf('--output');
if (outputFlag >= 0 && process.argv[outputFlag + 1]) {
  const path = resolve(process.argv[outputFlag + 1]);
  await writeFile(path, JSON.stringify(reports, null, 2));
  console.log(`Wrote ${path}`);
}
for (const report of reports) {
  console.log(`\n${report.fixture.toUpperCase()} · ${report.counts.brushes} brushes · ${report.counts.faces} faces`);
  for (const item of report.metrics) {
    console.log(`${item.status === 'pass' ? 'PASS' : 'OVER'} ${item.name.padEnd(32)} ${item.milliseconds.toFixed(2).padStart(9)} ms / ${item.budgetMilliseconds.toFixed(1)} ms (${item.budgetClass})`);
  }
}
if (reports.some(report => report.metrics.some(item => item.status === 'over-budget'))) process.exitCode = 1;
