import {
  LEGACY_NETCODE_ROLLOUT_MANIFEST,
  NETCODE_ROLLOUT_MANIFEST_MESSAGE,
  NETCODE_ROLLOUT_PROTOCOL_VERSION,
  NETCODE_ROLLOUT_REQUEST_MESSAGE,
  validateNetcodeRolloutManifest,
  type NetcodeRolloutManifest,
  type NetcodeRolloutStage
} from '../../../shared/protocol/netcode-rollout.ts';

export type NetcodeRolloutSource = 'pending' | 'negotiated' | 'legacy-fallback' | 'rejected';

export interface NetcodeRolloutSnapshot {
  readonly source: NetcodeRolloutSource;
  readonly manifest: NetcodeRolloutManifest;
  readonly rejectionReason?: string;
}

export interface NetcodeRolloutRoom {
  send(type: string, message?: unknown): void;
  onMessage(type: string, callback: (message: unknown) => void): unknown;
}

interface NetcodeRolloutControllerOptions {
  fallbackAfterMs?: number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
}

const DEFAULT_FALLBACK_AFTER_MS = 2_000;

export class NetcodeRolloutController {
  private readonly listeners = new Set<(snapshot: NetcodeRolloutSnapshot) => void>();
  private readonly removeMessageListener?: () => void;
  private readonly cancel: (handle: unknown) => void;
  private fallbackHandle?: unknown;
  private current: NetcodeRolloutSnapshot = Object.freeze({
    source: 'pending',
    manifest: LEGACY_NETCODE_ROLLOUT_MANIFEST
  });

  constructor(room: NetcodeRolloutRoom, options: NetcodeRolloutControllerOptions = {}) {
    const remove = room.onMessage(NETCODE_ROLLOUT_MANIFEST_MESSAGE, this.receive);
    if (typeof remove === 'function') this.removeMessageListener = remove as () => void;
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    const delay = finiteDelay(options.fallbackAfterMs ?? DEFAULT_FALLBACK_AFTER_MS);
    this.fallbackHandle = schedule(this.fallback, delay);
    room.send(NETCODE_ROLLOUT_REQUEST_MESSAGE, {
      protocolVersion: NETCODE_ROLLOUT_PROTOCOL_VERSION
    });
  }

  snapshot(): NetcodeRolloutSnapshot {
    return this.current;
  }

  enabled(stage: NetcodeRolloutStage): boolean {
    return this.current.source === 'negotiated' && this.current.manifest.stages[stage];
  }

  subscribe(listener: (snapshot: NetcodeRolloutSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.removeMessageListener?.();
    if (this.fallbackHandle !== undefined) this.cancel(this.fallbackHandle);
    this.fallbackHandle = undefined;
    this.listeners.clear();
  }

  private readonly receive = (message: unknown): void => {
    const validated = validateNetcodeRolloutManifest(message);
    if (!validated.accepted) {
      this.set(Object.freeze({
        source: 'rejected',
        manifest: LEGACY_NETCODE_ROLLOUT_MANIFEST,
        rejectionReason: validated.reason
      }));
      return;
    }
    this.set(Object.freeze({source: 'negotiated', manifest: validated.value}));
  };

  private readonly fallback = (): void => {
    this.fallbackHandle = undefined;
    if (this.current.source !== 'pending') return;
    this.set(Object.freeze({
      source: 'legacy-fallback',
      manifest: LEGACY_NETCODE_ROLLOUT_MANIFEST
    }));
  };

  private set(snapshot: NetcodeRolloutSnapshot): void {
    if (this.fallbackHandle !== undefined) this.cancel(this.fallbackHandle);
    this.fallbackHandle = undefined;
    this.current = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}

function finiteDelay(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Rollout fallback delay is invalid.');
  return value;
}
