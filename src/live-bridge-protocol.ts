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

export type BridgeToEditorMessage =
  | {
      type: 'apply_operations';
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
  | { type: 'request_snapshot'; requestId: string }
  | { type: 'texture_search'; requestId: string; query: string; limit: number }
  | { type: 'texture_preview'; requestId: string; name: string }
  | { type: 'entity_class_search'; requestId: string; query: string; classType?: 'point' | 'brush'; limit: number }
  | { type: 'entity_class_schema'; requestId: string; classname: string }
  | { type: 'editor_select'; requestId: string; refs: string[]; replace: boolean }
  | { type: 'editor_frame_objects'; requestId: string; refs: string[] }
  | { type: 'editor_set_camera'; requestId: string; position: Vec3; yaw: number; pitch: number }
  | { type: 'editor_screenshot'; requestId: string; width?: number; height?: number }
  | { type: 'mark_saved'; revision: number };

export type EditorToBridgeMessage =
  | { type: 'editor_ready'; snapshot: LiveMapSnapshot }
  | { type: 'document_changed'; label: string; snapshot: LiveMapSnapshot }
  | { type: 'operation_result'; requestId: string; result: MapOperationResult; snapshot: LiveMapSnapshot }
  | { type: 'document_replaced'; requestId: string; snapshot: LiveMapSnapshot }
  | { type: 'snapshot'; requestId: string; snapshot: LiveMapSnapshot }
  | { type: 'capability_result'; requestId: string; result: unknown }
  | { type: 'operation_error'; requestId: string; message: string; revision: number };
