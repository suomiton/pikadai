import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep, waitUntil } from './timing';

describe('timing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sleep resolves after the given time', async () => {
    let done = false;
    void sleep(500).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('waitUntil waits for a future wall-clock time', async () => {
    vi.setSystemTime(10_000);
    let done = false;
    void waitUntil(12_000).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('waitUntil resolves at once for a time already passed', async () => {
    vi.setSystemTime(10_000);
    let done = false;
    void waitUntil(9_000).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });
});
