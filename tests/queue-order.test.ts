import { describe, expect, it } from 'vitest';

import { orderRoundRobin } from '@/lib/queue';

import { song } from './fake-repo';

/**
 * Round-robin ordering (spec §6). This is the function `pickNext()` is built on, so its
 * behaviour is the station's fairness policy.
 */

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

function at(seconds: number): string {
  return `2026-08-16T00:00:${String(seconds).padStart(2, '0')}.000Z`;
}

describe('orderRoundRobin', () => {
  it('collapses to FIFO for a single adder', () => {
    // Somebody alone in the office at 8am is never throttled.
    const rows = [
      song({ id: 'a1', added_by: 'a', created_at: at(1) }),
      song({ id: 'a2', added_by: 'a', created_at: at(2) }),
      song({ id: 'a3', added_by: 'a', created_at: at(3) }),
    ];

    expect(ids(orderRoundRobin(rows))).toEqual(['a1', 'a2', 'a3']);
  });

  it('alternates between two adders', () => {
    const rows = [
      song({ id: 'a1', added_by: 'a', created_at: at(1) }),
      song({ id: 'a2', added_by: 'a', created_at: at(2) }),
      song({ id: 'b1', added_by: 'b', created_at: at(3) }),
      song({ id: 'b2', added_by: 'b', created_at: at(4) }),
    ];

    expect(ids(orderRoundRobin(rows))).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('plays Sara’s single song second even though Bat queued fifteen first', () => {
    const bat = Array.from({ length: 15 }, (_, index) =>
      song({ id: `bat${index}`, added_by: 'bat', created_at: at(index + 1) }),
    );
    const sara = song({ id: 'sara', added_by: 'sara', created_at: at(30) });

    const order = ids(orderRoundRobin([...bat, sara]));

    expect(order[0]).toBe('bat0');
    expect(order[1]).toBe('sara');
    expect(order[2]).toBe('bat1');
  });

  it('breaks ties within a turn by who pasted first', () => {
    const rows = [
      song({ id: 'b1', added_by: 'b', created_at: at(9) }),
      song({ id: 'a1', added_by: 'a', created_at: at(3) }),
      song({ id: 'c1', added_by: 'c', created_at: at(6) }),
    ];

    expect(ids(orderRoundRobin(rows))).toEqual(['a1', 'c1', 'b1']);
  });

  it('is deterministic when timestamps collide, so the list never reshuffles', () => {
    const rows = [
      song({ id: 'zzz', added_by: 'a', created_at: at(1) }),
      song({ id: 'aaa', added_by: 'b', created_at: at(1) }),
    ];

    const once = ids(orderRoundRobin(rows));
    const twice = ids(orderRoundRobin([...rows].reverse()));

    expect(once).toEqual(twice);
  });

  it('does not mutate its input', () => {
    const rows = [
      song({ id: 'b1', added_by: 'b', created_at: at(2) }),
      song({ id: 'a1', added_by: 'a', created_at: at(1) }),
    ];
    const before = ids(rows);

    orderRoundRobin(rows);

    expect(ids(rows)).toEqual(before);
  });

  it('handles an empty queue', () => {
    expect(orderRoundRobin([])).toEqual([]);
  });
});
