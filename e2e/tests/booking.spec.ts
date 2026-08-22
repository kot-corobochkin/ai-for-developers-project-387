import { expect, test, type Page } from "@playwright/test";

// The backend only generates slots for weekdays (Mon–Fri) and only for times
// still in the future, so a fixed day index breaks near weekends or late in
// the evening. Walk the calendar until a day actually offering slots is found.
async function selectDayWithSlots(page: Page) {
  const days = page.locator("button.day:not(:disabled)");
  const total = await days.count();
  for (let index = 0; index < total; index += 1) {
    await days.nth(index).click();
    await page.locator(".slots-heading ~ .empty-state, .slots-grid .slot").first().waitFor();
    const slot = page.locator(".slot").first();
    if (await slot.isVisible()) return slot;
  }
  throw new Error("В окне бронирования не нашлось дня со свободными слотами");
}

test.describe("публичное бронирование", () => {
  test("гость выбирает встречу, бронирует слот и видит её в админке", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Запланируйте время" })).toBeVisible();
    await expect(page.getByText("Короткая встреча", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Короткая встреча/ }).click();

    await expect(page.getByRole("heading", { name: "Короткая встреча" })).toBeVisible();
    const slot = await selectDayWithSlots(page);
    const slotLabel = await slot.innerText();
    await slot.click();

    await page.getByLabel("Имя и фамилия").fill("Playwright Guest");
    await page.getByLabel("Email").fill("playwright@example.com");
    await page.getByRole("button", { name: "Подтвердить встречу" }).click();

    await expect(page.getByText("Встреча подтверждена")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Короткая встреча" })).toBeVisible();

    await page.getByRole("button", { name: "Управление" }).click();
    await page.getByRole("button", { name: "Бронирования" }).click();
    const bookingRow = page.locator(".table-row").filter({ hasText: "Playwright Guest" }).filter({ hasText: slotLabel });
    await expect(bookingRow).toHaveCount(1);
    await expect(bookingRow).toContainText("playwright@example.com");
  });

  test("после бронирования слот исчезает из доступных", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Короткая встреча/ }).click();
    const slot = await selectDayWithSlots(page);
    const bookedSlotLabel = await slot.innerText();
    await slot.click();
    await page.getByLabel("Имя и фамилия").fill("First Guest");
    await page.getByLabel("Email").fill("first@example.com");
    await page.getByRole("button", { name: "Подтвердить встречу" }).click();
    await expect(page.getByText("Встреча подтверждена")).toBeVisible();

    await page.getByRole("button", { name: "Создать ещё одну встречу" }).click();
    await page.getByRole("button", { name: /Короткая встреча/ }).click();
    await expect(page.locator(".slot").first()).toBeVisible();

    // The previously selected slot is removed by the backend and must not be offered again.
    await expect(page.locator(".slot").filter({ hasText: bookedSlotLabel })).toHaveCount(0);
  });
});
