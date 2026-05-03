// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROJECT_POD_MIGRATION — Phase 2 Task 2.4
// Pod Session Wrapper — batches consecutive jobs onto a single live pod and
// sleeps it after an idle window (D6 = 10 min) to amortize the ~60s cold-start
// across a burst of work.
//
// Contract:
//   const art = await withPodSession(async (handle) => {
//     return produceVideo(handle, spec);
//   });
//
// Semantics:
//   • First caller: startPod() + waitUntilReady(), then runs fn(handle).
//   • Concurrent/subsequent callers within the idle window: reuse the same pod.
//   • When the last in-flight caller returns, a stopPod() is SCHEDULED for
//     `idleWindowMs` later. If a new caller arrives before that timer fires,
//     the timer is cancelled and the pod is reused.
//   • On fn() throwing: the error propagates unchanged. If this was the last
//     active caller, we stop the pod IMMEDIATELY (no idle window) to prevent
//     a broken job from leaking GPU charges. Other in-flight callers are
//     unaffected — their own shutdown path still handles the pod.
//
// This is a SINGLE-PROCESS orchestrator helper. Railway currently runs one
// bot process, so module-level state is sufficient. If we ever shard the
// orchestrator we must move this state into Redis or Supabase.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { startPod, stopPod, waitUntilReady, capturePodLogs, type StartPodOptions } from "./runpod-client";
import type { PodHandle } from "./types";

/** Default idle window before the pod is stopped (D6 in PROJECT_POD_MIGRATION). */
const DEFAULT_IDLE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export interface PodSessionOptions {
  /**
   * How long the pod stays warm after the last in-flight caller returns.
   * Next caller within this window reuses the same pod (no cold-start).
   * Default: 10 min.
   */
  idleWindowMs?: number;
  /** Passthrough to `startPod()` when the session has to mint a new pod. */
  startPodOptions?: StartPodOptions;
  /**
   * Max time `waitUntilReady` waits for /health/live after a fresh start.
   * Default: 10 min (matches runpod-client default).
   */
  readinessTimeoutMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level state — single process, single pod at a time.
// ─────────────────────────────────────────────────────────────────────────────
interface ActiveSession {
  handle: PodHandle;
  /** Concurrent callers currently inside fn(). */
  inFlight: number;
  /** Pending stop timer (set when inFlight hits 0 cleanly). */
  idleTimer: NodeJS.Timeout | null;
  /** Idle window to use for this session's pending stop. */
  idleWindowMs: number;
}

/**
 * Either the active pod (post-readiness) or the in-flight promise to start one.
 * Using a Promise lets concurrent callers share a single startPod() RPC.
 */
let startingPod: Promise<ActiveSession> | null = null;
let active: ActiveSession | null = null;

/** Clear a pending idle-stop timer if one exists, returning whether we cleared. */
function cancelIdleTimer(session: ActiveSession): boolean {
  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
    return true;
  }
  return false;
}

/**
 * Schedule the pod to stop after `idleWindowMs`. If called while a timer
 * already exists, the existing timer is left in place (earliest scheduled
 * stop wins — the new caller has already returned, so we don't want to
 * extend the warm window they didn't request).
 */
function scheduleIdleStop(session: ActiveSession): void {
  if (session.idleTimer) return; // already scheduled
  const handleToStop = session.handle;
  session.idleTimer = setTimeout(() => {
    // Guard: if a new caller grabbed the session between timer firing and
    // our handler, `active` may have been reset or replaced.
    if (active && active.handle.podId === handleToStop.podId && active.inFlight === 0) {
      active = null;
      // Capture logs before termination
      void capturePodLogs(handleToStop, "idle_stop").finally(() => stopPod(handleToStop.podId));
    }
  }, session.idleWindowMs);

  // Don't keep the Node event loop alive just to stop a pod — if the
  // process exits, the pod exits with it (RunPod idle-timeout reaps).
  if (typeof session.idleTimer.unref === "function") {
    session.idleTimer.unref();
  }
}

/**
 * Immediate stop — fire-and-forget. Used on fn() throwing when no other
 * caller is in-flight, to avoid leaking GPU charges on broken jobs.
 */
function stopImmediately(session: ActiveSession): void {
  cancelIdleTimer(session);
  const handleToStop = session.handle;
  // Only null out `active` if we're still the current session.
  if (active && active.handle.podId === handleToStop.podId) {
    active = null;
  }
  // Capture logs before termination (especially important on errors)
  void capturePodLogs(handleToStop, "error_stop").finally(() => stopPod(handleToStop.podId));
}

/**
 * Acquire the live pod for this caller. If another caller is already starting
 * one, wait for the same startPod() promise — we never mint two in parallel.
 */
async function acquire(opts: PodSessionOptions): Promise<ActiveSession> {
  // Fast path: existing warm pod. Cancel its pending stop and claim it.
  if (active) {
    cancelIdleTimer(active);
    active.inFlight += 1;
    // A caller's idleWindowMs override only affects their own stop schedule;
    // we track the latest one so that when inFlight hits 0 we honor it.
    active.idleWindowMs = opts.idleWindowMs ?? active.idleWindowMs;
    return active;
  }

  // Shared path: a startPod() is already in flight — latch onto it.
  if (startingPod) {
    const session = await startingPod;
    cancelIdleTimer(session);
    session.inFlight += 1;
    return session;
  }

  // Cold path: mint a new pod. Dedup concurrent cold-path callers via the
  // `startingPod` promise so exactly one startPod() RPC happens.
  const idleWindowMs = opts.idleWindowMs ?? DEFAULT_IDLE_WINDOW_MS;
  startingPod = (async () => {
    const handle = await startPod(opts.startPodOptions);
    try {
      await waitUntilReady(handle, {
        timeoutMs: opts.readinessTimeoutMs,
      });
    } catch (err) {
      // Readiness failed — don't leak a half-started pod.
      void stopPod(handle.podId);
      throw err;
    }
    const session: ActiveSession = {
      handle,
      inFlight: 0,
      idleTimer: null,
      idleWindowMs,
    };
    active = session;
    return session;
  })();

  let session: ActiveSession;
  try {
    session = await startingPod;
  } finally {
    // Whether we succeeded or failed, the in-flight start is resolved now.
    // Future callers will either find `active` set (success) or null (fail).
    startingPod = null;
  }

  session.inFlight += 1;
  return session;
}

/**
 * Release this caller's claim. On success: if we're the last caller, schedule
 * an idle stop. On throw: if we're the last caller, stop immediately.
 */
function release(session: ActiveSession, didThrow: boolean): void {
  session.inFlight = Math.max(0, session.inFlight - 1);
  if (session.inFlight > 0) return; // other callers still using the pod

  if (didThrow) {
    stopImmediately(session);
  } else {
    scheduleIdleStop(session);
  }
}

/**
 * Wake a pod (or reuse a warm one), run `fn(handle)`, then sleep the pod
 * after the idle window. Concurrent calls share a single pod.
 *
 * Errors from `fn` propagate unchanged; the pod is torn down immediately if
 * this was the last active caller, to avoid leaking GPU charges on a broken
 * job. Normal completion schedules the stop after `idleWindowMs`.
 */
export async function withPodSession<T>(
  fn: (handle: PodHandle) => Promise<T>,
  opts: PodSessionOptions = {},
): Promise<T> {
  const session = await acquire(opts);
  let threw = false;
  try {
    return await fn(session.handle);
  } catch (err) {
    threw = true;
    throw err;
  } finally {
    release(session, threw);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test hooks — exported for contract tests + shutdown handlers. Not intended
// for production callers; use `withPodSession` instead.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Snapshot of the current session for diagnostics / graceful shutdown. Returns
 * null if no pod is warm. DOES NOT cancel any pending idle timer.
 */
export function peekActiveSession(): {
  podId: string;
  workerUrl: string;
  inFlight: number;
  idleTimerScheduled: boolean;
} | null {
  if (!active) return null;
  return {
    podId: active.handle.podId,
    workerUrl: active.handle.workerUrl,
    inFlight: active.inFlight,
    idleTimerScheduled: active.idleTimer !== null,
  };
}

/**
 * Graceful-shutdown hook: cancel any pending idle timer and stop the pod
 * NOW, awaiting the stopPod() RPC. Safe to call even if no pod is warm.
 * Use this in `process.on("SIGTERM", ...)` to avoid leaking GPU charges
 * when the Railway container restarts during a warm-pod idle window.
 */
export async function shutdownPodSession(): Promise<void> {
  if (!active) return;
  const session = active;
  cancelIdleTimer(session);
  active = null;
  // Capture logs before graceful shutdown
  await capturePodLogs(session.handle, "graceful_shutdown").catch(() => {});
  await stopPod(session.handle.podId).catch(() => {
    // stopPod is already 404-safe; swallow transport errors on shutdown.
  });
}
