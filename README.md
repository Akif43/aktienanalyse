# Borsa – Aktienanalyse-PWA (0 € Budget)

Aktien einfach erklärt, auf Deutsch **und Türkisch**: BIST (Borsa Istanbul), US und XETRA. Watchlist, verständliches Kurzfazit mit Ampel,
News/KAP mit Einordnung, Kursanzeige, Depot und Push-Alarme als PWA auf dem iPhone, ohne Apple-Developer-Account und ohne bezahlte Dienste.

> **Keine Anlageberatung.** Alle Auswertungen sind Einordnungen aus öffentlichen Daten, keine Empfehlungen.

## Status

| Phase | Inhalt | Stand |
|---|---|---|
| 1 | Plan, Datenquellen-Vergleich, Push-Lösung, Hosting | erledigt |
| 2 | Datenanbindung, Indikatoren mit Tests, Watchlist-Speicher | erledigt |
| 3 | PWA: Watchlist, Kurs, Chart, Suche, installierbar | erledigt (Vercel-Deployment steht noch aus) |
| 4 | KI-Auswertung (technisch + News/KAP), TRY/USD/EUR | erledigt, mit echtem Gemini-Key auf Vercel geprüft |
| 4b | Einfache Ansicht für Laien, Deutsch und Türkisch umschaltbar | erledigt (türkische Texte bitte gegenlesen) |
| 4c | Türkische Investment-/Rentenfonds (TEFAS): Suche, Merkliste, Kursverlauf, Vergleich | erledigt |
| 4d | Depot: eigene Käufe (Aktien und Fonds) eintragen, Vermögen und Gewinn/Verlust sehen | erledigt |
| **5** | **Alarme: Regeln je Aktie, Hintergrund-Überwachung über GitHub Actions, Push über ntfy** | **erledigt (du musst noch ntfy einrichten, siehe unten)** |
| 6 | Feinschliff, Fehlerbehandlung, Deployment-Anleitung, optional Web Push | offen |

## Was die App kann

- **Zwei Sprachen:** Deutsch und Türkisch, umschaltbar unter *Einstellungen*. Beim ersten Start gilt die Sprache des Handys (Türkisch, sonst Deutsch). Die Sprache gilt für die ganze Oberfläche **und** für die KI-Texte (eigener Zwischenspeicher je Sprache).
- **Meine Aktien** mit Name, Kurs, Tagesänderung und einem einfachen Hinweis "Live" bzw. "ca. 15 Min. verzögert", automatisch aktualisiert.
- **Einfache Ansicht (Standard)** je Aktie: Tageswerte, **Kurzfazit mit Ampel** (Sieht eher gut aus / Gemischtes Bild / Sieht eher schwach aus) in Alltagssprache mit "Das spricht dafür/dagegen", ein **einfacher Kursverlauf** (Tag, Woche, Monat, 6 Monate, Jahr, 5 Jahre) mit Veränderung, Höchst- und Tiefststand, **Auf einen Blick** (einfache Aussagen zu Trend, Jahresspanne und Schwankung, auch ohne KI) und bei BIST-Aktien der **Lira-Effekt** (Entwicklung in Lira, Dollar und Euro).
- **Details für Fortgeschrittene** (eingeklappt, Zustand wird gemerkt): Kerzenchart mit SMA, Bollinger, RSI, MACD, möglicher Handelsplan (Einstieg, Verlustbremse, Kursziele, Chance-Risiko), ausführliche KI-Begründung, alle Kennzahlen mit kurzen Erklärungen und ein Begriffs-Wörterbuch.
- **Nachrichten:** je Meldung Positiv/Neutral/Negativ und ein Hinweis "Wichtig", Titel in der gewählten Sprache (von der KI übersetzt, Original darunter), dazu "Kurz gesagt" mit Positivem und Negativem. **Offizielle KAP-Meldungen haben Vorrang:** Sie stehen in einem eigenen Abschnitt vor den Medien, die KI gewichtet sie höher (Presse gilt als zweitrangig und Unbestätigtes wird als solches genannt), und sie fließen bei BIST-Aktien auch in das **Kurzfazit** ein (die neuesten Meldungen der letzten 14 Tage; eine neue Meldung löst nach dem Mindestabstand eine neue Einschätzung aus).
- **Wichtiges zuerst:** Die KI bewertet jede Meldung nach Firmenbezug **und** möglicher Kurswirkung (Skala 1 bis 5, bloße Namensnennung zählt nicht). Die Liste ist danach sortiert, Unwichtiges (bei Presse Wichtigkeit 1 und 2, bei KAP 1) ist eingeklappt. Vorab entscheidet eine einfache Vorbewertung (Firma im Titel, Ereigniswörter wie Bilanz/Dividende/Übernahme, Füllstoff wie Tagesnotizen und Kurslisten, bei KAP Meldungsart und Absender), welche Meldungen die KI überhaupt zu sehen bekommt. Berichte zur selben Geschichte (z. B. 30 Artikel über denselben Preis) erscheinen einmal mit "+N weitere Berichte". Grenze: Ähnliche Artikel mit ganz anderen Worten werden nicht immer erkannt.
- **Meldung antippen = Erklärung in der App:** Die KI fasst die Meldung in einfachen Worten zusammen und ordnet ein, was sie für die Aktie bedeuten könnte (kurzfristig, langfristig, was helfen und was belasten könnte, worauf man achten kann), mit Ampel-Einstufung und Angabe, wie gut das belegt ist. **Bei KAP-Meldungen liest die KI den vollständigen Meldungstext** (das offizielle KAP-PDF). **Bei Presseartikeln liegt ihr nur die Überschrift vor**, weil Artikeltexte nicht frei abrufbar sind; die App sagt das ausdrücklich und deckelt die Sicherheit der Einschätzung. Das Original bleibt als Link erreichbar. Abgerufen wird erst beim Antippen, gespeichert je Meldung und Sprache (kostet also pro Meldung höchstens eine KI-Anfrage).
- **Fonds (TEFAS):** eigener Reiter in der Suche, eigene Merkliste "Meine Fonds" (getrennt von den Aktien), Fonds-Detailseite mit Preis, Tagesänderung, Kategorie, Platz in der Kategorie, Anlegerzahl, Marktanteil, einfachem Kursverlauf (Woche bis 5 Jahre, **umschaltbar TRY/USD/EUR** wie beim Aktienchart, umgerechnet mit dem Tageskurs) und Vergleich mit Gold, BIST 100/30, Inflation (TÜFE), USD, EUR und Bankzins. Quelle ist TEFAS (Tefas.gov.tr), die offizielle Handelsplattform für Investment- und Rentenfonds in der Türkei; der Preis wird einmal täglich nach Börsenschluss aktualisiert, nicht in Echtzeit. Keine KI-Auswertung für Fonds (nur Zahlen aus TEFAS, keine Einschätzung).
- **Depot:** eigene Käufe von Aktien und Fonds eintragen (Stückzahl, Kaufpreis, Datum, mehrere Käufe je Wert möglich). Übersicht zeigt zuerst das **Gesamtvermögen** (Positionen plus Bargeld), darunter den Wert nur der Positionen, Bargeld, eingesetztes Kapital und Gewinn/Verlust, **umschaltbar in Lira, Dollar oder Euro** (wie beim Kursverlauf), dazu ein **Verlaufschart "Gesamtvermögen im Zeitverlauf"** (aus der gehaltenen Stückzahl je Tag und den historischen Kursen berechnet; Bargeld fließt mit dem aktuellen Betrag über den ganzen Zeitraum ein, da dafür kein Verlauf bekannt ist). Je Position außerdem direkt auf der Aktien-/Fonds-Detailseite unter "Mein Bestand". Rein lokal auf dem Gerät gespeichert (wie die Watchlist), keine Anlageberatung.
- **Alarme:** je Aktie einzeln ein-/ausschaltbar: neues Tagestief, 52-Wochen-Hoch/-Tief, Kurs über/unter einer Schwelle, starke Tagesbewegung (%), wichtige Meldung. Höchstens 3 Alarme am Tag je Regel, nur während die jeweilige Börse geöffnet ist. Ein GitHub-Actions-Job prüft alle 5 Minuten im Hintergrund (`scripts/monitor.ts`, `.github/workflows/monitor.yml`) und schickt Treffer per **ntfy**-Push aufs Handy, unabhängig davon, ob die App gerade offen ist. Regeln und Zustand liegen in Supabase (dieselbe Tabelle wie der KI-Zwischenspeicher), nicht im Browser — Einrichtung siehe unten. Nur für Aktien (Fonds haben keine Tageszeitspanne/52-Wochen-Werte).
- **Suche** (BIST, XETRA, US, TEFAS-Fonds), **Einstellungen** (Sprache, Zugangscode, Verbindungstest, KI-Status, Liste sichern), **PWA** (installierbar, offlinefähige Hülle).

## So verhindert die App erfundene Zahlen

1. Alle Kennzahlen berechnet der **Code**, nicht die KI.
2. Einstieg, Stop-Loss und Kursziele werden ebenfalls **vom Code berechnet** (aus Unterstützungs-/Widerstandszonen und ATR). Die KI wählt nur per
   ID aus (z. B. `E2`, `SL2`, `T1`) und begründet. Unpassende Auswahl (Stop über Einstieg, unbekannte ID) wird verworfen und vermerkt.
3. Jede Zahl in den KI-Texten wird gegen das Eingabe-JSON geprüft (gerundet oder abgeschnitten erlaubt). Bei nicht belegten Zahlen gibt es **eine
   Wiederholung mit Rückmeldung**. Bleiben sie, werden die betroffenen **Sätze entfernt** und die App zeigt, wie viele.
4. Ausgewogenheit ist Pflicht: Argumente dafür, dagegen und Risiken müssen vorhanden sein, sonst wird die Antwort abgelehnt.
5. Meldungstexte gelten als fremde Daten: Die KI wird angewiesen, darin stehende Anweisungen nicht zu befolgen.

Grenzen: Der Wächter prüft Zahlen, nicht ob eine Aussage fachlich richtig ist. Kleine Zahlen bis 10, gängige Indikator-Perioden (14, 20, 50, 200 …) und
Jahreszahlen sind freigegeben. Die KI kann also weiterhin falsch gewichten oder Zusammenhänge falsch deuten. Prüfe Einschätzungen immer selbst.

## KI einrichten (kostenlos)

Ohne Key läuft alles außer dem KI-Text. Die App zeigt dann einen Hinweis und die Kennzahlen funktionieren normal.

**Gemini-Key (Pflicht für die KI):**
1. aistudio.google.com mit deinem Google-Konto öffnen → **"Get API key"** → **"Create API key"**. Keine Kreditkarte nötig.
2. Den Key als `GEMINI_API_KEY` in Vercel (Environment Variables) bzw. lokal in der `.env` eintragen.
3. Standardmodell ist `gemini-3.1-flash-lite`. Laut Drittquellen (Stand 09/2026) hat es das großzügigste Gratis-Kontingent (ca. 500 Anfragen/Tag);
   die stärkeren Flash-Modelle nur ca. 20/Tag. Dein tatsächliches Limit siehst du in AI Studio. Ändern mit `GEMINI_MODEL`.
4. Hinweis: Im kostenlosen Tarif dürfen Eingaben laut Googles Bedingungen zur Produktverbesserung genutzt werden. Übertragen werden nur öffentliche
   Kurs- und Nachrichtendaten, keine persönlichen Daten.

**Groq-Key (optional, Ausweichanbieter bei Limit oder Ausfall von Gemini):** console.groq.com → *API Keys* → `GROQ_API_KEY`. Standardmodell `openai/gpt-oss-120b`.

**Supabase (empfohlen, damit Auswertungen erhalten bleiben):**
1. supabase.com → **"Start your project"** → mit GitHub anmelden → **New project** (Free, Region *Frankfurt*, ein Datenbank-Passwort vergeben und aufschreiben).
2. **SQL Editor** → **New query** → den Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen → **Run**.
3. **Project Settings → API**: *Project URL* als `SUPABASE_URL` und den **service_role**-Key als `SUPABASE_SERVICE_KEY` in Vercel eintragen.
   Der service_role-Key ist geheim (nie ins Repo oder Frontend). Die Tabelle ist per Row Level Security gesperrt, nur dieser Key darf zugreifen.
4. Danach in Vercel **neu deployen**, damit die Variablen greifen. In den App-Einstellungen zeigt *Speichern und Verbindung testen* den KI-Status.

Ohne Supabase liegen Auswertungen nur im Arbeitsspeicher der Serverfunktion und gehen bei jedem Kaltstart verloren. Das verbraucht Kontingent schneller.
Kostenlose Supabase-Projekte pausieren nach etwa einer Woche ohne Nutzung. Dann im Dashboard auf *Restore* klicken (ab Phase 5 hält der Monitor es wach).

**Schutz des Kontingents:** höchstens eine neue Auswertung je Aktie und Stunde, manuelles "Neu auswerten" frühestens nach 10 Minuten, neue Auswertung nur bei
neuer Tageskerze, Kursbewegung von etwa einer halben ATR oder geändertem Trend/Signal (News: nur bei neuen Meldungen), Tageslimit `AI_DAILY_LIMIT` (Standard 300).
Bei Limit oder Ausfall zeigt die App die letzte Auswertung als "veraltet".

**Testlauf mit echtem Key** (verbraucht 1 bis 2 Anfragen):
```bash
npm run analyze -- THYAO.IS --news
```
`npm run check:ai` prüft ohne Key nur, ob die KI-Server erreichbar sind und Fehler richtig erkannt werden. `AI_PROVIDER=demo` liefert Platzhaltertexte
zum Ausprobieren der Oberfläche (in der App deutlich als Demo gekennzeichnet).

## Alarme einrichten (Phase 5, optional)

Ohne diese Einrichtung funktioniert die App normal, nur ohne Push-Benachrichtigungen. Braucht Supabase (siehe oben) und einen GitHub-Account (hast du schon, für das Repo).

1. **ntfy-App installieren:** aus dem App Store (iOS) oder Play Store (Android), kostenlos, kein Account nötig.
2. **Ein langes Zufalls-Topic erzeugen** (das ist dein einziges Geheimnis, wie ein Passwort):
   ```bash
   node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
   ```
3. In der ntfy-App **genau dieses Topic abonnieren** (+ Symbol → Topic-Namen einfügen). Ab jetzt kommen Testnachrichten für dieses Topic auf dein Handy.
4. **GitHub-Repo → Settings → Secrets and variables → Actions → New repository secret**, drei bzw. vier Einträge anlegen (GitHub Actions liest *nicht* aus den Vercel-Umgebungsvariablen, deshalb müssen `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` hier noch einmal eingetragen werden):
   - `SUPABASE_URL` und `SUPABASE_SERVICE_KEY` (dieselben Werte wie in Vercel)
   - `NTFY_TOPIC` (das Topic aus Schritt 2)
   - optional `APP_URL` (z. B. `https://<dein-projekt>.vercel.app`), damit ein Antippen der Benachrichtigung direkt zur Aktie führt
5. **Testlauf:** GitHub-Repo → Tab **Actions** → **"Depot-Überwachung (Alarme)"** → **Run workflow**. Ohne aktive Regeln beendet er sich sofort ("Keine aktiven Regeln"); leg dafür in der App auf einer Aktien-Detailseite unter **Alarme** eine Regel an (z. B. "Kurs über" mit einer Schwelle knapp über dem aktuellen Kurs) und starte den Workflow erneut.
6. Danach läuft er automatisch alle 5 Minuten. **Bekannte Grenzen** (siehe auch Abschnitt "Risiken" oben): Alarme kommen wegen der Kursverzögerung (~15 Min. bei BIST) und der Cron-Verzögerung (5–30 Min., "best effort") nicht sofort. Geplante GitHub-Workflows werden nach 60 Tagen ohne jegliche Repo-Aktivität automatisch deaktiviert.

Lokaler Testlauf ohne GitHub Actions (mit `.env`, siehe [`.env.example`](.env.example)):
```bash
npm run monitor
```

## Schnellstart (lokal)

Voraussetzung: Node.js ≥ 20 (getestet mit 24).

```bash
npm install
npm run dev          # http://localhost:5173 (App + API in einem Server)
npm test             # 472 Tests
npm run typecheck
npm run smoke        # Live-Abruf der Datenquellen für ein paar Ticker
npm run spike        # prüft, ob alle Datenquellen aus der aktuellen Umgebung erreichbar sind
```

Produktionsnahe Probe (Service Worker, Manifest, API-Funktionen genau wie später auf Vercel):

```bash
npm run build && npm start     # http://localhost:4173
```

Alle Umgebungsvariablen sind in [`.env.example`](.env.example) erklärt. Mit `APP_TOKEN` in der `.env` verlangt die API ein Zugriffstoken.

## Deployment auf Vercel (kostenlos) und Installation auf dem iPhone

Die Schritte kannst nur du selbst ausführen (Konten anlegen). Es ist keine Kreditkarte nötig.

1. **Repo auf GitHub:** neues **öffentliches** Repository anlegen und diesen Ordner hochladen.
2. **Vercel-Konto:** auf vercel.com mit **"Continue with GitHub"** anmelden, Tarif **Hobby** (gratis, nur private Nutzung, passt hier).
3. **Zugriffstoken erzeugen** (schützt deine Daten-API vor Fremden) und aufschreiben:
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
4. **Projekt importieren:** Vercel → *Add New… → Project* → dein Repo wählen. **Framework Preset: "Other"**, Root Directory `./`,
   Build-Einstellungen unverändert lassen (kommen aus `vercel.json`). Unter **Environment Variables** eintragen:
   - `APP_TOKEN` = das Token aus Schritt 3
   - `GEMINI_API_KEY` = Key aus AI Studio (siehe oben; kann auch später nachgetragen werden)
   - optional `GROQ_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `FINNHUB_API_KEY`
5. **Deploy** klicken. Danach `https://<dein-projekt>.vercel.app/api/health` im Browser öffnen: es muss
   `{"ok":true,"authRequired":true,"ai":{…},…}` erscheinen.
6. **iPhone:** `https://<dein-projekt>.vercel.app` in **Safari** öffnen → Teilen-Symbol → **"Zum Home-Bildschirm"** → Hinzufügen.
7. Die App **vom Home-Bildschirm** öffnen → *Einstellungen* → Zugriffstoken einfügen → **"Speichern und Verbindung testen"**.
8. Watchlist füllen (Suche oder Beispielliste).

**Wichtig zu iOS:** Die installierte App hat einen **eigenen Speicher**, getrennt von Safari. Lege die Watchlist deshalb in der
installierten App an oder nutze in den Einstellungen *Exportieren* (in Safari) und *Importieren* (in der App).
Die Watchlist, Fonds-Merkliste und das Depot liegen nur auf dem Gerät; Alarmregeln dagegen in Supabase (damit der Hintergrund-Check sie lesen kann).

Falls beim ersten Deployment etwas hakt (z. B. `/api/health` liefert 404), schick mir die Fehlermeldung aus dem Vercel-Build-Log.

## Aufbau

```
apps/web/            Vite + React + TypeScript, PWA (Service Worker, Manifest), Lightweight Charts
apps/api/functions/  Einstiegspunkte der API-Funktionen (je Route eine Datei)
packages/core/       Indikatoren, Datenquellen-Adapter, KI-Auswertung, Alarm-Regel-Engine, ntfy-Notifier, Speicher
packages/server/     API-Handler (Web-Standard Request/Response), Zugriffsschutz, Cache
supabase/            schema.sql für den dauerhaften Zwischenspeicher (KI-Cache und Alarme, dieselbe Tabelle)
scripts/             smoke, spike-reach, analyze, check-ai-endpoints, monitor (Alarm-Check für GitHub Actions)
tools/               Build-Skripte, Icons, lokaler Produktionsserver, pandas-Referenz für Tests
.github/workflows/   ci.yml (Typecheck, Tests, Build), spike.yml (Erreichbarkeit aus GitHub Actions), monitor.yml (Alarm-Check alle 5 Min.)
```

`npm run build` erzeugt die Vercel-Ausgabe (Build Output API v3) unter `.vercel/output`: die Web-App als statische Dateien und
eine einzige gebündelte Funktion für alle `/api/*`-Routen (der Hobby-Plan erlaubt höchstens 12 Functions je Deployment,
`createApi()` dispatcht ohnehin selbst anhand des Pfads). Derselbe Handler läuft im Dev-Server.

**API** (alle außer `health` mit `Authorization: Bearer <APP_TOKEN>`, sofern gesetzt): `/api/health`, `/api/quote?s=THYAO.IS,AAPL`,
`/api/candles?s=…&tf=1T|1W|1M|6M|1J|5J`, `/api/history?s=…`, `/api/news?s=…&name=…`, `/api/search?q=…`,
`/api/analysis?s=…&name=…[&lang=de|tr][&refresh=1]`, `/api/news-item?s=…&id=<Meldungs-ID>[&name=…][&lang=de|tr][&refresh=1]` (Erklärung einer einzelnen Meldung), `/api/news-analysis?s=…&name=…[&lang=de|tr][&refresh=1]` (503, solange kein KI-Key gesetzt ist),
`/api/fund-search?q=…`, `/api/fund?code=AFT`, `/api/fund-history?code=…&period=week|month|3month|6month|ytd|year|3year|5year`, `/api/fund-benchmark?code=…&period=…` (Fonds, TEFAS, keine KI beteiligt),
`GET/PUT /api/alerts?s=…` (Alarmregeln je Aktie lesen bzw. speichern; einzige Route mit `PUT`, sonst ist alles GET-only; 503, solange kein Supabase eingerichtet ist).

**KI-Anbieter** sind austauschbar (`LLMProvider`): Gemini → Groq → Ollama (nur lokal), nur konfigurierte werden genutzt, bei Ausfall springt die Kette weiter.
Ein Claude-Anbieter lässt sich später als weitere Klasse ergänzen, ohne dass sich Auswertung oder Oberfläche ändern.

## Datenquellen (nur gratis) und ihre Grenzen

| Quelle | Zweck | Grenzen |
|---|---|---|
| Yahoo Finance | Kurse, Kerzen, Suche, Wechselkurse | **Inoffiziell.** BIST/XETRA ca. 15 Min. verzögert (gemessen 15,3 bzw. 16,0 Min.). Kann Rate-Limits setzen, Cloud-IPs sperren oder das Format ändern. Enthält Datenlücken. |
| Finnhub Free | US-Live-Kurs, US-News | Nur US. Keine Kerzen. Key nötig. Nicht mit echtem Key getestet. |
| İş Yatırım | BIST-Tagesdaten (Fallback) | Inoffiziell. Nur Tagesschluss, kein Eröffnungskurs, Volumen geschätzt. Langsam. |
| KAP (`kap.org.tr`) | Offizielle BIST-Meldungen | Inoffiziell (JSON der Webseite), max. 2000 Einträge je Abruf. Zugriff aus Rechenzentren unbestätigt. |
| Google News RSS | Nachrichten (tr/de/en) | Nur Titel, Link, Quelle, Datum. Die KI ordnet also nur nach Titel ein, nicht nach Volltext. Laut Google nur für persönlichen Gebrauch. |
| Gemini / Groq | KI-Text | Gratis-Kontingente schwanken und sind teils nur über Drittquellen belegt. |
| Twelve Data Free | – | **Kein BIST im Gratis-Plan**, daher nicht eingebunden. |
| TEFAS (`tefas.gov.tr`) | Fondskurse, -kennzahlen, Vergleichswerte | Inoffizielle JSON-API der offiziellen Handelsplattform. Preis nur einmal täglich (nach Börsenschluss), kein Live-Kurs. Das Fondsverzeichnis (ca. 2.600 Fonds) wird serverseitig bis zu 6 Std. zwischengespeichert. |

Für BIST gibt es gratis **keine offizielle Echtzeitquelle**. Die App ist ausschließlich für den privaten Gebrauch gedacht.

## Datenqualität: worauf man achten muss

- **Lücken bei Yahoo:** Die Tagesdaten enthalten gelegentlich Kerzen ohne Kurswerte (bei BIST 4–6 von 500, auch bei den letzten Handelstagen). Der Adapter
  verwirft sie, die App und die KI bekommen einen Datenhinweis.
- **Laufende Tageskerze:** Während der Börsenzeit ist die letzte Tageskerze unvollständig, die Kennzahlen nutzen dann den aktuellen Kurs.
- **Kein Widerstand bei Allzeithochs** (z. B. AAPL): Die Kursziele sind dann ATR-Projektionen und als solche gekennzeichnet.
- **Chance-Risiko-Verhältnis** ist rein rechnerisch aus Einstieg, Stop und erstem Ziel, keine Prognose.
- **Währungsumrechnung** nutzt den Tageskurs. Bei Intraday-Kerzen ist das eine Näherung.
- **US-Aktualität:** Yahoo-US-Kurse sind als "Echtzeit" gekennzeichnet. Das ist eine Annahme und noch nicht gemessen.

## Tests

`npm test` (472 Tests) prüft unter anderem:

- **Indikatoren gegen unabhängige pandas-Referenzwerte** (Toleranz 1e-7), plus von Hand nachgerechnete Fälle.
- **Adapter** gegen aufgezeichnete Live-Antworten inklusive Fehlerfälle. **KI-Anbieter** (Gemini, Groq, Ollama) gegen nachgebildete Antworten inklusive Kontingent-, Schema- und Key-Fehlern.
- **Fonds (TEFAS):** Suche (Kürzel exakt vor Präfix vor Namenstreffer, Zwischenspeicher), Fondsinfo, Zeitraum-Zuordnung (inkl. "Woche" als zugeschnittener Monat), Vergleichswerte mit erzwungener Reihenfolge (Fonds selbst zuerst), Fehlerfälle, gegen echte aufgezeichnete TEFAS-Antworten.
- **Depot:** Speicher für Käufe und Bargeld (hinzufügen/entfernen, kaputte Speicherinhalte, Export/Import), Berechnungen (Ø-Kaufpreis, Gewinn/Verlust, Umrechnung zwischen Lira/Dollar/Euro über den Wechselkurs, unvollständige Summen bei fehlendem Kurs), Wert-im-Zeitverlauf (wachsende Stückzahl bei mehreren Käufen, fehlender Kursverlauf oder Wechselkurs an einem Tag, Punktbegrenzung bei langen Zeiträumen).
- **Sprachen:** deutsches und türkisches Wörterbuch haben dieselben Schlüssel und Platzhalter, Systemmeldungen gibt es in beiden Sprachen, Formate ("1,50 %" bzw. "%1,50"), Spracherkennung, KI-Sprache in Prompt und Zwischenspeicher, Fachbegriffe tauchen in der Einfach-Ansicht nicht auf.
- **Zahlen-Wächter:** deutsche, türkische und englische Zahlenformate, Rundung, Datum/Uhrzeit, erfundene Kurse, eingeschleuste Anweisungen.
- **Auswertungen:** Kandidaten und Handelsplan mit echten THYAO-Daten, Währungsumrechnung, Prüfablauf mit Wiederholung, Zwischenspeicher, Mindestabstand, Tageslimit, Ausfälle.
- **API und Deployment-Artefakt:** Zugriffsschutz, Fehlerabbildung, Supabase-Anbindung, jede Funktion startet in einem frischen Node-Prozess, `toNodeHandler` reicht Methode/Header/**Body** korrekt an einen echten HTTP-Server durch (nicht nur an den In-Prozess-Handler — ein Body-Weiterleitungs-Fehler wäre bei reinen In-Prozess-Tests unbemerkt geblieben, siehe Alarme unten).
- **Alarme:** alle 5 Regeltypen (Feuern und Hysterese-Rückstellung), Tageszähler-Grenze und -Reset an einem neuen Börsentag, "Börse geschlossen" sperrt jede Regel, News-Dedup über gesehene IDs, `/api/alerts` (GET/PUT, Validierung, Ticker-Trennung, 503 ohne Supabase, weiterhin 405 für andere Methoden), `NtfyNotifier` gegen einen Fake-`fetch`.

Mutationstests bestätigen, dass die Tests echte Fehler finden (z. B. Wächter ohne Satzentfernung, ignoriertes Tageslimit, Stop über Einstieg).
Manuell geprüft: iPhone-Viewport (hell/dunkel) mit Demo-KI und echten Kursdaten, Fall ohne KI-Key, Service Worker mit Offline-Start, Token-Ablauf, Alarmregeln speichern/laden im Browser (mit Validierung leerer Schwellenwerte).

**Nicht getestet:** die **türkischen KI-Texte mit echtem Gemini** (Qualität und ob der Zahlen-Wächter bei türkischen Sätzen zu streng oder zu locker ist, bisher nur mit dem Demo-Anbieter und Tests), die neue Ansicht auf einem echten iPhone, die türkischen Oberflächentexte durch eine Person, die Türkisch als Muttersprache spricht, ein echter Alarm über ntfy bis aufs Handy (das kannst nur du mit deinem eigenen Topic testen, siehe "Alarme einrichten").

## Sicherheit

- API-Keys nur als Umgebungsvariablen bzw. Secrets, nie im Frontend oder Repo (im Browser-Bundle geprüft).
- Die Daten-API verlangt ein Zugriffstoken (`APP_TOKEN`), verglichen ohne Zeitunterschiede. Das Token liegt nur im Speicher deines Geräts.
- Der Supabase-Service-Key bleibt serverseitig, die Tabelle ist per Row Level Security gesperrt.
- Ticker-Eingaben werden validiert, Links aus Nachrichtenquellen nur mit `http(s)` geöffnet, Fehlermeldungen geben keine internen Details preis.
- Der Zugriffsschutz ist für **eine Person** gedacht (ein gemeinsames Token, keine Konten).
