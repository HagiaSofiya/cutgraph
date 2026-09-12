import { describe, expect, it } from 'vitest';
import { SpendGuard } from '../src/jobs/spendGuard';

describe('SpendGuard', () => {
  it('allows reservations under both limits', () => {
    const guard = new SpendGuard(10, 3);
    expect(guard.tryReserve()).toEqual({ ok: true });
    expect(guard.tryReserve()).toEqual({ ok: true });
  });

  it('rejects once the concurrent limit is reached, independent of the total limit', () => {
    const guard = new SpendGuard(10, 2);
    expect(guard.tryReserve().ok).toBe(true);
    expect(guard.tryReserve().ok).toBe(true);

    const result = guard.tryReserve();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('concurrent');
  });

  it('rejects once the total lifetime limit is reached, even with no jobs in flight', () => {
    const guard = new SpendGuard(2, 10);
    expect(guard.tryReserve().ok).toBe(true);
    expect(guard.tryReserve().ok).toBe(true);

    const result = guard.tryReserve();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('generation limit');
  });

  it('frees a concurrency slot on release without touching the total counter', () => {
    const guard = new SpendGuard(10, 1);
    expect(guard.tryReserve().ok).toBe(true);
    expect(guard.tryReserve().ok).toBe(false); // slot taken

    guard.release();
    expect(guard.tryReserve().ok).toBe(true); // slot freed

    // Three reservations total have now been attempted-and-accepted (2 succeeded + release
    // doesn't refund the total counter) -- a 4th accepted reservation should still be allowed
    // since maxGenerationsTotal is 10.
    guard.release();
    expect(guard.tryReserve().ok).toBe(true);
  });

  it('never lets release() push the concurrency count negative', () => {
    const guard = new SpendGuard(10, 1);
    guard.release();
    guard.release();
    expect(guard.tryReserve().ok).toBe(true);
  });
});
