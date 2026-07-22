import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('landing page', () => {
  it('never wraps or shrinks its call-to-action buttons', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    const buttonRule = [...css.matchAll(/\.landing-button\s*\{([^}]*)\}/g)]
      .map(match => match[1])
      .find(rule => rule.includes('display: inline-flex'));

    expect(buttonRule).toContain('flex: 0 0 auto');
    expect(buttonRule).toContain('white-space: nowrap');
  });

  it('uses Phosphor icons in its call-to-action buttons', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

    expect(html).toContain('class="ph ph-arrow-right"');
    expect(html).toContain('class="ph ph-arrow-square-out"');
    expect(html).not.toMatch(/landing-button[^>]*>[\s\S]*?<span[^>]*>[→↗]<\/span>/);
  });
});
