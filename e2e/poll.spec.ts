import { createPollViaApi, expect, futureIso, test } from './fixtures';
import { answerDate, pickDate, waitForTurnstile } from './helpers';

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
});

test.describe('answering a poll', () => {
  test('a participant answers, sees their row and can change it later', async ({ page, request, clientIp }) => {
    const poll = await createPollViaApi(request, clientIp);
    await page.goto(poll.participantUrl);
    await expect(page.getByRole('heading', { level: 1, name: 'Board game night' })).toBeVisible();
    await expect(page.getByText('No answers yet. Be the first.')).toBeVisible();

    await page.getByRole('button', { name: 'Add your availability' }).click();
    await page.getByLabel('Nickname').fill('Ada');
    await answerDate(page, 0, 1); // yes
    await answerDate(page, 1, 2); // if need be
    const save = page.getByRole('button', { name: 'Save' });
    await waitForTurnstile(save);
    await save.click();

    const row = page.getByRole('row', { name: /Ada/ });
    await expect(row).toBeVisible();
    await expect(row.getByText('you')).toBeVisible();
    // Focus lands on the nearest control once the editor has closed and the request has finished.
    await expect(page.getByRole('button', { name: 'Edit your answers' })).toBeFocused();
    await expect(row.getByRole('img', { name: 'Yes' })).toHaveCount(1);
    await expect(row.getByRole('img', { name: 'If need be' })).toHaveCount(1);
    await expect(page.getByRole('status').filter({ hasText: 'Your answers were saved.' })).toBeAttached();

    // The identity survives the re-fetch, so this browser can still edit the answer after a reload.
    await page.reload();
    await expect(page.getByRole('row', { name: /Ada/ }).getByText('you')).toBeVisible();

    const tallies = page.locator('tfoot td.tally');
    await expect(tallies.nth(0)).toHaveText(/1\s*\/\s*0/);
    await expect(tallies.nth(1)).toHaveText(/0\s*\/\s*1/);

    await page.getByRole('button', { name: 'Edit your answers' }).click();
    await answerDate(page, 0, 1); // yes → if need be
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(tallies.nth(0)).toHaveText(/0\s*\/\s*1/);
    await expect(page.getByRole('button', { name: 'Edit your answers' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Add your availability' })).toHaveCount(0);
  });

  test('two people cannot use the same nickname, ignoring case', async ({ page, otherPerson, request, clientIp }) => {
    const poll = await createPollViaApi(request, clientIp);
    await page.goto(poll.participantUrl);
    await page.getByRole('button', { name: 'Add your availability' }).click();
    await page.getByLabel('Nickname').fill('Grace');
    const save = page.getByRole('button', { name: 'Save' });
    await waitForTurnstile(save);
    await save.click();
    await expect(page.getByRole('row', { name: /Grace/ })).toBeVisible();

    const other = await otherPerson.newPage();
    await other.goto(poll.participantUrl);
    await other.getByRole('button', { name: 'Add your availability' }).click();
    await other.getByLabel('Nickname').fill('grace');
    const otherSave = other.getByRole('button', { name: 'Save' });
    await waitForTurnstile(otherSave);
    await otherSave.click();
    await expect(other.getByRole('alert')).toHaveText('Someone in this poll already uses that nickname.');
    // The first Grace is still the only saved participant; the second is still in the editing row.
    await expect(other.locator('tbody tr:not(.is-editing) .participant-name')).toHaveText(['Grace']);
    await expect(other.locator('tbody tr.is-editing')).toHaveCount(1);
  });

  test('a participant can suggest another date', async ({ page, request, clientIp }) => {
    const poll = await createPollViaApi(request, clientIp);
    await page.goto(poll.participantUrl);
    await expect(page.locator('thead th.option-col')).toHaveCount(3);

    await page.getByRole('button', { name: 'Pick a date' }).click();
    await pickDate(page, futureIso(30));
    await page.getByRole('button', { name: /^Add (?!your availability)/ }).click();

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

    page.once('dialog', (d) => d.accept());
    await page
      .getByRole('button', { name: /^Remove .*/ })
      .first()
      .click();
    await expect(page.locator('thead th.option-col')).toHaveCount(2);

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Delete poll' }).click();
    await expect(page).toHaveURL('/');

    await page.goto(poll.participantUrl);
    await expect(page.getByRole('heading', { name: 'Poll unavailable' })).toBeVisible();
    await expect(page.getByText('This poll does not exist or was deleted.')).toBeVisible();
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
    await expect(other.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(other.getByRole('button', { name: 'Pick a date' })).toHaveCount(0);

    await page.goto(poll.adminUrl);
    await expect(page.getByRole('heading', { name: 'Add a date' })).toBeVisible();
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
