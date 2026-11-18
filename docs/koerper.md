# Körperwerte: Waage und Apple Health

Zurück zum [README](../README.md).

## Bluetooth-Waage

`/wiegen` verbindet sich per Web Bluetooth direkt mit der Körperwaage – ohne
Hersteller-App und ohne Apple Health. Auf dem iPhone kann Safari kein Web
Bluetooth; dort die Seite im Browser **Bluefy** öffnen. Unter „Körper“ steht
eine kurze Anleitung.

- Unterstützt sind Waagen der QN-Scale-Familie (z. B. Feelfit). Sie warten auf
  einen kurzen Handshake mit Konfiguration und Uhrzeit, den die Seite selbst
  führt (`src/lib/qn-scale.ts`).
- Die stabile Messung landet im Gewichtsverlauf, zusammen mit dem Widerstand
  (Impedanz). Was die Waage roh sendet, wird zusätzlich mitgeschrieben
  (Tabelle `scale_captures`, per MCP `scale_captures`).
- Sind im Profil Größe, Geburtsjahr und Geschlecht eingetragen, zeigt
  GymTracker daraus Körperfett als **Schätzung** nach Wu et al. 2015
  (Fuß-zu-Fuß, 50 kHz, gegen DXA geprüft; `src/lib/body-composition.ts`). Die
  Formel ist für Europäer nicht validiert und absolut etwa ± 4 Prozentpunkte
  unsicher – aussagekräftig ist der Verlauf.
- Der Gewichtstrend glättet einzelne Messungen; mehrere Wiegungen eines Tages
  zählen als ein Mittelwert.

## Apple Health

Apple Health hat keine Web-Schnittstelle – eine Web-App kommt an die Daten
nur über eine App auf dem iPhone. GymTracker nimmt den JSON-Export von
**Health Auto Export** (iOS, Funktion „REST API“ braucht das Abo der App)
unter `POST /api/health` an:

1. In GymTracker unter Einstellungen → Apple Health einen Import-Schlüssel
   erzeugen. Er kann nur Körperwerte schreiben, nichts lesen.
2. In Health Auto Export eine Automation „REST API“ anlegen: URL
   `https://deine-instanz/api/health`, Format JSON, „Daten zusammenfassen“
   an, Zeitraum täglich, unter HTTP-Header `Authorization` = `Bearer gymh_…`.
3. Metriken wählen. Übernommen werden Gewicht, Körperfett, Magermasse,
   Ruhepuls, HRV (SDNN), Schlaf (nur zusammengefasst), Schritte und aktive
   Energie; kg/lb/st und kcal/kJ werden umgerechnet.

Die Antwort nennt, was übernommen wurde, welche Metriken ignoriert wurden
(`ignored`) und welche eine unbekannte Einheit hatten (`badUnits`) – die
Doku der App nennt die JSON-Namen der Metriken nicht vollständig, deshalb
ist das der Weg, eine Abweichung zu sehen. Ein erneuter Export desselben
Zeitraums überschreibt, statt doppelt zu zählen. Der jüngste Gewichtswert
wird zum Körpergewicht im Profil; bereits gespeicherte Sätze behalten ihr
Volumen.

Hinter einem Reverse Proxy mit Größenlimit (nginx: `client_max_body_size`)
muss das Limit für `/api/health` zum Export passen – ein Tag ist klein, ein
Jahresexport mehrere MB. GymTracker selbst nimmt bis 20 MB an.
