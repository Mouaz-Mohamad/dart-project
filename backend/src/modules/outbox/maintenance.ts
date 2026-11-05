export interface MaintenanceResult {
  ok: boolean;
  failedJobs: string[];
}

// Run sequentially because these jobs can share transaction/lock ordering.
// A failed job must neither starve another job nor stop committed message delivery.
export async function runMaintenanceTasks(
  tasks: ReadonlyArray<readonly [string, () => Promise<unknown>]>,
  onFailure?: (job: string) => void,
): Promise<MaintenanceResult> {
  const failedJobs: string[] = [];
  for (const [name, run] of tasks) {
    try {
      await run();
    } catch {
      failedJobs.push(name);
      onFailure?.(name);
    }
  }
  return { ok: failedJobs.length === 0, failedJobs };
}
