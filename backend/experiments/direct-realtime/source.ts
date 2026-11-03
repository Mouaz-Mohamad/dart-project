import type { PilotSource, VersionedSnapshot } from "../realtime-pilot/client.js";

// On duration-driven reconnects check the small authoritative version first.
// Full snapshots are fetched only for actual changes; cache is per source, in memory.
export function directSnapshotSource<T extends VersionedSnapshot>(options: {
  subscribe: PilotSource<T>["subscribe"];
  loadVersion(signal: AbortSignal): Promise<number>;
  loadSnapshot(signal: AbortSignal): Promise<T>;
  apply(snapshot: T): void;
}): PilotSource<T> {
  let cached: T | undefined, announced = 0;
  return {
    subscribe: (receive, state) => options.subscribe(signal => {
      announced = Math.max(announced, signal.version); receive(signal);
    }, state),
    snapshot: async signal => {
      if (cached && announced <= cached.version) {
        const version = await options.loadVersion(signal);
        if (!Number.isSafeInteger(version) || version < cached.version) throw new Error("Invalid authoritative version");
        if (version === cached.version && announced <= cached.version) return cached;
      }
      const snapshot = await options.loadSnapshot(signal);
      if (signal.aborted || !Number.isSafeInteger(snapshot.version) || (cached && snapshot.version < cached.version)) throw new Error("Invalid snapshot");
      cached = snapshot;
      return snapshot;
    },
    apply: options.apply,
  };
}
