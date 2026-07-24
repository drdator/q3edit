import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileMap } from '../src/q3map';

class FakeWorker {
  static messages: Array<Record<string, unknown>> = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: Record<string, unknown>): void {
    FakeWorker.messages.push(message);
    const options = message.options as { reuseBsp?: Uint8Array };
    queueMicrotask(() => {
      const stageStatus = options.reuseBsp ? 'reused' : 'success';
      this.onmessage?.({ data: { type: 'output', line: '=== Stage 1: BSP ===' } } as MessageEvent);
      this.onmessage?.({ data: { type: 'output', line: `=== Stage 1 result: ${stageStatus} (0 ms) ===` } } as MessageEvent);
      this.onmessage?.({
        data: {
          type: 'done',
          success: true,
          bsp: new Uint8Array([1, 2, 3, 4]),
          bspStage: options.reuseBsp ?? new Uint8Array([1, 2]),
          prtData: new Uint8Array([3]),
          aas: null,
          portalFileText: 'portal',
          pointfileText: null,
        },
      } as MessageEvent);
    });
  }

  terminate(): void {}
}

describe('q3map stage reuse', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWorker.messages = [];
  });

  it('reuses BSP output when only later-stage options change', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    await compileMap('map fixture', { lightArgs: ['-fast'] });
    const result = await compileMap('map fixture', { lightArgs: ['-extra'] });

    const secondOptions = FakeWorker.messages[1].options as { reuseBsp?: Uint8Array };
    expect([...secondOptions.reuseBsp!]).toEqual([1, 2]);
    expect(result.stages).toContainEqual({ stage: 'bsp', status: 'reused', durationMs: 0 });
  });
});
