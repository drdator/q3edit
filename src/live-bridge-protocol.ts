import type { EditorDiagnostic, EntityInfo, MapInfo } from './diagnostics';
import type { MapOperation, MapOperationResult } from './map-operations';

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
  | { type: 'mark_saved'; revision: number };

export type EditorToBridgeMessage =
  | { type: 'editor_ready'; snapshot: LiveMapSnapshot }
  | { type: 'document_changed'; label: string; snapshot: LiveMapSnapshot }
  | { type: 'operation_result'; requestId: string; result: MapOperationResult; snapshot: LiveMapSnapshot }
  | { type: 'document_replaced'; requestId: string; snapshot: LiveMapSnapshot }
  | { type: 'snapshot'; requestId: string; snapshot: LiveMapSnapshot }
  | { type: 'operation_error'; requestId: string; message: string; revision: number };
