# Claude und MCP

Zurück zum [README](../README.md).

GymTracker stellt unter `/api/mcp` einen
[MCP](https://modelcontextprotocol.io)-Server bereit. Damit lässt sich das
Training im Chat oder per Sprache mitschreiben, statt zwischen den Sätzen zu
tippen:

> „Heute Rückentraining. War 10 Minuten auf dem Stepper, und jetzt erster Satz
> Latzug mit 20 Kilo, 12 Wiederholungen."

## Schlüssel erzeugen

1. In GymTracker unter **Einstellungen → Zugriff für Claude (MCP)** eine
   Bezeichnung eintragen (z. B. „Handy") und **Schlüssel erzeugen** klicken.
2. Den Schlüssel sofort kopieren — er wird **genau einmal** angezeigt. In der
   Datenbank liegt danach nur noch sein SHA-256-Hash, wie bei den Session-Tokens.
3. Der Schlüssel gilt ausschließlich für dein eigenes Konto. Er lässt sich
   jederzeit widerrufen; laufende Verbindungen sind damit sofort tot.

## In Claude eintragen

Der Server spricht Streamable HTTP und authentifiziert über einen
`Authorization: Bearer`-Header. In Claude Desktop oder Claude Code:

```json
{
  "mcpServers": {
    "gymtracker": {
      "type": "http",
      "url": "https://gym.example.com/api/mcp",
      "headers": { "Authorization": "Bearer gym_dein-schluessel" }
    }
  }
}
```

Die passende Adresse steht in den Einstellungen direkt über dem Eingabefeld.
Der Endpunkt gehört hinter TLS — der Schlüssel steht im Klartext im Header.

Manche Clients beanspruchen `Authorization` für ihren eigenen OAuth-Flow und
reichen einen selbst gesetzten Wert nicht durch. Claudes Dialog für eigene
Connectors etwa nimmt Zusatz-Header ausdrücklich nur *neben* dem OAuth-Token
entgegen. Für diesen Fall akzeptiert der Server denselben Schlüssel auch unter
`X-API-Key`:

```
X-API-Key: gym_dein-schluessel
```

Geprüft wird in beiden Fällen dasselbe: derselbe Schlüssel, derselbe Hash,
dieselben Rechte. `Authorization` hat Vorrang, `X-API-Key` greift nur, wenn
dort nichts Brauchbares steht.

## Was der Server kann

| Werkzeug | Wozu |
| --- | --- |
| `list_exercises`, `list_plans`, `get_plan` | Übungen und Pläne durchsehen |
| `last_performance`, `exercise_history` | Was lief beim letzten Mal an dieser Maschine? |
| `recent_workouts`, `training_stats` | Verlauf und Kennzahlen |
| `create_exercise`, `assign_machine` | Neue Übung anlegen, Maschinen Übungen und Studios zuordnen |
| `create_plan`, `add_exercise_to_plan` | Plan aufbauen |
| `share_plan`, `import_shared_plan` | Link zu einem Plan ausgeben, erneuern (`renew`) oder widerrufen (`revoke`); geteilten Plan als Kopie übernehmen |
| `update_plan_exercise`, `remove_exercise_from_plan` | Zielwerte ändern, Übung entfernen |
| `start_workout`, `current_workout`, `finish_workout` | Training führen |
| `edit_workout`, `delete_workout` | Zeiten eines Trainings korrigieren oder es löschen |
| `log_set`, `undo_last_set` | Sätze protokollieren und korrigieren |
| `search_equipment`, `list_equipment` | Maschinen finden (auch über die Notiz, z. B. „Nr. 24“), nach Studio oder Übung filtern; zeigt Foto-Status und mögliche Dubletten |
| `create_equipment`, `update_equipment` | Maschinen anlegen und ändern; `per_side` (Gewicht je Seite), `load_unit` (`kg` oder `level` für Stufen) |
| `catalog_history` | Änderungsprotokoll einer Übung, Maschine oder eines Studios |
| `update_exercise` | Name, Muskelgruppe, Messart einer Übung ändern (Messart nur umrechenbar: Gewicht ↔ Körpergewicht + Zusatz) |
| `archive_exercise`, `archive_equipment` | Aus Auswahllisten ausblenden, Verlauf bleibt; `restore` holt zurück |
| `delete_exercise`, `delete_equipment` | Endgültig löschen – nur ohne Verlauf, nur Anleger oder Admin |
| `merge_exercises` | Doppelte Übung in eine andere zusammenführen: Verlauf, Pläne aller Nutzer und Maschinen wandern mit, die Dublette verschwindet |
| `reorder_plan`, `replace_plan_exercise` | Übungen im Plan nach vorn stellen bzw. austauschen, Zielwerte und Notiz bleiben; `plan: "*"` für alle Pläne |
| `photo_upload_link` | Einmal-Link für ein Maschinenfoto |
| `search_wger` | Übung in der offenen Datenbank wger suchen, um sie zu übernehmen |
| `log_meal`, `meals_on`, `delete_meal` | Mahlzeit eintragen (etwa aus einem Foto), Tag ansehen, Fehleintrag löschen |
| `nutrition_summary` | Tagessummen, Ziel, Gewichtstrend, Eiweiß- und Kalorienziel, Verbrauch |
| `weekly_review` | Wochenrückblick der Vorwoche: Training, Essen, Gewicht, Hinweise |
| `scale_captures` | Rohe Mitschnitte der Bluetooth-Waage |

Übungen und Pläne werden über ihren **Namen** angesprochen, nicht über IDs:
„Latzug" findet die Übung auch als Teilwort und ohne Rücksicht auf Groß- und
Kleinschreibung. Passen mehrere, fragt der Server nach, statt zu raten. Ist noch
kein Training offen, startet `log_set` selbst ein freies Training — mitten in der
Übung will niemand erst einen Plan auswählen.

**Fotos per Chat:** Ein Sprachmodell sieht ein Foto im Chat, kann die Datei
aber nicht an einen MCP-Server weiterreichen – dafür gibt es in MCP noch keinen
Standard. Deshalb liefern `create_equipment` und `photo_upload_link` einen
Einmal-Link (`/upload/…`): 30 Minuten ab dem Ausstellen gültig, genau ein
Foto, nur für diese Maschine, ohne Anmeldung. Gespeichert wird nur der Hash des
Schlüssels. Ist der Link abgelaufen, aber noch unbenutzt, lässt er sich auf der
Seite selbst erneuern – bis 24 Stunden nach dem ersten Ausstellen. Der Link
baut auf `APP_URL` auf – die Adresse muss vom Handy aus erreichbar sein.

Hochgeladen wird über eine feste Route (`POST /api/upload/…`), nicht über eine
Server-Action: deren ID ändert sich mit jedem Build, und eine Upload-Seite, die
vor einem Deploy geöffnet wurde, bekam beim Absenden sonst „Page not found“.

Trainings werden über ihr **Datum** angesprochen (`2026-09-08`); ohne Angabe
ist das zuletzt beendete gemeint. Zeiten dürfen als `2026-09-08T20:12` oder
verkürzt als `20:12` kommen — die reine Uhrzeit bezieht sich auf den Tag des
Trainings.

Pläne **löschen** kann der MCP-Server bewusst nicht. Das bleibt der Oberfläche
vorbehalten, wo eine Rückfrage davorsteht.

Die Regeln sind dieselben wie in der Oberfläche: beide Wege rufen dieselbe
Fachlogik in `src/lib/services/` auf. Ein Schlüssel sieht ausschließlich die
Daten seines eigenen Kontos, und ein gesperrtes Konto kommt auch über MCP nicht
mehr hinein.
