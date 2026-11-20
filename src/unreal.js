// Unreal-Engine-Hilfen: Engine finden, Projekte anlegen, bauen, Editor-Python ausführen.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

/** Sucht installierte Unreal-Engine-5-Versionen an den üblichen Orten. */
function findEngines(extraPath) {
  const candidates = [];
  if (extraPath) candidates.push(extraPath);
  const roots = isWin
    ? ['C:\\Program Files\\Epic Games', 'D:\\Program Files\\Epic Games', 'D:\\Epic Games', 'E:\\Epic Games']
    : isMac
      ? ['/Users/Shared/Epic Games']
      : [path.join(os.homedir(), 'UnrealEngine'), '/opt/UnrealEngine', path.join(os.homedir(), 'Epic Games')];
  for (const root of roots) {
    try {
      for (const d of fs.readdirSync(root)) {
        if (/^UE_5/.test(d) || d === 'UnrealEngine') candidates.push(path.join(root, d));
      }
    } catch { /* Ordner existiert nicht */ }
  }
  // Linux: Ordner selbst kann die Engine sein
  if (!isWin && !isMac) candidates.push(...roots);

  const found = [];
  for (const dir of [...new Set(candidates)]) {
    const tools = engineTools(dir);
    if (tools && fs.existsSync(tools.editorCmd)) {
      const ver = (dir.match(/UE_(5\.\d+)/) || [])[1] || readEngineVersion(dir) || '5.x';
      found.push({ dir, version: ver, ...tools });
    }
  }
  return found.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
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
function runProcess(cmd, args, { cwd, onOutput, timeoutMs = 60 * 60 * 1000, shell = false } = {}) {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(cmd, args, { cwd, shell, windowsHide: true });
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

function findUproject(root) {
  try {
    const f = fs.readdirSync(root).find((x) => x.endsWith('.uproject'));
    return f ? path.join(root, f) : null;
  } catch { return null; }
}

module.exports = { findEngines, runProcess, scaffoldProject, findUproject, safeName, isWin };
