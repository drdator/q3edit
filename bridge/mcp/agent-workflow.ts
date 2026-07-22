import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const AGENT_WORKFLOW = `# Q3Edit MCP workflow

1. Resolve the intended editor with \`editor_sessions\`, then inspect \`map_status\`, \`map_summary\`, \`map_style_get\`, and \`map_spatial_plan_get\`.
   If the user refers to their current selection, call \`editor_selection\` first and use its returned revision and references instead of guessing what they mean.
2. Discover entity classes, textures, shaders, and exact operation schemas. Do not guess names or properties.
3. For substantial maps, establish semantic areas, connections, height changes, routes, and landmarks before detailed geometry. Use design patterns as adaptable constraints, never fixed prefabs.
4. Prefer angled, curved, terraced, and path-based construction where it supports the layout. Refine safe blockouts with chamfer, taper, face offset, clipping, hollowing, and CSG instead of leaving every room box-shaped.
5. Preview related operations as one batch, including relevant reviews, then apply them atomically with the returned revision. Use symbolic IDs inside a batch and persistent named groups afterward. If an applied direction is visually poor, use revision-checked \`map_undo\` instead of destructively reconstructing the prior map.
6. Treat UV projection as part of geometry. Fit focal one-image surfaces, preserve intentional tiling on large walls/floors, use semantic per-face transforms, and run \`map_texture_review\`.
7. After major edits run \`map_design_review\`, capture perspective and orthographic views with \`editor_review\`, and revise weak routes, repeated dimensions, flat silhouettes, or texture problems before decoration.
8. Save and compile, then use \`map_play({useLastCompile:true})\` while the revision is unchanged. Wait for verified play-preview readiness, target a useful spawn/entity view, and inspect a game screenshot before finalizing.
9. When a compiler or review warning is unclear, pass its code, message, severity, and refs to \`diagnostic_explain\` before guessing at a repair.
`;

export function registerAgentWorkflowResource(server: McpServer): void {
  server.registerResource('Q3Edit agent workflow', 'q3edit://agent-workflow', {
    title: 'Q3Edit MCP map-authoring workflow',
    description: 'Shared workflow and quality guidance for agents editing Quake 3 maps through Q3Edit.',
    mimeType: 'text/markdown',
  }, uri => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: AGENT_WORKFLOW }],
  }));
}
