import type { Page } from '@playwright/test';
import type { EventView } from '../shared/types';
import { expect, futureIso, test } from './fixtures';

/** Dialog tests use deterministic API responses, including failures and requests held in flight. */
async function openPoll(page: Page, { mine = false, nickname = 'Ada' } = {}) {
  const poll: EventView = {
    id: 'd'.repeat(22),
    title: 'Board game night',
    description: 'Bring snacks.',
    allowSuggestions: true,
    createdAt: Date.now(),
    expiresAt: Date.now() + 86_400_000,
    options: [14, 15, 16].map((days, i) => ({ id: String(i).repeat(22), date: futureIso(days), suggestedBy: null })),
    participants: [{ id: 'p'.repeat(22), nickname, votes: {}, createdAt: Date.now() }],
    comments: [],
    viewer: { isAdmin: !mine },
  };
  let deletions = 0;

  if (mine) {
    await page.addInitScript(
      ({ pollId, participantId }) => {
        localStorage.setItem(
          `pikadai:participant:${pollId}`,
          JSON.stringify({ id: participantId, token: 't'.repeat(43) }),
        );
      },
      { pollId: poll.id, participantId: poll.participants[0].id },
    );
  }

  await page.route(`**/api/events/${poll.id}**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET') {
      await route.fulfill({ json: poll });
    } else if (request.method() === 'DELETE') {
      deletions++;
      if (path.includes('/options/')) poll.options = poll.options.filter((o) => !path.endsWith(o.id));
      else if (path.includes('/participants/')) poll.participants = [];
      await route.fulfill({ status: 204 });
    } else {
      await route.fallback();
    }
  });

  await page.goto(`/e/${poll.id}${mine ? '' : `#admin=${'a'.repeat(43)}`}`);
  await expect(page.getByRole('heading', { level: 1, name: poll.title })).toBeVisible();
  return { poll, deletions: () => deletions };
}

test('poll confirmation is labelled, contains keyboard focus and cancels without deleting', async ({ page }) => {
  const { deletions } = await openPoll(page);
  const opener = page.getByRole('button', { name: 'Delete poll', exact: true });
  await opener.focus();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('alertdialog', { name: 'Delete this poll?' });
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  const confirm = dialog.getByRole('button', { name: 'Delete poll' });
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toHaveAccessibleDescription(
    'The poll and every answer in it will be permanently deleted. This cannot be undone.',
  );
  await expect(cancel).toBeFocused();

  // The native modal also prevents scripts from putting focus on background controls.
  await page.getByRole('button', { name: 'Edit details', includeHidden: true }).evaluate((button) => button.focus());
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  await opener.click();
  await cancel.click();
  await expect(opener).toBeFocused();
  await opener.click();
  await page.keyboard.press('Enter'); // The initial action is always Cancel.
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(deletions()).toBe(0);
});

test('date removal can be cancelled and returns focus to the table after confirming', async ({ page }) => {
  const { deletions } = await openPoll(page);
  const opener = page.getByRole('button', { name: /^Remove .*/ }).first();
  const dateLabel = await opener.getAttribute('aria-label');
  await opener.click();
  const dialog = page.getByRole('alertdialog', { name: 'Remove this date?' });
  await expect(dialog).toHaveAccessibleDescription(
    `${dateLabel?.replace(/^Remove /, '')} and every answer for it will be removed. This cannot be undone.`,
  );
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  expect(deletions()).toBe(0);
  await expect(page.locator('thead th.option-col')).toHaveCount(3);

  await opener.click();
  await dialog.getByRole('button', { name: 'Remove date' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('thead th.option-col')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Availability table, scrolls sideways' })).toBeFocused();
  expect(deletions()).toBe(1);
});

for (const mine of [true, false]) {
  test(`${mine ? 'a participant' : 'an organiser'} confirms answer removal without losing a cancelled draft`, async ({
    page,
  }) => {
    const { poll, deletions } = await openPoll(page, { mine });
    await page.getByRole('button', { name: mine ? 'Edit your answers' : 'Edit Ada' }).click();
    await page.getByLabel('Nickname', { exact: true }).fill('Unsaved draft');
    const opener = page.getByRole('button', { name: 'Remove', exact: true });
    await opener.click();

    const dialog = page.getByRole('alertdialog', { name: mine ? 'Remove your answers?' : 'Remove Ada?' });
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expect(dialog).toHaveAccessibleDescription(
      mine
        ? 'Your answers and comments will be removed from this poll. This cannot be undone.'
        : 'Ada and all their answers and comments will be removed from this poll. This cannot be undone.',
    );
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(opener).toBeFocused();
    await expect(page.getByLabel('Nickname', { exact: true })).toHaveValue('Unsaved draft');
    expect(deletions()).toBe(0);

    await opener.click();
    await dialog.getByRole('button', { name: 'Remove answers' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('No answers yet. Be the first.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Availability table, scrolls sideways' })).toBeFocused();
    expect(deletions()).toBe(1);
    if (mine) {
      expect(await page.evaluate((id) => localStorage.getItem(`pikadai:participant:${id}`), poll.id)).toBeNull();
    }
  });
}

test('a pending deletion keeps focus, prevents repeats and displays a retryable failure in the dialog', async ({
  page,
}) => {
  const { poll, deletions } = await openPoll(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let attempts = 0;
  await page.route(`**/api/events/${poll.id}`, async (route) => {
    if (route.request().method() === 'DELETE' && ++attempts === 1) {
      await gate;
      await route.fulfill({ status: 500, json: { error: 'Deletion failed', code: 'internal' } });
    } else {
      await route.fallback();
    }
  });

  await page.getByRole('button', { name: 'Delete poll' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete this poll?' });
  await dialog.getByRole('button', { name: 'Delete poll' }).click();
  const pending = dialog.getByRole('button', { name: 'Deleting poll…' });
  await expect(pending).toBeFocused();
  await expect(pending).toHaveAttribute('aria-disabled', 'true');
  await expect(dialog.getByRole('status')).toHaveText('Deleting poll…');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(dialog).toBeVisible();
  expect(attempts).toBe(1);

  release();
  await expect(dialog.getByRole('alert')).toHaveText('Something went wrong on our side. Please try again.');
  const retry = dialog.getByRole('button', { name: 'Delete poll' });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page).toHaveURL('/');
  expect(attempts).toBe(2);
  expect(deletions()).toBe(1);
});

test('long confirmation text reflows in a small viewport with light theme and reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 256 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await openPoll(page, { nickname: 'A'.repeat(40) });
  await page.getByRole('button', { name: `Edit ${'A'.repeat(40)}` }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  const size = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    };
  });
  expect(size.left).toBeGreaterThanOrEqual(0);
  expect(size.right).toBeLessThanOrEqual(size.viewportWidth);
  expect(size.top).toBeGreaterThanOrEqual(0);
  expect(size.bottom).toBeLessThanOrEqual(size.viewportHeight);
  expect(size.scrollWidth).toBe(size.width);
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Remove answers' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeFocused();
});
