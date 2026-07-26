import { parseMapWithDiagnostics } from './mapfile';

self.onmessage = (event: MessageEvent<{ requestId: string; text: string }>) => {
  try {
    self.postMessage({ requestId: event.data.requestId, result: parseMapWithDiagnostics(event.data.text) });
  } catch (error) {
    self.postMessage({
      requestId: event.data.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
