import type { APIRequestContext } from '@playwright/test';
import type { Answer, CreateParticipantResponse, EventView } from '../shared/types';
import { createPollViaApi, DUMMY_TURNSTILE_TOKEN, expect, test } from './fixtures';
import { answerDate, nameField } from './helpers';

const addParticipant = async (
  request: APIRequestContext,
  clientIp: string,
  pollId: string,
  name: string,
  votes: Record<string, Answer> = {},
) => {
  const response = await request.post(`/api/events/${pollId}/participants`, {
    headers: { 'CF-Connecting-IP': clientIp },
    data: { name, votes, turnstileToken: DUMMY_TURNSTILE_TOKEN },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as CreateParticipantResponse;
};

test('a removed participant closes the editor and leaves the other rows editable', async ({
  page,
  request,
  clientIp,
}) => {
  const poll = await createPollViaApi(request, clientIp);
  await addParticipant(request, clientIp, poll.id, 'Ada');
  const bob = await addParticipant(request, clientIp, poll.id, 'Bob');
  await page.goto(poll.adminUrl);
  await page.getByRole('button', { name: 'Edit Bob', exact: true }).click();
  await expect(page.locator('tr.is-editing').getByLabel('Name')).toHaveValue('Bob');

  const removed = await request.delete(`/api/events/${poll.id}/participants/${bob.id}`, {
    headers: { 'CF-Connecting-IP': clientIp, Authorization: `Bearer ${bob.editToken}` },
  });
  expect(removed.status()).toBe(204);

  // Saving organiser details refreshes the table while Bob's draft is still open.
  const organiser = page.getByRole('region', { name: 'Organiser', exact: true });
  await organiser.getByRole('button', { name: 'Edit details' }).click();
  await organiser.getByLabel('Title').fill('Updated poll');
  await organiser.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Updated poll' })).toBeVisible();
  await expect(page.locator('tr.is-editing')).toHaveCount(0);
  const editAda = page.getByRole('button', { name: 'Edit Ada', exact: true });
  await expect(editAda).toBeEnabled();
  await editAda.click();
  await expect(page.locator('tr.is-editing').getByLabel('Name')).toHaveValue('Ada');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
});

test('save announcements match the edited person and the visible results', async ({ page, request, clientIp }) => {
  const poll = await createPollViaApi(request, clientIp);
  const view = (await (
    await request.get(`/api/events/${poll.id}`, { headers: { 'CF-Connecting-IP': clientIp } })
  ).json()) as EventView;
  await addParticipant(request, clientIp, poll.id, 'Ada', { [view.options[0].id]: 'yes' });
  const grace = await addParticipant(request, clientIp, poll.id, 'Grace');
  await page.goto(`${poll.participantUrl}#participant=${grace.id}&token=${grace.editToken}`);
  await expect(page.locator('tr.is-editing')).toHaveCount(1);
  const availability = page.getByRole('region', { name: 'Availability', exact: true });
  const savedStatus = availability.getByRole('status').filter({ hasText: 'answers were saved.' });

  // An empty answer does not reveal other people's rows.
  await availability.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(savedStatus).toHaveText('Your answers were saved.');
  await expect(page.locator('tfoot')).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Ada/ })).toHaveCount(0);

  // A saved answer cannot reveal results until the refresh succeeds.
  let failNextRefresh = true;
  await page.route(
    (url) => url.pathname === `/api/events/${poll.id}`,
    async (route) => {
      if (route.request().method() === 'GET' && failNextRefresh) {
        failNextRefresh = false;
        await route.fulfill({ status: 500, json: { error: 'Temporary failure', code: 'internal' } });
      } else {
        await route.fallback();
      }
    },
  );
  await page.getByRole('button', { name: 'Edit your answers' }).click();
  await answerDate(page, 0, 1);
  await availability.getByRole('button', { name: 'Save', exact: true }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Could not refresh the poll.' });
  await expect(alert).toBeVisible();
  await expect(savedStatus).toHaveText('Your answers were saved.');
  await expect(page.locator('tfoot')).toHaveCount(0);
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('row', { name: /Ada/ })).toBeVisible();

  // Organisers hear the updated name when saving somebody else's row.
  await page.goto(poll.adminUrl);
  await page.getByRole('button', { name: 'Edit Ada', exact: true }).click();
  await page.locator('tr.is-editing').getByLabel('Name').fill('Ada Updated');
  await availability.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(savedStatus).toHaveText("Ada Updated's answers were saved.");
  await expect(page.getByRole('row', { name: /Ada Updated/ })).toBeVisible();
});

test("retrying a poll refresh does not refocus the organiser's open join form", async ({ page, request, clientIp }) => {
  const poll = await createPollViaApi(request, clientIp);
  await page.goto(poll.adminUrl);
  await page.getByRole('button', { name: 'Join this poll' }).click();
  await expect(nameField(page)).toBeFocused();
  await nameField(page).fill('Draft host');

  let failNextRefresh = true;
  await page.route(
    (url) => url.pathname === `/api/events/${poll.id}`,
    async (route) => {
      if (route.request().method() === 'GET' && failNextRefresh) {
        failNextRefresh = false;
        await route.fulfill({ status: 500, json: { error: 'Temporary failure', code: 'internal' } });
      } else {
        await route.fallback();
      }
    },
  );
  const organiser = page.getByRole('region', { name: 'Organiser', exact: true });
  await organiser.getByRole('button', { name: 'Edit details' }).click();
  await organiser.getByLabel('Title').fill('Updated poll');
  await organiser.getByRole('button', { name: 'Save', exact: true }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Could not refresh the poll.' });
  await expect(alert).toBeVisible();
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Updated poll' })).toBeVisible();
  await expect(nameField(page)).toHaveValue('Draft host');
  await expect(nameField(page)).not.toBeFocused();
});
