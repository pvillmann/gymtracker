import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "geheim-e2e-123";

/** Konsolenfehler sammeln – darunter fallen auch CSP-Verletzungen. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function login(page: Page, email: string) {
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill(PASSWORD);
  await page.getByRole("button", { name: "Anmelden" }).click();
  // Erst weiter, wenn der Login durch ist – sonst landet der nächste Aufruf
  // noch ohne Sitzung auf /login.
  await page.waitForURL((url) => url.pathname !== "/login");
}

test("Training aus dem Plan: Satz speichern, Pause läuft", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/login");
  await login(page, "anna@e2e.local");
  await expect(page).toHaveURL("/");

  await page.goto("/plans/p-beine");
  await page.getByRole("button", { name: "Training starten" }).click();
  await expect(page).toHaveURL(/\/workout\//);

  const card = page.locator("[id^=uebung-]").first();
  await expect(card).toContainText("Kniebeuge E2E");
  await card.getByRole("button", { name: /speichern/i }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Pause" })).toBeVisible();
  await expect(card).toContainText("× ");

  for (const path of ["/", "/plans", "/exercises", "/equipment", "/history", "/stats", "/settings"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("Plan teilen: ohne Konto lesen, nach dem Login übernehmen", async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage();
  await owner.goto("/login");
  await login(owner, "anna@e2e.local");
  await owner.goto("/plans/p-beine");
  await owner.getByRole("button", { name: "Link zum Teilen erzeugen" }).click();
  const link = (await owner.locator("code", { hasText: "/p/" }).innerText()).trim();
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:3200\/p\/[0-9a-f]{64}$/);

  const guest = await (await browser.newContext()).newPage();
  const errors = watchErrors(guest);
  await guest.goto(link);
  await expect(guest.getByRole("heading", { name: "Beine E2E" })).toBeVisible();
  await expect(guest.locator("main")).toContainText("tief runter");
  await expect(guest.locator("main")).not.toContainText("privat");

  await guest.getByRole("button", { name: "Anmelden und übernehmen" }).click();
  await expect(guest).toHaveURL(/\/login\?next=/);
  await login(guest, "ben@e2e.local");
  await expect(guest).toHaveURL(link);
  await guest.getByRole("button", { name: "In meine Pläne übernehmen" }).click();
  await expect(guest).toHaveURL(/uebernommen=1/);
  await expect(guest.locator("main")).toContainText("Plan übernommen");
  expect(errors).toEqual([]);
});

test("Login: falsches Ziel nach dem Login wird ignoriert", async ({ page }) => {
  await page.goto("/login?next=//evil.example");
  await login(page, "ben@e2e.local");
  await expect(page).toHaveURL("/");
});

test("Darstellung: Standard Blau und deckend, pro Konto umstellbar", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/login");
  await login(page, "ben@e2e.local");

  const app = page.locator("[data-glass]");
  await expect(app).toHaveAttribute("data-glass", "solid");
  expect(await app.evaluate((el) => getComputedStyle(el).getPropertyValue("--color-accent").trim())).toBe("#4f9dff");

  await page.goto("/settings");
  await page.locator("label", { hasText: "Violett" }).click();
  await page.locator("label", { hasText: "Gedämpft" }).click();
  await page.locator("form", { hasText: "Akzentfarbe" }).getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert.")).toBeVisible();

  await page.goto("/plans");
  await expect(app).toHaveAttribute("data-glass", "medium");
  expect(await app.evaluate((el) => getComputedStyle(el).getPropertyValue("--color-accent").trim())).toBe("#a78bfa");
  expect(await page.locator("nav ul").evaluate((el) => getComputedStyle(el).backdropFilter)).toContain("blur");
  expect(errors).toEqual([]);
});
