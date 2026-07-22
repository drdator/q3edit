import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MCP_INSTALLATION_URL } from '../src/live-bridge/connection-dialog';

describe('MCP discovery', () => {
  it('links the connection dialog to the canonical installation guide', () => {
    expect(MCP_INSTALLATION_URL).toBe(
      'https://github.com/drdator/q3edit/blob/main/docs/LIVE_MCP.md#start-the-bridge',
    );
  });

  it('introduces live MCP authoring on the crawlable landing page', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('Live MCP authoring');
    expect(html).toContain('Build maps with Codex or Claude.');
    expect(html).toContain(MCP_INSTALLATION_URL);
    expect(html).toContain('View → Local MCP Connection');
  });
});
