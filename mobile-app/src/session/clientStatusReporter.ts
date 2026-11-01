/** One bounded in-flight report, scoped to a registered session. */
export function createClientStatusReporter(options: {
  connected(): boolean;
  collect(): Promise<unknown>;
  publish(value: unknown): void;
  intervalMs?: number;
}) {
  let active = true, pending = false;
  async function report() {
    if (!active || pending || !options.connected()) return;
    pending = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        options.collect(),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Status collection timed out')), 4000); }),
      ]);
      if (active && options.connected()) options.publish(value);
    } catch { /* Optional diagnostics must never interrupt media. */ }
    finally { clearTimeout(timeout); pending = false; }
  }
  const timer = setInterval(() => { void report(); }, options.intervalMs ?? 5000);
  void report();
  return { report, stop() { active = false; clearInterval(timer); } };
}
