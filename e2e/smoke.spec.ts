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

  for (const path of ["/", "/plans", "/exercises", "/equipment", "/history", "/stats", "/settings", "/koerper", "/ernaehrung", "/mehr"]) {
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

  await page.goto("/koerper");
  await expect(page.getByRole("heading", { name: "Körper", exact: true })).toBeVisible();
  await expect(page.locator("main")).toContainText("Körpergewicht (kg)");
  await expect(page.locator("main")).toContainText("54 /min");
  expect(errors).toEqual([]);
});

test("Wiegen: Testseite mit Anleitung", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/login");
  await login(page, "ben@e2e.local");
  await page.goto("/wiegen");
  await expect(page.getByRole("heading", { name: "Wiegen", exact: true })).toBeVisible();
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
  await expect(page.locator("main")).toContainText("5 Pakete");
  expect(errors).toEqual([]);
});

test("Wiegen: sofortige Ablehnung wie in Bluefy – Fehler sichtbar, Varianten angeboten", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as unknown as { __calls: unknown[] }).__calls = calls;
    Object.defineProperty(navigator, "bluetooth", {
      value: {
        requestDevice: async (options: unknown) => {
          calls.push(options);
          throw 2;
        },
      },
      configurable: true,
    });
  });
  await page.goto("/login");
  await login(page, "ben@e2e.local");
  await page.goto("/wiegen");
  await page.getByRole("button", { name: "Waage verbinden" }).click();
  await expect(page.getByRole("status")).toContainText("Fehler: 2");
  await page.getByRole("button", { name: /Variante A/ }).click();
  await expect(page.getByRole("status")).toContainText("Fehler: 2");
  const calls = await page.evaluate(() => (window as unknown as { __calls: Array<Record<string, unknown>> }).__calls);
  // Standard ist die Suche mit Filtern (bei Bluefy die einzige, die klappte).
  expect(calls[0]).toHaveProperty("filters");
  expect(calls[1]).toMatchObject({ acceptAllDevices: true });
  expect((calls[1].optionalServices as string[])[0]).toBe("0000ffe0-0000-1000-8000-00805f9b34fb");
});

test("Wiegen: simulierte QN-Waage – Handshake, Live-Gewicht, Ergebnis", async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    const sum = (b: number[]) => b.reduce((a, x) => a + x, 0) & 0xff;
    const frame = (b: number[]) => new DataView(new Uint8Array([...b, sum(b)]).buffer);
    const writes: string[] = [];
    (window as unknown as { __writes: string[] }).__writes = writes;
    const props = (p: Partial<Record<string, boolean>>) => ({
      read: false, write: false, writeWithoutResponse: false, notify: false, indicate: false, ...p,
    });
    // Wie die echte Waage: Info-Frame alle 100 ms, bis die Konfiguration kommt.
    const ffe1 = Object.assign(new EventTarget(), {
      uuid: "FFE1",
      properties: props({ notify: true }),
      value: undefined as DataView | undefined,
      async readValue() {
        return new DataView(new ArrayBuffer(0));
      },
      async startNotifications() {
        const info = setInterval(() => emit([0x12, 0x0f, 0x15, 0x0c, 0x77, 0xc7, 0x38, 0xc1, 0xa4, 0x38, 0x01, 0x38, 0x00, 0x00]), 100);
        (ffe1 as unknown as { stopInfo: () => void }).stopInfo = () => clearInterval(info);
        return ffe1;
      },
    });
    const emit = (bytes: number[]) => {
      ffe1.value = frame(bytes);
      ffe1.dispatchEvent(new Event("characteristicvaluechanged"));
    };
    const writable = (uuid: string) => ({
      uuid,
      properties: props({ write: true, writeWithoutResponse: true }),
      addEventListener() {},
      async readValue() {
        return new DataView(new ArrayBuffer(0));
      },
      async startNotifications() {
        return this;
      },
      async writeValueWithResponse(value: ArrayBuffer) {
        const bytes = Array.from(new Uint8Array(value));
        writes.push(`${uuid}:${bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
        if (uuid === "FFE3" && bytes[0] === 0x13) {
          (ffe1 as unknown as { stopInfo: () => void }).stopInfo();
          setTimeout(() => emit([0x14, 0x05, 0x15, 0x00]), 20);
          // Live-Gewicht 79,70 → 79,80 stabil.
          setTimeout(() => emit([0x10, 0x0b, 0x15, 0x1f, 0x22, 0x00, 0x00, 0x00, 0x00, 0x00]), 60);
          setTimeout(() => emit([0x10, 0x0b, 0x15, 0x1f, 0x2c, 0x01, 0x01, 0xf4, 0x02, 0x58]), 120);
        }
      },
    });
    const device = Object.assign(new EventTarget(), {
      id: "qn",
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
          return [{ uuid: "FFE0", getCharacteristics: async () => [ffe1, writable("FFE3"), writable("FFE4")] }];
        },
      },
    });
    Object.defineProperty(navigator, "bluetooth", { value: { requestDevice: async () => device }, configurable: true });
  });

  await page.goto("/login");
  await login(page, "ben@e2e.local");
  // Profil für die Körperfett-Schätzung.
  await page.goto("/settings");
  const profile = page.locator("form", { hasText: "Geburtsjahr" });
  await profile.getByLabel("Größe (cm)").fill("180");
  await profile.getByLabel("Geburtsjahr").fill("1990");
  await profile.getByLabel("Geschlecht").selectOption("m");
  await profile.getByRole("button", { name: "Speichern" }).click();
  await expect(profile.getByText("Gespeichert.")).toBeVisible();

  await page.goto("/wiegen");
  await page.getByRole("button", { name: "Waage verbinden" }).click();
  await expect(page.getByRole("status")).toContainText("79,8 kg");
  await expect(page.getByRole("status")).toContainText("Körperfett");
  await expect(page.getByRole("status")).toContainText("Schätzung");
  await expect(page.getByRole("status")).toContainText("gemessen");
  const writes = await page.evaluate(() => (window as unknown as { __writes: string[] }).__writes);
  expect(writes[0]).toBe("FFE3:13 09 15 01 10 00 00 00 42");
  expect(writes[1]).toMatch(/^FFE4:02( [0-9a-f]{2}){4}$/);
  expect(writes.some((w) => w.startsWith("FFE3:20 08 15"))).toBe(true);
  await expect(page.getByRole("status")).toContainText("gespeichert");
  await page.reload();
  await expect(page.locator("main")).toContainText("Letzte Messungen");
  await expect(page.locator("main")).toContainText("79,8 kg");
  // In der Statistik: Gewicht im Verlauf und die Schätzung mit Hinweis.
  await page.goto("/koerper");
  await expect(page.locator("main")).toContainText("Körperfett (Schätzung)");
  await expect(page.locator("main")).toContainText("Wu et al. 2015");
  expect(errors).toEqual([]);
});

test("Profil: Geschlecht bleibt nach dem Speichern ausgewählt", async ({ page }) => {
  await page.goto("/login");
  await login(page, "anna@e2e.local");
  await page.goto("/settings");
  const profile = page.locator("form", { hasText: "Geburtsjahr" });
  await profile.getByLabel("Geschlecht").selectOption("f");
  await profile.getByRole("button", { name: "Speichern" }).click();
  await expect(profile.getByText("Gespeichert.")).toBeVisible();
  // Direkt nach dem Speichern – ohne Neuladen – muss die Auswahl stehen bleiben,
  // sonst schickt das nächste Speichern „keine Angabe“ und löscht den Wert.
  await expect(profile.getByLabel("Geschlecht")).toHaveValue("f");
  await profile.getByRole("button", { name: "Speichern" }).click();
  await expect(profile.getByText("Gespeichert.")).toBeVisible();
  await page.reload();
  await expect(page.locator("form", { hasText: "Geburtsjahr" }).getByLabel("Geschlecht")).toHaveValue("f");
});

test("Ernährung: von Hand eintragen, Summe auf Seite und Startseite, löschen", async ({ page }) => {
  const errors = watchErrors(page);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/login");
  await login(page, "ben@e2e.local");
  await page.goto("/ernaehrung");
  await expect(page.locator("main")).toContainText("Noch nichts eingetragen");
  await page.getByText("Von Hand eintragen").click();
  await page.getByLabel("Was").fill("Skyr mit Beeren");
  await page.getByLabel("kcal").fill("320");
  await page.getByLabel("Eiweiß (g)").fill("30");
  await page.getByRole("button", { name: "Eintragen" }).click();
  await expect(page.locator("main")).toContainText("Skyr mit Beeren");
  await expect(page.locator("main")).toContainText("320");
  await expect(page.locator("main")).toContainText("30 g");

  await page.goto("/");
  await expect(page.locator("main")).toContainText("Heute gegessen");
  await expect(page.locator("main")).toContainText("320 kcal");

  await page.goto("/ernaehrung");
  await page.getByRole("button", { name: "×" }).click();
  await expect(page.locator("main")).toContainText("Noch nichts eingetragen");
  expect(errors).toEqual([]);
});

test("Navigation: täglich unten, Rest hinter „Mehr“", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/login");
  await login(page, "ben@e2e.local");
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  for (const label of ["Heute", "Training", "Essen", "Körper", "Mehr"]) {
    await expect(nav.getByRole("link", { name: label })).toBeVisible();
  }
  await nav.getByRole("link", { name: "Körper" }).click();
  await expect(page).toHaveURL("/koerper");
  await expect(nav.getByRole("link", { name: "Körper" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Wiegen", exact: true }).click();
  await expect(page).toHaveURL("/wiegen");
  // Wiegen gehört zu „Körper“.
  await expect(nav.getByRole("link", { name: "Körper" })).toHaveAttribute("aria-current", "page");

  await nav.getByRole("link", { name: "Mehr" }).click();
  for (const label of ["Verlauf", "Statistik", "Übungen", "Maschinen", "Studios", "Einstellungen"]) {
    await expect(page.locator("main").getByRole("link", { name: new RegExp(label) })).toBeVisible();
  }
  await page.locator("main").getByRole("link", { name: /Statistik/ }).click();
  await expect(page).toHaveURL("/stats");
  await expect(nav.getByRole("link", { name: "Mehr" })).toHaveAttribute("aria-current", "page");
  // Admin-Eintrag nur für Administratoren.
  await page.goto("/mehr");
  await expect(page.locator("main")).not.toContainText("Administration");
  expect(errors).toEqual([]);
});

test("Ziele: Eiweißziel ohne Daten, Ziel im Profil, Hinweis auf fehlende Daten", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/login");
  await login(page, "ben@e2e.local");
  await page.goto("/ernaehrung");
  // Eiweißziel gibt es sofort (aus dem Gewicht), Kalorienziel erst mit Ziel und Daten.
  await expect(page.locator("main")).toContainText("Eiweiß heute");
  await expect(page.locator("main")).toContainText("Ziel im Profil setzen");
  await page.goto("/settings");
  const profile = page.locator("form", { hasText: "Geburtsjahr" });
  await profile.getByLabel("Ziel").selectOption("lose-0.5");
  await profile.getByRole("button", { name: "Speichern" }).click();
  await expect(profile.getByText("Gespeichert.")).toBeVisible();
  await expect(profile.getByLabel("Ziel")).toHaveValue("lose-0.5");
  await page.goto("/ernaehrung");
  await expect(page.locator("main")).toContainText("Kalorienziel folgt");
  expect(errors).toEqual([]);
});

test("Wochenrückblick: Karte auf „Heute“ mit Zahlen und Eiweiß-Hinweis", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/login");
  await login(page, "cara@e2e.local");
  await page.goto("/");
  const card = page.getByTestId("weekly-review");
  await expect(card).toContainText("Wochenrückblick");
  await expect(card).toContainText("0 Trainings");
  await expect(card).toContainText("Ø 2.100 kcal (4 Tage)");
  await expect(card).toContainText("Eiweiß an 4 von 4 Tagen unter dem Minimum");
  await expect(card).toContainText("Die ganze Woche kein Training.");
  expect(errors).toEqual([]);
});
