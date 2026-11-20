# Unreal Forge 🎮

Eine Desktop-App, in der du einfach beschreibst, welches Spiel du willst. Die KI legt dafür das **Unreal-Engine-5-Projekt** an, schreibt den C++-Code, kompiliert ihn und baut die Welt per Editor-Skript.

Das Gehirn ist **Claude Fable 5.2**, das stärkste Modell von Anthropic. Es ist auf Unreal-Entwicklung eingestellt: große Open Worlds (World Partition, PCG), realistische Grafik (Lumen, Nanite), Fahrzeuge (Chaos Vehicles), Verkehr und Fußgänger (Mass AI), Kampf (Gameplay Ability System) und mehr.

## Herunterladen

1. Auf GitHub zu **Releases** (rechts) gehen. Alternativ unter **Actions** den letzten erfolgreichen Lauf öffnen und dort unten bei *Artifacts* herunterladen.
2. Windows: `UnrealForge-Setup-….exe` (Installer) oder `UnrealForge-Portable-….exe` (ohne Installation).
   Mac: `.dmg`. Linux: `.AppImage`.
3. Windows zeigt eventuell „Der Computer wurde durch Windows geschützt“, weil die App nicht signiert ist. Dann auf **Weitere Informationen → Trotzdem ausführen** klicken.

## Was du brauchst

- **Anthropic-API-Schlüssel**: unter <https://console.anthropic.com> → *API Keys*. Die Nutzung wird pro Token abgerechnet. Fable 5.2 kostet $8 pro Million Eingabe-Tokens und $40 pro Million Ausgabe-Tokens. Ein großer Bau-Auftrag kann einige Dollar kosten. Die App zeigt den Verbrauch unten links an.
- **Unreal Engine 5** (kostenlos im Epic Games Launcher), plus **Visual Studio 2022** mit „Spieleentwicklung mit C++“, damit C++ kompiliert werden kann.
  Ohne Engine legt die App die Projekte trotzdem an. Sie kann sie dann aber weder kompilieren noch per Skript befüllen.

## So benutzt du es

1. App starten und den API-Schlüssel in den Einstellungen eintragen. Der Unreal-Pfad wird automatisch gesucht.
2. Dein Spiel beschreiben, z. B. *„Open-World-Stadt im Stil von Miami mit Autos, Fußgängern, Tag-Nacht-Zyklus und Polizei-System“*.
3. Unreal Forge legt das Projekt an und schreibt `GAME_PLAN.md`. Danach baut es System für System, kompiliert dabei und behebt Fehler.
4. Weitere Aufträge geben: „Füg ein Waffensystem hinzu“, „Mach die Stadt doppelt so groß“ … Der Verlauf wird pro Projekt gespeichert.
5. Mit „öffne das Projekt in Unreal“ startet der Editor, und du kannst spielen.

## Ehrlich zum Umfang

Ein Spiel wie GTA VI haben über tausend Leute fast zehn Jahre lang gebaut, mit Millionen von handgemachten Modellen, Animationen und Sprachaufnahmen. Diese **Inhalte** kann keine KI heute auf Knopfdruck erzeugen.

Was Unreal Forge kann:
- die komplette **Technik und Spiellogik** bauen,
- die Welt **prozedural generieren**,
- Platzhalter-Inhalte setzen,
- das Spiel über viele Sitzungen hinweg Stück für Stück erweitern.

Für realistische Optik empfiehlt die KI echte Assets: Quixel Megascans, MetaHuman und Fab. Sie zeigt dir auch, wie du sie einbindest.

## Entwickeln

```bash
npm install
npm start          # App starten
npm test           # Selbsttest
npm run dist       # Installer für das aktuelle Betriebssystem bauen
```

Bei jedem Push baut GitHub Actions automatisch die Versionen für Windows, Mac und Linux und veröffentlicht sie als Release (`.github/workflows/build.yml`).

### Aufbau
- `src/main.js`: Electron-Hauptprozess, Einstellungen (API-Schlüssel verschlüsselt per `safeStorage`)
- `src/agent.js`: Agent-Schleife mit Claude Fable 5.2: Streaming, adaptives Denken, automatischer Modell-Fallback bei Ablehnung, Prompt-Caching
- `src/tools.js`: Werkzeuge: Dateien lesen und schreiben, Projekt anlegen, kompilieren, Python im Unreal Editor ausführen, Befehle ausführen (nur nach Bestätigung), Web-Suche
- `src/unreal.js`: Engine-Erkennung, Projektvorlage, Build-Aufrufe
- `src/prompt.js`: Fachwissen und Arbeitsweise der KI
- `src/renderer/`: Oberfläche
