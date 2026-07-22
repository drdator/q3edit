import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;

describe('Q3Edit Codex plugin', () => {
  it('publishes the bundled skill and live MCP connection', () => {
    const plugin = readJson<{
      name: string;
      skills: string;
      mcpServers: string;
    }>('../plugins/q3edit/.codex-plugin/plugin.json');
    const mcp = readJson<{
      mcpServers: { q3edit: { type: string; url: string } };
    }>('../plugins/q3edit/.mcp.json');
    const marketplace = readJson<{
      name: string;
      plugins: Array<{ name: string; source: { path: string } }>;
    }>('../.agents/plugins/marketplace.json');

    expect(plugin).toMatchObject({
      name: 'q3edit',
      skills: './skills/',
      mcpServers: './.mcp.json',
    });
    expect(mcp.mcpServers.q3edit).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:8765/mcp',
    });
    expect(marketplace).toMatchObject({
      name: 'q3edit',
      plugins: [{ name: 'q3edit', source: { path: './plugins/q3edit' } }],
    });
  });

  it('routes live map requests ahead of generic UI automation', () => {
    const skill = readFileSync(
      new URL(
        '../plugins/q3edit/skills/q3edit-map-authoring/SKILL.md',
        import.meta.url,
      ),
      'utf8',
    );
    const metadata = readFileSync(
      new URL(
        '../plugins/q3edit/skills/q3edit-map-authoring/agents/openai.yaml',
        import.meta.url,
      ),
      'utf8',
    );

    expect(skill).toContain('the current Q3Edit map');
    expect(skill).toContain('Prefer Q3Edit MCP over browser, computer-use');
    expect(skill).toContain('Do not operate the web UI.');
    expect(metadata).toContain('allow_implicit_invocation: true');
    expect(metadata).toContain('value: "q3edit"');
  });
});
