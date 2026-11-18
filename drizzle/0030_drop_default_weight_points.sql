-- Issue #64: Migration 0023 hat das Profilgewicht aller Konten in den Verlauf
-- übernommen – auch den Standardwert 80 kg bei Konten, die nie ein Gewicht
-- gesetzt haben. Diese ausgedachten Punkte fallen weg: Quelle „manuell“,
-- 80 kg und das Profil steht noch auf 80. Das Profilgewicht bleibt.
DELETE FROM `body_metrics`
WHERE `metric` = 'weight'
  AND `source` = 'manuell'
  AND `value` = 80
  AND `user_id` IN (SELECT `id` FROM `users` WHERE `bodyweight_kg` = 80);
