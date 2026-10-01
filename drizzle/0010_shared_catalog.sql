DROP INDEX `equipment_user_name_unique`;--> statement-breakpoint
DROP INDEX `gyms_user_name_unique`;--> statement-breakpoint
DROP INDEX `movements_user_name_unique`;--> statement-breakpoint
-- Vor dem Zusammenführen: bisherige Fotos gelten als vom Ersteller des
-- Geräts hochgeladen – danach wäre der ursprüngliche Ersteller nicht mehr zu sehen.
ALTER TABLE `equipment_images` ADD `uploaded_by` text REFERENCES users(id) ON DELETE set null;--> statement-breakpoint
UPDATE `equipment_images` SET `uploaded_by` = (
  SELECT q.`user_id` FROM `equipment` q WHERE q.`id` = `equipment_images`.`equipment_id`
);--> statement-breakpoint
-- Ab hier gilt der Katalog für die ganze Instanz, Namen sind instanzweit
-- eindeutig. Gleichnamige Einträge verschiedener Konten werden vorher
-- zusammengeführt: es bleibt jeweils der älteste (kleinste ID).
--
-- Bewegungen: Verweise umhängen, dann die Doppelten löschen. Ein Konto hatte
-- jeden Namen höchstens einmal, also kann ein Training nicht zwei
-- zusammengeführte Bewegungen gewählt haben – kein Konflikt im Primärschlüssel.
UPDATE `exercises` SET `movement_id` = (
  SELECT min(k.`id`) FROM `movements` k
  WHERE k.`name` = (SELECT m.`name` FROM `movements` m WHERE m.`id` = `exercises`.`movement_id`)
) WHERE `movement_id` IS NOT NULL;--> statement-breakpoint
UPDATE `workout_variants` SET `movement_id` = (
  SELECT min(k.`id`) FROM `movements` k
  WHERE k.`name` = (SELECT m.`name` FROM `movements` m WHERE m.`id` = `workout_variants`.`movement_id`)
);--> statement-breakpoint
-- Hat der verbleibende Eintrag keine Muskelgruppe, die eines Doppelten übernehmen.
UPDATE `movements` SET `muscle_group` = (
  SELECT d.`muscle_group` FROM `movements` d
  WHERE d.`name` = `movements`.`name` AND d.`muscle_group` IS NOT NULL
  ORDER BY d.`id` LIMIT 1
) WHERE `muscle_group` IS NULL;--> statement-breakpoint
DELETE FROM `movements` WHERE `id` NOT IN (SELECT min(`id`) FROM `movements` GROUP BY `name`);--> statement-breakpoint
-- Die Muskelgruppe gehört der Bewegung, die Übungen tragen eine Kopie.
UPDATE `exercises` SET `muscle_group` = (
  SELECT m.`muscle_group` FROM `movements` m WHERE m.`id` = `exercises`.`movement_id`
) WHERE `movement_id` IS NOT NULL;--> statement-breakpoint
-- Geräte: ebenso; Fotos wandern zum verbleibenden Eintrag.
UPDATE `exercises` SET `equipment_id` = (
  SELECT min(k.`id`) FROM `equipment` k
  WHERE k.`name` = (SELECT q.`name` FROM `equipment` q WHERE q.`id` = `exercises`.`equipment_id`)
) WHERE `equipment_id` IS NOT NULL;--> statement-breakpoint
UPDATE `equipment_images` SET `equipment_id` = (
  SELECT min(k.`id`) FROM `equipment` k
  WHERE k.`name` = (SELECT q.`name` FROM `equipment` q WHERE q.`id` = `equipment_images`.`equipment_id`)
);--> statement-breakpoint
DELETE FROM `equipment` WHERE `id` NOT IN (SELECT min(`id`) FROM `equipment` GROUP BY `name`);--> statement-breakpoint
-- Hatte ein zusammengeführtes Gerät eine andere Übersetzung, stimmt das
-- vorberechnete Volumen nicht mehr: für Gewicht × Wiederholungen neu rechnen.
UPDATE `workout_sets` SET `volume_kg` = (
  SELECT max(0, (q.`base_load_kg` + `workout_sets`.`weight_kg` * q.`load_factor`) * `workout_sets`.`reps`)
  FROM `exercises` x JOIN `equipment` q ON q.`id` = x.`equipment_id`
  WHERE x.`id` = `workout_sets`.`exercise_id`
) WHERE `exercise_id` IN (
  SELECT `id` FROM `exercises` WHERE `equipment_id` IS NOT NULL AND `tracking_mode` = 'weight_reps'
);--> statement-breakpoint
-- Studios werden nicht zusammengeführt: "Mein Studio" zweier Nutzer ist
-- selten dasselbe. Doppelte Namen bekommen den Namen des Kontos angehängt,
-- und was danach noch doppelt ist, ein Stück der ID.
UPDATE `gyms` SET `name` = `name` || ' (' || coalesce((SELECT u.`name` FROM `users` u WHERE u.`id` = `gyms`.`user_id`), '?') || ')'
WHERE `id` NOT IN (SELECT min(`id`) FROM `gyms` GROUP BY `name`);--> statement-breakpoint
UPDATE `gyms` SET `name` = `name` || ' #' || substr(`id`, -4)
WHERE `id` NOT IN (SELECT min(`id`) FROM `gyms` GROUP BY `name`);--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_name_unique` ON `equipment` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `gyms_name_unique` ON `gyms` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `movements_name_unique` ON `movements` (`name`);
