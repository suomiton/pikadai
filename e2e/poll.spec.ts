import type { EventView } from '../shared/types';
import { createPollViaApi, DUMMY_TURNSTILE_TOKEN, expect, futureIso, test } from './fixtures';
import { answerDate, nameField, pickDate, waitForTurnstile } from './helpers';

test.describe('creating a poll', () => {
  test('walks through the form, the progress dialog and lands on the organiser view', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('What are you planning?').fill('Team dinner');
    await page.getByLabel('Details').fill('Somewhere central.');
    await pickDate(page, futureIso(20));
    await pickDate(page, futureIso(21));
    await expect(page.getByRole('list', { name: 'Selected dates' }).getByRole('listitem')).toHaveCount(2);

    const create = page.getByRole('button', { name: 'Create poll' });
    await waitForTurnstile(create);
    await create.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Creating your poll' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Creating your poll' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('heading', { name: 'Creating your poll' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/e\/[A-Za-z0-9_-]{22}$/, { timeout: 20_000 });

    await expect(page.getByRole('heading', { level: 1, name: 'Team dinner' })).toBeVisible();
    await expect(page.getByText('organiser view')).toBeVisible();
    await expect(page.getByLabel('Admin link')).toHaveValue(/#admin=[A-Za-z0-9_-]{43}$/);
    await expect(page.getByLabel('Participant link')).toHaveValue(
      new RegExp(`${page.url().replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}$`),
    );
  });

  test('refuses to proceed without a title or dates and focuses the first problem', async ({ page }) => {
    await page.goto('/');
    const create = page.getByRole('button', { name: 'Create poll' });
    await waitForTurnstile(create);
    await create.click();
    const title = page.getByLabel('What are you planning?');
    await expect(title).toBeFocused();
    await expect(title).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Title is required')).toBeVisible();
    await expect(page.getByText('Pick at least one date')).toBeVisible();
    await expect(page).toHaveURL('/');
  });

  test('a creation failure focuses the way back and restores focus to the form', async ({ page }) => {
    await page.route('**/api/tickets', (route) =>
      route.fulfill({ status: 500, json: { error: 'Creation failed', code: 'internal' } }),
    );
    await page.goto('/');
    const title = page.getByLabel('What are you planning?');
    await title.fill('Team dinner');
    await pickDate(page, futureIso(20));
    const create = page.getByRole('button', { name: 'Create poll' });
    await waitForTurnstile(create);
    await create.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Could not create the poll' });
    const back = dialog.getByRole('button', { name: 'Back to the form' });
    await expect(dialog.getByRole('alert')).toHaveText('Something went wrong on our side. Please try again.');
    await expect(back).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(back).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(back).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    // Resetting Turnstile can temporarily disable the submit button; the title is the fallback.
    await expect
      .poll(() =>
        title.or(create).evaluateAll((elements) => elements.some((element) => element === document.activeElement)),
      )
      .toBe(true);
    await expect(title).toHaveValue('Team dinner');
    await expect(page.getByRole('list', { name: 'Selected dates' }).getByRole('listitem')).toHaveCount(1);
  });
});

test.describe('answering a poll', () => {
  test('a participant joins with a name, answers in the row that opens and can change it later', async ({
    page,
    request,
    clientIp,
  }) => {
    const poll = await createPollViaApi(request, clientIp);
    await page.goto(poll.participantUrl);
    await expect(page.getByRole('heading', { level: 1, name: 'Board game night' })).toBeVisible();

    // Step one: only the Name tile. No table, no comments, no share links yet.
    await expect(page.getByRole('heading', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Comments' })).toHaveCount(0);
    await expect(page.getByLabel('Participant link')).toHaveCount(0);
    await nameField(page).fill('Ada');
    const join = page.getByRole('button', { name: 'Join' });
    await waitForTurnstile(join);
    await join.click();

    // Step two: the new row opens for editing with focus on its first date cell, alone in the table.
    const editing = page.locator('tbody tr.is-editing');
    await expect(editing).toHaveCount(1);
    await expect(editing.locator('.participant-name')).toHaveText('Ada');
    await expect(editing.locator('button.vote-btn').first()).toBeFocused();
    await expect(page).toHaveURL(/#participant=[A-Za-z0-9_-]{22}&token=[A-Za-z0-9_-]{43}$/);
    await expect(page.getByLabel('Your private link')).toHaveValue(page.url());
    await expect(page.getByText('You are in this poll as')).toContainText('Ada');
    await expect(page.getByRole('button', { name: 'Join' })).toHaveCount(0);
    await expect(page.getByText('Answer at least one date and save to see what others have answered.')).toBeVisible();
    await expect(page.locator('tfoot')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Comments' })).toBeVisible();
    await expect(page.getByLabel('Participant link')).toHaveCount(0);
    await answerDate(page, 0, 1); // yes
    await answerDate(page, 1, 2); // if need be
    await page.getByRole('button', { name: 'Save' }).click();

    // Step three: everyone's answers, the tallies and the share links.
    const row = page.getByRole('row', { name: /Ada/ });
    await expect(row).toBeVisible();
    await expect(row.getByText('you')).toBeVisible();
    // Focus lands on the nearest control once the editor has closed and the request has finished.
    await expect(page.getByRole('button', { name: 'Edit your answers' })).toBeFocused();
    await expect(row.getByRole('img', { name: 'Yes' })).toHaveCount(1);
    await expect(row.getByRole('img', { name: 'If need be' })).toHaveCount(1);
    await expect(page.getByRole('status').filter({ hasText: 'Your answers were saved.' })).toBeAttached();
    await expect(page.locator('tfoot')).toHaveCount(1);
    await expect(page.getByLabel('Participant link')).toBeVisible();
    await expect(page.getByLabel('Participant link')).toHaveValue(new URL(poll.participantUrl, page.url()).href);

    // The identity survives the re-fetch, so this browser can still edit the answer after a reload.
    await page.reload();
    await expect(page.getByRole('row', { name: /Ada/ }).getByText('you')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join' })).toHaveCount(0);

    const tallies = page.locator('tfoot td.tally');
    await expect(tallies.nth(0)).toHaveText(/1\s*\/\s*0/);
    await expect(tallies.nth(1)).toHaveText(/0\s*\/\s*1/);

    await page.getByRole('button', { name: 'Edit your answers' }).click();
    await answerDate(page, 0, 1); // yes → if need be
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(tallies.nth(0)).toHaveText(/0\s*\/\s*1/);
    await expect(page.getByRole('button', { name: 'Edit your answers' })).toBeFocused();

    // The name is changed in the Name tile; the row follows.
    await page.getByRole('button', { name: 'Change name' }).click();
    await nameField(page).fill('Ada L.');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('row', { name: /Ada L\./ }).getByText('you')).toBeVisible();
    await expect(page.getByText('You are in this poll as')).toContainText('Ada L.');
    await expect(page.getByRole('button', { name: 'Change name' })).toBeFocused();
  });

  test('a participant sees nobody else until they have answered a date', async ({ page, request, clientIp }) => {
    const poll = await createPollViaApi(request, clientIp);
    const headers = { 'CF-Connecting-IP': clientIp };
    const view = (await (await request.get(`/api/events/${poll.id}`, { headers })).json()) as EventView;
    const answered = await request.post(`/api/events/${poll.id}/participants`, {
      headers,
      data: { name: 'Ada', votes: { [view.options[0].id]: 'yes' }, turnstileToken: DUMMY_TURNSTILE_TOKEN },
    });
    expect(answered.status()).toBe(201);

    await page.goto(poll.participantUrl);
    await expect(page.getByRole('table')).toHaveCount(0);
    await nameField(page).fill('Grace');
    const join = page.getByRole('button', { name: 'Join' });
    await waitForTurnstile(join);
    await join.click();
    await expect(page.locator('tbody tr.is-editing')).toHaveCount(1);
    await expect(page.getByRole('row', { name: /Ada/ })).toHaveCount(0);
    await expect(page.locator('tfoot')).toHaveCount(0);

    // Cancelling keeps the row closed, and still alone, until an answer is saved.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Edit your answers' })).toBeFocused();
    await expect(page.getByRole('row', { name: /Ada/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit your answers' }).click();
    await answerDate(page, 0, 3); // no
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('row', { name: /Ada/ })).toBeVisible();
    await expect(page.locator('tfoot td.tally').nth(0)).toHaveText(/1\s*\/\s*0/);
  });

  test('two people cannot use the same name, ignoring case', async ({ page, otherPerson, request, clientIp }) => {
    const poll = await createPollViaApi(request, clientIp);
    await page.goto(poll.participantUrl);
    await nameField(page).fill('Grace');
    const join = page.getByRole('button', { name: 'Join' });
    await waitForTurnstile(join);
    await join.click();
    await expect(page.locator('tbody tr.is-editing')).toHaveCount(1);

    const other = await otherPerson.newPage();
    await other.goto(poll.participantUrl);
    await nameField(other).fill('grace');
    const otherJoin = other.getByRole('button', { name: 'Join' });
    await waitForTurnstile(otherJoin);
    await otherJoin.click();
    await expect(other.getByRole('alert')).toHaveText('Someone in this poll already uses that name.');
    // Still at the first step, with the draft kept and a fresh token for the next attempt.
    await expect(other.getByRole('table')).toHaveCount(0);
    await expect(nameField(other)).toHaveValue('grace');
    await waitForTurnstile(otherJoin);
  });

  test('a participant comments once per page load, within the limit, and others read it', async ({
    page,
    otherPerson,
    request,
    clientIp,
  }) => {
    const poll = await createPollViaApi(request, clientIp);
    await page.goto(poll.participantUrl);
    await expect(page.getByRole('heading', { name: 'Comments' })).toHaveCount(0);

    await nameField(page).fill('Ada');
    const join = page.getByRole('button', { name: 'Join' });
    await waitForTurnstile(join);
    await join.click();
    await expect(page.locator('tbody tr.is-editing')).toHaveCount(1);
    await page.getByRole('button', { name: 'Cancel' }).click(); // commenting without answering is fine
    await expect(page.getByText('No comments yet.')).toBeVisible();

    const comment = page.getByLabel('Add a comment');
    await expect(comment).toBeVisible();
    await expect(comment).toHaveAccessibleDescription('0 / 512');
    await comment.fill('I can host if Saturday wins.');
    await expect(page.getByText('28 / 512')).toBeVisible();

    // The limit is enforced by the field itself, and the field grows so the whole text stays in view.
    const shortHeight = await comment.evaluate((el) => el.getBoundingClientRect().height);
    await comment.fill('x'.repeat(600));
    await expect(comment).toHaveValue('x'.repeat(512));
    await expect(page.getByText('512 / 512')).toBeVisible();
    await comment.fill(Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n'));
    const tall = await comment.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      overflow: el.scrollHeight - el.clientHeight,
    }));
    expect(tall.height).toBeGreaterThan(shortHeight * 2);
    expect(tall.overflow).toBeLessThanOrEqual(1);
    // A narrower window wraps more lines; the field follows without a further keystroke.
    const viewport = page.viewportSize()!;
    await comment.fill('word '.repeat(90).trim());
    await page.setViewportSize({ width: 320, height: viewport.height });
    await expect.poll(() => comment.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    await page.setViewportSize(viewport);
    await expect.poll(() => comment.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);

    await comment.fill('I can host if Saturday wins.');
    await page.getByRole('button', { name: 'Send' }).click();

    const posted = page.getByRole('listitem').filter({ hasText: 'I can host if Saturday wins.' });
    await expect(posted).toBeVisible();
    await expect(posted).toContainText('Ada');
    await expect(posted.getByText('you')).toBeVisible();
    await expect(posted.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
    await expect(posted.locator('time')).not.toBeEmpty();
    await expect(page.getByRole('status').filter({ hasText: 'Your comment was posted.' })).toBeAttached();

    // One comment per page load: the form is gone until the page is reloaded.
    await expect(page.getByLabel('Add a comment')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send' })).toHaveCount(0);
    const note = page.getByText('Your comment was posted. Reload the page to write another.');
    await expect(note).toBeVisible();
    await expect(note).toBeFocused();
    await page.reload();
    await expect(page.getByLabel('Add a comment')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'I can host if Saturday wins.' })).toBeVisible();

    // Comments are for people in the poll: the other person joins and reads it under Ada's name.
    const other = await otherPerson.newPage();
    await other.goto(poll.participantUrl);
    await expect(other.getByRole('heading', { name: 'Comments' })).toHaveCount(0);
    await nameField(other).fill('Grace');
    const otherJoin = other.getByRole('button', { name: 'Join' });
    await waitForTurnstile(otherJoin);
    await otherJoin.click();
    await expect(other.locator('tbody tr.is-editing')).toHaveCount(1);
    const seen = other.getByRole('listitem').filter({ hasText: 'I can host if Saturday wins.' });
    await expect(seen).toContainText('Ada');
    await expect(seen.getByText('you')).toHaveCount(0);
    await expect(other.getByLabel('Add a comment')).toBeVisible();
  });

  test('a participant can suggest another date', async ({ page, request, clientIp }) => {
    const poll = await createPollViaApi(request, clientIp);
    await page.goto(poll.participantUrl);
    await nameField(page).fill('Ada');
    const join = page.getByRole('button', { name: 'Join' });
    await waitForTurnstile(join);
    await join.click();
    await expect(page.locator('thead th.option-col')).toHaveCount(3);

    await page.getByRole('button', { name: 'Suggest a date' }).click();
    await pickDate(page, futureIso(30));
    // On a phone the Add button sits below the fold. Bring it on screen and wait until it is there, so
    // the click needs no scroll of its own; a click straight after Playwright's scroll once landed on
    // what occupied that spot before the scroll, because compositor hit-test data lags on slow machines.
    const add = page.getByRole('button', { name: /^Add (?!your availability)/ });
    await add.scrollIntoViewIfNeeded();
    await expect(add).toBeInViewport();
    await add.click();

    await expect(page.locator('thead th.option-col')).toHaveCount(4);
    await expect(page.getByRole('status').filter({ hasText: 'was added to the poll.' })).toBeAttached();
  });
});

test.describe('organising a poll', () => {
  test('the admin link grants the organiser view in a fresh browser and is scrubbed from the address bar', async ({
    page,
    request,
    clientIp,
  }) => {
    const poll = await createPollViaApi(request, clientIp);
    await page.goto(poll.adminUrl);
    await expect(page.getByText('organiser view')).toBeVisible();
    await expect(page).toHaveURL(poll.participantUrl);
    await expect(page.getByRole('heading', { name: 'Organiser' })).toBeVisible();

    await page.reload();
    await expect(page.getByText('organiser view')).toBeVisible();
  });

  test('the organiser keeps access when the browser blocks storage', async ({ page }) => {
    // Firefox with site data blocked and some private modes throw on every localStorage access.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('Storage is blocked', 'SecurityError');
        },
      });
    });
    await page.goto('/');
    await page.getByLabel('What are you planning?').fill('No storage');
    await pickDate(page, futureIso(20));
    const create = page.getByRole('button', { name: 'Create poll' });
    await waitForTurnstile(create);
    await create.click();

    await expect(page).toHaveURL(/\/e\/[A-Za-z0-9_-]{22}$/, { timeout: 20_000 });
    await expect(page.getByText('organiser view')).toBeVisible();
    await expect(page.getByLabel('Admin link')).toHaveValue(/#admin=[A-Za-z0-9_-]{43}$/);
    await expect(page.getByRole('note').filter({ hasText: 'organiser link' })).toBeVisible();
    // The join form carries its own notice once the organiser opens it.
    await page.getByRole('button', { name: 'Join this poll' }).click();
    await expect(page.getByRole('note').filter({ hasText: 'not saving site data' })).toHaveCount(2);
  });

  test('the organiser joins under a name and is marked on their row and their comments', async ({
    page,
    otherPerson,
    request,
    clientIp,
  }) => {
    const poll = await createPollViaApi(request, clientIp);
    await page.goto(poll.adminUrl);
    // The organiser sees everything from the start; the Name tile offers to join, without the widget
    // until asked.
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Join this poll' }).click();
    await expect(nameField(page)).toBeFocused();
    await nameField(page).fill('Host');
    const join = page.getByRole('button', { name: 'Join', exact: true });
    await waitForTurnstile(join);
    await join.click();
    await expect(page.locator('tbody tr.is-editing')).toHaveCount(1);
    await page.getByRole('button', { name: 'Save' }).click();
    const row = page.getByRole('row', { name: /Host/ });
    await expect(row.getByText('you')).toBeVisible();
    await expect(row.getByText('organiser', { exact: true })).toBeVisible();

    await page.getByLabel('Add a comment').fill('Welcome, everyone.');
    await page.getByRole('button', { name: 'Send' }).click();
    const comment = page.getByRole('listitem').filter({ hasText: 'Welcome, everyone.' });
    await expect(comment.getByText('organiser', { exact: true })).toBeVisible();

    // A participant sees the pill on the organiser's comment at once and on their row once they have
    // answered; their own row gets none.
    const other = await otherPerson.newPage();
    await other.goto(poll.participantUrl);
    await nameField(other).fill('Guest');
    const otherJoin = other.getByRole('button', { name: 'Join' });
    await waitForTurnstile(otherJoin);
    await otherJoin.click();
    await expect(other.locator('tbody tr.is-editing')).toHaveCount(1);
    await expect(
      other.getByRole('listitem').filter({ hasText: 'Welcome, everyone.' }).getByText('organiser', { exact: true }),
    ).toBeVisible();
    await answerDate(other, 0, 1);
    await other.getByRole('button', { name: 'Save' }).click();
    await expect(other.getByRole('row', { name: /Host/ }).getByText('organiser', { exact: true })).toBeVisible();
    const guest = other.getByRole('row', { name: /Guest/ });
    await expect(guest.getByText('you')).toBeVisible();
    await expect(guest.getByText('organiser', { exact: true })).toHaveCount(0);
  });

  test('a visitor without the admin link gets no organiser controls', async ({ page, request, clientIp }) => {
    const poll = await createPollViaApi(request, clientIp);
    await page.goto(poll.participantUrl);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('organiser view')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Organiser' })).toHaveCount(0);
    await expect(page.getByLabel('Admin link')).toHaveCount(0);
  });

  test('the organiser edits the details, removes a date and deletes the poll', async ({ page, request, clientIp }) => {
    const poll = await createPollViaApi(request, clientIp);
    await page.goto(poll.adminUrl);

    await page.getByRole('button', { name: 'Edit details' }).click();
    await page.getByLabel('Title').fill('Board game night, round two');
    await page.getByLabel('Participants may suggest other dates').uncheck();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Board game night, round two' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit details' })).toBeFocused();

    await page
      .getByRole('button', { name: /^Remove .*/ })
      .first()
      .click();
    await page
      .getByRole('alertdialog', { name: 'Remove this date?' })
      .getByRole('button', { name: 'Remove date' })
      .click();
    await expect(page.locator('thead th.option-col')).toHaveCount(2);
    await expect(page.getByRole('region', { name: 'Availability table, scrolls sideways' })).toBeFocused();

    await page.getByRole('button', { name: 'Delete poll' }).click();
    await page
      .getByRole('alertdialog', { name: 'Delete this poll?' })
      .getByRole('button', { name: 'Delete poll' })
      .click();
    await expect(page).toHaveURL('/');

    await page.goto(poll.participantUrl);
    await expect(page.getByRole('heading', { name: 'Poll unavailable' })).toBeVisible();
    await expect(page.getByText('This poll does not exist or was deleted.')).toBeVisible();
  });

  test('the top dates appear once three people have answered', async ({ page, request, clientIp }) => {
    const poll = await createPollViaApi(request, clientIp);
    const headers = { 'CF-Connecting-IP': clientIp };
    const view = (await (await request.get(`/api/events/${poll.id}`, { headers })).json()) as EventView;
    const [first, second, third] = view.options;
    const answer = async (name: string, votes: Record<string, string>) => {
      const res = await request.post(`/api/events/${poll.id}/participants`, {
        headers,
        data: { name, votes, turnstileToken: DUMMY_TURNSTILE_TOKEN },
      });
      expect(res.status()).toBe(201);
    };
    await answer('Ada', { [first.id]: 'yes', [second.id]: 'yes', [third.id]: 'no' });
    await answer('Grace', { [first.id]: 'yes', [second.id]: 'maybe' });

    await page.goto(poll.adminUrl);
    const organiser = page.getByRole('region', { name: 'Organiser' });
    await expect(organiser.getByText('once three people have answered')).toBeVisible();
    await expect(organiser.getByRole('table')).toHaveCount(0);

    await answer('Linus', { [first.id]: 'yes', [second.id]: 'no', [third.id]: 'yes' });
    await page.reload();
    const rows = organiser.getByRole('table', { name: 'Top dates' }).locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText(/3\s*\/\s*3/);
    await expect(rows.nth(0)).toContainText('100%');
    // Both remaining dates have one yes; the one with an if-need-be answer ranks first.
    await expect(rows.nth(1)).toContainText(/1\s*\/\s*3/);
    await expect(rows.nth(1)).toContainText('33%');
    await expect(rows.nth(1)).toContainText(String(Number(second.date.slice(-2))));
    await expect(rows.nth(2)).toContainText(/1\s*\/\s*3/);
    await expect(rows.nth(2)).toContainText(String(Number(third.date.slice(-2))));
  });

  test('turning suggestions off hides the picker from participants', async ({
    page,
    otherPerson,
    request,
    clientIp,
  }) => {
    const poll = await createPollViaApi(request, clientIp, { allowSuggestions: false });
    const other = await otherPerson.newPage();
    await other.goto(poll.participantUrl);
    await nameField(other).fill('Grace');
    const join = other.getByRole('button', { name: 'Join' });
    await waitForTurnstile(join);
    await join.click();
    await expect(other.locator('tbody tr.is-editing')).toHaveCount(1);
    await expect(other.getByRole('button', { name: 'Suggest a date' })).toHaveCount(0);

    await page.goto(poll.adminUrl);
    await expect(page.getByRole('button', { name: 'Add a date' })).toBeVisible();
  });
});

test.describe('when the poll changes underneath', () => {
  test('removing a date under an open answer keeps the rest of the draft saveable', async ({
    page,
    request,
    clientIp,
  }) => {
    const poll = await createPollViaApi(request, clientIp);
    const headers = { 'CF-Connecting-IP': clientIp };
    const view = (await (await request.get(`/api/events/${poll.id}`, { headers })).json()) as EventView;
    const [first, second] = view.options;
    const answered = await request.post(`/api/events/${poll.id}/participants`, {
      headers,
      data: {
        name: 'Ada',
        votes: { [first.id]: 'yes', [second.id]: 'yes' },
        turnstileToken: DUMMY_TURNSTILE_TOKEN,
      },
    });
    expect(answered.status()).toBe(201);

    await page.goto(poll.adminUrl);
    await page.getByRole('button', { name: 'Edit Ada' }).click();
    await page.locator('tr.is-editing').getByLabel('Name').fill('Ada B.');

    // The organiser removes the first date while the answer is still open for editing.
    await page
      .getByRole('button', { name: /^Remove .+/ })
      .first()
      .click();
    await page
      .getByRole('alertdialog', { name: 'Remove this date?' })
      .getByRole('button', { name: 'Remove date' })
      .click();
    await expect(page.locator('thead th.option-col')).toHaveCount(2);
    await expect(page.locator('tbody tr.is-editing')).toHaveCount(1);
    await expect(page.locator('tr.is-editing').getByLabel('Name')).toHaveValue('Ada B.');

    await page.getByRole('button', { name: 'Save' }).click();
    const row = page.getByRole('row', { name: /Ada B\./ });
    await expect(row).toBeVisible();
    await expect(row.getByRole('img', { name: 'Yes' })).toHaveCount(1);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('a failed refresh keeps the poll and an open draft on screen, and retry recovers', async ({
    page,
    request,
    clientIp,
  }) => {
    const poll = await createPollViaApi(request, clientIp);
    await page.goto(poll.adminUrl);
    await page.getByRole('button', { name: 'Edit details' }).click();
    await page.getByLabel('Title').fill('Draft title');

    // The next re-fetch of the poll fails; the mutation before it succeeds.
    let failures = 0;
    await page.route(
      (url) => url.pathname === `/api/events/${poll.id}`,
      async (route) => {
        if (route.request().method() === 'GET' && failures++ === 0) {
          await route.fulfill({ status: 500, json: { error: 'Something broke', code: 'internal' } });
        } else {
          await route.fallback();
        }
      },
    );
    await page.getByRole('button', { name: 'Add a date' }).click();
    await pickDate(page, futureIso(30));
    await page.getByRole('button', { name: /^Add (?!your availability)/ }).click();

    const alert = page.getByRole('alert').filter({ hasText: 'Could not refresh the poll.' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Something went wrong on our side.');
    await expect(page.getByRole('heading', { level: 1, name: 'Board game night' })).toBeVisible();
    await expect(page.getByLabel('Title')).toHaveValue('Draft title');
    await expect(page.locator('thead th.option-col')).toHaveCount(3);

    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('thead th.option-col')).toHaveCount(4);
    await expect(page.getByLabel('Title')).toHaveValue('Draft title');
  });
});

test.describe('layout', () => {
  test('the poll page does not scroll sideways; only the table does', async ({ page, request, clientIp }) => {
    // Enough dates that the table is wider than a phone.
    const dates = [14, 15, 16, 17, 18].map(futureIso);
    const poll = await createPollViaApi(request, clientIp, { dates });
    await page.goto(poll.adminUrl);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const widths = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(widths.page).toBe(widths.viewport);
  });

  test('a scrolled table shows only the name column at its left edge', async ({ page, request, clientIp }) => {
    // A phone width, so the table scrolls in both the desktop and the mobile project.
    await page.setViewportSize({ width: 390, height: 780 });
    const dates = [14, 15, 16, 17, 18, 19, 20, 21].map(futureIso);
    const poll = await createPollViaApi(request, clientIp, { dates });
    const headers = { 'CF-Connecting-IP': clientIp };
    const view = (await (await request.get(`/api/events/${poll.id}`, { headers })).json()) as EventView;
    const answered = await request.post(`/api/events/${poll.id}/participants`, {
      headers,
      data: {
        name: 'Ada',
        votes: Object.fromEntries(view.options.map((option) => [option.id, 'yes'])),
        turnstileToken: DUMMY_TURNSTILE_TOKEN,
      },
    });
    expect(answered.status()).toBe(201);

    await page.goto(poll.adminUrl); // the organiser sees every row without joining
    await expect(page.getByRole('row', { name: /Ada/ })).toBeVisible();

    // Whatever is painted at the scroller's left edge must be the sticky name column, not dates,
    // answers or tallies that have scrolled underneath it.
    const scroller = page.locator('.table-scroll');
    for (const scrollLeft of [150, 300, 'end'] as const) {
      await scroller.evaluate((el, to) => {
        el.scrollLeft = to === 'end' ? el.scrollWidth : to;
      }, scrollLeft);
      const strayCells = await scroller.evaluate((el) => {
        const x = el.getBoundingClientRect().left + 1;
        const stray: string[] = [];
        for (const row of Array.from(el.querySelectorAll('tr'))) {
          const { top, height } = row.getBoundingClientRect();
          const cell = document.elementFromPoint(x, top + height / 2)?.closest('td, th');
          if (cell && !cell.classList.contains('name-col'))
            stray.push(`${cell.tagName.toLowerCase()}.${cell.className}`);
        }
        return stray;
      });
      expect(strayCells, `scrolled to ${scrollLeft}`).toEqual([]);
    }
  });

  test('the footer link text and icon line up with the copyright text', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer.site-footer');
    await expect(footer).toBeVisible();

    const { copyrightTop, linkTextTop, linkTextMiddle, iconMiddle } = await footer.evaluate((el) => {
      const link = el.querySelector('a')!;
      const textNode = (parent: Element, match: (text: string) => boolean) =>
        Array.from(parent.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && match(n.textContent ?? ''))!;
      const box = (node: Node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect();
      };
      const copyright = box(textNode(el, (text) => text.includes('Copyright')));
      const linkText = box(textNode(link, (text) => text.trim() !== ''));
      const icon = link.querySelector('svg')!.getBoundingClientRect();
      return {
        copyrightTop: copyright.top,
        linkTextTop: linkText.top,
        linkTextMiddle: (linkText.top + linkText.bottom) / 2,
        iconMiddle: (icon.top + icon.bottom) / 2,
      };
    });

    // Both texts are in the same font, so their boxes share a top only if they share a baseline.
    expect(Math.abs(linkTextTop - copyrightTop)).toBeLessThan(0.5);
    expect(Math.abs(iconMiddle - linkTextMiddle)).toBeLessThan(1.5);
  });
});

test.describe('dead ends', () => {
  test('an unknown poll id explains itself', async ({ page }) => {
    await page.goto('/e/doesnotexist0000000000');
    await expect(page.getByRole('heading', { name: 'Poll unavailable' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create a new poll' })).toBeVisible();
  });

  test('an unknown path shows the not-found page', async ({ page }) => {
    await page.goto('/nothing/here');
    await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible();
    await page.getByRole('link', { name: 'Create a poll' }).click();
    await expect(page.getByRole('heading', { name: 'Find a date that works for everyone.' })).toBeVisible();
  });
});
