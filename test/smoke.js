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
