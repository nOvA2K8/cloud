# Unreal Forge 🎮

Eine Desktop-App, in der du einfach beschreibst, welches Spiel du willst. Die KI legt dafür das **Unreal-Engine-5-Projekt** an, schreibt den C++-Code, kompiliert ihn, recherchiert im Internet und **lernt aus jedem Fehler dazu**.

- **Kostenlos:** Standardmäßig läuft eine KI direkt auf deiner Grafikkarte (über Ollama, Modell Qwen3 8B). Es gibt keine Kosten, kein Konto und keine Daten nach außen.
- **Optional stärker:** Für schwierige Aufgaben kannst du auf Claude umschalten (Fable, Opus, Sonnet oder Haiku). Das kostet Geld und braucht einen API-Schlüssel.

## Herunterladen

1. Auf GitHub zu **Releases** gehen und die neueste Version nehmen.
2. Windows: `UnrealForge-Setup-….exe` (Installer) oder `UnrealForge-Portable-….exe` (ohne Installation).
   Mac: `.dmg`. Linux: `.AppImage`.
3. Windows zeigt eventuell „Der Computer wurde durch Windows geschützt“, weil die App nicht signiert ist. Dann auf **Weitere Informationen → Trotzdem ausführen** klicken.

## Einrichten (kostenlose Variante)

1. **Ollama** installieren: <https://ollama.com/download> (gratis). Danach läuft es im Hintergrund.
2. Unreal Forge starten. Links unter **„KI“** auf **„Modell herunterladen“** klicken. Das passiert einmalig und lädt etwa 5 GB.
3. **Unreal Engine 5** über den Epic Games Launcher installieren, außerdem **Visual Studio 2022** mit „Spieleentwicklung mit C++“. Beides ist kostenlos.
4. Dein Spiel beschreiben und auf **„Bauen ▶“** klicken.

**Welches Modell für welche Grafikkarte?**
| Grafikspeicher | Modell | Kontextgröße |
|---|---|---|
| 8 GB (z. B. RTX 5060) | Qwen3 8B (Standard) | 12k |
| 12–16 GB | Qwen3 14B | 16k |
| 24 GB+ | Qwen3 14B | 32k |

Läuft es zu langsam, stell die Kontextgröße in den Einstellungen auf 8k. Unreal und die KI teilen sich die Grafikkarte, deshalb schließt du den Unreal Editor am besten, während die KI baut.

## Wie die App „lernt“

Die App trainiert das Modell nicht neu, das wäre auf einem PC unmöglich. Sie nutzt stattdessen ein **Langzeitgedächtnis** (`memory.json` im App-Ordner):
- Repariert die KI einen Build-Fehler, speichert die App automatisch den Fehler zusammen mit den geänderten Dateien.
- Die KI kann sich selbst Erkenntnisse merken (`remember`), zum Beispiel funktionierende Lösungen oder deine Vorlieben.
- Vor jedem Auftrag werden passende Erinnerungen automatisch mitgegeben.

So wird sie mit jedem Projekt besser. Unter **„Gedächtnis → anzeigen“** siehst du, was sie gelernt hat.

## Internet-Recherche

Die KI kann kostenlos im Web suchen (DuckDuckGo) und Seiten lesen, zum Beispiel die Unreal-Doku, Foren oder Tutorials, wenn sie bei einem Fehler nicht weiterkommt.

## Ehrlich zum Umfang

- **Lokales 8B-Modell:** Es ist gratis, aber viel schwächer als Claude Fable. Kleine, klar beschriebene Schritte funktionieren gut, zum Beispiel „Füg ein Auto hinzu, in das der Spieler einsteigen kann“. Bei großen, komplexen Systemen macht es mehr Fehler. Dann hilft es, für diesen Schritt auf Claude umzuschalten.
- **Ein Spiel wie GTA VI:** Daran haben über tausend Leute fast zehn Jahre gearbeitet, mit Millionen handgemachter Modelle, Animationen und Sprachaufnahmen. Diese **Inhalte** kann keine KI heute auf Knopfdruck erzeugen. Unreal Forge baut die Technik und die Spiellogik, generiert die Welt prozedural und erweitert das Spiel Schritt für Schritt. Für realistische Optik empfiehlt es Quixel Megascans, MetaHuman und Fab.

## Entwickeln

```bash
npm install
npm start          # App starten
npm test           # Tests (inkl. simuliertem Ollama-Server)
npm run dist       # Installer für das aktuelle Betriebssystem bauen
```

Bei jedem Push baut GitHub Actions die Versionen für Windows, Mac und Linux und veröffentlicht sie als Release.

### Aufbau
- `src/main.js`: Electron-Hauptprozess, Einstellungen, Wahl der KI
- `src/localAgent.js`: kostenlose lokale KI über Ollama (Werkzeugaufrufe, Kontext-Verwaltung für kleine Modelle)
- `src/agent.js`: optionale Claude-Anbindung (Streaming, adaptives Denken, automatischer Fallback)
- `src/tools.js`: Werkzeuge: Projekt anlegen, Dateien, Kompilieren, Editor-Python, Befehle (nur nach Bestätigung), Web, Gedächtnis
- `src/memory.js`: Langzeitgedächtnis mit Deutsch/Englisch-Synonymen
- `src/web.js`: kostenlose Suche und Seiten-Abruf
- `src/unreal.js`: Engine-Erkennung, Projektvorlage, Build-Aufrufe
- `src/prompt.js`: Fachwissen und Arbeitsweise der KI
- `src/renderer/`: Oberfläche
