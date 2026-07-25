import { describe, expect, it } from 'vitest';
import {
  precedingReviewRun,
  runDesignReview,
  type ReviewRun,
} from '../src/design-review-workspace';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';

describe('design review workspace', () => {
  it('compares a historical review with the next older review', () => {
    const history = [
      { id: 'newest' },
      { id: 'middle' },
      { id: 'oldest' },
    ] as ReviewRun[];
    expect(precedingReviewRun(history, 'newest')?.id).toBe('middle');
    expect(precedingReviewRun(history, 'middle')?.id).toBe('oldest');
    expect(precedingReviewRun(history, 'oldest')).toBeNull();
  });

  it('derives diagnostics and map information from an unapplied preview', () => {
    const current = new Editor();
    const broken = createEntity('trigger_once');
    broken.properties.target = 'missing';
    current.entities.push(broken);

    const preview = new Editor();
    const result = runDesignReview(current, preview.serializeMap(), 'preview');

    expect(result.findings.some(finding => finding.code === 'broken-target')).toBe(false);
    expect(result.statistics.geometry.totalBrushes).toBe(0);
  });
});
