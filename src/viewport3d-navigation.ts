import { Vec3, vec3Add, vec3Copy, vec3Dot, vec3Length, vec3Scale, vec3Sub } from './math';
import { Editor } from './editor';
import { CROUCH_VIEWHEIGHT, PHYSICS_STEP, TraceFn, TraceResult, VIEWHEIGHT, WalkState, pmove } from './q3-movement';

export interface Viewport3DNavigationContext {
  editor: Editor;
  fullscreen: boolean;
  fullscreenMode: 'walk' | 'fly' | 'edit';
  looking: boolean;
  keys: Set<string>;
  moveSpeed: number;
  position: Vec3;
  yaw: number;
  pitch: number;
  walkState: WalkState | null;
  physicsAccum: number;
  walkStepSmooth: number;
  walkViewH: number;
  walkLandChange: number;
  walkLandTime: number;
  walkBobCycle: number;
}

export interface Viewport3DNavigationUpdate {
  position: Vec3;
  physicsAccum: number;
  walkStepSmooth: number;
  walkViewH: number;
  walkLandChange: number;
  walkLandTime: number;
  walkBobCycle: number;
  dirty: boolean;
}

export function getViewport3DForward(yaw: number, pitch: number): Vec3 {
  return [
    Math.cos(yaw) * Math.cos(pitch),
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
  ];
}

export function getViewport3DRight(yaw: number): Vec3 {
  return [
    Math.cos(yaw - Math.PI / 2),
    Math.sin(yaw - Math.PI / 2),
    0,
  ];
}

export function centerViewport3DOnSelection(editor: Editor, yaw: number, pitch: number): Vec3 | null {
  const bounds = editor.selectionBounds();
  if (!bounds) return null;
  const center: Vec3 = [
    (bounds.mins[0] + bounds.maxs[0]) / 2,
    (bounds.mins[1] + bounds.maxs[1]) / 2,
    (bounds.mins[2] + bounds.maxs[2]) / 2,
  ];
  const size = vec3Length(vec3Sub(bounds.maxs, bounds.mins));
  const dist = Math.max(size * 1.5, 128);
  const forward = getViewport3DForward(yaw, pitch);
  return vec3Sub(center, vec3Scale(forward, dist));
}

function traceViewport3DPlayerBox(editor: Editor, start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3): TraceResult {
  const cx = (mins[0] + maxs[0]) * 0.5;
  const cy = (mins[1] + maxs[1]) * 0.5;
  const cz = (mins[2] + maxs[2]) * 0.5;
  const hx = (maxs[0] - mins[0]) * 0.5;
  const hy = (maxs[1] - mins[1]) * 0.5;
  const hz = (maxs[2] - mins[2]) * 0.5;

  const ts: Vec3 = [start[0] + cx, start[1] + cy, start[2] + cz];
  const te: Vec3 = [end[0] + cx, end[1] + cy, end[2] + cz];

  let bestFrac = 1.0;
  let bestNormal: Vec3 = [0, 0, 1];

  for (const { brush } of editor.allBrushes()) {
    if (brush.maxs[0] < Math.min(ts[0], te[0]) - hx || brush.mins[0] > Math.max(ts[0], te[0]) + hx ||
        brush.maxs[1] < Math.min(ts[1], te[1]) - hy || brush.mins[1] > Math.max(ts[1], te[1]) + hy ||
        brush.maxs[2] < Math.min(ts[2], te[2]) - hz || brush.mins[2] > Math.max(ts[2], te[2]) + hz) continue;

    let enterFrac = -1.0;
    let leaveFrac = 1.0;
    let enterNormal: Vec3 = [0, 0, 1];
    let startsOut = false;
    let endsOut = false;

    for (const face of brush.faces) {
      const n = face.plane.normal;
      const expand = hx * Math.abs(n[0]) + hy * Math.abs(n[1]) + hz * Math.abs(n[2]);

      const d1 = vec3Dot(n, ts) - face.plane.dist - expand;
      const d2 = vec3Dot(n, te) - face.plane.dist - expand;

      if (d1 > 0) startsOut = true;
      if (d2 > 0) endsOut = true;

      if (d1 > 0 && (d2 >= 0.125 || d2 >= d1)) { enterFrac = 2; break; }
      if (d1 <= 0 && d2 <= 0) continue;

      if (d1 > d2) {
        const ef = (d1 - 0.125) / (d1 - d2);
        if (ef > enterFrac) {
          enterFrac = Math.max(0, ef);
          enterNormal = face.plane.normal;
        }
      } else {
        const lf = (d1 + 0.125) / (d1 - d2);
        if (lf < leaveFrac) leaveFrac = Math.min(1, lf);
      }
    }

    if (!startsOut) {
      if (!endsOut) {
        return { fraction: 0, endPos: vec3Copy(start), normal: [0, 0, 1], allSolid: true };
      }
      continue;
    }

    if (enterFrac < leaveFrac && enterFrac >= 0 && enterFrac < bestFrac) {
      bestFrac = enterFrac;
      bestNormal = vec3Copy(enterNormal);
    }
  }

  return {
    fraction: bestFrac,
    endPos: [
      start[0] + (end[0] - start[0]) * bestFrac,
      start[1] + (end[1] - start[1]) * bestFrac,
      start[2] + (end[2] - start[2]) * bestFrac,
    ],
    normal: bestNormal,
    allSolid: false,
  };
}

export function updateViewport3DCamera(ctx: Viewport3DNavigationContext, dt: number): Viewport3DNavigationUpdate {
  const isWalkMode = ctx.fullscreen && ctx.fullscreenMode === 'walk';
  if (!isWalkMode) {
    if (!ctx.looking && !ctx.fullscreen && ctx.keys.size === 0) {
      return {
        position: ctx.position,
        physicsAccum: ctx.physicsAccum,
        walkStepSmooth: ctx.walkStepSmooth,
        walkViewH: ctx.walkViewH,
        walkLandChange: ctx.walkLandChange,
        walkLandTime: ctx.walkLandTime,
        walkBobCycle: ctx.walkBobCycle,
        dirty: false,
      };
    }
    if (ctx.keys.size === 0) {
      return {
        position: ctx.position,
        physicsAccum: ctx.physicsAccum,
        walkStepSmooth: ctx.walkStepSmooth,
        walkViewH: ctx.walkViewH,
        walkLandChange: ctx.walkLandChange,
        walkLandTime: ctx.walkLandTime,
        walkBobCycle: ctx.walkBobCycle,
        dirty: false,
      };
    }
  }

  let position = ctx.position;
  let physicsAccum = ctx.physicsAccum;
  let walkStepSmooth = ctx.walkStepSmooth;
  let walkViewH = ctx.walkViewH;
  let walkLandChange = ctx.walkLandChange;
  let walkLandTime = ctx.walkLandTime;
  let walkBobCycle = ctx.walkBobCycle;

  if (isWalkMode && ctx.walkState) {
    let fwd = 0;
    let side = 0;
    if (ctx.keys.has('w')) fwd += 1;
    if (ctx.keys.has('s')) fwd -= 1;
    if (ctx.keys.has('d')) side += 1;
    if (ctx.keys.has('a')) side -= 1;
    const jump = ctx.keys.has(' ');
    const walk = ctx.keys.has('shift');
    const crouch = ctx.keys.has('c');

    physicsAccum += dt;
    if (physicsAccum > 0.1) physicsAccum = 0.1;

    const traceFn: TraceFn = (start, end, mins, maxs) =>
      traceViewport3DPlayerBox(ctx.editor, start, end, mins, maxs);

    while (physicsAccum >= PHYSICS_STEP) {
      pmove(ctx.walkState, traceFn, ctx.yaw, fwd, side, jump, walk, crouch, PHYSICS_STEP);
      physicsAccum -= PHYSICS_STEP;
    }

    if (ctx.walkState.stepOffset > 0) {
      walkStepSmooth += ctx.walkState.stepOffset;
    }
    if (walkStepSmooth > 0) {
      walkStepSmooth = Math.max(0, walkStepSmooth - dt * 80);
    }

    if (ctx.walkState.landDeflect !== 0) {
      walkLandChange = ctx.walkState.landDeflect;
      walkLandTime = performance.now();
    }
    let landOffset = 0;
    const landElapsed = performance.now() - walkLandTime;
    if (landElapsed < 150) {
      landOffset = walkLandChange * (landElapsed / 150);
    } else if (landElapsed < 450) {
      landOffset = walkLandChange * (1 - (landElapsed - 150) / 300);
    }

    const targetViewH = ctx.walkState.crouching ? CROUCH_VIEWHEIGHT : VIEWHEIGHT;
    walkViewH += (targetViewH - walkViewH) * Math.min(1, dt * 12);

    let bobOffset = 0;
    if (ctx.walkState.walking && (fwd !== 0 || side !== 0)) {
      const xyspeed = Math.sqrt(
        ctx.walkState.velocity[0] ** 2 + ctx.walkState.velocity[1] ** 2,
      );
      walkBobCycle += dt * xyspeed * 0.035;
      bobOffset = Math.sin(walkBobCycle) * Math.min(xyspeed / 320, 1) * 1.5;
    } else {
      walkBobCycle *= Math.max(0, 1 - dt * 6);
    }

    position = [
      ctx.walkState.origin[0],
      ctx.walkState.origin[1],
      ctx.walkState.origin[2] + walkViewH - walkStepSmooth + landOffset + bobOffset,
    ];
  } else {
    const sprint = ctx.keys.has('shift') ? 2.5 : 1;
    const speed = ctx.moveSpeed * dt * sprint;
    const forward = getViewport3DForward(ctx.yaw, ctx.pitch);
    const right = getViewport3DRight(ctx.yaw);
    const boostSpeed = !ctx.fullscreen && (ctx.keys.has('control') || ctx.keys.has('meta')) ? speed * 3 / sprint : speed;

    if (ctx.keys.has('w')) position = vec3Add(position, vec3Scale(forward, boostSpeed));
    if (ctx.keys.has('s')) position = vec3Add(position, vec3Scale(forward, -boostSpeed));
    if (ctx.keys.has('d')) position = vec3Add(position, vec3Scale(right, boostSpeed));
    if (ctx.keys.has('a')) position = vec3Add(position, vec3Scale(right, -boostSpeed));
    if (ctx.keys.has('q') || ctx.keys.has(' ')) position[2] += boostSpeed;
    if (ctx.keys.has('e') || ctx.keys.has('c') || (!ctx.fullscreen && ctx.keys.has('shift'))) position[2] -= boostSpeed;
  }

  return {
    position,
    physicsAccum,
    walkStepSmooth,
    walkViewH,
    walkLandChange,
    walkLandTime,
    walkBobCycle,
    dirty: true,
  };
}
