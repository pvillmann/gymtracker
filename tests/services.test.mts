import assert from "node:assert/strict";
import { before, test } from "node:test";

import { makeUser, setupDb } from "./helpers/db";

const { db, schema } = await setupDb();
const { eq } = await import("drizzle-orm");
const machines = await import("@/lib/services/machines");
const equipment = await import("@/lib/services/equipment");
const workouts = await import("@/lib/services/workouts");
const plans = await import("@/lib/services/plans");
const { mergeMovements } = await import("@/lib/services/merge");
const { resolveMovement } = await import("@/lib/services/resolve");
const sharing = await import("@/lib/services/plan-sharing");

type User = Awaited<ReturnType<typeof makeUser>>;
let anna: User;
let ben: User;
let admin: User;

before(async () => {
  anna = await makeUser("Anna", { bodyweightKg: 70 });
  ben = await makeUser("Ben");
  admin = await makeUser("Admin", { admin: true });
});

const machine = (name: string, extra: Partial<Parameters<typeof equipment.createEquipment>[1]> = {}) =>
  equipment.createEquipment(anna, { name, kind: "plates", loadFactor: 1, baseLoadKg: 0, ...extra });

async function volumeOf(setId: string) {
  const [row] = await db.select().from(schema.workoutSets).where(eq(schema.workoutSets.id, setId));
  return row.volumeKg;
}

test("Satz an einer Maschine je Seite: doppeltes Volumen, Umstellen rechnet neu", async () => {
  const row = await machines.createMovement(anna, { name: "Rudern Test", muscleGroup: "Rücken", trackingMode: "weight_reps" });
  const iso = await machine("Iso Row Test", { perSide: true });
  await machines.linkMovementEquipment(anna, row, iso);
  const variant = await machines.getOrCreateVariant(anna, row, iso);
  const { workoutId } = await workouts.startWorkout(anna, null);
  const set = await workouts.logSet(anna, workoutId, variant, { weightKg: 40, reps: 10 });
  assert.equal(set.volumeKg, 800);

  // Auf Stufen umgestellt: kein Volumen mehr, auch rückwirkend.
  await equipment.updateEquipment(anna, iso, { name: "Iso Row Test", kind: "plates", loadFactor: 1, baseLoadKg: 0, perSide: false, loadUnit: "level" });
  assert.equal(await volumeOf(set.setId), 0);

  // Zurück auf kg mit 2:1-Übersetzung und Eigengewicht.
  await equipment.updateEquipment(anna, iso, { name: "Iso Row Test", kind: "plates", loadFactor: 0.5, baseLoadKg: 10, perSide: false, loadUnit: "kg" });
  assert.equal(await volumeOf(set.setId), (10 + 40 * 0.5) * 10);
});

test("Namen: Dubletten in anderer Schreibweise werden abgelehnt", async () => {
  await machines.createMovement(anna, { name: "Seitheben Test", muscleGroup: null, trackingMode: "weight_reps" });
  await assert.rejects(
    machines.createMovement(ben, { name: "seitheben test", muscleGroup: null, trackingMode: "weight_reps" }),
    /gibt es schon/,
  );
});

test("Namensauflösung: wörtlich vor Teilwort, mehrdeutig nennt Kandidaten", async () => {
  await machines.createMovement(anna, { name: "Latzug breit", muscleGroup: null, trackingMode: "weight_reps" });
  await machines.createMovement(anna, { name: "Latzug eng", muscleGroup: null, trackingMode: "weight_reps" });
  assert.equal((await resolveMovement("latzug eng")).name, "Latzug eng");
  await assert.rejects(resolveMovement("Latzug"), /Latzug breit, Latzug eng/);
  await assert.rejects(resolveMovement("Kreuzheben"), /Keine Übung namens/);
});

test("Zusammenführen: Verlauf, Pläne und Maschinen wandern mit", async () => {
  const target = await machines.createMovement(anna, { name: "Kniebeuge Hack", muscleGroup: "Beine", trackingMode: "weight_reps" });
  const source = await machines.createMovement(anna, { name: "Hackenschmidt Kniebeuge", muscleGroup: "Beine", trackingMode: "weight_reps" });
  const hack = await machine("Hack Squat Test");
  await machines.linkMovementEquipment(anna, source, hack);

  // Anna hat an derselben Maschine Sätze unter beiden Übungen.
  const vTarget = await machines.getOrCreateVariant(anna, target, hack);
  const vSource = await machines.getOrCreateVariant(anna, source, hack);
  const { workoutId } = await workouts.startWorkout(anna, null);
  await workouts.logSet(anna, workoutId, vTarget, { weightKg: 50, reps: 10 });
  await workouts.logSet(anna, workoutId, vSource, { weightKg: 60, reps: 8 });

  // Ein Plan mit beiden, einer nur mit der Dublette.
  const both = await plans.createPlan(anna, { name: "Beine A" });
  await plans.addPlanItem(anna, both, target, { targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, restSeconds: 90 });
  await plans.addPlanItem(anna, both, source, { targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, restSeconds: 90 });
  const only = await plans.createPlan(anna, { name: "Beine B" });
  await plans.addPlanItem(anna, only, source, { targetSets: 4, targetRepsMin: 6, targetRepsMax: 8, restSeconds: 120 });

  // Ben ist weder Anleger noch Admin.
  await assert.rejects(mergeMovements(ben, source, target), /nur, wer die Übung angelegt hat/);

  const report = await mergeMovements(anna, source, target);
  assert.equal(report.mergedVariants, 1);
  assert.equal(report.movedSets, 1);
  assert.equal(report.movedPlanItems, 1);
  assert.equal(report.droppedPlanItems, 1);
  // Die Maschine hing über die Variante schon an der Zielübung.
  const links = await db.select().from(schema.movementEquipment).where(eq(schema.movementEquipment.movementId, target));
  assert.deepEqual(links.map((l) => l.equipmentId), [hack]);

  assert.equal((await db.select().from(schema.movements).where(eq(schema.movements.id, source))).length, 0);
  const sets = await db.select().from(schema.workoutSets).where(eq(schema.workoutSets.exerciseId, vTarget));
  assert.deepEqual(sets.map((s) => s.setNumber).sort(), [1, 2]);
  const items = await db.select().from(schema.planExercises).where(eq(schema.planExercises.planId, only));
  assert.equal(items[0].movementId, target);
  assert.equal(items[0].targetSets, 4);
});

test("Löschen: nur ohne Verlauf, nur Anleger oder Admin", async () => {
  const empty = await machines.createMovement(anna, { name: "Leere Übung", muscleGroup: null, trackingMode: "time" });
  await assert.rejects(machines.deleteMovement(ben, empty), /angelegt hat/);
  await machines.deleteMovement(admin, empty);

  const used = await machines.createMovement(anna, { name: "Benutzte Übung", muscleGroup: null, trackingMode: "weight_reps" });
  const variant = await machines.getOrCreateVariant(anna, used, null);
  const { workoutId } = await workouts.startWorkout(anna, null);
  await workouts.logSet(anna, workoutId, variant, { weightKg: 10, reps: 10 });
  await assert.rejects(machines.deleteMovement(anna, used), /archiv/i);
});

test("Pläne: fremde Pläne sind tabu, Reihenfolge bleibt lückenlos", async () => {
  const plan = await plans.createPlan(anna, { name: "Reihenfolge" });
  const ids: string[] = [];
  for (const name of ["Ü1 Test", "Ü2 Test", "Ü3 Test"]) {
    const m = await machines.createMovement(anna, { name, muscleGroup: null, trackingMode: "weight_reps" });
    ids.push((await plans.addPlanItem(anna, plan, m, { targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, restSeconds: 60 })).itemId);
  }
  await assert.rejects(plans.movePlanItem(ben, ids[0], "down"), /gibt es nicht/);
  await plans.reorderPlan(anna, plan, [ids[2]]);
  const rows = await db.select().from(schema.planExercises).where(eq(schema.planExercises.planId, plan));
  const order = rows.sort((a, b) => a.position - b.position).map((r) => r.id);
  assert.deepEqual(order, [ids[2], ids[0], ids[1]]);
  assert.deepEqual(rows.map((r) => r.position).sort(), [0, 1, 2]);
});

test("Teilen: Kopie ohne Plan-Notiz, gleiche Namen nummeriert, Widerruf wirkt", async () => {
  const m = await machines.createMovement(anna, { name: "Geteilte Übung", muscleGroup: null, trackingMode: "weight_reps" });
  const plan = await plans.createPlan(anna, { name: "Push", notes: "privat" });
  await plans.addPlanItem(anna, plan, m, { targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, restSeconds: 90, notes: "langsam" });
  await assert.rejects(sharing.sharePlan(ben, plan), /gibt es nicht/);

  const token = await sharing.sharePlan(anna, plan);
  assert.equal(sharing.tokenFromLink(`https://x/p/${token}`), token);
  assert.equal(await sharing.sharePlan(anna, plan), token, "ohne renew bleibt der Link");

  await plans.createPlan(ben, { name: "Push" });
  const first = await sharing.importSharedPlan(ben, token);
  const second = await sharing.importSharedPlan(ben, token);
  assert.equal(first.name, "Push (Kopie)");
  assert.equal(second.name, "Push (Kopie 2)");

  const [copy] = await db.select().from(schema.plans).where(eq(schema.plans.id, first.planId));
  assert.equal(copy.userId, ben.id);
  assert.equal(copy.notes, null);
  const [item] = await db.select().from(schema.planExercises).where(eq(schema.planExercises.planId, first.planId));
  assert.equal(item.notes, "langsam");
  assert.equal(item.exerciseId, null);

  const renewed = await sharing.sharePlan(anna, plan, { renew: true });
  assert.notEqual(renewed, token);
  assert.equal(await sharing.getSharedPlan(token), null);
  await sharing.unsharePlan(anna, plan);
  await assert.rejects(sharing.importSharedPlan(ben, renewed), /gibt es nicht mehr/);
});
