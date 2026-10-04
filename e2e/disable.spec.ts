import type { APIRequestContext, Page } from '@playwright/test';
import type { CreateParticipantResponse, EventView } from '../shared/types';
import { createPollViaApi, DUMMY_TURNSTILE_TOKEN, expect, futureIso, test, type CreatedPoll } from './fixtures';
import { pickDate } from './helpers';

/** A poll where Ada and Grace have both said yes to the first date and Ada has commented. */
const seed = async (request: APIRequestContext, clientIp: string) => {
  const poll = await createPollViaApi(request, clientIp);
  const headers = { 'CF-Connecting-IP': clientIp };
  const view = (await (await request.get(`/api/events/${poll.id}`, { headers })).json()) as EventView;
  const join = async (name: string) => {
    const res = await request.post(`/api/events/${poll.id}/participants`, {
      headers,
      data: { name, votes: { [view.options[0].id]: 'yes' }, turnstileToken: DUMMY_TURNSTILE_TOKEN },
    });
    expect(res.status()).toBe(201);
    return (await res.json()) as CreateParticipantResponse;
  };
  const ada = await join('Ada');
  const grace = await join('Grace');
  const comment = await request.post(`/api/events/${poll.id}/comments`, {
    headers: { ...headers, Authorization: `Bearer ${ada.editToken}`, 'X-Participant-Id': ada.id },
    data: { body: 'Count me in.' },
  });
  expect(comment.status()).toBe(201);
  return { poll, ada, grace, headers };
};

const setDisabled = async (
  request: APIRequestContext,
  poll: CreatedPoll,
  participant: CreateParticipantResponse,
  disabled: boolean,
  headers: Record<string, string>,
) => {
  const res = await request.put(`/api/events/${poll.id}/participants/${participant.id}/disabled`, {
    headers: { ...headers, Authorization: `Bearer ${poll.adminToken}` },
    data: { disabled },
  });
  expect(res.status()).toBe(204);
};

const nameFieldLabel = (page: Page) => page.getByLabel('Your name');

const privateLink = (poll: CreatedPoll, p: CreateParticipantResponse) =>
  `${poll.participantUrl}#participant=${p.id}&token=${p.editToken}`;

test.describe('disabling a participant', () => {
  test('the organiser disables someone: others stop seeing them, the counts drop, and enabling restores them', async ({
    page,
    otherPerson,
    request,
    clientIp,
  }) => {
    const { poll, grace } = await seed(request, clientIp);
    await page.goto(poll.adminUrl);
    const firstTally = page.locator('tfoot td.tally').nth(0);
    await expect(firstTally).toHaveText(/2\s*\/\s*0/);

    await page.getByRole('button', { name: 'Edit Ada' }).click();
    await page.getByRole('button', { name: 'Disable' }).click();
    await expect(page.getByRole('button', { name: 'Edit Ada' })).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Ada was disabled' })).toHaveText(
      'Ada was disabled. Their answers no longer count, and only you can see them.',
    );
    const adaRow = page.getByRole('row', { name: /Ada/ });
    await expect(adaRow).toHaveClass(/is-disabled/);
    await expect(adaRow.locator('.tag-danger')).toHaveText('disabled');
    await expect(firstTally).toHaveText(/1\s*\/\s*0/);
    await expect(page.locator('thead .name-col')).toHaveText('1 answer');

    // Grace, in her own browser, no longer sees Ada's row or counts her answer; Ada's comment stays, marked.
    const other = await otherPerson.newPage();
    await other.goto(privateLink(poll, grace));
    await expect(other.getByRole('row', { name: /Grace/ })).toBeVisible();
    await expect(other.getByRole('row', { name: /Ada/ })).toHaveCount(0);
    await expect(other.locator('tfoot td.tally').nth(0)).toHaveText(/1\s*\/\s*0/);
    const comment = other.locator('.comment').filter({ hasText: 'Count me in.' });
    await expect(comment.locator('.comment-author')).toHaveText('Ada');
    await expect(comment.locator('.tag-danger')).toHaveText('disabled');

    await page.getByRole('button', { name: 'Edit Ada' }).click();
    await page.getByRole('button', { name: 'Enable' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Ada was enabled' })).toHaveText(
      'Ada was enabled again. Their answers count and everyone can see them.',
    );
    await expect(firstTally).toHaveText(/2\s*\/\s*0/);
    await other.reload();
    await expect(other.getByRole('row', { name: /Ada/ })).toBeVisible();
    await expect(other.locator('tfoot td.tally').nth(0)).toHaveText(/2\s*\/\s*0/);
  });

  test("the organiser's own row has no Disable button", async ({ page, request, clientIp }) => {
    const poll = await createPollViaApi(request, clientIp);
    const res = await request.post(`/api/events/${poll.id}/participants`, {
      headers: { 'CF-Connecting-IP': clientIp, Authorization: `Bearer ${poll.adminToken}` },
      data: { name: 'Olga', votes: {}, turnstileToken: DUMMY_TURNSTILE_TOKEN },
    });
    const olga = (await res.json()) as CreateParticipantResponse;
    await page.goto(`${privateLink(poll, olga)}&admin=${poll.adminToken}`);
    // Olga has not answered yet, so her row opens for editing by itself.
    await expect(page.locator('tbody tr.is-editing')).toContainText('Olga');
    await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Disable' })).toHaveCount(0);
  });

  test('a disabled participant still reads the poll but can change nothing, and gets it all back when enabled', async ({
    page,
    request,
    clientIp,
  }) => {
    const { poll, ada, headers } = await seed(request, clientIp);
    await setDisabled(request, poll, ada, true, headers);

    await page.goto(privateLink(poll, ada));
    const nameTile = page.getByRole('region', { name: 'Name' });
    await expect(nameTile).toContainText('the organiser has disabled you');
    await expect(nameTile.getByRole('button', { name: 'Change name' })).toHaveCount(0);
    await expect(page.getByRole('row', { name: /Ada/ }).locator('.tag-danger')).toHaveText('disabled');
    await expect(page.getByRole('button', { name: 'Edit your answers' })).toHaveCount(0);
    await expect(page.locator('tfoot td.tally').nth(0)).toHaveText(/1\s*\/\s*0/);
    await expect(page.getByLabel('Add a comment')).toHaveCount(0);
    await expect(page.getByText('so you can no longer comment')).toBeVisible();
    await expect(page.getByRole('button', { name: /suggest/i })).toHaveCount(0);

    // The identity survived being hidden: after enabling, the same browser is Ada again.
    await setDisabled(request, poll, ada, false, headers);
    await page.reload();
    await expect(nameTile.getByRole('button', { name: 'Change name' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit your answers' })).toBeVisible();
    await expect(page.getByLabel('Add a comment')).toBeVisible();
  });

  test('someone disabled while the page is open learns it on their next save, and the page turns read-only', async ({
    page,
    request,
    clientIp,
  }) => {
    const { poll, ada, headers } = await seed(request, clientIp);
    await page.goto(privateLink(poll, ada));
    await page.getByRole('button', { name: 'Edit your answers' }).click();
    await setDisabled(request, poll, ada, true, headers);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'The organiser has disabled you in this poll, so you can no longer change anything.',
    );
    await expect(page.getByRole('region', { name: 'Name' })).toContainText('the organiser has disabled you');
    await expect(page.getByLabel('Add a comment')).toHaveCount(0);
  });

  test("a disabled participant's link with a wrong admin token still opens as them", async ({
    page,
    request,
    clientIp,
  }) => {
    const { poll, ada, headers } = await seed(request, clientIp);
    await setDisabled(request, poll, ada, true, headers);
    await page.goto(`${privateLink(poll, ada)}&admin=${'x'.repeat(43)}`);
    await expect(page.getByRole('region', { name: 'Name' })).toContainText('the organiser has disabled you');
    await expect(page.getByText('This private link is no longer valid.')).toHaveCount(0);
    await expect(nameFieldLabel(page)).toHaveCount(0);
  });

  test('someone disabled while the page is open turns read-only when a date suggestion is refused', async ({
    page,
    request,
    clientIp,
  }) => {
    const { poll, ada, headers } = await seed(request, clientIp);
    await page.goto(privateLink(poll, ada));
    await page.getByRole('button', { name: 'Suggest a date' }).click();
    await setDisabled(request, poll, ada, true, headers);
    await pickDate(page, futureIso(30));
    const add = page.getByRole('button', { name: /^Add (?!your availability)/ });
    await add.scrollIntoViewIfNeeded();
    await add.click();
    await expect(page.getByRole('region', { name: 'Name' })).toContainText('the organiser has disabled you');
    await expect(page.getByRole('button', { name: 'Change name' })).toHaveCount(0);
    await expect(page.getByLabel('Add a comment')).toHaveCount(0);
  });

  test('someone disabled while the page is open turns read-only when removing their answers is refused', async ({
    page,
    request,
    clientIp,
  }) => {
    const { poll, ada, headers } = await seed(request, clientIp);
    await page.goto(privateLink(poll, ada));
    await page.getByRole('button', { name: 'Edit your answers' }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await setDisabled(request, poll, ada, true, headers);
    const dialog = page.getByRole('alertdialog', { name: 'Remove your answers?' });
    await dialog.getByRole('button', { name: 'Remove answers' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'The organiser has disabled you in this poll, so you can no longer change anything.',
    );
    await expect(page.getByRole('region', { name: 'Name' })).toContainText('the organiser has disabled you');
    await expect(page.getByLabel('Add a comment')).toHaveCount(0);
  });
});
