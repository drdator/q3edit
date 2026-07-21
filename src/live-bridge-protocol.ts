import type { EditorDiagnostic, EntityInfo, MapInfo } from './diagnostics';
import type { MapOperation, MapOperationResult } from './map-operations';
import type { Vec3 } from './math';

export interface LiveMapSnapshot {
  fileName: string;
  mapText: string;
  revision: number;
  mapInfo: MapInfo;
  entities: EntityInfo[];
  diagnostics: EditorDiagnostic[];
}

export interface ScreenshotBounds {
  mins: Vec3;
  maxs: Vec3;
}

export interface EditorScreenshotOptions {
  mode?: 'perspective' | 'top' | 'front' | 'side';
  width?: number;
  height?: number;
  hideEntityMarkers?: boolean;
  hideGroups?: string[];
  hideToolBrushes?: boolean;
  hideSkyBrushes?: boolean;
  sectionBounds?: ScreenshotBounds;
  frameBounds?: ScreenshotBounds;
  frameGroup?: string;
  xray?: boolean;
  showEntityLabels?: boolean;
  showCoordinates?: boolean;
  layoutOverlay?: boolean;
}

export interface GamePreviewStatus {
  state: 'idle' | 'preparing' | 'loading' | 'running' | 'error' | 'closed';
  message: string;
  mapName: string | null;
  noclip: boolean;
  launchedAt: string | null;
  runningAt: string | null;
  error: string | null;
  consoleTail: string[];
  renderer: { context: string; width: number; height: number; preserveDrawingBuffer: boolean } | null;
}

export interface GameScreenshot {
  mimeType: string;
  data: string;
  width: number;
  height: number;
  blackFrame: boolean;
  meanLuminance: number;
  status: GamePreviewStatus;
}

export interface McpActivityEntry {
  id: string;
  timestamp: string;
  mcpSessionId: string;
  editorSessionId: string | null;
  tool: string;
  readOnly: boolean;
  durationMs: number;
  status: 'success' | 'error';
  revisionBefore: number | null;
  revisionAfter: number | null;
  revisionDelta: number | null;
  arguments: unknown;
  result: unknown;
}

export type BridgeToEditorMessage =
  | { type: 'mcp_activity'; entry: McpActivityEntry }
  | {
      type: 'apply_operations';
      requestId: string;
      expectedRevision: number;
      label: string;
      operations: MapOperation[];
    }
  | {
      type: 'preview_operations';
      requestId: string;
      expectedRevision: number;
      label: string;
      operations: MapOperation[];
    }
  | {
      type: 'replace_document';
      requestId: string;
      fileName: string;
      mapText: string;
    }
  | {
      type: 'new_document';
      requestId: string;
      expectedRevision: number;
      template: 'empty' | 'starter';
      preserveWorldspawn: boolean;
      worldspawnProperties?: Record<string, string>;
      fileName: string;
    }
  | { type: 'request_snapshot'; requestId: string }
  | { type: 'texture_search'; requestId: string; query: string; limit: number }
  | { type: 'texture_preview'; requestId: string; name: string }
  | { type: 'texture_inspect'; requestId: string; name: string }
  | { type: 'entity_class_search'; requestId: string; query: string; classType?: 'point' | 'brush'; limit: number }
  | { type: 'entity_class_schema'; requestId: string; classname: string }
  | { type: 'editor_select'; requestId: string; refs: string[]; replace: boolean }
  | { type: 'editor_frame_objects'; requestId: string; refs: string[] }
  | { type: 'editor_set_camera'; requestId: string; position: Vec3; yaw: number; pitch: number }
  | ({ type: 'editor_screenshot'; requestId: string } & EditorScreenshotOptions)
  | { type: 'editor_capabilities'; requestId: string }
  | { type: 'map_compile'; requestId: string; quality: 'fast' | 'normal' | 'full'; includeArtifact?: boolean }
  | { type: 'map_play'; requestId: string; noclip: boolean }
  | { type: 'game_status'; requestId: string }
  | { type: 'game_wait_ready'; requestId: string; timeoutMs: number }
  | { type: 'game_command'; requestId: string; command: 'noclip' | 'restart' }
  | { type: 'game_set_view'; requestId: string; position: Vec3; yaw: number }
  | { type: 'game_screenshot'; requestId: string }
  | { type: 'mark_saved'; revision: number; fileName?: string };

export type EditorToBridgeMessage =
  | { type: 'editor_ready'; snapshot: LiveMapSnapshot }
  | { type: 'document_changed'; label: string; snapshot: LiveMapSnapshot }
  | { type: 'operation_result'; requestId: string; result: MapOperationResult; snapshot: LiveMapSnapshot }
  | { type: 'document_replaced'; requestId: string; snapshot: LiveMapSnapshot }
  | { type: 'snapshot'; requestId: string; snapshot: LiveMapSnapshot }
  | { type: 'capability_result'; requestId: string; result: unknown }
  | { type: 'operation_error'; requestId: string; message: string; revision: number };
