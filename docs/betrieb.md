# Betrieb

Reverse Proxy, E-Mail, Administration, Backup, Image und Sicherheit. Zurück zum [README](../README.md).

## Registrierung zumachen

Solange kein `REGISTRATION_CODE` gesetzt ist, kann sich jeder registrieren, der
die URL kennt. Für eine öffentlich erreichbare Instanz in der
`docker-compose.yml` setzen:

```yaml
environment:
  REGISTRATION_CODE: "dein-geheimer-code"
```

Danach `docker compose up -d` — bestehende Konten bleiben, neue brauchen den Code.

## Hinter einem Reverse Proxy

Das Session-Cookie wird nur dann als `secure` gesetzt, wenn die Verbindung
tatsächlich über HTTPS läuft. Sonst wäre der Login über `http://nas.local:3000`
im Heimnetz stillschweigend kaputt — der Browser würde das Cookie verwerfen.

Erkannt wird das über `X-Forwarded-Proto`. Falls dein Proxy den Header nicht
schickt, obwohl er HTTPS terminiert, setze `COOKIE_SECURE=true`.

Beispiel für Caddy:

```
gym.example.com {
    reverse_proxy localhost:3000
}
```

Und in der `docker-compose.yml` den Port auf `127.0.0.1:3000:3000` einschränken,
damit der Container nicht direkt aus dem Netz erreichbar ist.

**Host-Header:** Next.js vergleicht bei jedem Formular-Absenden die Herkunft
(`Origin`) mit dem `Host` bzw. `X-Forwarded-Host` – das ist der Schutz gegen
untergeschobene Formulare von fremden Seiten. Caddy und Traefik reichen den
Host durch; bei nginx `proxy_set_header Host $host;` setzen, sonst lehnt die
App Formulare ab.

**Bremse je IP:** GymTracker bremst Fehlversuche je Adresse (siehe
[Sicherheit](betrieb.md#sicherheit)). Eine Bremse je IP gehört an den Proxy, der die
echte Adresse kennt – für nginx etwa:

```nginx
limit_req_zone $binary_remote_addr zone=gym_login:10m rate=10r/m;

server {
    # …
    location = /login {
        limit_req zone=gym_login burst=5 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Caddy bringt dafür kein Bordmittel mit; dort hilft das Plugin
`caddy-ratelimit` oder fail2ban auf das Zugriffslog.

**Upload-Größe:** Handyfotos sind schnell 5–10 MB; GymTracker nimmt bis 15 MB
an. Caddy und Traefik begrenzen standardmäßig nicht, **nginx schon (1 MB)** –
dort `client_max_body_size 16m;` setzen, sonst scheitert der Foto-Upload mit
„zu groß“ (HTTP 413).

## E-Mail-Versand

Läuft über SMTP mit Zugangsdaten in der `.env` bzw. `docker-compose.yml` —
kein Drittanbieter-Account nötig, funktioniert mit praktisch jedem Provider
(eigener Mailserver, Domain-Hoster, ein App-Passwort bei Gmail o. ä.):

```yaml
environment:
  SMTP_HOST: "smtp.example.com"
  SMTP_PORT: "587"
  SMTP_USER: "dein-nutzername"
  SMTP_PASSWORD: "dein-passwort"
  SMTP_FROM: "GymTracker <noreply@example.com>"
  APP_URL: "https://gym.example.com"
```

`APP_URL` ist die Adresse, unter der GymTracker für deine Nutzer erreichbar
ist — wird für die Links in Bestätigungs- und Passwort-Reset-Mails gebraucht
(in einer Mail funktioniert kein relativer Link). Ohne `/` am Ende angeben.

`SMTP_PORT` bestimmt automatisch, ob TLS direkt (Port 465) oder per STARTTLS
(alles andere) genutzt wird. Erwartet dein Provider auf einem anderen Port
trotzdem implizites TLS, kannst du das mit `SMTP_SECURE: "true"` erzwingen.

Schlägt der Versand fehl (SMTP nicht erreichbar, falsche Zugangsdaten), bleibt
das Konto trotzdem angelegt — der Nutzer landet auf einer Seite mit einem
"Erneut senden"-Button, sobald der Mailserver wieder erreichbar ist.

**Lokal testen ohne echte Zugangsdaten**: ein Fake-SMTP-Server wie
[MailHog](https://github.com/mailhog/MailHog) fängt alle Mails ab und zeigt
sie in einer Weboberfläche:

```bash
docker run -d -p 1025:1025 -p 8025:8025 mailhog/mailhog
# SMTP_HOST=localhost, SMTP_PORT=1025, dann auf http://localhost:8025 schauen
```

## Benutzergruppen und Administration

Nutzer gehören Gruppen an. Aktuell gibt es genau eine, die die Anwendung selbst
mitbringt: **Administratoren**. Die Tabellen sind bewusst allgemein gehalten,
damit später auch fachliche Gruppen dazukommen können, über die sich
Trainingspläne teilen lassen.

### Ersteinrichtung

Solange es **keinen** Administrator gibt, legt die Anwendung beim Start ein
Einrichtungskonto an und schreibt die Zugangsdaten ins Log:

```bash
docker compose logs gymtracker | grep -A6 "nicht eingerichtet"
```

```
E-Mail:   admin@admin.de
Passwort: k7qm2-xf9rt-3bnwd
```

Das Passwort wird bei **jedem Start** neu erzeugt. Im Log steht damit immer
ein gültiges, auch wenn die alte Ausgabe längst weggescrollt ist – und ein
Passwort, das jemand mal mitgelesen hat, überlebt keinen Neustart.

Damit meldest du dich an und landest direkt auf der Einrichtungsseite. Dort
gibt es zwei Wege:

- **Neues Konto anlegen** – der Normalfall bei einer frischen Installation.
- **Bestehendes Konto übernehmen** – wenn schon Konten existieren, etwa weil du
  GymTracker vor dieser Version betrieben hast. Du wählst dein eigenes aus,
  statt ein zweites anzulegen.

In beiden Fällen wird das gewählte Konto Administrator, das Übergangskonto
gelöscht und die Einrichtungsseite verschwindet. Danach findest du unter
**Einstellungen → Administration** die Benutzerverwaltung.

Das Einrichtungskonto kann ausschließlich diese eine Sache. Es kommt weder in
die App noch in die Benutzerverwaltung, und an seine Adresse wird nie eine Mail
verschickt – auch kein „Passwort vergessen", denn `admin.de` gehört jemand
anderem.

Es ist zugleich der Notausgang: Wer versehentlich alle Administratoren
entfernt, bekommt nach einem Neustart wieder ein Einrichtungskonto – statt sich
dauerhaft ausgesperrt zu haben.

### Was ein Administrator kann

| Aktion | Wozu |
| --- | --- |
| Adminrechte vergeben und entziehen | Weitere Administratoren benennen |
| E-Mail manuell bestätigen | Der Notausgang, wenn eine Bestätigungsmail nicht ankommt |
| Bestätigungsmail erneut senden | Zustellung nochmal anstoßen |
| Konto sperren und entsperren | Login blockieren, Trainingsdaten bleiben erhalten |
| Konto löschen | Entfernt das Konto samt aller Trainingsdaten |

Zwei Regeln verhindern, dass sich jemand aussperrt, und sie werden serverseitig
in jeder Aktion geprüft, nicht nur im Menü versteckt:

- Am **eigenen** Konto sind Sperren, Löschen und der Entzug der Adminrechte
  gesperrt. Weil nur Administratoren diese Aktionen ausführen können, bleibt
  damit immer mindestens einer übrig.
- **Andere Administratoren** lassen sich weder sperren noch löschen. Dafür muss
  man ihnen zuerst die Adminrechte nehmen.

Eine Sperre wirkt sofort: laufende Sitzungen des Kontos werden ungültig, nicht
erst beim nächsten Login.

**Trainingsdaten anderer Konten bleiben auch für Administratoren privat.** In
der Benutzerverwaltung ist nur sichtbar, wie viele Trainings ein Konto hat –
keine Pläne, keine Sätze, keine Gewichte.

## Backup

Alles steckt in einer einzigen SQLite-Datei. Sauber (also auch im laufenden
Betrieb konsistent) sicherst du sie so:

```bash
docker compose exec gymtracker \
  node -e "const D=require('better-sqlite3');new D('/data/gym.db').backup('/data/backup.db').then(()=>console.log('ok'))"
docker compose cp gymtracker:/data/backup.db ./gym-backup-$(date +%F).db
```

Ein einfaches `cp` der Datei reicht nicht zuverlässig, solange die App läuft:
SQLite schreibt im WAL-Modus, die Änderungen stecken dann noch in `gym.db-wal`.

**Automatisch vor Updates:** Bringt ein neues Image Datenbank-Migrationen mit,
legt GymTracker vor dem Anwenden eine Kopie unter `/data/backups/` an
(`gym-<Zeitpunkt>-vor-<Migration>.db`, die letzten fünf bleiben liegen).
Schlägt eine Migration fehl, startet der Container nicht – dann das alte Image
nehmen und die Kopie zurück an `/data/gym.db` legen. Abschalten lässt sich das
mit `DB_BACKUP_BEFORE_MIGRATION=false`. Es ersetzt kein Backup außerhalb des
Servers.

**Der Schlüssel für gespeicherte API-Schlüssel:** Ohne `SECRET_KEY` legt
GymTracker beim ersten Bedarf `secret.key` neben der Datenbank an (im
Container also `/data/secret.key`). Sichere ihn mit – getrennt vom
Datenbank-Backup, sonst ist die Verschlüsselung wertlos. Geht er verloren,
müssen die Nutzer ihre Anthropic-Schlüssel neu eintragen; sonst fehlt nichts.

## Update

Zwei Wege, je nachdem ob du das fertige Image aus der GitHub Container
Registry ziehen oder lokal bauen willst:

```bash
# Vorgebautes Image von GitHub holen (Standard, kein lokaler Build nötig)
git pull
docker compose pull
docker compose up -d

# Oder: lokal bauen, z. B. für eigene Änderungen
git pull
docker compose up -d --build
```

Neue Migrationen laufen beim Start automatisch. Vorher ein Backup zu ziehen,
schadet trotzdem nie.

Die Datenbank liegt im Volume unter `/data/gym.db` und wird beim ersten Start angelegt.

## Vorgefertigtes Image (GitHub Container Registry)

Jeder Push auf `main` baut über [`.github/workflows/docker.yml`](../.github/workflows/docker.yml)
automatisch das Produktions-Image und veröffentlicht es als
`ghcr.io/pvillmann/gymtracker:latest` (zusätzlich getaggt mit dem kurzen
Commit-Hash) — öffentlich abrufbar, kein Login nötig. Pull Requests bauen nur
zur Validierung, ohne zu veröffentlichen — das eignet sich als Pflicht-Check
für einen geschützten `main`-Branch.

`docker-compose.yml` verweist auf dieses Image (`image:`), behält aber
`build: .` als Fallback für lokale Änderungen.

Falls du das Image später auf **Settings → Change package visibility →
Private** stellst, muss sich der Server einmalig einloggen, z. B. mit einem
[Personal Access Token](https://github.com/settings/tokens) mit
`read:packages`-Recht:

```bash
echo "<dein-token>" | docker login ghcr.io -u <dein-github-nutzername> --password-stdin
```

## Sicherheit

Was GymTracker selbst mitbringt:

- **Passwörter** als scrypt-Hash; Session-, Mail- und API-Tokens nur als
  SHA-256-Hash in der Datenbank. Eine gestohlene `gym.db` öffnet keine Sitzung.
- **Login-Bremse:** nach 10 Fehlversuchen für dieselbe Adresse 15 Minuten
  Pause. Gezählt wird im Speicher des Containers, ein Neustart setzt zurück.
  Die Kehrseite: Wer deine Adresse kennt, kann deinen Login so eine
  Viertelstunde blockieren – der Reverse Proxy ist der bessere Ort für eine
  Bremse je IP (Beispiel unter [Reverse Proxy](betrieb.md#hinter-einem-reverse-proxy)).
- **Content-Security-Policy mit Nonce:** Jede Seite bekommt pro Anfrage
  einen Zufallswert; nur Skripte, die Next.js selbst damit ausliefert,
  laufen (`src/proxy.ts`). Dazu: kein Einbetten in fremde Seiten,
  `nosniff`, sparsamer Referrer; Links mit Schlüssel in der URL (Upload,
  geteilte Pläne) mit `no-referrer` und `noindex`. Inline-Styles bleiben
  erlaubt (Diagramme), `upgrade-insecure-requests` fehlt bewusst – sonst
  ginge der Betrieb über `http://` im Heimnetz nicht mehr.
- **Server Actions** prüfen in Next.js die Herkunft (Origin gegen Host) –
  das ist der CSRF-Schutz der Formulare. Hinter einem Reverse Proxy muss der
  deshalb den `Host`-Header durchreichen (siehe [Reverse Proxy](betrieb.md#hinter-einem-reverse-proxy)).
- **Fotos** werden serverseitig neu kodiert (WebP, ohne Metadaten), mit
  Pixel-Obergrenze gegen Dekompressionsbomben, und nur angemeldeten Nutzern
  ausgeliefert.
- **Rechte:** Trainings, Pläne und Einstellungen sieht nur ihr Besitzer – auch
  kein Administrator. Den Katalog (Übungen, Maschinen, Studios) darf jeder
  bearbeiten; jede Änderung steht im Änderungsprotokoll.
- **Fremde API-Schlüssel** (Anthropic, pro Konto) liegen AES-256-GCM-
  verschlüsselt in der Datenbank und werden nie wieder angezeigt, nur die
  letzten vier Zeichen. Eine gestohlene `gym.db` allein reicht nicht – mit
  `secret.key` bzw. `SECRET_KEY` zusammen schon.
- **Web Push** läuft über VAPID; die Schlüssel erzeugt die Instanz selbst und
  legt sie in der Datenbank ab. Benachrichtigungen enthalten nur „Pause
  vorbei“ und den Übungsnamen.
  Als Endpunkt nimmt der Server nur Adressen der bekannten Push-Dienste an
  (sonst könnte ein Konto ihn Anfragen an interne Dienste schicken lassen),
  höchstens zehn Geräte je Konto.
- **Uploads und Importe** werden als Stream mit Obergrenze gelesen (Foto
  15 MB, Health-Export 20 MB) – auch ohne `Content-Length`.

Was du selbst tun solltest:

- **TLS davor.** Ohne HTTPS gehen Passwort, Session-Cookie und MCP-Schlüssel
  im Klartext übers Netz.
- **Registrierung zumachen** (`REGISTRATION_CODE`), wenn die Instanz aus dem
  Internet erreichbar ist.
- **Backups** der `gym.db` (siehe [Backup](betrieb.md#backup)) – und sie wie Passwörter
  behandeln: Sie enthalten E-Mail-Adressen und Trainingsdaten.
- **Updates** einspielen: Das Image wird bei jedem Merge neu gebaut und
  enthält damit die aktuellen Sicherheitsupdates von Next.js und Co.
