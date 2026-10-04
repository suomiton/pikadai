import type { APIRequestContext } from '@playwright/test';
import type { CreateParticipantResponse, EventView } from '../shared/types';
import { createPollViaApi, DUMMY_TURNSTILE_TOKEN, expect, test } from './fixtures';
import { answerDate, nameField, waitForTurnstile } from './helpers';

const addAnswer = async (
  request: APIRequestContext,
  clientIp: string,
  pollId: string,
  name = 'Ada',
  adminToken: string | null = null,
) => {
  const headers = { 'CF-Connecting-IP': clientIp, ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}) };
  const view = (await (await request.get(`/api/events/${pollId}`, { headers })).json()) as EventView;
  const response = await request.post(`/api/events/${pollId}/participants`, {
    headers,
    data: { name, votes: { [view.options[0].id]: 'yes' }, turnstileToken: DUMMY_TURNSTILE_TOKEN },
  });
  expect(response.status()).toBe(201);
  const { id, editToken } = (await response.json()) as CreateParticipantResponse;
  const identity = { id, token: editToken };
  return { identity, hash: `#participant=${id}&token=${editToken}` };
};

test.describe('private links', () => {
  test('a saved profile blocks another person’s private link and its admin credential', async ({
    page,
    request,
    clientIp,
  }) => {
    const poll = await createPollViaApi(request, clientIp);
    const ada = await addAnswer(request, clientIp, poll.id);
    const grace = await addAnswer(request, clientIp, poll.id, 'Grace');
    await page.addInitScript(
      ({ id, identity }) => localStorage.setItem(`pikadai:participant:${id}`, JSON.stringify(identity)),
      { id: poll.id, identity: grace.identity },
    );
    let foreignVerifications = 0;
    page.on('request', (req) => {
      if (
        req.method() === 'GET' &&
        new URL(req.url()).pathname === `/api/events/${poll.id}/participants/${ada.identity.id}`
      )
        foreignVerifications++;
    });
    await page.goto(poll.participantUrl + ada.hash + `&admin=${poll.adminToken}`);
    await expect(page.getByRole('status').filter({ hasText: 'The other private link was not opened' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Grace/ }).getByText('you')).toBeVisible();
    await expect(page.getByRole('row', { name: /Ada/ }).getByText('you')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit Ada', exact: true })).toHaveCount(0);
    await expect(page.getByText('organiser view')).toHaveCount(0);
    await expect(page.getByLabel('Admin link')).toHaveCount(0);
    await expect(page.getByLabel('Your private link')).toHaveValue(
      new URL(poll.participantUrl + grace.hash, page.url()).href,
    );
    await page.getByRole('button', { name: 'Edit your answers' }).click();
    await answerDate(page, 0, 1);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('row', { name: /Grace/ }).getByRole('img', { name: 'If need be' })).toHaveCount(1);
    await expect(page.getByRole('row', { name: /Ada/ }).getByRole('img', { name: 'Yes' })).toHaveCount(1);
    await page.getByLabel('Add a comment').fill('Still using my own profile.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.comment-author')).toHaveText('Grace');
    expect(foreignVerifications).toBe(0);
    expect(
      await page.evaluate((id) => JSON.parse(localStorage.getItem(`pikadai:participant:${id}`)!), poll.id),
    ).toEqual(grace.identity);
    expect(await page.evaluate((id) => localStorage.getItem(`pikadai:admin:${id}`), poll.id)).toBeNull();
    await page.reload();
    await expect(page.getByRole('row', { name: /Grace/ }).getByText('you')).toBeVisible();
  });

  test('rejected and malformed links restore the saved name with a notice instead of inviting a duplicate join', async ({
    page,
    request,
    clientIp,
  }) => {
    const poll = await createPollViaApi(request, clientIp);
    await addAnswer(request, clientIp, poll.id);
    const grace = await addAnswer(request, clientIp, poll.id, 'Grace');
    await page.addInitScript(
      ({ id, identity }) => localStorage.setItem(`pikadai:participant:${id}`, JSON.stringify(identity)),
      { id: poll.id, identity: grace.identity },
    );
    for (const hash of [
      `#participant=${grace.identity.id}&token=${'x'.repeat(43)}`,
      '#participant=short&token=short',
    ]) {
      await page.goto(poll.participantUrl + hash);
      await expect(page.getByRole('row', { name: /Grace/ }).getByText('you')).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: 'This private link is no longer valid.' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Join', exact: true })).toHaveCount(0);
      await expect(page.getByLabel('Your private link')).toHaveValue(
        new URL(poll.participantUrl + grace.hash, page.url()).href,
      );
      await expect(page).toHaveURL(new URL(poll.participantUrl, page.url()).href);
      expect(
        await page.evaluate((id) => JSON.parse(localStorage.getItem(`pikadai:participant:${id}`)!), poll.id),
      ).toEqual(grace.identity);
    }
  });

  test('post-save refreshes do not make another verification request when that endpoint is rate limited', async ({
    page,
    request,
    clientIp,
  }) => {
    const poll = await createPollViaApi(request, clientIp);
    const ada = await addAnswer(request, clientIp, poll.id);
    let rateLimited = false;
    let verifications = 0;
    await page.route(`**/api/events/${poll.id}/participants/${ada.identity.id}`, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      verifications++;
      if (rateLimited) await route.fulfill({ status: 429, json: { error: 'Slow down', code: 'rate_limited' } });
      else await route.fallback();
    });
    await page.goto(poll.participantUrl + ada.hash);
    await expect(page.getByRole('row', { name: /Ada/ }).getByText('you')).toBeVisible();
    const initialVerifications = verifications;
    rateLimited = true;
    await page.getByRole('button', { name: 'Edit your answers' }).click();
    await answerDate(page, 0, 1);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('row', { name: /Ada/ }).getByRole('img', { name: 'If need be' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Change name' }).click();
    await nameField(page).fill('Ada L.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('You are in this poll as')).toContainText('Ada L.');
    await page.getByLabel('Add a comment').fill('No verification request needed after this save.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.comment-author')).toHaveText('Ada L.');
    expect(verifications).toBe(initialVerifications);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('restores answers after site data deletion and on another device, including edits and comments', async ({
    page,
    otherPerson,
    request,
    clientIp,
  }) => {
    const poll = await createPollViaApi(request, clientIp);
    const ada = await addAnswer(request, clientIp, poll.id);
    await addAnswer(request, clientIp, poll.id, 'Grace');
    const privateUrl = poll.participantUrl + ada.hash;
    const requests: string[] = [];
    page.on('request', (req) => requests.push(req.url()));
    await page.goto(privateUrl);
    await expect(page.getByRole('row', { name: /Ada/ }).getByText('you')).toBeVisible();
    await expect(page).toHaveURL(new URL(poll.participantUrl, page.url()).href);
    await expect(page.getByLabel('Your private link')).toHaveValue(new URL(privateUrl, page.url()).href);
    await page.evaluate(() => localStorage.clear());
    await page.goto(privateUrl);
    await expect(page.getByRole('row', { name: /Ada/ }).getByText('you')).toBeVisible();
    await expect(page).toHaveURL(new URL(poll.participantUrl, page.url()).href);
    expect(requests.every((url) => !url.includes(ada.identity.token))).toBe(true);

    // A fresh device can recover the same identity from the saved private link.
    const other = await otherPerson.newPage();
    await other.goto(new URL(privateUrl, page.url()).href);
    await expect(other.getByRole('row', { name: /Ada/ }).getByText('you')).toBeVisible();
    await expect(other.getByRole('row', { name: /Grace/ }).getByText('you')).toHaveCount(0);
    await expect(other.getByRole('button', { name: 'Edit Grace' })).toHaveCount(0);
    await other.getByRole('button', { name: 'Edit your answers' }).click();
    await answerDate(other, 0, 1); // yes → if need be
    await other.getByRole('button', { name: 'Save' }).click();
    await expect(other.getByRole('row', { name: /Ada/ }).getByRole('img', { name: 'If need be' })).toHaveCount(1);
    await other.getByRole('button', { name: 'Change name' }).click();
    await nameField(other).fill('Ada L.');
    await other.getByRole('button', { name: 'Save' }).click();
    await expect(other.getByText('You are in this poll as')).toContainText('Ada L.');
    await other.getByLabel('Add a comment').fill('This link works on my other device.');
    await other.getByRole('button', { name: 'Send', exact: true }).click();
    const comment = other.locator('.comment').filter({ hasText: 'This link works on my other device.' });
    await expect(comment.locator('.comment-author')).toHaveText('Ada L.');
    await expect(other.getByLabel('Poll link')).toHaveValue(new URL(poll.participantUrl, page.url()).href);

    await other.reload();
    await expect(other.getByRole('row', { name: /Ada L./ }).getByText('you')).toBeVisible();

    // The public link carries no participant credentials for a browser with no saved identity.
    await page.evaluate(() => localStorage.clear());
    await page.goto(poll.participantUrl);
    await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeVisible();
    await expect(page.getByLabel('Your private link')).toHaveCount(0);
  });

  test('upgrades a returning participant from the old localStorage format without creating another answer', async ({
    page,
    request,
    clientIp,
  }) => {
    const poll = await createPollViaApi(request, clientIp);
    const ada = await addAnswer(request, clientIp, poll.id);
    await page.addInitScript(({ key, identity }) => localStorage.setItem(key, JSON.stringify(identity)), {
      key: `pikadai:participant:${poll.id}`,
      identity: ada.identity,
    });
    await page.goto(poll.participantUrl);
    await expect(page).toHaveURL(new URL(poll.participantUrl, page.url()).href);
    await expect(page.getByRole('row', { name: /Ada/ }).getByText('you')).toBeVisible();
    await expect(page.getByLabel('Your private link')).toHaveValue(
      new URL(poll.participantUrl + ada.hash, page.url()).href,
    );
    expect(
      (
        (await (
          await request.get(`/api/events/${poll.id}`, { headers: { 'CF-Connecting-IP': clientIp } })
        ).json()) as EventView
      ).participants,
    ).toHaveLength(1);
  });

  test('joining with blocked storage keeps the address bar public and restores access by reopening the saved link', async ({
    page,
    request,
    clientIp,
  }) => {
    const poll = await createPollViaApi(request, clientIp);
    await page.addInitScript(() => {
      for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
        Storage.prototype[method] = () => {
          throw new DOMException('Storage is blocked', 'SecurityError');
        };
      }
    });
    await page.goto(poll.participantUrl);
    await expect(page.getByRole('note')).toContainText('save your private link');
    await nameField(page).fill('Ada');
    const join = page.getByRole('button', { name: 'Join', exact: true });
    await waitForTurnstile(join);
    await join.click();
    await expect(page.getByLabel('Your private link')).toHaveValue(
      /#participant=[A-Za-z0-9_-]{22}&token=[A-Za-z0-9_-]{43}$/,
    );
    await expect(page).toHaveURL(new URL(poll.participantUrl, page.url()).href);
    const privateUrl = await page.getByLabel('Your private link').inputValue();
    await expect(page.getByRole('note')).toContainText('reopen it after a reload');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeVisible();
    await page.goto(privateUrl);
    await expect(page.getByText('You are in this poll as')).toContainText('Ada');
    await expect(page.locator('tr.is-editing')).toHaveCount(1);
    await expect(page).toHaveURL(new URL(poll.participantUrl, page.url()).href);
    await answerDate(page, 0, 1);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('row', { name: /Ada/ }).getByRole('img', { name: 'Yes' })).toHaveCount(1);
  });

  test('rejects a forged link and removes the private fragment after an answer is deleted', async ({
    page,
    request,
    clientIp,
  }) => {
    const poll = await createPollViaApi(request, clientIp);
    const ada = await addAnswer(request, clientIp, poll.id);
    await page.goto(`${poll.participantUrl}#participant=${ada.identity.id}&token=${'x'.repeat(43)}`);
    await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'This private link is no longer valid.' })).toBeVisible();
    await expect(page.getByLabel('Your private link')).toHaveCount(0);
    await expect(page).toHaveURL(new URL(poll.participantUrl, page.url()).href);
    await page.goto(poll.participantUrl + ada.hash);
    await expect(page.getByRole('button', { name: 'Edit your answers' })).toBeVisible();
    expect(
      (
        await request.delete(`/api/events/${poll.id}/participants/${ada.identity.id}`, {
          headers: { 'CF-Connecting-IP': clientIp, Authorization: `Bearer ${ada.identity.token}` },
        })
      ).status(),
    ).toBe(204);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeVisible();
    await expect(page).toHaveURL(new URL(poll.participantUrl, page.url()).href);
    expect(await page.evaluate((id) => localStorage.getItem(`pikadai:participant:${id}`), poll.id)).toBeNull();
  });

  test('preserves an organiser session without attaching admin access to a guest private link', async ({
    page,
    otherPerson,
    request,
    clientIp,
  }) => {
    const poll = await createPollViaApi(request, clientIp);
    const ada = await addAnswer(request, clientIp, poll.id);
    const host = await addAnswer(request, clientIp, poll.id, 'Host', poll.adminToken);
    await page.addInitScript(
      ({ id, identity }) => localStorage.setItem(`pikadai:participant:${id}`, JSON.stringify(identity)),
      { id: poll.id, identity: host.identity },
    );
    await page.goto(poll.adminUrl);
    await expect(page.getByText('organiser view')).toBeVisible();
    await page.goto(poll.participantUrl + ada.hash);
    await expect(page.getByText('organiser view')).toBeVisible();
    await expect(page.getByRole('row', { name: /Host/ }).getByText('you')).toBeVisible();
    await expect(page.getByRole('row', { name: /Ada/ }).getByText('you')).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'The other private link was not opened' })).toBeVisible();
    await expect(page.getByLabel('Admin link')).toHaveValue(new URL(poll.adminUrl, page.url()).href);
    await expect(page.getByLabel('Poll link')).toHaveValue(new URL(poll.participantUrl, page.url()).href);
    const guestPrivateUrl = new URL(poll.participantUrl + ada.hash, page.url()).href;
    await expect(page.getByLabel('Your private link')).toHaveValue(
      new URL(poll.participantUrl + host.hash + `&admin=${poll.adminToken}`, page.url()).href,
    );
    await expect(page).toHaveURL(new URL(poll.participantUrl, page.url()).href);
    expect(
      await page.evaluate((id) => JSON.parse(localStorage.getItem(`pikadai:participant:${id}`)!), poll.id),
    ).toEqual(host.identity);
    // Without a saved profile, a guest link can open in this organiser's browser, but its copy field never gains admin access.
    await page.evaluate((id) => localStorage.removeItem(`pikadai:participant:${id}`), poll.id);
    await page.goto(guestPrivateUrl);
    await expect(page.getByRole('row', { name: /Ada/ }).getByText('you')).toBeVisible();
    await expect(page.getByLabel('Your private link')).toHaveValue(guestPrivateUrl);
    const other = await otherPerson.newPage();
    await other.goto(guestPrivateUrl);
    await expect(other.getByRole('row', { name: /Ada/ }).getByText('you')).toBeVisible();
    await expect(other.getByText('organiser view')).toHaveCount(0);
    await expect(other.getByRole('button', { name: 'Delete poll', exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('row', { name: /Host/ }).getByText('you')).toBeVisible();
    await expect(page.getByLabel('Your private link')).toHaveValue(
      new URL(poll.participantUrl + host.hash + `&admin=${poll.adminToken}`, page.url()).href,
    );
  });

  test('the organiser private link restores their name and all permissions on another device with blocked storage', async ({
    page,
    otherPerson,
    request,
    clientIp,
  }) => {
    const poll = await createPollViaApi(request, clientIp);
    await addAnswer(request, clientIp, poll.id, 'Guest');
    await page.goto(poll.adminUrl);
    await page.getByRole('button', { name: 'Join this poll' }).click();
    await nameField(page).fill('Host');
    const join = page.getByRole('button', { name: 'Join', exact: true });
    await waitForTurnstile(join);
    await join.click();
    await expect(page.getByLabel('Your private link')).toHaveValue(
      /#participant=[A-Za-z0-9_-]{22}&token=[A-Za-z0-9_-]{43}&admin=[A-Za-z0-9_-]{43}$/,
    );
    await expect(page).toHaveURL(new URL(poll.participantUrl, page.url()).href);
    await expect(page.getByRole('region', { name: 'Name', exact: true })).toContainText('edit or delete the poll');
    const privateUrl = await page.getByLabel('Your private link').inputValue();
    await answerDate(page, 0, 1);
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    // The public URL restores the saved organiser identity; only the private copy field contains credentials.
    await page.goto(poll.participantUrl);
    await expect(page).toHaveURL(new URL(poll.participantUrl, page.url()).href);
    await page.evaluate(() => localStorage.clear());
    await page.goto(privateUrl);
    await expect(page.getByText('organiser view')).toBeVisible();
    await expect(page.getByText('You are in this poll as')).toContainText('Host');

    const other = await otherPerson.newPage();
    await other.addInitScript(() => {
      for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
        Storage.prototype[method] = () => {
          throw new DOMException('Storage is blocked', 'SecurityError');
        };
      }
    });
    await other.goto(privateUrl);
    await expect(other.getByText('organiser view')).toBeVisible();
    await expect(other.getByRole('row', { name: /Host/ }).getByText('you')).toBeVisible();
    await expect(other.getByLabel('Your private link')).toHaveValue(privateUrl);

    await other.getByRole('button', { name: 'Edit details' }).click();
    await other.getByLabel('Title', { exact: true }).fill('Rescheduled board game night');
    await other.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(other.getByRole('heading', { level: 1 })).toHaveText('Rescheduled board game night');
    await other.getByRole('button', { name: 'Edit Guest', exact: true }).click();
    await other.locator('tr.is-editing').getByLabel('Name', { exact: true }).fill('Guest updated');
    await other.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(other.getByRole('row', { name: /Guest updated/ })).toBeVisible();
    await other.getByLabel('Add a comment').fill('Posted as the organiser from another device.');
    await other.getByRole('button', { name: 'Send', exact: true }).click();
    const comment = other.locator('.comment').filter({ hasText: 'Posted as the organiser from another device.' });
    await expect(comment.locator('.comment-author')).toHaveText('Host');
    await expect(comment.getByText('organiser', { exact: true })).toBeVisible();

    await expect(other).toHaveURL(new URL(poll.participantUrl, other.url()).href);
    await other.goto(privateUrl);
    await expect(other.getByText('organiser view')).toBeVisible();
    await expect(other).toHaveURL(new URL(poll.participantUrl, other.url()).href);
    await other.getByRole('button', { name: 'Delete poll', exact: true }).click();
    await other
      .getByRole('alertdialog', { name: 'Delete this poll?' })
      .getByRole('button', { name: 'Delete poll' })
      .click();
    await expect(other.getByRole('heading', { name: 'Find a date that works for everyone.' })).toBeVisible();
  });

  test('keeps the saved profile on fragment navigation and Back within the same poll', async ({
    page,
    request,
    clientIp,
  }) => {
    const poll = await createPollViaApi(request, clientIp);
    const ada = await addAnswer(request, clientIp, poll.id);
    const grace = await addAnswer(request, clientIp, poll.id, 'Grace');
    await page.goto(poll.participantUrl + ada.hash);
    await expect(page.getByRole('row', { name: /Ada/ }).getByText('you')).toBeVisible();
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, grace.hash);
    await expect(page.getByRole('status').filter({ hasText: 'The other private link was not opened' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Ada/ }).getByText('you')).toBeVisible();
    await expect(page.getByRole('row', { name: /Grace/ }).getByText('you')).toHaveCount(0);
    await expect(page.getByLabel('Your private link')).toHaveValue(
      new URL(poll.participantUrl + ada.hash, page.url()).href,
    );
    await expect(page).toHaveURL(new URL(poll.participantUrl, page.url()).href);
    await page.goBack();
    await expect(page.getByRole('row', { name: /Ada/ }).getByText('you')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'The other private link was not opened' })).toHaveCount(0);
  });

  test('keeps the poll readable during a verification outage and restores access on retry', async ({
    page,
    request,
    clientIp,
  }) => {
    const poll = await createPollViaApi(request, clientIp);
    const ada = await addAnswer(request, clientIp, poll.id);
    let failing = true;
    await page.route(`**/api/events/${poll.id}/participants/${ada.identity.id}`, (route) =>
      failing ? route.fulfill({ status: 503, json: { error: 'Unavailable', code: 'internal' } }) : route.fallback(),
    );
    await page.goto(poll.participantUrl + ada.hash);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Board game night');
    await expect(page.getByRole('alert')).toContainText('Could not confirm your private link.');
    await expect(page.getByRole('row', { name: /Ada/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit your answers' })).toHaveCount(0);
    await expect(page.getByLabel('Add a comment')).toHaveCount(0);
    await expect(page).toHaveURL(new URL(poll.participantUrl, page.url()).href);
    failing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('row', { name: /Ada/ }).getByText('you')).toBeVisible();
  });

  test('a verification that finishes after leaving the poll cannot put its secret in the home URL', async ({
    page,
    request,
    clientIp,
  }) => {
    const poll = await createPollViaApi(request, clientIp);
    const ada = await addAnswer(request, clientIp, poll.id);
    await page.addInitScript(({ key, identity }) => localStorage.setItem(key, JSON.stringify(identity)), {
      key: `pikadai:participant:${poll.id}`,
      identity: ada.identity,
    });
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const verificationStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const path = `/api/events/${poll.id}/participants/${ada.identity.id}`;
    await page.route(`**${path}`, async (route) => {
      started();
      await waiting;
      await route.fulfill({ status: 204 });
    });
    await page.goto(poll.participantUrl);
    await verificationStarted;
    await page.getByRole('link', { name: 'pikadai', exact: true }).click();
    await expect(page).toHaveURL('/');
    const response = page.waitForResponse((res) => new URL(res.url()).pathname === path);
    release();
    await response;
    // Let the fetch callbacks and the following React commit run before checking the resulting URL.
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Find a date that works for everyone.' })).toBeVisible();
  });
});
