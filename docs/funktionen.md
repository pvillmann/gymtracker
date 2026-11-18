# Funktionen

Alles, was GymTracker kann – nach Bereichen. Zurück zum [README](../README.md).

## Aufbau

- Unten fünf Tabs für den Alltag: **Heute** (Training starten, gegessen,
  Gewicht), **Training** (Pläne), **Essen**, **Körper** (Gewicht,
  Körperfett-Schätzung, Wiegen) und **Mehr**
- Hinter „Mehr“: Verlauf, Statistik, Übungen, Maschinen, Studios,
  Einstellungen, Administration und Abmelden
- Einstellungen in vier Gruppen mit Sprungleiste: Profil & Körper, App,
  Verbindungen (Claude/MCP, Apple Health, KI), Konto

## Training mitschreiben

- Satz für Satz Gewicht und Wiederholungen erfassen – einfach eintippen,
  vorbelegt mit den Werten vom letzten Mal
- Über jedem Eingabefeld steht, was beim letzten Mal in genau diesem Satz stand
- Jeder gespeicherte Satz bekommt sofort ein Vergleichs-Label: ▲ +5 kg, ▼ −1 Wdh. oder „gleich"
- Den letzten Satz einer Übung mit einem Tipp einschätzen – „Am Limit“, „Ok“
  oder „Leicht“ – und beim nächsten Mal sehen, ob noch Luft war
- Pausentimer startet automatisch nach dem Satz und vibriert, wenn er abgelaufen ist
- Notizfeld pro Maschine für die Einstellungen (Sitzhöhe, Lehne, Griff)
- Beenden vergessen? Wer ein Training öffnet, das seit Stunden läuft, bekommt
  angeboten, das Ende auf den letzten protokollierten Satz zu setzen — sonst
  steht im Verlauf eine Dauer, die jede Auswertung über die Trainingszeit
  verzerrt. Beginn und Ende lassen sich später ohnehin korrigieren.
- Aufwärmsätze werden getrennt gezählt (A1, A2 …), zählen nicht aufs Satzziel
  und werden nur mit den Aufwärmsätzen vom letzten Mal verglichen
- Übungen lassen sich spontan ergänzen, auch wenn sie nicht im Plan stehen

## Vorschläge im Training

- Progressionsvorschlag nach doppelter Progression: erst Wiederholungen bis ans
  obere Ende des Zielbereichs, dann ein Gewichtssprung. Die Felder sind direkt
  damit vorbelegt, ein Knopf schaltet auf „wie letztes Mal“ zurück. „Am Limit“
  hält das Gewicht, „Leicht“ steigert schon knapp unter dem Ziel. Ist der
  Sprung größer als 10 % des Gewichts, kommen erst zwei Wiederholungen über
  das Ziel hinzu
- Der Sprung steht pro Maschine (Feld „Gewichtssprung“), sonst gilt ein
  Standard nach Gerätetyp: Steckgewicht/Kabel 5 kg, Scheiben 2,5 kg (je Seite
  1,25), Kurzhanteln 2 kg, Stufen 1
- Optional mit **Claude Haiku**: Wer in den Einstellungen einen eigenen
  Anthropic-API-Schlüssel hinterlegt, bekommt den Regelvorschlag von Haiku
  verfeinert (etwa ein Deload nach Stillstand). Der Vorschlag entsteht im
  Hintergrund, bis dahin gilt die Regel; er bleibt höchstens einen Sprung über
  der Regel und zwei unter dem letzten Mal. Gesendet werden je Übung Name,
  Zielbereich, Plannotiz und die letzten drei Trainings daran – keine Namen
  oder E-Mail. Der Schlüssel wird vor dem Speichern geprüft, liegt nur
  verschlüsselt in der Datenbank (AES-256-GCM, siehe `SECRET_KEY`) und die
  Kosten laufen über das eigene Anthropic-Konto
- Scheiben-Rechner: An Scheiben-Maschinen steht unter dem Gewicht, was pro
  Seite aufzulegen ist. Die vorhandenen Scheiben lassen sich je Studio
  einstellen
- „Da ging noch was“: War der letzte Satz „Leicht“, schlägt die App einen
  Bonus-Satz mit einem Sprung mehr vor – und, wenn im Plan noch eine Übung für
  den Gegenspieler offen ist, diese als Supersatz
- „Pause vorbei“ als Benachrichtigung auch bei gesperrtem Bildschirm (Web
  Push, in den Einstellungen pro Gerät einschalten; auf dem iPhone nur als
  Web-App vom Home-Bildschirm, ab iOS 16.4)

## Pläne und Übungen

- Mehrere Trainingspläne mit sortierter Übungsreihenfolge und Zielvorgaben
  (Sätze, Wiederholungsbereich, Pausenlänge)
- Ein Startpaket gängiger Geräte lässt sich per Klick anlegen
- Pläne teilen: Auf der Planseite einen Link erzeugen – wer ihn hat, sieht den
  Plan auch ohne Konto und übernimmt ihn mit Konto als eigene Kopie. Geteilt
  werden Übungen, Zielwerte, Pausen und die Notizen der Einträge; nicht die
  Plan-Notiz, das Studio oder wer geteilt hat. Der Link lässt sich erneuern
  oder widerrufen, übernommene Kopien bleiben davon unberührt
- Übung, Maschine, Studio: Eine Übung (z. B. „Seitheben“) geht an mehreren
  Maschinen, eine Maschine steht in mehreren Studios – beides wird einmal
  zugeordnet und gilt für alle. Im Plan steht nur die Übung; im Training
  schlägt die App die Maschine vor, die im gewählten Studio steht (bei
  mehreren die dort zuletzt benutzte). Andere Maschinen der Übung lassen sich
  umschalten; wer an einer trainiert, trägt sie damit im Studio ein.
  Verglichen wird nur an derselben Maschine – dieselben Kilos sind an
  Maschine und Kabelzug nicht dieselbe Last.
- Studios: Beim Trainingsstart fragt die App, wo du bist – mit „Nicht erneut
  fragen“ merkt sich der Plan das Studio. Jedes Studio hat eine eigene Seite
  (unter Übungen → Studios) mit den Maschinen, die dort stehen. Einstellungen
  an der Maschine lassen sich pro Studio hinterlegen
- Maschinen mit Foto, Hersteller, Übersetzung (z. B. 2:1 am Kabelzug),
  Eigengewicht. Übersetzung und Eigengewicht fließen ins bewegte Gewicht ein;
  Fotos werden verkleinert und ohne Metadaten (auch ohne GPS) im Daten-Volume
  gespeichert
- Maschinen mit getrennten Armen (Iso-Lateral) lassen sich auf „Gewicht je
  Seite“ stellen: eingetragen wird, was auf einer Seite steckt, angezeigt als
  „40 kg/Seite“, ins Volumen geht das Doppelte. Maschinen mit Stufen statt
  Kilo (z. B. Life Fitness 1–20) zeigen „Stufe 8“; Stufen zählen nicht ins
  Volumen, weil sich daraus keine Last ableiten lässt
- Änderungsprotokoll: Auf den Seiten von Übung, Maschine und Studio steht,
  wer wann was geändert, zugeordnet, archiviert oder zusammengeführt hat
  (per MCP: `catalog_history`) – Gegenstück dazu, dass jeder bearbeiten darf
- Varianten (Übung × Maschine) sind nur noch über Name und eigene Einstellung
  bearbeitbar; Messart, Muskelgruppe und Maschine gehören zur Übung bzw.
  Maschine und werden dort für alle geändert
- Dubletten: Namen, die sich nur in Groß-/Kleinschreibung unterscheiden, werden
  beim Anlegen abgelehnt. Bestehende Dubletten lassen sich auf der Übungsseite
  (oder per MCP) zusammenführen – Verlauf, Pläne und Maschinen wandern mit
- Archivieren statt Löschen: Übungen und Maschinen mit Verlauf lassen sich
  archivieren – sie verschwinden aus Auswahllisten und Vorschlägen, Verlauf und
  Pläne bleiben. Löschen geht nur, solange niemand daran trainiert hat
- Gemeinsamer Katalog: Übungen, Maschinen (samt Fotos), Studios und ihre
  Zuordnungen gelten für alle Nutzer der Instanz. Jeder darf sie benutzen,
  anlegen, bearbeiten und zuordnen – wer einen Fehler sieht, korrigiert ihn.
  Löschen darf nur, wer den Eintrag angelegt hat, oder ein Administrator.
  Trainings, Pläne und Einstellungen bleiben privat.
- Neue Übungen lassen sich aus der offenen Übungsdatenbank
  [wger](https://wger.de) übernehmen (Name und Muskelgruppe). Lizenz und
  Urheber werden pro Eintrag mitgespeichert und angezeigt (CC-BY-SA);
  braucht Internetzugang der Instanz, `WGER_URL` stellt eine eigene
  wger-Instanz ein
- Vier Messarten: Gewicht × Wiederholungen, Körpergewicht (+ Zusatzgewicht),
  Körpergewicht − Gegengewicht (assistierte Maschinen) und Zeit

## Darstellung

- Kopfleiste, Trainingsleiste und Navigation liegen als schwebende Ebene über
  dem Inhalt, die Navigation als Kapsel wie bei iOS. Inhalte (Sätze, Zahlen)
  bleiben auf deckenden Karten – im Gym zählt Lesbarkeit
- In den Einstellungen wählt jedes Konto Akzentfarbe (Blau, Cyan, Violett,
  Orange, Pink, Lime) und Glasstärke (deckend, gedämpft, klar). Standard:
  Blau, deckend. Grün und Rot bleiben für besser/schlechter reserviert
- Ist auf dem Gerät „Transparenz reduzieren“ oder „Kontrast erhöhen“ an,
  bleibt die Ebene deckend

## Ernährung und Ziele

Waage und Apple Health: [Körperwerte](koerper.md).

- Mahlzeiten per Foto im Claude-Chat: Claude schätzt kcal und Eiweiß, fragt
  nach Öl, Soßen und Getränken und trägt nach Bestätigung über MCP ein
  (`log_meal`, `meals_on`, `delete_meal`, `nutrition_summary`). Fotos speichert
  GymTracker nicht, nur Beschreibung und Zahlen
- Seite „Ernährung“ mit den Mahlzeiten des Tages, Summe und Schnitt über die
  Tage mit Einträgen; Eintragen von Hand geht auch. Tage ohne Eintrag zählen
  nicht als „nichts gegessen“
- Schätzungen aus Fotos liegen oft 20–50 % daneben – gleichbleibend schätzen
  ist wichtiger als genau
- Ziele aus Regeln (`src/lib/goals.ts`): Wochenziel im Profil (−1 bis
  +0,25 %/Woche, Helms et al. 2014), geglätteter Gewichtstrend und Tempo,
  Eiweiß 1,6–2,0 g/kg (Morton et al. 2018; ab BMI 30 bezogen auf das Gewicht
  bei BMI 25 – eine Konvention), Verbrauch aus Essen und Trend ab 21 Tagen
  mit mindestens drei von vier Tagen eingetragen, daraus das Kalorienziel
- Wochenrückblick auf „Heute“ (montags für die Vorwoche, einmal berechnet
  und gespeichert): Trainings und Volumen gegen die Vorwoche, Übungen ohne
  Fortschritt seit drei Einheiten, Essen und Eiweiß gegen das Ziel,
  Gewichtstrend gegen das Wochenziel. Die Hinweise rechnet GymTracker
  (`src/lib/weekly-review.ts`); mit eigenem API-Schlüssel schreibt Claude
  Haiku 3–5 Sätze Rückmeldung und höchstens zwei Korrekturen dazu. Haiku
  bekommt nur die Zahlen, keinen Namen und keine E-Mail. Per MCP:
  `weekly_review`

## Fortschritt sehen

- Pro Übung: Verlaufskurve des besten Satzes, schwerstes Gewicht, bestes Training
- Der Vergleich läuft über das geschätzte 1RM (Epley), damit 60 kg × 10 und
  70 kg × 6 vergleichbar sind
- Neue persönliche Rekorde werden nach dem Training markiert
- Statistik: bewegtes Gesamtgewicht, Wochenverlauf, Trainingsserie in Wochen,
  Top-Übungen und Verteilung nach Muskelgruppe
- Arbeitssätze pro Muskelgruppe und Woche mit Durchschnitt der letzten vier
  Wochen – Aufwärmsätze zählen nicht (per MCP in `training_stats`)
- „Fakten zum Angeben": das bewegte Gewicht in Elefanten, Linienbussen oder
  Vielfachen des eigenen Körpergewichts
- Körperwerte im Verlauf: Jede Änderung des Körpergewichts im Profil landet
  als Punkt in der Kurve; aus Apple Health kommen Gewicht, Körperfett,
  Magermasse, Ruhepuls, HRV, Schlaf, Schritte und aktive Energie dazu (siehe
  [Apple Health](koerper.md#apple-health)). Kacheln zeigen den letzten Wert, den
  Schnitt der letzten sieben Tage und die Veränderung zu vier Wochen davor

## Mehrere Nutzer

- Registrierung mit E-Mail und Passwort (scrypt-Hash), Session-Cookies
- E-Mail-Bestätigung ist Pflicht: ohne Klick auf den Link in der
  Willkommensmail kein Login
- "Passwort vergessen" per Mail-Link, invalidiert dabei alle bestehenden
  Sessions des Kontos
- Jeder Nutzer sieht ausschließlich seine eigenen Pläne, Übungen und Trainings
- Die Registrierung lässt sich über `REGISTRATION_CODE` hinter einen Code sperren
- Konto selbst restlos löschen (mit Passwort-Bestätigung) – entfernt wirklich
  alles: Pläne, Übungen, Trainings, Sätze, Sessions

## Per Chat mitschreiben (MCP)

Einrichtung und alle Werkzeuge: [Claude und MCP](claude-mcp.md).

- GymTracker bringt einen eigenen MCP-Server mit: „Heute Rückentraining, erster
  Satz Latzug mit 20 kg" wird direkt zum protokollierten Satz
- Jeder Nutzer erzeugt sich in den Einstellungen seinen eigenen Schlüssel
- Lesen (Pläne, Verlauf, letzte Leistung, Statistik) und Schreiben (Übungen und
  Pläne anlegen, Training starten, Sätze protokollieren, Training beenden)
- Sätze nennen die Übung; die Maschine ergibt sich aus Training und Studio
  oder wird bei Bedarf dazugesagt. Maschinen lassen sich per Chat Übungen
  und Studios zuordnen
- Geräte aus einem Foto anlegen: Claude erkennt die Maschine im Chat, recherchiert
  Daten wie die Übersetzung, legt sie nach deiner Bestätigung an und gibt dir
  einen Einmal-Link für das Foto (30 Minuten gültig, ein Foto, ohne Anmeldung)

## Benutzergruppen

- Gruppenmodell als Grundlage, aktuell mit der Systemgruppe *Administratoren*
- Benutzerverwaltung: Konten freischalten, sperren, löschen und Adminrechte vergeben
- Schutz gegen Selbstaussperrung, serverseitig geprüft

## Messarten


Jede Übung hat eine Messart, die bestimmt, was du erfasst und wie daraus die
bewegte Last wird:

| Messart | Du trägst ein | Bewegte Last |
| --- | --- | --- |
| Gewicht × Wiederholungen | das aufgelegte Gewicht | genau dieses Gewicht |
| Körpergewicht (+ Zusatzgewicht) | optionales Zusatzgewicht | Körpergewicht **plus** Zusatz |
| Körpergewicht − Gegengewicht | das Gegengewicht der Maschine | Körpergewicht **minus** Gegengewicht |
| Zeit | die Dauer | keine (zählt nicht ins Volumen) |

Die dritte ist für **assistierte Klimmzug- und Dip-Maschinen**: das eingestellte
Gegengewicht nimmt dir Last ab. Entsprechend ist **weniger** Gegengewicht die
Steigerung — die App dreht die Richtung um, ein Satz mit 5 kg weniger Hilfe
erscheint als Fortschritt (`▲ −5 kg Hilfe`), nicht als Rückschritt.

## Wie das bewegte Gewicht gerechnet wird


Volumen eines Satzes = bewegte Last × Wiederholungen, aufsummiert über alle
Sätze. Das in den Einstellungen hinterlegte Körpergewicht geht dabei in die
beiden Körpergewichts-Messarten ein — sonst wären Klimmzüge rechnerisch
wertlos. Mehr Gegengewicht als Körpergewicht ergibt null statt einer negativen
Last.

Bei Maschinen mit **Gewicht je Seite** zählt die eingetragene Last doppelt
(Faktor und Eigengewicht wie gehabt: Eigengewicht + Gewicht × Übersetzung × 2).
Maschinen mit **Stufen** liefern kein Volumen – „Stufe 8“ ist keine Masse.
Wer eine Maschine umstellt, rechnet damit alle bisherigen Sätze daran neu.
