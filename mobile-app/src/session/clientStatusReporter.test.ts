import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClientStatusReporter } from './clientStatusReporter';
const reporters: ReturnType<typeof createClientStatusReporter>[] = [];
const create = (options: Parameters<typeof createClientStatusReporter>[0]) => {
  const reporter = createClientStatusReporter(options); reporters.push(reporter); return reporter;
};
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { reporters.splice(0).forEach(reporter => reporter.stop()); vi.clearAllTimers(); vi.useRealTimers(); });
describe('session device reporting lifecycle', () => {
  it('skips disconnected sessions and stops publishing after teardown', async () => {
    let connected = false;
    const collect = vi.fn(async () => ({ charging: true })), publish = vi.fn();
    const reporter = create({ connected: () => connected, collect, publish });
    expect(collect).not.toHaveBeenCalled(); connected = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(publish).toHaveBeenCalledWith({ charging: true }); reporter.stop();
    await vi.advanceTimersByTimeAsync(10000); expect(publish).toHaveBeenCalledOnce();
  });
  it('ignores in-flight results after logout and prevents overlapping polls', async () => {
    let finish!: (value: unknown) => void;
    const collect = vi.fn(() => new Promise(resolve => { finish = resolve; })), publish = vi.fn();
    const reporter = create({ connected: () => true, collect, publish });
    await reporter.report(); expect(collect).toHaveBeenCalledOnce();
    reporter.stop(); finish({}); await Promise.resolve(); await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
  });
  it('recovers from a hanging device API and never publishes its late result', async () => {
    let finish!: (value: unknown) => void;
    const collect = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ networkType: 'wifi' });
    const publish = vi.fn(); create({ connected: () => true, collect, publish });
    await vi.advanceTimersByTimeAsync(5000);
    expect(publish).toHaveBeenCalledExactlyOnceWith({ networkType: 'wifi' });
    finish({ networkType: 'cellular' }); await Promise.resolve(); await Promise.resolve();
    expect(publish).toHaveBeenCalledOnce();
  });
});
