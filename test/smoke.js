// Schneller Selbsttest ohne Electron und ohne API-Aufruf.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const unreal = require('../src/unreal');
const { TOOLS, ToolContext, validateInput } = require('../src/tools');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-'));
  let root = null;
  const ctx = new ToolContext({
    getSettings: () => ({ projectsDir: tmp, enginePath: '' }),
    getProjectRoot: () => root,
    setProjectRoot: (r) => { root = r; },
    onLog: () => {},
    askApproval: async () => false,
  });

  console.log(await ctx.run('create_unreal_project', { name: '9 Neon City!', description: 'Test' }));
  assert.ok(fs.existsSync(path.join(root, 'NeonCity.uproject')));
  const up = JSON.parse(fs.readFileSync(path.join(root, 'NeonCity.uproject'), 'utf8'));
  assert.strictEqual(up.Modules[0].Name, 'NeonCity');
  assert.ok(fs.readFileSync(path.join(root, 'Source/NeonCity/NeonCityGameMode.h'), 'utf8').includes('NEONCITY_API'));

  await ctx.run('write_file', { path: 'GAME_PLAN.md', content: '# Plan\nA' });
  await ctx.run('edit_file', { path: 'GAME_PLAN.md', old_text: 'A', new_text: 'B' });
  assert.strictEqual(await ctx.run('read_file', { path: 'GAME_PLAN.md' }), '# Plan\nB');
  assert.ok((await ctx.run('list_files', { path: '.' })).includes('Source/'));
  await assert.rejects(ctx.run('read_file', { path: '../../etc/passwd' }), /außerhalb/);
  assert.match(await ctx.run('run_command', { command: 'echo hi' }), /abgelehnt/);

  assert.strictEqual(validateInput('write_file', { path: 'a' }), 'Pflichtfeld fehlt: content');
  assert.strictEqual(validateInput('write_file', { path: 'a', content: 1 }), 'content muss Text sein');
  assert.strictEqual(validateInput('read_file', { path: 'a' }), null);
  assert.ok(TOOLS.every((t) => t.eager_input_streaming));

  require('../src/agent'); // lädt das SDK
  console.log('Alle Tests bestanden.');
})().catch((e) => { console.error(e); process.exit(1); });

// --- Engine-Erkennung (Linux-Pfade als Stellvertreter für Windows) ---
(() => {
  if (process.platform === 'win32' || process.platform === 'darwin') return;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-eng-'));
  const mk = (dir, ver) => {
    const bin = path.join(dir, 'Engine', 'Binaries', 'Linux');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'UnrealEditor-Cmd'), '');
    fs.mkdirSync(path.join(dir, 'Engine', 'Build'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Engine', 'Build', 'Build.version'), JSON.stringify({ MajorVersion: 5, MinorVersion: ver }));
  };
  // 1) Nutzer wählt nur den Überordner "Epic Games" statt UE_5.8
  mk(path.join(base, 'Spiele', 'Epic Games', 'UE_5.8'), 8);
  let e = unreal.findEngines(path.join(base, 'Spiele'), { roots: [] });
  assert.strictEqual(e[0] && e[0].version, '5.8', 'findet Engine im Unterordner');
  // 2) Engine an ungewöhnlichem Ort, nur über die Epic-Launcher-Datei bekannt
  mk(path.join(base, 'X', 'Irgendwo'), 7);
  const dat = path.join(base, 'LauncherInstalled.dat');
  fs.writeFileSync(dat, JSON.stringify({ InstallationList: [{ InstallLocation: path.join(base, 'X', 'Irgendwo'), AppName: 'UE_5.7' }, { InstallLocation: '/x', AppName: 'Fortnite' }] }));
  e = unreal.findEngines('', { roots: [], launcherFile: dat });
  assert.strictEqual(e[0] && e[0].version, '5.7', 'findet Engine über Launcher-Datei');
  assert.match(unreal.engineHelp(), /Einstellungen/);
  console.log('Engine-Erkennung: Tests bestanden.');
})();

// --- Windows-Befehlszeile mit Leerzeichen in Pfaden ---
(() => {
  const line = unreal.winCommandLine('C:\\Program Files\\Epic Games\\UE_5.8\\Engine\\Build\\BatchFiles\\Build.bat',
    ['MilitrFlughafenEditor', 'Win64', 'Development', '-Project=C:\\Users\\PC\\UnrealForge Projects\\MilitrFlughafen\\MilitrFlughafen.uproject', '-WaitMutex']);
  assert.strictEqual(line,
    '""C:\\Program Files\\Epic Games\\UE_5.8\\Engine\\Build\\BatchFiles\\Build.bat" MilitrFlughafenEditor Win64 Development "-Project=C:\\Users\\PC\\UnrealForge Projects\\MilitrFlughafen\\MilitrFlughafen.uproject" -WaitMutex"');
  console.log('Windows-Befehlszeile: Test bestanden.');
})();

// --- Build-Skript mit Leerzeichen im Pfad wirklich ausführen (Linux/Mac: bash) ---
(async () => {
  if (process.platform === 'win32') return;
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'forge sp '));
  const sh = path.join(d, 'Build Tool.sh');
  fs.writeFileSync(sh, 'for a in "$@"; do echo "ARG[$a]"; done\n');
  const r = await unreal.runScript(sh, ['X', '-Project=/a b/c.uproject']);
  assert.strictEqual(r.code, 0);
  assert.ok(r.output.includes('ARG[-Project=/a b/c.uproject]'), r.output);
  console.log('Build-Skript mit Leerzeichen: Test bestanden.');
})();

// --- Windows: echte .bat in Ordner mit Leerzeichen (läuft in GitHub Actions auf windows-latest) ---
(async () => {
  if (process.platform !== 'win32') return;
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'forge sp '));
  const bat = path.join(d, 'Build Tool.bat');
  fs.writeFileSync(bat, '@echo off\r\n:loop\r\nif "%~1"=="" goto end\r\necho ARG[%~1]\r\nshift\r\ngoto loop\r\n:end\r\n');
  const r = await unreal.runScript(bat, ['X', '-Project=C:\\a b\\c.uproject']);
  assert.strictEqual(r.code, 0, r.output);
  assert.ok(r.output.includes('ARG[-Project=C:\\a b\\c.uproject]'), r.output);
  console.log('Windows .bat mit Leerzeichen: Test bestanden.');
})().catch((e) => { console.error(e); process.exit(1); });

// --- Plugins, die es in der Engine nicht gibt, werden entfernt (z. B. MassEntity ab UE 5.5) ---
(() => {
  const eng = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-plug-'));
  const names = ['PCG', 'ChaosVehiclesPlugin', 'MassGameplay', 'MassAI', 'MassCrowd', 'ZoneGraph', 'StateTree', 'SmartObjects',
    'GameplayAbilities', 'EnhancedInput', 'CommonUI', 'PythonScriptPlugin', 'EditorScriptingUtilities', 'ModelingToolsEditorMode',
    'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']; // ohne MassEntity
  for (const n of names) {
    const d = path.join(eng, 'Engine', 'Plugins', 'Runtime', n);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, n + '.uplugin'), '{}');
  }
  const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-proj-'));
  const r = unreal.scaffoldProject(projDir, 'Flughafen', '5.8', 'x');
  const up = unreal.findUproject(r.root);
  assert.deepStrictEqual(unreal.fixProjectPlugins(up, eng), ['MassEntity']);
  const after = JSON.parse(fs.readFileSync(up, 'utf8')).Plugins.map((p) => p.Name);
  assert.ok(!after.includes('MassEntity') && after.includes('PCG') && after.length === 14);
  assert.deepStrictEqual(unreal.fixProjectPlugins(up, eng), [], 'zweiter Lauf ändert nichts');
  console.log('Plugin-Bereinigung: Test bestanden.');
})();
