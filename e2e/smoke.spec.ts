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

  // Letztes Mal 3 × 10 bei Ziel 8–10: heute +2,5 kg mit 8 Wdh. vorbelegt.
  await expect(card).toContainText("Alle Sätze mit 10 Wdh. geschafft");
  await expect(card.locator("input[name=weightKg]")).toHaveValue("102,5");
  await expect(card.locator("input[name=reps]")).toHaveValue("8");
  await card.getByRole("button", { name: "Wie letztes Mal" }).click();
  await expect(card.locator("input[name=weightKg]")).toHaveValue("100");
  await card.getByRole("button", { name: "Vorschlag" }).click();
  await expect(card.locator("input[name=weightKg]")).toHaveValue("102,5");
  await card.getByRole("button", { name: /speichern/i }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Pause" })).toBeVisible();
  await expect(card).toContainText("× ");

  // Zwei weitere Sätze, den letzten als „Leicht“ bewerten: Bonus-Satz.
  for (const n of [2, 3]) {
    await card.getByRole("button", { name: `Satz ${n} speichern` }).click();
    await expect(card.getByRole("button", { name: `Satz ${n + 1} speichern` })).toBeVisible();
  }
  await card.getByRole("button", { name: /Leicht/ }).click();
  await expect(card).toContainText("Da ging noch was");
  await expect(card).toContainText("105 kg");
  await card.getByRole("button", { name: "Bonus-Satz vorbelegen" }).click();
  await expect(card.locator("input[name=weightKg]")).toHaveValue("105");

  for (const path of ["/", "/plans", "/exercises", "/equipment", "/history", "/stats", "/settings"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
  }
  // Je drei Arbeitssätze aus den Testdaten und von heute zählen für „Beine“.
  await page.goto("/stats");
  await expect(page.locator("main")).toContainText("Arbeitssätze pro Muskelgruppe");
  await expect(page.locator("main")).toContainText("6 diese Woche");
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

test("Benachrichtigungen: Abschnitt in den Einstellungen, Service Worker erreichbar", async ({ page, request }) => {
  const errors = watchErrors(page);
  await page.goto("/login");
  await login(page, "ben@e2e.local");
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Benachrichtigungen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Auf diesem Gerät einschalten" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "KI-Vorschläge (Claude Haiku)" })).toBeVisible();
  await expect(page.getByLabel("Anthropic-API-Schlüssel")).toHaveAttribute("type", "password");

  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["content-type"]).toContain("javascript");
  expect(await sw.text()).toContain("showNotification");
  expect(errors).toEqual([]);
});

test("Apple Health: Schlüssel erzeugen, Export senden, Verlauf in der Statistik", async ({ page, request }) => {
  const errors = watchErrors(page);
  await page.goto("/login");
  await login(page, "anna@e2e.local");
  await page.goto("/settings");
  await page.getByRole("button", { name: "Import-Schlüssel erzeugen" }).click();
  const token = (await page.locator("code", { hasText: "gymh_" }).innerText()).trim();

  const denied = await request.post("/api/health", { data: {}, headers: { authorization: "Bearer gymh_falsch" } });
  expect(denied.status()).toBe(401);

  const response = await request.post("/api/health", {
    headers: { authorization: `Bearer ${token}` },
    data: {
      data: {
        metrics: [
          { name: "weight_body_mass", units: "kg", data: [
            { qty: 81.2, date: "2026-10-01 07:00:00 +0200", source: "Waage" },
            { qty: 79.8, date: "2026-11-10 07:00:00 +0100", source: "Waage" },
          ] },
          { name: "resting_heart_rate", units: "count/min", data: [{ qty: 54, date: "2026-11-10 00:00:00 +0100" }] },
        ],
      },
    },
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ imported: 3, bodyweightKg: 79.8 });

  await page.goto("/stats");
  await expect(page.getByRole("heading", { name: "Körper" })).toBeVisible();
  await expect(page.locator("main")).toContainText("Körpergewicht (kg)");
  await expect(page.locator("main")).toContainText("54 /min");
  expect(errors).toEqual([]);
});

test("Wiegen: Testseite mit Anleitung", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/login");
  await login(page, "ben@e2e.local");
  await page.goto("/wiegen");
  await expect(page.getByRole("heading", { name: "Wiegen (Test)" })).toBeVisible();
  await expect(page.locator("main")).toContainText("Feelfit-App schließen");
  // Chromium kann Web Bluetooth: dann gibt es den Knopf, sonst den Hinweis auf Bluefy.
  await expect(page.getByRole("button", { name: "Waage verbinden" }).or(page.getByText("Dieser Browser kann kein Bluetooth"))).toBeVisible();
  expect(errors).toEqual([]);
});

test("Wiegen: simulierte Waage – Pakete landen in der Datenbank", async ({ page }) => {
  const errors = watchErrors(page);
  // Eine Waage im Browser vortäuschen: ein Dienst, ein Merkmal mit Benachrichtigungen.
  await page.addInitScript(() => {
    const listeners: Array<() => void> = [];
    const characteristic = Object.assign(new EventTarget(), {
      uuid: "0000fff1-0000-1000-8000-00805f9b34fb",
      properties: { read: false, write: false, writeWithoutResponse: false, notify: true, indicate: false },
      value: undefined as DataView | undefined,
      async readValue() {
        return new DataView(new ArrayBuffer(0));
      },
      async startNotifications() {
        let n = 0;
        const timer = setInterval(() => {
          characteristic.value = new DataView(new Uint8Array([0x10, 0x0b, 0x15, n++]).buffer);
          characteristic.dispatchEvent(new Event("characteristicvaluechanged"));
          if (n >= 5) clearInterval(timer);
        }, 50);
        return characteristic;
      },
    });
    const device = Object.assign(new EventTarget(), {
      id: "fake",
      name: "QN-Scale",
      gatt: {
        connected: true,
        async connect() {
          return device.gatt;
        },
        disconnect() {
          device.dispatchEvent(new Event("gattserverdisconnected"));
        },
        async getPrimaryServices() {
          return [{ uuid: "0000fff0-0000-1000-8000-00805f9b34fb", getCharacteristics: async () => [characteristic] }];
        },
      },
    });
    void listeners;
    Object.defineProperty(navigator, "bluetooth", {
      value: { requestDevice: async () => device },
      configurable: true,
    });
  });

  await page.goto("/login");
  await login(page, "ben@e2e.local");
  await page.goto("/wiegen");
  await page.getByRole("button", { name: "Waage verbinden" }).click();
  await expect(page.getByRole("status")).toContainText("Verbunden");
  await expect(page.getByRole("status")).toContainText("10 0b 15 04");
  await page.getByRole("button", { name: "Fertig" }).click();
  await expect(page.getByRole("status")).toContainText("gespeichert");

  await page.reload();
  await expect(page.locator("main")).toContainText("QN-Scale");
  await expect(page.locator("main")).toContainText("5 Messpakete");
  expect(errors).toEqual([]);
});
