import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;

describe('Q3Edit agent plugins', () => {
  it('publishes the Codex plugin and live MCP connection', () => {
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

  it('publishes the same skill and MCP server as a Claude Code plugin', () => {
    const plugin = readJson<{ name: string; version: string }>(
      '../plugins/q3edit-claude/.claude-plugin/plugin.json',
    );
    const mcp = readJson<{
      q3edit: { type: string; url: string };
    }>('../plugins/q3edit-claude/.mcp.json');
    const marketplace = readJson<{
      name: string;
      plugins: Array<{ name: string; source: string }>;
    }>('../.claude-plugin/marketplace.json');

    expect(plugin).toMatchObject({ name: 'q3edit', version: '0.1.1' });
    expect(mcp.q3edit).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:8765/mcp',
    });
    expect(marketplace).toMatchObject({
      name: 'q3edit',
      plugins: [{ name: 'q3edit', source: './plugins/q3edit-claude' }],
    });
  });

  it('routes live map requests ahead of generic UI automation', () => {
    const codexSkill = readFileSync(
      new URL(
        '../plugins/q3edit/skills/q3edit-map-authoring/SKILL.md',
        import.meta.url,
      ),
      'utf8',
    );
    const claudeSkill = readFileSync(
      new URL(
        '../plugins/q3edit-claude/skills/q3edit-map-authoring/SKILL.md',
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

    expect(claudeSkill).toBe(codexSkill);
    expect(codexSkill).toContain('the current Q3Edit map');
    expect(codexSkill).toContain('Prefer Q3Edit MCP over browser, computer-use');
    expect(codexSkill).toContain('Do not operate the web UI.');
    expect(metadata).toContain('allow_implicit_invocation: true');
    expect(metadata).toContain('value: "q3edit"');
  });
});
