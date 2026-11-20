# Minimaler Ersatz für Unreals Python-Modul (nur für Tests ohne Engine).
from unittest.mock import MagicMock
calls = []

def log(m): print('LogPython: ' + str(m))
def log_error(m): print('LogPython: Error: ' + str(m))

class Vector:
    def __init__(self, x=0, y=0, z=0): self.x, self.y, self.z = x, y, z
class Rotator:
    def __init__(self, pitch=0, yaw=0, roll=0): self.pitch, self.yaw, self.roll = pitch, yaw, roll
class LinearColor:
    def __init__(self, r, g, b, a=1.0): self.rgba = (r, g, b, a)

class EditorAssetLibrary:
    does_asset_exist = staticmethod(lambda p: False)
    does_directory_exist = staticmethod(lambda p: True)
    load_asset = staticmethod(lambda p: MagicMock(name=p))
    save_directory = staticmethod(lambda *a, **k: True)
    save_loaded_asset = staticmethod(lambda a: True)

class _ActorSys:
    def spawn_actor_from_class(self, cls, loc, rot):
        calls.append(('spawn', cls, loc.x, loc.y, loc.z))
        a = MagicMock(); a.get_actor_label.return_value = 'X'
        return a
    def get_all_level_actors(self): return []

class _LevelSys:
    def new_level(self, p): calls.append(('new_level', p)); return True
    def load_level(self, p): return True
    def save_current_level(self): calls.append(('save',)); return True

EditorActorSubsystem = 'EditorActorSubsystem'
LevelEditorSubsystem = 'LevelEditorSubsystem'
def get_editor_subsystem(c): return _ActorSys() if c == EditorActorSubsystem else _LevelSys()

def __getattr__(name):  # alles andere: Platzhalter
    return MagicMock(name=name)
