// Testet die kostenlose lokale KI-Schleife gegen einen simulierten Ollama-Server,
// außerdem Gedächtnis, automatisches Lernen und den Such-Parser.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { LocalAgent, extractTextToolCalls } = require('../src/localAgent');
const { ToolContext } = require('../src/tools');
const { Memory } = require('../src/memory');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-local-'));
  const memory = new Memory(path.join(tmp, 'memory.json'));

  // --- Gedächtnis ---
  memory.remember('Chaos Vehicles: Modul ChaosVehicles in Build.cs eintragen, sonst Linkerfehler', 'build, vehicles');
  memory.remember('Nutzer mag dunkle, realistische Nachtszenen', 'vorliebe');
  assert.strictEqual(memory.remember('Nutzer mag dunkle, realistische Nachtszenen'), 'Ist schon gespeichert.');
  const hits = memory.recall('Autos mit Chaos Vehicles bauen');
  assert.ok(hits[0].text.includes('ChaosVehicles'), 'recall findet passenden Eintrag');
  assert.strictEqual(new Memory(memory.file).items.length, 2, 'Gedächtnis wird gespeichert');

  // --- Werkzeugaufrufe als Text (Fallback für kleine Modelle) ---
  const c = extractTextToolCalls('Ich lege an:\n<tool_call>{"name":"recall","arguments":{"query":"x"}}</tool_call>');
  assert.strictEqual(c[0].function.name, 'recall');
  assert.strictEqual(extractTextToolCalls('<tool_call>{"name":"rm_rf","arguments":{}}</tool_call>').length, 0);

  // --- Such-Parser mit Beispiel-HTML ---
  const web = require('../src/web');
  const sample = '<div><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdev.epicgames.com%2Fdoc&amp;rut=1">Chaos <b>Vehicles</b></a><a class="result__snippet" href="x">How to set up &amp; drive</a></div>';
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: true, text: async () => sample });
  const sr = await web.webSearch('x');
  global.fetch = realFetch;
  assert.ok(sr.includes('https://dev.epicgames.com/doc') && sr.includes('Chaos Vehicles') && sr.includes('set up & drive'), sr);
  assert.ok(web.htmlToText('<script>x</script><h2>Titel</h2><p>A&amp;B</p>').includes('## Titel'));

  // --- Simulierter Ollama-Server ---
  const requests = [];
  const script = [
    // 1. Antwort: Projekt anlegen (echter Funktionsaufruf)
    [{ message: { role: 'assistant', content: '', thinking: 'Ich lege das Projekt an.' } },
     { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'create_unreal_project', arguments: { name: 'TestCity', description: 'Testspiel' } } }] } },
     { done: true, prompt_eval_count: 100, eval_count: 20, message: { role: 'assistant', content: '' } }],
    // 2. Antwort: Datei schreiben + merken (zwei Aufrufe), eines davon kaputt
    [{ message: { role: 'assistant', content: '', tool_calls: [
      { function: { name: 'write_file', arguments: { path: 'GAME_PLAN.md', content: '# TestCity\n- Autos' } } },
      { function: { name: 'write_file', arguments: { path: 'kaputt.txt' } } },
      { function: { name: 'remember', arguments: { text: 'TestCity nutzt World Partition', tags: 'projekt' } } }] } },
     { done: true, message: { role: 'assistant', content: '' } }],
    // 3. Antwort: Fertig-Text
    [{ message: { role: 'assistant', content: 'Fertig: ' } }, { message: { role: 'assistant', content: 'Projekt angelegt.' } },
     { done: true, message: { role: 'assistant', content: '' } }],
  ];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const j = JSON.parse(body);
      requests.push(j);
      const chunks = script[requests.length - 1] || [{ done: true, message: { content: 'Ende' } }];
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      for (const ch of chunks) res.write(JSON.stringify(ch) + '\n');
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  let root = null;
  const ctx = new ToolContext({
    getSettings: () => ({ projectsDir: tmp }), getProjectRoot: () => root, setProjectRoot: (r) => { root = r; },
    onLog: () => {}, askApproval: async () => false, memory,
  });
  const events = [];
  const agent = new LocalAgent({ baseUrl, model: 'qwen3:8b', numCtx: 8192, toolCtx: ctx, memory, emit: (e, p) => events.push([e, p]) });
  await agent.send('Bau mir eine Stadt mit Autos');
  server.close();

  assert.strictEqual(requests.length, 3, 'drei Modellaufrufe');
  assert.strictEqual(requests[0].tools.length, 13, 'alle Werkzeuge übergeben');
  assert.strictEqual(requests[0].options.num_ctx, 8192);
  assert.ok(requests[0].messages[1].content.includes('ChaosVehicles'), 'Gedächtnis wird automatisch mitgegeben');
  assert.ok(!('display' in requests[0].messages[1]), 'interne Felder gehen nicht an Ollama');
  assert.strictEqual(requests[1].messages.at(-1).role, 'tool');
  const r2tools = requests[2].messages.filter((m) => m.role === 'tool').map((m) => m.content);
  assert.ok(r2tools.some((t) => t.startsWith('FEHLER bei der Eingabe: Pflichtfeld fehlt: content')), 'kaputte Eingabe wird abgefangen');
  assert.strictEqual(fs.readFileSync(path.join(root, 'GAME_PLAN.md'), 'utf8'), '# TestCity\n- Autos');
  assert.ok(memory.items.some((i) => i.text === 'TestCity nutzt World Partition'), 'remember funktioniert');
  assert.ok(events.some(([e, p]) => e === 'text' && p === 'Projekt angelegt.'));
  assert.ok(events.some(([e]) => e === 'done'));
  assert.ok(fs.existsSync(path.join(root, '.forge', 'history-local.json')), 'Verlauf gespeichert');
  assert.deepStrictEqual(agent.displayHistory()[0], { type: 'user', text: 'Bau mir eine Stadt mit Autos' });

  // --- Automatisches Lernen aus reparierten Builds ---
  ctx.touched.add('Source/TestCity/Car.cpp');
  ctx.learnFromBuild({ code: 6, output: 'Car.cpp(12): error C2065: UChaosVehicleMovementComponent: undeclared identifier\n' });
  ctx.touched.add('Source/TestCity/TestCity.Build.cs');
  ctx.learnFromBuild({ code: 0, output: 'Result: Succeeded' });
  assert.ok(memory.items.some((i) => i.text.includes('C2065') && i.text.includes('Build.cs')), 'Fehler + Lösung automatisch gelernt');

  // --- Ollama-Status, wenn nichts läuft ---
  const st = await LocalAgent.status('http://127.0.0.1:1', 'qwen3:8b');
  assert.strictEqual(st.running, false);

  console.log('Lokale KI, Gedächtnis, Lernen und Suche: alle Tests bestanden.');
})().catch((e) => { console.error(e); process.exit(1); });

// --- run_editor_python mit forge-Bibliothek gegen simulierten Editor ---
(async () => {
  if (process.platform === 'win32') return;
  const { execSync } = require('child_process');
  try { execSync('python3 --version', { stdio: 'ignore' }); } catch { console.log('python3 fehlt – übersprungen'); return; }
  const unreal = require('../src/unreal');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-py-'));
  const r = unreal.scaffoldProject(tmp, 'PyTest', '5.8', '');
  const fake = path.join(__dirname, 'fake_unreal', 'UnrealEditor-Cmd');
  const ctx = new ToolContext({ getSettings: () => ({}), getProjectRoot: () => r.root, setProjectRoot: () => {}, onLog: () => {}, askApproval: async () => false });
  ctx.engine = () => ({ dir: tmp, version: '5.8', editorCmd: fake, editor: fake });
  const ok = await ctx.run('run_editor_python', { filename: 'airbase.py', script: [
    'import forge',
    'forge.new_level("Airbase")', 'forge.sky()', 'forge.ground(4000)',
    'forge.box("Runway", x=0, y=0, z=0, length=3000, width=60, height=0.3, color="#3a3a3a")',
    'forge.cylinder("Tank", x=1, y=2, z=0, diameter=10, height=12, color="#999999")',
    'forge.player_start()', 'forge.save()'].join('\n') });
  assert.ok(ok.startsWith('SKRIPT ERFOLGREICH'), ok);
  assert.ok(ok.includes('[Forge] Level angelegt: /Game/Maps/Airbase'), ok);
  assert.ok(!ok.includes('Running start-up script'), 'Start-Rauschen gefiltert');
  assert.ok(fs.existsSync(path.join(r.root, 'Content', 'Python', 'forge.py')));
  const bad = await ctx.run('run_editor_python', { filename: 'bad.py', script: 'import unreal\nunreal.StaticMesh.load("x")\nraise ValueError("kaputt")' });
  assert.ok(bad.startsWith('SKRIPT-FEHLER') && bad.includes('ValueError: kaputt'), bad);
  console.log('Editor-Python mit forge: Test bestanden.');
})().catch((e) => { console.error(e); process.exit(1); });
