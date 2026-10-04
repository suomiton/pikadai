import type { EventView } from '../shared/types';
import { createPollViaApi, DUMMY_TURNSTILE_TOKEN, expect, test } from './fixtures';
import { nameField } from './helpers';

test.describe('just taking me to the results', () => {
  test('a visitor skips joining to see the answers and results, then goes back to join', async ({
    page,
    request,
    clientIp,
  }) => {
    const poll = await createPollViaApi(request, clientIp);
    const headers = { 'CF-Connecting-IP': clientIp };
    const view = (await (await request.get(`/api/events/${poll.id}`, { headers })).json()) as EventView;
    for (const name of ['Ada', 'Grace', 'Linus']) {
      const res = await request.post(`/api/events/${poll.id}/participants`, {
        headers,
        data: { name, votes: { [view.options[0].id]: 'yes' }, turnstileToken: DUMMY_TURNSTILE_TOKEN },
      });
      expect(res.status()).toBe(201);
    }

    await page.goto(poll.participantUrl);
    const nameTile = page.getByRole('region', { name: 'Name' });
    const availability = page.getByRole('region', { name: 'Availability' });
    const results = page.getByRole('region', { name: 'Results' });
    // No need to wait for the verification widget: nothing is posted.
    await nameTile.getByRole('button', { name: 'Just take me to results' }).click();

    await expect(nameTile).toHaveCount(0);
    await expect(availability.getByRole('row', { name: /Ada/ })).toBeVisible();
    await expect(availability.getByRole('row', { name: /Linus/ })).toBeVisible();
    await expect(availability.locator('tfoot td.tally').nth(0)).toHaveText(/3\s*\/\s*0/);
    await expect(availability.getByRole('button', { name: /^Edit/ })).toHaveCount(0);
    await expect(availability.getByRole('button', { name: /suggest/i })).toHaveCount(0);
    await expect(results.getByRole('table', { name: 'Top dates' }).locator('tbody tr')).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Comments' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Share' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Join instead' }).click();
    await expect(nameField(page)).toBeFocused();
    await expect(availability).toHaveCount(0);
    await expect(results).toHaveCount(0);

    // The choice is not remembered: a reload asks for the name again.
    await nameTile.getByRole('button', { name: 'Just take me to results' }).click();
    await expect(results).toBeVisible();
    await page.reload();
    await expect(nameField(page)).toBeVisible();
    await expect(results).toHaveCount(0);
  });

  test("the organiser's join form does not offer it", async ({ page, request, clientIp }) => {
    const poll = await createPollViaApi(request, clientIp);
    await page.goto(poll.adminUrl);
    await page.getByRole('button', { name: 'Join this poll' }).click();
    await expect(nameField(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Just take me to results' })).toHaveCount(0);
  });
});
