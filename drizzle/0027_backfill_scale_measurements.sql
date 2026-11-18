-- Messungen aus den Waagen-Mitschnitten (scale_captures), die vor dem
-- automatischen Speichern (#56) entstanden sind, in den Verlauf übernehmen.
-- Zeitpunkt: Beginn des Mitschnitts + Zeit des measurement-Ereignisses.
-- Übersprungen wird, was es schon gibt (Waage-Eintrag ±5 Minuten), damit
-- spätere Messungen nicht doppelt landen.
INSERT OR IGNORE INTO `body_metrics` (`user_id`, `metric`, `measured_at`, `value`, `source`)
SELECT c.`user_id`, 'weight', c.`created_at` + CAST(json_extract(e.value, '$.t') / 1000 AS INTEGER), json_extract(e.value, '$.kg'), 'Waage'
FROM `scale_captures` c, json_each(c.`events`) e
WHERE json_extract(e.value, '$.type') = 'measurement'
  AND json_extract(e.value, '$.kg') BETWEEN 20 AND 400
  AND NOT EXISTS (
    SELECT 1 FROM `body_metrics` b
    WHERE b.`user_id` = c.`user_id` AND b.`metric` = 'weight' AND b.`source` = 'Waage'
      AND abs(b.`measured_at` - c.`created_at`) < 300
  );
--> statement-breakpoint
INSERT OR IGNORE INTO `body_metrics` (`user_id`, `metric`, `measured_at`, `value`, `source`)
SELECT c.`user_id`, 'impedance', c.`created_at` + CAST(json_extract(e.value, '$.t') / 1000 AS INTEGER), json_extract(e.value, '$.r1'), 'Waage'
FROM `scale_captures` c, json_each(c.`events`) e
WHERE json_extract(e.value, '$.type') = 'measurement'
  AND json_extract(e.value, '$.r1') BETWEEN 150 AND 1200
  AND NOT EXISTS (
    SELECT 1 FROM `body_metrics` b
    WHERE b.`user_id` = c.`user_id` AND b.`metric` = 'impedance' AND b.`source` = 'Waage'
      AND abs(b.`measured_at` - c.`created_at`) < 300
  );
