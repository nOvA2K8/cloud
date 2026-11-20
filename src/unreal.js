// Unreal-Engine-Hilfen: Engine finden, Projekte anlegen, bauen, Editor-Python ausführen.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

/** Liest aus der Epic-Launcher-Datei, wo Engines installiert wurden (auch auf anderen Laufwerken). */
function launcherInstalls(file) {
  const f = file || (isWin
    ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'UnrealEngineLauncher', 'LauncherInstalled.dat')
    : isMac ? '/Users/Shared/UnrealEngine/Launcher/LauncherInstalled.dat' : null);
  if (!f) return [];
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    return (j.InstallationList || [])
      .filter((i) => /^UE_5/.test(i.AppName || '') || /UE_5/.test(i.InstallLocation || ''))
      .map((i) => i.InstallLocation);
  } catch { return []; }
}

/** Fügt einen Ordner hinzu – oder, falls er selbst keine Engine ist, seine UE_5.x-Unterordner. */
function addCandidate(list, dir) {
  if (!dir) return;
  list.push(dir);
  try {
    for (const d of fs.readdirSync(dir)) {
      if (/^UE_5/i.test(d) || d === 'UnrealEngine' || d === 'Epic Games') list.push(path.join(dir, d));
      if (d === 'Epic Games') {
        try { for (const e of fs.readdirSync(path.join(dir, d))) if (/^UE_5/i.test(e)) list.push(path.join(dir, d, e)); } catch { /* egal */ }
      }
    }
  } catch { /* Ordner existiert nicht */ }
}

/** Sucht installierte Unreal-Engine-5-Versionen: Einstellung, Epic-Launcher, übliche Ordner auf allen Laufwerken. */
function findEngines(extraPath, opts = {}) {
  const candidates = [];
  addCandidate(candidates, extraPath);
  for (const loc of launcherInstalls(opts.launcherFile)) candidates.push(loc);
  let roots;
  if (isWin) {
    roots = [];
    for (const drive of 'CDEFGH') {
      roots.push(`${drive}:\\Program Files\\Epic Games`, `${drive}:\\Epic Games`, `${drive}:\\Games\\Epic Games`, `${drive}:\\`);
    }
    roots.push(path.join(os.homedir(), 'Epic Games'));
  } else if (isMac) {
    roots = ['/Users/Shared/Epic Games'];
  } else {
    roots = [path.join(os.homedir(), 'UnrealEngine'), '/opt/UnrealEngine', path.join(os.homedir(), 'Epic Games')];
  }
  for (const r of opts.roots || roots) addCandidate(candidates, r);

  const found = [];
  const seen = new Set();
  for (const dir of candidates) {
    const key = path.resolve(dir).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const tools = engineTools(dir);
    if (fs.existsSync(tools.editorCmd) || fs.existsSync(tools.editor)) {
      if (!fs.existsSync(tools.editorCmd)) tools.editorCmd = tools.editor;
      const ver = readEngineVersion(dir) || (dir.match(/UE_(5\.\d+)/i) || [])[1] || '5.x';
      found.push({ dir, version: ver, ...tools });
    }
  }
  return found.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
}

/** Erklärt, wo gesucht wurde – für eine hilfreiche Fehlermeldung. */
function engineHelp() {
  return 'Keine Unreal Engine 5 gefunden. Lösung: In Unreal Forge auf ⚙ Einstellungen → „Unreal-Engine-Ordner“ den Ordner der Engine wählen ' +
    '(z. B. C:\\Program Files\\Epic Games\\UE_5.8 – das ist der Ordner, in dem „Engine“ liegt) und speichern. ' +
    'Prüfe außerdem im Epic Games Launcher unter „Unreal Engine → Bibliothek“, ob die Installation wirklich abgeschlossen ist (nicht nur heruntergeladen/in Warteschlange).';
}

function readEngineVersion(dir) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(dir, 'Engine/Build/Build.version'), 'utf8'));
    return `${v.MajorVersion}.${v.MinorVersion}`;
  } catch { return null; }
}

function engineTools(dir) {
  const bin = path.join(dir, 'Engine', 'Binaries');
  const batch = path.join(dir, 'Engine', 'Build', 'BatchFiles');
  if (isWin) {
    return {
      editor: path.join(bin, 'Win64', 'UnrealEditor.exe'),
      editorCmd: path.join(bin, 'Win64', 'UnrealEditor-Cmd.exe'),
      build: path.join(batch, 'Build.bat'),
      platform: 'Win64',
    };
  }
  if (isMac) {
    return {
      editor: path.join(bin, 'Mac', 'UnrealEditor.app', 'Contents', 'MacOS', 'UnrealEditor'),
      editorCmd: path.join(bin, 'Mac', 'UnrealEditor.app', 'Contents', 'MacOS', 'UnrealEditor'),
      build: path.join(batch, 'Mac', 'Build.sh'),
      platform: 'Mac',
    };
  }
  return {
    editor: path.join(bin, 'Linux', 'UnrealEditor'),
    editorCmd: path.join(bin, 'Linux', 'UnrealEditor-Cmd'),
    build: path.join(batch, 'Linux', 'Build.sh'),
    platform: 'Linux',
  };
}

/** Führt einen Prozess aus, streamt Ausgabe, gibt gekürztes Ergebnis zurück. */
/** Setzt ein Argument für cmd.exe in Anführungszeichen, wenn es Leerzeichen o. ä. enthält. */
function quoteWin(a) {
  const s = String(a);
  return /[\s&()^|<>,;=]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Komplette cmd.exe-Zeile: Pfade wie "C:\Program Files\..." bleiben ein Argument. */
function winCommandLine(cmd, args) {
  return `"${[cmd, ...args].map(quoteWin).join(' ')}"`;
}

/** Startet eine .bat/.sh-Datei sicher (Windows: über cmd.exe mit korrekten Anführungszeichen). */
function runScript(file, args, opts = {}) {
  if (isWin) {
    return runProcess(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', winCommandLine(file, args)], { ...opts, verbatim: true });
  }
  return runProcess('bash', [file, ...args], opts);
}

function runProcess(cmd, args, { cwd, onOutput, timeoutMs = 60 * 60 * 1000, shell = false, verbatim = false } = {}) {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(cmd, args, { cwd, shell, windowsHide: true, windowsVerbatimArguments: verbatim });
    const timer = setTimeout(() => { child.kill(); out += '\n[Abgebrochen: Zeitlimit erreicht]'; }, timeoutMs);
    const onData = (d) => { const s = d.toString(); out += s; onOutput && onOutput(s); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, output: `Startfehler: ${e.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, output: tail(out, 30000) }); });
  });
}

function tail(s, max) {
  return s.length > max ? `[... ${s.length - max} Zeichen gekürzt ...]\n` + s.slice(-max) : s;
}

const safeName = (n) => n.replace(/[^A-Za-z0-9_]/g, '').replace(/^[0-9]+/, '') || 'MyGame';

/** Legt ein vollständiges UE5-C++-Projekt mit Open-World-Grundeinstellungen an. */
function scaffoldProject(parentDir, rawName, engineVersion = '5.5', description = '') {
  const name = safeName(rawName);
  const root = path.join(parentDir, name);
  if (fs.existsSync(path.join(root, `${name}.uproject`))) {
    return { root, name, created: false };
  }
  const api = name.toUpperCase() + '_API';
  const files = {
    [`${name}.uproject`]: JSON.stringify({
      FileVersion: 3,
      EngineAssociation: engineVersion,
      Category: '',
      Description: description,
      Modules: [{ Name: name, Type: 'Runtime', LoadingPhase: 'Default', AdditionalDependencies: ['Engine'] }],
      Plugins: [
        { Name: 'ModelingToolsEditorMode', Enabled: true, TargetAllowList: ['Editor'] },
        { Name: 'PCG', Enabled: true },
        { Name: 'ChaosVehiclesPlugin', Enabled: true },
        { Name: 'MassEntity', Enabled: true },
        { Name: 'MassGameplay', Enabled: true },
        { Name: 'MassAI', Enabled: true },
        { Name: 'MassCrowd', Enabled: true },
        { Name: 'ZoneGraph', Enabled: true },
        { Name: 'StateTree', Enabled: true },
        { Name: 'SmartObjects', Enabled: true },
        { Name: 'GameplayAbilities', Enabled: true },
        { Name: 'EnhancedInput', Enabled: true },
        { Name: 'CommonUI', Enabled: true },
        { Name: 'PythonScriptPlugin', Enabled: true },
        { Name: 'EditorScriptingUtilities', Enabled: true },
      ],
    }, null, 2),
    'Config/DefaultEngine.ini': `[/Script/EngineSettings.GameMapsSettings]
GlobalDefaultGameMode=/Script/${name}.${name}GameMode

[/Script/Engine.RendererSettings]
r.DynamicGlobalIlluminationMethod=1
r.ReflectionMethod=1
r.Shadow.Virtual.Enable=1
r.GenerateMeshDistanceFields=True
r.Nanite.ProjectEnabled=True
r.AntiAliasingMethod=4
r.DefaultFeature.AutoExposure.ExtendDefaultLuminanceRange=True
r.VirtualTextures=True
r.Lumen.HardwareRayTracing=True
r.RayTracing=True
r.SkinCache.CompileShaders=True

[/Script/WindowsTargetPlatform.WindowsTargetSettings]
DefaultGraphicsRHI=DefaultGraphicsRHI_DX12
-D3D12TargetedShaderFormats=PCD3D_SM5
+D3D12TargetedShaderFormats=PCD3D_SM6

[/Script/Engine.Engine]
bUseFixedFrameRate=False

[/Script/Engine.WorldPartitionSettings]
bEnableWorldPartition=True

[/Script/PythonScriptPlugin.PythonScriptPluginSettings]
bRemoteExecution=True
`,
    'Config/DefaultGame.ini': `[/Script/EngineSettings.GeneralProjectSettings]
ProjectName=${name}
Description=${description.replace(/\n/g, ' ')}
`,
    'Config/DefaultInput.ini': `[/Script/Engine.InputSettings]
DefaultPlayerInputClass=/Script/EnhancedInput.EnhancedPlayerInput
DefaultInputComponentClass=/Script/EnhancedInput.EnhancedInputComponent
`,
    [`Source/${name}.Target.cs`]: targetCs(name, 'Game'),
    [`Source/${name}Editor.Target.cs`]: targetCs(name, 'Editor'),
    [`Source/${name}/${name}.Build.cs`]: `using UnrealBuildTool;

public class ${name} : ModuleRules
{
	public ${name}(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] {
			"Core", "CoreUObject", "Engine", "InputCore", "EnhancedInput",
			"ChaosVehicles", "GameplayAbilities", "GameplayTags", "GameplayTasks",
			"AIModule", "NavigationSystem", "MassEntity", "StateTreeModule", "UMG"
		});
	}
}
`,
    [`Source/${name}/${name}.h`]: `#pragma once\n\n#include "CoreMinimal.h"\n`,
    [`Source/${name}/${name}.cpp`]: `#include "${name}.h"
#include "Modules/ModuleManager.h"

IMPLEMENT_PRIMARY_GAME_MODULE(FDefaultGameModuleImpl, ${name}, "${name}");
`,
    [`Source/${name}/${name}GameMode.h`]: `#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "${name}GameMode.generated.h"

UCLASS()
class ${api} A${name}GameMode : public AGameModeBase
{
	GENERATED_BODY()
public:
	A${name}GameMode();
};
`,
    [`Source/${name}/${name}GameMode.cpp`]: `#include "${name}GameMode.h"

A${name}GameMode::A${name}GameMode()
{
}
`,
    'Content/Python/.keep': '',
    '.gitignore': 'Binaries/\nDerivedDataCache/\nIntermediate/\nSaved/\n.vs/\n*.sln\n.forge/\n',
  };
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return { root, name, created: true };
}

function targetCs(name, type) {
  const cls = type === 'Editor' ? `${name}EditorTarget` : `${name}Target`;
  return `using UnrealBuildTool;

public class ${cls} : TargetRules
{
	public ${cls}(TargetInfo Target) : base(Target)
	{
		Type = TargetType.${type};
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("${name}");
	}
}
`;
}

/** Alle Plugin-Namen, die in dieser Engine-Installation existieren (alle .uplugin-Dateien unter Engine/Plugins). */
const pluginCache = new Map();
function enginePlugins(engineDir) {
  if (pluginCache.has(engineDir)) return pluginCache.get(engineDir);
  const names = new Set();
  const skip = new Set(['Source', 'Content', 'Binaries', 'Intermediate', 'Resources', 'Shaders', 'Config', 'Docs', 'Extras', 'ThirdParty']);
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.uplugin')) names.add(e.name.slice(0, -8));
      else if (e.isDirectory() && !skip.has(e.name)) walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(path.join(engineDir, 'Engine', 'Plugins'), 0);
  pluginCache.set(engineDir, names);
  return names;
}

/**
 * Entfernt Plugins aus der .uproject, die es in dieser Engine-Version nicht gibt
 * (z. B. MassEntity, das ab UE 5.5 fest in die Engine gewandert ist). Gibt die entfernten Namen zurück.
 */
function fixProjectPlugins(uprojectPath, engineDir) {
  const available = enginePlugins(engineDir);
  if (available.size < 20) return []; // Engine-Plugins nicht lesbar – lieber nichts anfassen
  const proj = JSON.parse(fs.readFileSync(uprojectPath, 'utf8'));
  const before = proj.Plugins || [];
  const keep = before.filter((p) => available.has(p.Name) || fs.existsSync(path.join(path.dirname(uprojectPath), 'Plugins', p.Name)));
  const removed = before.filter((p) => !keep.includes(p)).map((p) => p.Name);
  if (removed.length) {
    proj.Plugins = keep;
    fs.writeFileSync(uprojectPath, JSON.stringify(proj, null, 2));
  }
  return removed;
}

function findUproject(root) {
  try {
    const f = fs.readdirSync(root).find((x) => x.endsWith('.uproject'));
    return f ? path.join(root, f) : null;
  } catch { return null; }
}

module.exports = { fixProjectPlugins, enginePlugins, runScript, winCommandLine, findEngines, engineHelp, launcherInstalls, runProcess, scaffoldProject, findUproject, safeName, isWin };
