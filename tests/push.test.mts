import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createECDH, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { makeUser, setupDb } from "./helpers/db";

// Lokaler HTTPS-Empfänger statt Apple/Google: selbst signiert, nur für diesen
// Testprozess vertraut.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
process.env.PUSH_EXTRA_HOSTS = "127.0.0.1";
const dir = mkdtempSync(join(tmpdir(), "push-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost",
  "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "1"], { stdio: "ignore" });

const received: Array<{ path: string; auth: string; encoding: string; ttl: string; bytes: number }> = [];
let status = 201;
const server = createServer({ key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) }, (req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    received.push({
      path: req.url ?? "",
      auth: String(req.headers.authorization ?? ""),
      encoding: String(req.headers["content-encoding"] ?? ""),
      ttl: String(req.headers.ttl ?? ""),
      bytes: Buffer.concat(chunks).length,
    });
    res.writeHead(status).end();
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as { port: number }).port;
after(() => server.close());

const { db, schema } = await setupDb();
const push = await import("@/lib/push");
const { eq } = await import("drizzle-orm");

const subscription = (path: string) => ({
  endpoint: `https://127.0.0.1:${port}${path}`,
  keys: {
    p256dh: createECDH("prime256v1").generateKeys().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  },
});

test("VAPID-Schlüssel entstehen einmal und bleiben", async () => {
  const a = await push.vapidKeys();
  const b = await push.vapidKeys();
  assert.equal(a.publicKey, b.publicKey);
  assert.ok(a.publicKey.length > 40);
});

test("Senden: verschlüsselt, mit VAPID und kurzer Lebensdauer; 410 räumt auf", async () => {
  const user = await makeUser("Push");
  await push.saveSubscription(user, subscription("/ok"));
  await push.saveSubscription(user, subscription("/gone"));
  assert.equal(await push.countSubscriptions(user.id), 2);

  status = 201;
  assert.equal(await push.sendToUser(user.id, { title: "Pause vorbei", body: "Weiter", tag: "rest" }), 2);
  const ok = received.find((r) => r.path === "/ok");
  assert.match(ok?.auth ?? "", /^vapid t=.+, k=.+/);
  assert.equal(ok?.encoding, "aes128gcm");
  assert.equal(ok?.ttl, "300");
  assert.ok((ok?.bytes ?? 0) > 50);

  status = 410;
  assert.equal(await push.sendToUser(user.id, { title: "x", body: "y" }), 0);
  assert.equal(await push.countSubscriptions(user.id), 0);
});

test("Pause planen: ersetzt die vorige, Abbrechen verhindert das Senden", async () => {
  const user = await makeUser("Timer");
  await push.saveSubscription(user, subscription("/timer"));
  status = 201;
  const before = received.length;
  await push.scheduleRestNotification(user.id, 1, { title: "Pause vorbei", body: "a", tag: "rest" });
  push.cancelRestNotification(user.id);
  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(received.length, before, "abgebrochen: nichts gesendet");
  await push.scheduleRestNotification(user.id, 1, { title: "Pause vorbei", body: "b", tag: "rest" });
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(received.filter((r) => r.path === "/timer").length, 1);
  assert.ok(db && schema);
});

test("Endpunkte: nur bekannte Push-Dienste, höchstens zehn Geräte", async () => {
  delete process.env.PUSH_EXTRA_HOSTS;
  try {
    for (const ok of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/abc",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]) assert.equal(push.isAllowedPushEndpoint(ok), true, ok);
    for (const bad of [
      "https://127.0.0.1/x",
      "https://169.254.169.254/latest",
      "https://intranet.local/x",
      "http://fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "https://evilgoogleapis.com/x",
      "https://user:pw@fcm.googleapis.com/x",
      "kaputt",
    ]) assert.equal(push.isAllowedPushEndpoint(bad), false, bad);

    const user = await makeUser("Viele");
    await assert.rejects(push.saveSubscription(user, subscription("/intern")), /Ungültige/);
    const keys = subscription("/x").keys;
    for (let i = 0; i < 12; i++) {
      await push.saveSubscription(user, { endpoint: `https://fcm.googleapis.com/fcm/send/${i}`, keys });
    }
    const rows = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, user.id));
    assert.equal(rows.length, push.MAX_DEVICES);
    // Die ältesten zwei sind raus, das neueste ist da.
    assert.ok(rows.some((r) => r.endpoint.endsWith("/11")));
    assert.ok(!rows.some((r) => r.endpoint.endsWith("/0") || r.endpoint.endsWith("/1")));
  } finally {
    process.env.PUSH_EXTRA_HOSTS = "127.0.0.1";
  }
});
