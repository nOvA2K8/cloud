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
  assert.ok(TOOLS.every((t) => t.type || t.eager_input_streaming));

  require('../src/agent'); // lädt das SDK
  console.log('Alle Tests bestanden.');
})().catch((e) => { console.error(e); process.exit(1); });
