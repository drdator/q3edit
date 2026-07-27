import type { Vec3 } from './math';

export type TransformDescriptor =
  | { kind: 'move'; delta: Vec3 }
  | { kind: 'rotate'; angleDeg: number; axis: number; centerMode: 'selection' }
  | { kind: 'scale'; scale: Vec3; centerMode: 'selection' }
  | { kind: 'flip'; axis: number; centerMode: 'selection' };

export function cloneTransformDescriptor(transform: TransformDescriptor): TransformDescriptor {
  if (transform.kind === 'move') return { kind: 'move', delta: [...transform.delta] };
  if (transform.kind === 'scale') {
    return { kind: 'scale', scale: [...transform.scale], centerMode: transform.centerMode };
  }
  return { ...transform };
}
