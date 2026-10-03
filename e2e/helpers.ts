import { expect, type Locator, type Page } from '@playwright/test';

/** Click a day in the calendar on screen, paging forward until its month is shown. */
export async function pickDate(page: Page, iso: string): Promise<void> {
  const today = new Date();
  const [y, m] = iso.split('-').map(Number);
  const monthsAhead = (y - today.getFullYear()) * 12 + (m - 1 - today.getMonth());
  const calendar = page.locator('.calendar').last();
  for (let i = 0; i < monthsAhead; i++) await calendar.getByRole('button', { name: 'Next month' }).click();
  await calendar.locator(`[data-iso="${iso}"]`).click();
}

/** The vote button for a date in the row currently being edited; `clicks` cycles yes → if need be → no. */
export async function answerDate(page: Page, columnIndex: number, clicks: number): Promise<void> {
  const row = page.locator('tr.is-editing');
  const button = row.locator('button.vote-btn').nth(columnIndex);
  for (let i = 0; i < clicks; i++) await button.click();
}

/** Wait for the Turnstile test widget to hand over its token, which enables the primary button. */
export async function waitForTurnstile(button: Locator): Promise<void> {
  await expect(button).toBeEnabled({ timeout: 30_000 });
}
