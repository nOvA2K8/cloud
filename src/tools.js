// Werkzeuge, die Claude auf dem Rechner des Nutzers ausführen darf.
// Alle Dateipfade sind auf den Projektordner beschränkt.
const fs = require('fs');
const path = require('path');
const os = require('os');
const unreal = require('./unreal');

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
];

// Client-Tools streamen ihre Eingaben sofort (große Dateien), dazu Web-Suche für aktuelle UE-Doku.
const TOOLS = [
  ...TOOL_DEFS.map((t) => ({ ...t, eager_input_streaming: true })),
  { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
];

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
  constructor({ getSettings, getProjectRoot, setProjectRoot, onLog, askApproval }) {
    Object.assign(this, { getSettings, getProjectRoot, setProjectRoot, onLog, askApproval });
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
    if (!engines.length) throw new Error('Keine Unreal Engine 5 gefunden. Engine-Pfad in den Einstellungen der App angeben.');
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
        return `Geschrieben: ${input.path} (${input.content.length} Zeichen)`;
      }
      case 'edit_file': {
        const p = this.resolve(input.path);
        const txt = fs.readFileSync(p, 'utf8');
        const count = txt.split(input.old_text).length - 1;
        if (count !== 1) throw new Error(`old_text kommt ${count}-mal vor (muss genau 1 sein)`);
        fs.writeFileSync(p, txt.replace(input.old_text, () => input.new_text));
        return `Geändert: ${input.path}`;
      }
      case 'build_project': {
        const eng = this.engine();
        const up = unreal.findUproject(this.resolve('.'));
        if (!up) throw new Error('Keine .uproject-Datei im Projekt');
        const proj = path.basename(up, '.uproject');
        const r = await unreal.runProcess(eng.build,
          [`${proj}Editor`, eng.platform, 'Development', `-Project=${up}`, '-WaitMutex', '-NoHotReloadFromIDE'],
          { cwd: eng.dir, onOutput: this.onLog, shell: unreal.isWin });
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
        require('child_process').spawn(eng.editor, [up], { detached: true, stdio: 'ignore' }).unref();
        return 'Unreal Editor wird gestartet.';
      }
      default:
        throw new Error(`Unbekanntes Werkzeug: ${name}`);
    }
  }
}

module.exports = { TOOLS, ToolContext, validateInput };
