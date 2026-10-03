import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '@shared/limits';
import { deleteOption, getEventRow, insertOption } from '../db/queries';
import { computeExpiresAt } from '../lib/expiry';
import { insertEventRow } from './helpers';

const DAY = 24 * 60 * 60 * 1000;
const createdAt = Date.UTC(2026, 9, 3);

let counter = 0;
const option = (eventId: string, date: string) => ({
  id: `opt-${eventId}-${++counter}`,
  event_id: eventId,
  date,
  suggested_by: null,
  created_at: createdAt + counter,
});

/**
 * expires_at is recomputed from the option rows inside the same batch as the change, so it can
 * never reflect a snapshot taken before a concurrent request landed (review finding 1).
 */
describe('option writes keep expires_at in step with the rows', () => {
  it('recomputes the expiry from every option after each insert, whatever the order', async () => {
    const id = `q-insert-${Date.now()}`;
    await insertEventRow({ id, created_at: createdAt, expires_at: createdAt + LIMITS.ttlWithoutDatesDays * DAY });
    await insertOption(env.DB, option(id, '2026-11-28'));
    await insertOption(env.DB, option(id, '2026-11-21')); // an earlier date added later must not pull the expiry back
    const row = await getEventRow(env.DB, id);
    expect(row?.expires_at).toBe(computeExpiresAt(['2026-11-21', '2026-11-28'], createdAt));
  });

  it('falls back to the creation TTL once the last date is removed', async () => {
    const id = `q-delete-${Date.now()}`;
    await insertEventRow({ id, created_at: createdAt, expires_at: 0 });
    const only = option(id, '2026-11-21');
    await insertOption(env.DB, only);
    expect(await deleteOption(env.DB, id, only.id, createdAt + DAY)).toBe(true);
    const row = await getEventRow(env.DB, id);
    expect(row?.expires_at).toBe(computeExpiresAt([], createdAt));
    expect(row?.updated_at).toBe(createdAt + DAY);
  });

  it('reports false for an option that is not in the poll and keeps the expiry', async () => {
    const id = `q-miss-${Date.now()}`;
    await insertEventRow({ id, created_at: createdAt, expires_at: 0 });
    await insertOption(env.DB, option(id, '2026-11-21'));
    expect(await deleteOption(env.DB, id, 'not-an-option', createdAt)).toBe(false);
    expect((await getEventRow(env.DB, id))?.expires_at).toBe(computeExpiresAt(['2026-11-21'], createdAt));
  });

  it('rolls the insert back when the date is already in the poll', async () => {
    const id = `q-dup-${Date.now()}`;
    await insertEventRow({ id, created_at: createdAt, expires_at: 0 });
    await insertOption(env.DB, option(id, '2026-11-21'));
    await expect(insertOption(env.DB, option(id, '2026-11-21'))).rejects.toThrow(/UNIQUE constraint failed/);
    const { results } = await env.DB.prepare('SELECT id FROM options WHERE event_id = ?').bind(id).all();
    expect(results).toHaveLength(1);
  });
});
