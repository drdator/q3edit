// Q3-accurate player movement physics
// Port of Quake 3's bg_pmove.c / bg_slidemove.c for use with raw brush geometry

import {
  Vec3, vec3Add, vec3Scale, vec3Dot, vec3Length,
  vec3Cross, vec3Normalize, vec3Copy,
} from './math';

// ── Q3 Constants ──

const PM_STOPSPEED = 100;
const PM_FRICTION = 6;
const PM_ACCELERATE = 10;
const PM_AIRACCELERATE = 1;
const JUMP_VELOCITY = 270;
const DEFAULT_GRAVITY = 800;
export const MAX_SPEED = 320;
const MIN_WALK_NORMAL = 0.7;
const OVERCLIP = 1.001;
const STEPSIZE = 18;
const MAX_CLIP_PLANES = 5;

export const VIEWHEIGHT = 26;
export const CROUCH_VIEWHEIGHT = 12;
export const PLAYER_MINS: Vec3 = [-15, -15, -24];
export const PLAYER_MAXS: Vec3 = [15, 15, 32];
const CROUCH_MAXS: Vec3 = [15, 15, 16];

export const PHYSICS_STEP = 1 / 125;

// ── Types ──

export interface TraceResult {
  fraction: number;
  endPos: Vec3;
  normal: Vec3;
  allSolid: boolean;
}

export type TraceFn = (start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3) => TraceResult;

export interface WalkState {
  origin: Vec3;           // Q3 player origin (NOT eye position)
  velocity: Vec3;
  groundNormal: Vec3;
  groundPlane: boolean;
  walking: boolean;
  jumpHeld: boolean;
  crouching: boolean;
  landTimer: number;      // ms remaining
  stepOffset: number;     // step-up height for view smoothing
  landDeflect: number;    // landing view kick (negative = view dips down)
  prevVelocityZ: number;  // for landing detection
}

export function createWalkState(eyePos: Vec3): WalkState {
  return {
    origin: [eyePos[0], eyePos[1], eyePos[2] - VIEWHEIGHT],
    velocity: [0, 0, 0],
    groundNormal: [0, 0, 1],
    groundPlane: false,
    walking: false,
    jumpHeld: false,
    crouching: false,
    landTimer: 0,
    stepOffset: 0,
    landDeflect: 0,
    prevVelocityZ: 0,
  };
}

export function getEyePos(state: WalkState): Vec3 {
  const vh = state.crouching ? CROUCH_VIEWHEIGHT : VIEWHEIGHT;
  return [state.origin[0], state.origin[1], state.origin[2] + vh];
}

function getMaxs(state: WalkState): Vec3 {
  return state.crouching ? CROUCH_MAXS : PLAYER_MAXS;
}

// ── Clip velocity against a plane ──

function clipVelocity(vel: Vec3, normal: Vec3, overbounce: number): Vec3 {
  let backoff = vec3Dot(vel, normal);
  if (backoff < 0) {
    backoff *= overbounce;
  } else {
    backoff /= overbounce;
  }
  return [
    vel[0] - normal[0] * backoff,
    vel[1] - normal[1] * backoff,
    vel[2] - normal[2] * backoff,
  ];
}

// ── Slide move (Q3's PM_SlideMove) ──

function slideMove(
  state: WalkState,
  trace: TraceFn,
  dt: number,
  applyGravity: boolean
): boolean {
  let timeLeft = dt;
  let blocked = false;
  const maxs = getMaxs(state);
  const planes: Vec3[] = [];
  let numPlanes = 0;

  let endVelocity: Vec3 | null = null;

  if (applyGravity) {
    // Q3: save end velocity with full gravity, trace with averaged velocity
    endVelocity = vec3Copy(state.velocity);
    endVelocity[2] -= DEFAULT_GRAVITY * dt;
    state.velocity[2] -= DEFAULT_GRAVITY * dt * 0.5;
    if (state.groundPlane) {
      state.velocity = clipVelocity(state.velocity, state.groundNormal, OVERCLIP);
    }
  }

  // Start with ground normal as a clip plane if grounded
  if (state.groundPlane) {
    planes[numPlanes++] = vec3Copy(state.groundNormal);
  }
  // Add velocity direction as a clip plane
  const velLen = vec3Length(state.velocity);
  planes[numPlanes++] = velLen > 0 ? vec3Scale(state.velocity, 1 / velLen) : [0, 0, 1];

  for (let bumpCount = 0; bumpCount < 4; bumpCount++) {
    const end: Vec3 = [
      state.origin[0] + state.velocity[0] * timeLeft,
      state.origin[1] + state.velocity[1] * timeLeft,
      state.origin[2] + state.velocity[2] * timeLeft,
    ];

    const tr = trace(state.origin, end, PLAYER_MINS, maxs);

    if (tr.allSolid) {
      state.velocity[2] = 0;
      return true;
    }

    if (tr.fraction > 0) {
      state.origin = vec3Copy(tr.endPos);
    }

    if (tr.fraction === 1) break;

    blocked = true;
    timeLeft -= timeLeft * tr.fraction;

    // Check for duplicate plane (dot > 0.99) and nudge
    let duplicate = false;
    for (let i = 0; i < numPlanes; i++) {
      if (vec3Dot(tr.normal, planes[i]) > 0.99) {
        state.velocity = vec3Add(state.velocity, tr.normal);
        duplicate = true;
        break;
      }
    }
    if (duplicate) continue;

    if (numPlanes >= MAX_CLIP_PLANES) {
      state.velocity = [0, 0, 0];
      return true;
    }
    planes[numPlanes++] = vec3Copy(tr.normal);

    // Q3 multi-plane clipping
    let clipped = false;
    for (let i = 0; i < numPlanes; i++) {
      if (vec3Dot(state.velocity, planes[i]) >= 0.1) continue;

      let cv = clipVelocity(state.velocity, planes[i], OVERCLIP);
      let endV = endVelocity ? clipVelocity(endVelocity, planes[i], OVERCLIP) : null;

      // Check against all other planes
      for (let j = 0; j < numPlanes; j++) {
        if (j === i) continue;
        if (vec3Dot(cv, planes[j]) >= 0.1) continue;

        // Clip against plane j too
        cv = clipVelocity(cv, planes[j], OVERCLIP);
        if (endV) endV = clipVelocity(endV, planes[j], OVERCLIP);

        if (vec3Dot(cv, planes[i]) >= 0) continue;

        // Slide along the edge between planes i and j
        const dir = vec3Normalize(vec3Cross(planes[i], planes[j]));
        const d = vec3Dot(dir, state.velocity);
        cv = vec3Scale(dir, d);

        if (endV && endVelocity) {
          const dEnd = vec3Dot(dir, endVelocity);
          endV = vec3Scale(dir, dEnd);
        }

        // Check for a third blocking plane
        for (let k = 0; k < numPlanes; k++) {
          if (k === i || k === j) continue;
          if (vec3Dot(cv, planes[k]) >= 0.1) continue;
          // Blocked by 3+ planes: stop
          state.velocity = [0, 0, 0];
          return true;
        }
        break;
      }

      state.velocity = cv;
      if (endV) endVelocity = endV;
      clipped = true;
      break;
    }

    if (!clipped) {
      state.velocity = [0, 0, 0];
      return true;
    }
  }

  if (applyGravity && endVelocity) {
    state.velocity = endVelocity;
  }

  return blocked;
}

// ── Step slide move (Q3's PM_StepSlideMove) ──

function stepSlideMove(
  state: WalkState,
  trace: TraceFn,
  dt: number,
  applyGravity: boolean
): void {
  const startOrigin = vec3Copy(state.origin);
  const startVelocity = vec3Copy(state.velocity);
  const maxs = getMaxs(state);

  // Try normal slide first
  if (!slideMove(state, trace, dt, applyGravity)) {
    return; // No collision, done
  }

  const downOrigin = vec3Copy(state.origin);
  const downVelocity = vec3Copy(state.velocity);

  // Check if stepping is appropriate: don't step when moving upward without ground
  const stepDownTest: Vec3 = [startOrigin[0], startOrigin[1], startOrigin[2] - STEPSIZE];
  const startTr = trace(startOrigin, stepDownTest, PLAYER_MINS, maxs);
  if (startVelocity[2] > 0 && (startTr.fraction === 1.0 || startTr.normal[2] < MIN_WALK_NORMAL)) {
    return;
  }

  // Restore and try stepping up
  state.origin = vec3Copy(startOrigin);
  state.velocity = vec3Copy(startVelocity);

  const stepUp: Vec3 = [startOrigin[0], startOrigin[1], startOrigin[2] + STEPSIZE];
  let tr = trace(state.origin, stepUp, PLAYER_MINS, maxs);
  if (tr.allSolid) {
    state.origin = downOrigin;
    state.velocity = downVelocity;
    return;
  }

  const stepSize = tr.endPos[2] - startOrigin[2];
  state.origin = vec3Copy(tr.endPos);

  // Slide from the stepped-up position
  slideMove(state, trace, dt, applyGravity);

  // Step back down
  const stepDownEnd: Vec3 = [state.origin[0], state.origin[1], state.origin[2] - stepSize];
  tr = trace(state.origin, stepDownEnd, PLAYER_MINS, maxs);
  if (!tr.allSolid) {
    state.origin = vec3Copy(tr.endPos);
  }

  if (tr.fraction < 1.0) {
    state.velocity = clipVelocity(state.velocity, tr.normal, OVERCLIP);
  }

  // Record step offset for view smoothing
  const delta = state.origin[2] - startOrigin[2];
  if (delta > 2) {
    if (delta < 7) state.stepOffset = 4;
    else if (delta < 11) state.stepOffset = 8;
    else if (delta < 15) state.stepOffset = 12;
    else state.stepOffset = 16;
  }
}

// ── Ground trace ──

function groundTrace(state: WalkState, trace: TraceFn): void {
  const wasWalking = state.walking;
  const maxs = getMaxs(state);

  const end: Vec3 = [state.origin[0], state.origin[1], state.origin[2] - 0.25];
  const tr = trace(state.origin, end, PLAYER_MINS, maxs);

  if (tr.allSolid) {
    state.groundPlane = false;
    state.walking = false;
    return;
  }

  // No ground contact
  if (tr.fraction === 1.0) {
    state.groundPlane = false;
    state.walking = false;
    return;
  }

  // Moving away from ground (jumping)
  if (state.velocity[2] > 0 && vec3Dot(state.velocity, tr.normal) > 10) {
    state.groundPlane = false;
    state.walking = false;
    return;
  }

  // Slope too steep to walk on
  if (tr.normal[2] < MIN_WALK_NORMAL) {
    state.groundPlane = true;
    state.groundNormal = vec3Copy(tr.normal);
    state.walking = false;
    return;
  }

  // On walkable ground
  state.groundPlane = true;
  state.walking = true;
  state.groundNormal = vec3Copy(tr.normal);

  // Landing: set timer to prevent immediate re-jump + view kick
  if (!wasWalking && state.prevVelocityZ < -200) {
    state.landTimer = 250;
    // Compute landing deflect based on impact velocity (Q3-style)
    const impactSpeed = Math.abs(state.prevVelocityZ);
    if (impactSpeed > 600) state.landDeflect = -24;
    else if (impactSpeed > 400) state.landDeflect = -16;
    else state.landDeflect = -8;
  }
}

// ── Friction (Q3's PM_Friction) ──

function friction(state: WalkState, dt: number): void {
  const v = state.velocity;
  // Q3: when walking, ignore Z for speed calculation
  let speed: number;
  if (state.walking) {
    speed = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
  } else {
    speed = vec3Length(v);
  }

  if (speed < 1) {
    state.velocity = [0, 0, v[2]]; // Zero XY, preserve Z
    return;
  }

  let drop = 0;
  if (state.walking) {
    const control = Math.max(speed, PM_STOPSPEED);
    drop += control * PM_FRICTION * dt;
  }

  let newSpeed = speed - drop;
  if (newSpeed < 0) newSpeed = 0;
  newSpeed /= speed;

  state.velocity = [v[0] * newSpeed, v[1] * newSpeed, v[2] * newSpeed];
}

// ── Accelerate (Q3's PM_Accelerate) ──

function accelerate(state: WalkState, wishDir: Vec3, wishSpeed: number, accel: number, dt: number): void {
  const currentSpeed = vec3Dot(state.velocity, wishDir);
  const addSpeed = wishSpeed - currentSpeed;
  if (addSpeed <= 0) return;

  let accelSpeed = accel * dt * wishSpeed;
  if (accelSpeed > addSpeed) accelSpeed = addSpeed;

  state.velocity = [
    state.velocity[0] + accelSpeed * wishDir[0],
    state.velocity[1] + accelSpeed * wishDir[1],
    state.velocity[2] + accelSpeed * wishDir[2],
  ];
}

// ── Jump ──

function checkJump(state: WalkState, jump: boolean): boolean {
  if (!jump) return false;
  if (state.landTimer > 0) return false;
  if (state.jumpHeld) return false;

  state.jumpHeld = true;
  state.velocity = [state.velocity[0], state.velocity[1], JUMP_VELOCITY];
  state.walking = false;
  state.groundPlane = false;
  return true;
}

// ── Flat movement basis (yaw only, no pitch) ──

function buildFlatBasis(yaw: number): { forward: Vec3; right: Vec3 } {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  return {
    forward: [cy, sy, 0],
    right: [sy, -cy, 0],
  };
}

// ── Walk move (Q3's PM_WalkMove) ──

function walkMove(
  state: WalkState,
  trace: TraceFn,
  yaw: number,
  forwardMove: number,
  rightMove: number,
  jump: boolean,
  walk: boolean,
  dt: number
): void {
  if (checkJump(state, jump)) {
    airMove(state, trace, yaw, forwardMove, rightMove, dt);
    return;
  }

  friction(state, dt);

  // Build movement basis projected onto ground plane
  const { forward: flatFwd, right: flatRight } = buildFlatBasis(yaw);
  let forward = clipVelocity(flatFwd, state.groundNormal, OVERCLIP);
  let right = clipVelocity(flatRight, state.groundNormal, OVERCLIP);
  forward = vec3Normalize(forward);
  right = vec3Normalize(right);

  // Compute wish direction and speed
  let wishDir: Vec3 = [
    forward[0] * forwardMove + right[0] * rightMove,
    forward[1] * forwardMove + right[1] * rightMove,
    forward[2] * forwardMove + right[2] * rightMove,
  ];
  const wishLen = vec3Length(wishDir);
  if (wishLen > 0) {
    wishDir = vec3Scale(wishDir, 1 / wishLen);
  }

  // Q3 command scale: speed * max(|inputs|)
  const maxInput = Math.max(Math.abs(forwardMove), Math.abs(rightMove));
  let wishSpeed = MAX_SPEED * maxInput;

  // Shift = walk (halves speed, Q3 behavior)
  if (walk) wishSpeed *= 0.5;
  // Crouch caps speed
  if (state.crouching && wishSpeed > MAX_SPEED * 0.25) {
    wishSpeed = MAX_SPEED * 0.25;
  }

  accelerate(state, wishDir, wishSpeed, PM_ACCELERATE, dt);

  // Clip to ground plane, preserving speed magnitude (Q3 behavior)
  const vel = vec3Length(state.velocity);
  if (state.groundPlane) {
    state.velocity = clipVelocity(state.velocity, state.groundNormal, OVERCLIP);
  }
  const clippedSpeed = vec3Length(state.velocity);
  if (clippedSpeed > 0 && vel > 0) {
    state.velocity = vec3Scale(state.velocity, vel / clippedSpeed);
  }

  if (state.velocity[0] === 0 && state.velocity[1] === 0) return;

  stepSlideMove(state, trace, dt, false);
}

// ── Air move (Q3's PM_AirMove) ──

function airMove(
  state: WalkState,
  trace: TraceFn,
  yaw: number,
  forwardMove: number,
  rightMove: number,
  dt: number
): void {
  friction(state, dt);

  const { forward, right } = buildFlatBasis(yaw);

  // Wish direction in XY only (air has no vertical wish)
  let wishDir: Vec3 = [
    forward[0] * forwardMove + right[0] * rightMove,
    forward[1] * forwardMove + right[1] * rightMove,
    0,
  ];
  const wishLen = vec3Length(wishDir);
  if (wishLen > 0) {
    wishDir = vec3Scale(wishDir, 1 / wishLen);
  }

  const maxInput = Math.max(Math.abs(forwardMove), Math.abs(rightMove));
  const wishSpeed = MAX_SPEED * maxInput;

  // PM_AIRACCELERATE = 1 (very limited air control, enables strafe jumping)
  accelerate(state, wishDir, wishSpeed, PM_AIRACCELERATE, dt);

  // Clip to steep ground plane if applicable
  if (state.groundPlane) {
    state.velocity = clipVelocity(state.velocity, state.groundNormal, OVERCLIP);
  }

  stepSlideMove(state, trace, dt, true);
}

// ── Main pmove entry point ──

export function pmove(
  state: WalkState,
  trace: TraceFn,
  yaw: number,
  forwardMove: number,
  rightMove: number,
  jump: boolean,
  walk: boolean,
  crouch: boolean,
  dt: number
): void {
  // Release jump held when button released
  if (state.jumpHeld && !jump) {
    state.jumpHeld = false;
  }

  // Save previous velocity for landing detection
  state.prevVelocityZ = state.velocity[2];
  state.stepOffset = 0;
  state.landDeflect = 0;

  // Handle crouch
  if (crouch) {
    state.crouching = true;
  } else if (state.crouching) {
    // Try to uncrouch: check if standing bbox fits
    const tr = trace(state.origin, state.origin, PLAYER_MINS, PLAYER_MAXS);
    if (!tr.allSolid) {
      state.crouching = false;
    }
  }

  // Ground trace at start of frame
  groundTrace(state, trace);

  // Drop timers
  state.landTimer = Math.max(0, state.landTimer - dt * 1000);

  // Movement
  if (state.walking) {
    walkMove(state, trace, yaw, forwardMove, rightMove, jump, walk, dt);
  } else {
    airMove(state, trace, yaw, forwardMove, rightMove, dt);
  }

  // Ground trace at end of frame
  groundTrace(state, trace);
}
