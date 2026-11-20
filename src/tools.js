// Werkzeuge, die Claude auf dem Rechner des Nutzers ausführen darf.
// Alle Dateipfade sind auf den Projektordner beschränkt.
const fs = require('fs');
const path = require('path');
const os = require('os');
const unreal = require('./unreal');
const web = require('./web');

const TOOL_DEFS = [
  {
    name: 'create_unreal_project',
    description: 'Legt ein neues Unreal-Engine-5-C++-Projekt an (World Partition, Lumen, Nanite, PCG, Chaos Vehicles, Mass AI, GAS, Enhanced Input aktiviert) und macht es zum aktiven Projekt. Gibt den Projektordner zurück.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Projektname, nur Buchstaben/Ziffern, z.B. "NeonCity"' },
        description: { type: 'string', description: 'Ein-Satz-Beschreibung des Spiels' },
      },
      required: ['name', 'description'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_files',
    description: 'Listet Dateien und Ordner im aktiven Projekt (rekursiv bis zur angegebenen Tiefe). Binaries/Intermediate/Saved/DerivedDataCache werden übersprungen.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relativer Pfad im Projekt, "." für Wurzel' },
        depth: { type: 'integer', description: 'Rekursionstiefe, Standard 3' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_file',
    description: 'Liest eine Textdatei aus dem aktiven Projekt.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relativer Pfad im Projekt' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_file',
    description: 'Schreibt (oder überschreibt) eine Textdatei im aktiven Projekt. Ordner werden automatisch angelegt. Immer den vollständigen Dateiinhalt übergeben.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relativer Pfad im Projekt' },
        content: { type: 'string', description: 'Vollständiger Dateiinhalt' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'edit_file',
    description: 'Ersetzt einen exakt vorkommenden Textabschnitt in einer Datei. old_text muss genau einmal vorkommen.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_text: { type: 'string' },
        new_text: { type: 'string' },
      },
      required: ['path', 'old_text', 'new_text'],
      additionalProperties: false,
    },
  },
  {
    name: 'build_project',
    description: 'Kompiliert das C++-Editor-Target des aktiven Projekts mit UnrealBuildTool und gibt die Build-Ausgabe zurück (Fehler am Ende). Benötigt eine installierte Unreal Engine.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'run_editor_python',
    description: 'Führt ein Python-Skript headless im Unreal Editor des aktiven Projekts aus (Modul "unreal"). Ideal, um Level, Landschaften, PCG-Graphen, Actors und Assets per Skript zu erzeugen. Das Skript wird unter Content/Python/ gespeichert. Ausgaben mit unreal.log() bzw. print().',
    input_schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Dateiname, z.B. "build_city.py"' },
        script: { type: 'string', description: 'Python-Quelltext' },
      },
      required: ['filename', 'script'],
      additionalProperties: false,
    },
  },
  {
    name: 'run_command',
    description: 'Führt einen Shell-Befehl im Projektordner aus (z.B. git, Hilfsskripte). Der Nutzer muss ggf. zustimmen.',
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
      additionalProperties: false,
    },
  },
  {
    name: 'open_in_unreal',
    description: 'Öffnet das aktive Projekt im Unreal Editor (mit Fenster), damit der Nutzer es sehen und spielen kann.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'web_search',
    description: 'Kostenlose Internetsuche (DuckDuckGo). Nutze sie für aktuelle Unreal-Doku, Tutorials, Forenlösungen zu Build-Fehlern und um zu recherchieren, wie andere Spiele etwas umsetzen.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Suchbegriffe, am besten auf Englisch' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'fetch_url',
    description: 'Lädt eine Webseite und gibt ihren Text zurück (z.B. eine Doku-Seite aus web_search).',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'remember',
    description: 'Speichert eine Erkenntnis dauerhaft im Gedächtnis (über alle Projekte hinweg): z.B. Build-Fehler + Lösung, funktionierende Code-Muster, Vorlieben des Nutzers. Kurz und konkret formulieren.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Die Erkenntnis, z.B. "Fehler C2065 bei UChaosVehicleMovementComponent: Modul ChaosVehicles in Build.cs eintragen."' },
        tags: { type: 'string', description: 'Stichworte, z.B. "build, chaos, vehicles"' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'recall',
    description: 'Durchsucht das Gedächtnis nach früheren Erkenntnissen zu einem Thema. Vor schwierigen Aufgaben und bei Build-Fehlern zuerst hier nachsehen.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

// Client-Tools streamen ihre Eingaben sofort (große Dateien).
const TOOLS = TOOL_DEFS.map((t) => ({ ...t, eager_input_streaming: true }));

// Gleiche Werkzeuge im Format für lokale Modelle (Ollama / OpenAI-Funktionsformat).
const LOCAL_TOOLS = TOOL_DEFS.map((t) => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}));

/** Prüft Pflichtfelder und Typen (Eingaben werden ungepuffert gestreamt und deshalb nicht serverseitig validiert). */
function validateInput(name, input) {
  const def = TOOL_DEFS.find((t) => t.name === name);
  if (!def) return `Unbekanntes Werkzeug: ${name}`;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Eingabe ist kein Objekt';
  const props = def.input_schema.properties;
  for (const key of def.input_schema.required || []) {
    if (!(key in input)) return `Pflichtfeld fehlt: ${key}`;
  }
  for (const [key, val] of Object.entries(input)) {
    const spec = props[key];
    if (!spec) return `Unbekanntes Feld: ${key}`;
    if (spec.type === 'string' && typeof val !== 'string') return `${key} muss Text sein`;
    if (spec.type === 'integer' && !Number.isInteger(val)) return `${key} muss eine ganze Zahl sein`;
  }
  return null;
}

class ToolContext {
  constructor({ getSettings, getProjectRoot, setProjectRoot, onLog, askApproval, memory }) {
    Object.assign(this, { getSettings, getProjectRoot, setProjectRoot, onLog, askApproval, memory });
    this.touched = new Set();
    this.lastBuildErrors = null;
  }

  /** Automatisches Lernen: Wird ein fehlgeschlagener Build repariert, landet Fehler + betroffene Dateien im Gedächtnis. */
  learnFromBuild(r) {
    if (r.code !== 0) {
      const errs = r.output.split('\n').filter((l) => /error [A-Z]*\d+|: error|fatal error/i.test(l)).map((l) => l.trim().slice(0, 300));
      this.lastBuildErrors = errs.slice(0, 3);
      this.touched = new Set();
      return;
    }
    if (this.lastBuildErrors && this.lastBuildErrors.length && this.memory) {
      const files = [...this.touched].slice(0, 6).join(', ') || 'unbekannt';
      this.memory.remember(`Build-Fehler: ${this.lastBuildErrors.join(' | ')} -> behoben durch Änderungen an: ${files}`, 'build, auto');
    }
    this.lastBuildErrors = null;
    this.touched = new Set();
  }

  resolve(rel) {
    const root = this.getProjectRoot();
    if (!root) throw new Error('Kein aktives Projekt. Erst create_unreal_project aufrufen oder Projekt in der App öffnen.');
    const p = path.resolve(root, rel || '.');
    if (p !== root && !p.startsWith(root + path.sep)) throw new Error('Pfad liegt außerhalb des Projekts');
    return p;
  }

  engine() {
    const engines = unreal.findEngines(this.getSettings().enginePath);
    if (!engines.length) throw new Error(unreal.engineHelp() + ' Sag dem Nutzer genau das – behaupte NICHT, dass er Unreal erst installieren muss.');
    return engines[0];
  }

  async run(name, input) {
    switch (name) {
      case 'create_unreal_project': {
        const s = this.getSettings();
        const parent = s.projectsDir || path.join(os.homedir(), 'UnrealForge Projects');
        let ver = '5.5';
        try { ver = this.engine().version; } catch { /* keine Engine – Standard */ }
        const r = unreal.scaffoldProject(parent, input.name, ver, input.description);
        this.setProjectRoot(r.root);
        try { const e = this.engine(); unreal.fixProjectPlugins(unreal.findUproject(r.root), e.dir); } catch { /* keine Engine */ }
        return `${r.created ? 'Projekt angelegt' : 'Projekt existiert bereits, ist jetzt aktiv'}: ${r.root} (Engine ${ver})`;
      }
      case 'list_files': {
        const base = this.resolve(input.path);
        const skip = new Set(['Binaries', 'Intermediate', 'Saved', 'DerivedDataCache', '.git', '.vs', '.forge']);
        const lines = [];
        const walk = (dir, d, prefix) => {
          if (lines.length > 2000) return;
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (skip.has(e.name)) continue;
            lines.push(prefix + e.name + (e.isDirectory() ? '/' : ''));
            if (e.isDirectory() && d > 1) walk(path.join(dir, e.name), d - 1, prefix + '  ');
          }
        };
        walk(base, input.depth || 3, '');
        return lines.join('\n') || '(leer)';
      }
      case 'read_file': {
        const txt = fs.readFileSync(this.resolve(input.path), 'utf8');
        return txt.length > 200000 ? txt.slice(0, 200000) + '\n[... gekürzt]' : txt;
      }
      case 'write_file': {
        const p = this.resolve(input.path);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, input.content);
        this.touched.add(input.path);
        return `Geschrieben: ${input.path} (${input.content.length} Zeichen)`;
      }
      case 'edit_file': {
        const p = this.resolve(input.path);
        const txt = fs.readFileSync(p, 'utf8');
        const count = txt.split(input.old_text).length - 1;
        if (count !== 1) throw new Error(`old_text kommt ${count}-mal vor (muss genau 1 sein)`);
        fs.writeFileSync(p, txt.replace(input.old_text, () => input.new_text));
        this.touched.add(input.path);
        return `Geändert: ${input.path}`;
      }
      case 'build_project': {
        const eng = this.engine();
        const up = unreal.findUproject(this.resolve('.'));
        if (!up) throw new Error('Keine .uproject-Datei im Projekt');
        const proj = path.basename(up, '.uproject');
        const removed = unreal.fixProjectPlugins(up, eng.dir);
        if (removed.length) this.onLog && this.onLog(`[Unreal Forge] In UE ${eng.version} nicht vorhandene Plugins aus dem Projekt entfernt: ${removed.join(', ')}\n`);
        const r = await unreal.runScript(eng.build,
          [`${proj}Editor`, eng.platform, 'Development', `-Project=${up}`, '-WaitMutex', '-NoHotReloadFromIDE'],
          { cwd: eng.dir, onOutput: this.onLog });
        if (r.code !== 0 && /SDK validation failed|Sdk: not found|not a valid platform to build|Visual Studio.*not (found|installed)|No (valid )?(compiler|toolchain)|MSVC.*not found|NetFxSDK|\.NET Framework SDK/i.test(r.output)) {
          r.output += '\n\nLÖSUNG (an den Nutzer weitergeben): Auf dem PC fehlen Visual Studio bzw. das Windows SDK. ' +
            'Visual Studio Installer öffnen → Workloads "Spieleentwicklung mit C++" und "Desktopentwicklung mit C++" anhaken → ' +
            'unter Installationsdetails ein Windows 11 SDK (10.0.22621 oder neuer), die MSVC-C++-Buildtools und das ".NET Framework 4.8.1 SDK" anhaken → installieren → PC neu starten → erneut kompilieren. ' +
            'Das ist KEIN Code-Fehler im Projekt und Unreal ist korrekt installiert.';
        }
        if (r.code !== 0 && /is not recognized|wird nicht als|No such file|Startfehler/i.test(r.output)) {
          r.output += '\n\nHINWEIS FÜR DIE KI: Das ist ein Startproblem des Build-Werkzeugs, KEIN fehlendes Unreal. ' +
            'Die Engine ist installiert. Sag dem Nutzer, er soll diese Fehlermeldung an den Entwickler von Unreal Forge schicken.';
        }
        this.learnFromBuild(r);
        return `Exit-Code ${r.code} (${r.code === 0 ? 'BUILD ERFOLGREICH' : 'BUILD FEHLGESCHLAGEN'})\n${r.output}`;
      }
      case 'run_editor_python': {
        const eng = this.engine();
        const up = unreal.findUproject(this.resolve('.'));
        if (!up) throw new Error('Keine .uproject-Datei im Projekt');
        const fname = path.basename(input.filename).replace(/[^A-Za-z0-9_.-]/g, '_');
        const scriptPath = this.resolve(path.join('Content', 'Python', fname.endsWith('.py') ? fname : fname + '.py'));
        fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
        fs.writeFileSync(scriptPath, input.script);
        const r = await unreal.runProcess(eng.editorCmd,
          [up, '-run=pythonscript', `-script=${scriptPath}`, '-unattended', '-nopause', '-nosplash', '-stdout', '-FullStdOutLogOutput'],
          { cwd: path.dirname(up), onOutput: this.onLog });
        const relevant = r.output.split('\n').filter((l) => /LogPython|Error|error|Warning|Traceback/.test(l)).join('\n');
        return `Exit-Code ${r.code}\n${relevant.slice(-20000) || r.output.slice(-8000)}`;
      }
      case 'run_command': {
        const ok = await this.askApproval(`Claude möchte diesen Befehl ausführen:\n\n${input.command}`);
        if (!ok) return 'Der Nutzer hat den Befehl abgelehnt.';
        const r = await unreal.runProcess(input.command, [], { cwd: this.resolve('.'), onOutput: this.onLog, shell: true, timeoutMs: 15 * 60 * 1000 });
        return `Exit-Code ${r.code}\n${r.output}`;
      }
      case 'open_in_unreal': {
        const eng = this.engine();
        const up = unreal.findUproject(this.resolve('.'));
        if (!up) throw new Error('Keine .uproject-Datei im Projekt');
        const child = require('child_process').spawn(eng.editor, [up], { detached: true, stdio: 'ignore' });
        child.on('error', (e) => this.onLog && this.onLog(`Unreal-Start fehlgeschlagen: ${e.message}\n`));
        child.unref();
        return 'Unreal Editor wird gestartet.';
      }
      case 'web_search':
        return await web.webSearch(input.query);
      case 'fetch_url':
        return await web.fetchUrl(input.url);
      case 'remember':
        if (!this.memory) throw new Error('Kein Gedächtnis verfügbar');
        return this.memory.remember(input.text, input.tags || '');
      case 'recall': {
        if (!this.memory) throw new Error('Kein Gedächtnis verfügbar');
        const hits = this.memory.recall(input.query, 8);
        return hits.length ? this.memory.format(hits) : 'Nichts dazu im Gedächtnis.';
      }
      default:
        throw new Error(`Unbekanntes Werkzeug: ${name}`);
    }
  }
}

module.exports = { TOOLS, LOCAL_TOOLS, TOOL_DEFS, ToolContext, validateInput };
