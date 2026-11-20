"""
Unreal Forge – einfache Baukasten-Befehle für den Unreal Editor (Python).

Wird von Unreal Forge automatisch nach Content/Python/forge.py kopiert.
Benutzung in einem Skript:

    import forge
    forge.new_level("Airbase")
    forge.sky()
    forge.ground(4000)                                   # 4 x 4 km Boden
    forge.box("Runway", x=0, y=0, z=0, length=3000, width=60, height=0.3, color="#3a3a3a")
    forge.box("Hangar_1", x=200, y=150, z=0, length=80, width=60, height=25, color="#6b705c")
    forge.save()

Alle Maße in METERN. x/y = Mitte des Objekts, z = Unterkante (0 = Boden).
"""
import unreal

CUBE = "/Engine/BasicShapes/Cube.Cube"
CYLINDER = "/Engine/BasicShapes/Cylinder.Cylinder"
SPHERE = "/Engine/BasicShapes/Sphere.Sphere"
CONE = "/Engine/BasicShapes/Cone.Cone"
_BASE_MATERIAL = "/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"
_MAT_FOLDER = "/Game/Forge/Materials"
_material_cache = {}


def log(msg):
    unreal.log("[Forge] " + str(msg))


def _subsystem(cls):
    try:
        return unreal.get_editor_subsystem(cls)
    except Exception:
        return None


def _actor_sys():
    return _subsystem(unreal.EditorActorSubsystem)


def _level_sys():
    return _subsystem(unreal.LevelEditorSubsystem)


# ---------------------------------------------------------------- Level


def new_level(name, folder="/Game/Maps"):
    """Legt ein neues Level an (oder öffnet es, falls es schon existiert)."""
    path = "%s/%s" % (folder, name)
    lvl = _level_sys()
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        ok = lvl.load_level(path) if lvl else unreal.EditorLevelLibrary.load_level(path)
        log("Level geöffnet: " + path)
    else:
        ok = lvl.new_level(path) if lvl else unreal.EditorLevelLibrary.new_level(path)
        log("Level angelegt: " + path)
    if not ok:
        raise RuntimeError("Level konnte nicht angelegt/geöffnet werden: " + path)
    return path


def open_level(name, folder="/Game/Maps"):
    path = "%s/%s" % (folder, name)
    lvl = _level_sys()
    ok = lvl.load_level(path) if lvl else unreal.EditorLevelLibrary.load_level(path)
    if not ok:
        raise RuntimeError("Level nicht gefunden: " + path)
    log("Level geöffnet: " + path)
    return path


def save():
    """Speichert das aktuelle Level und alle von Forge erzeugten Materialien."""
    lvl = _level_sys()
    ok = lvl.save_current_level() if lvl else unreal.EditorLevelLibrary.save_current_level()
    try:
        if unreal.EditorAssetLibrary.does_directory_exist(_MAT_FOLDER):
            unreal.EditorAssetLibrary.save_directory(_MAT_FOLDER, only_if_is_dirty=True, recursive=True)
    except Exception as e:  # Materialien sind optional
        log("Materialien nicht gespeichert: %s" % e)
    log("Gespeichert." if ok else "WARNUNG: Speichern meldet Fehler.")
    return ok


# ---------------------------------------------------------------- Hilfen


def _vec_m(x, y, z):
    return unreal.Vector(x * 100.0, y * 100.0, z * 100.0)


def _hex_to_color(color):
    if isinstance(color, (tuple, list)):
        r, g, b = color[:3]
        return unreal.LinearColor(r, g, b, 1.0)
    c = str(color).lstrip("#")
    r, g, b = (int(c[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return unreal.LinearColor(r, g, b, 1.0)


def material(color):
    """Einfarbiges Material, z.B. material("#808080"). Gibt None zurück, wenn es nicht klappt."""
    key = str(color).lower()
    if key in _material_cache:
        return _material_cache[key]
    name = "M_Forge_" + "".join(ch for ch in key if ch.isalnum())
    path = "%s/%s" % (_MAT_FOLDER, name)
    try:
        if unreal.EditorAssetLibrary.does_asset_exist(path):
            mi = unreal.EditorAssetLibrary.load_asset(path)
        else:
            tools = unreal.AssetToolsHelpers.get_asset_tools()
            mi = tools.create_asset(name, _MAT_FOLDER, unreal.MaterialInstanceConstant,
                                    unreal.MaterialInstanceConstantFactoryNew())
            parent = unreal.EditorAssetLibrary.load_asset(_BASE_MATERIAL)
            unreal.MaterialEditingLibrary.set_material_instance_parent(mi, parent)
            unreal.MaterialEditingLibrary.set_material_instance_vector_parameter_value(
                mi, "Color", _hex_to_color(color))
            unreal.EditorAssetLibrary.save_loaded_asset(mi)
        _material_cache[key] = mi
        return mi
    except Exception as e:
        log("Material %s nicht möglich: %s" % (color, e))
        _material_cache[key] = None
        return None


def _spawn(cls, location, yaw=0.0, label=None):
    rot = unreal.Rotator(pitch=0.0, yaw=float(yaw), roll=0.0)
    acs = _actor_sys()
    actor = acs.spawn_actor_from_class(cls, location, rot) if acs else \
        unreal.EditorLevelLibrary.spawn_actor_from_class(cls, location, rot)
    if actor is None:
        raise RuntimeError("Konnte %s nicht erzeugen" % cls)
    if label:
        actor.set_actor_label(label)
    return actor


def _shape(label, mesh_path, x, y, z_center, sx, sy, sz, color=None, yaw=0.0):
    actor = _spawn(unreal.StaticMeshActor, _vec_m(x, y, z_center), yaw, label)
    comp = actor.static_mesh_component
    comp.set_static_mesh(unreal.EditorAssetLibrary.load_asset(mesh_path))
    actor.set_actor_scale3d(unreal.Vector(sx, sy, sz))
    if color is not None:
        mi = material(color)
        if mi is not None:
            comp.set_material(0, mi)
    return actor


# ---------------------------------------------------------------- Bausteine


def box(label, x, y, z, length, width, height, color=None, yaw=0.0):
    """Quader. x/y = Mitte, z = Unterkante, Maße in Metern. length entlang X, width entlang Y."""
    a = _shape(label, CUBE, x, y, z + height / 2.0, length, width, height, color, yaw)
    log("Box %s (%sx%sx%s m)" % (label, length, width, height))
    return a


def cylinder(label, x, y, z, diameter, height, color=None):
    """Zylinder (z.B. Tank, Säule, Turm). z = Unterkante."""
    a = _shape(label, CYLINDER, x, y, z + height / 2.0, diameter, diameter, height, color)
    log("Zylinder %s" % label)
    return a


def sphere(label, x, y, z, diameter, color=None):
    """Kugel. z = Unterkante."""
    return _shape(label, SPHERE, x, y, z + diameter / 2.0, diameter, diameter, diameter, color)


def ground(size, color="#7a7a6a", label="Ground"):
    """Flacher quadratischer Boden (size x size Meter), Oberkante auf z=0."""
    return box(label, 0, 0, -1.0, size, size, 1.0, color)


def sky(sun_pitch=-40.0, sun_yaw=30.0):
    """Sonne, Himmel (Atmosphäre), Himmelslicht, Nebel und Wolken."""
    sun = _spawn(unreal.DirectionalLight, unreal.Vector(0, 0, 1000), label="Sun")
    sun.set_actor_rotation(unreal.Rotator(pitch=float(sun_pitch), yaw=float(sun_yaw), roll=0.0), False)
    try:
        sun.light_component.set_editor_property("atmosphere_sun_light", True)
        sun.light_component.set_editor_property("intensity", 10.0)
    except Exception as e:
        log("Sonnen-Einstellung: %s" % e)
    _spawn(unreal.SkyAtmosphere, unreal.Vector(0, 0, 0), label="SkyAtmosphere")
    sl = _spawn(unreal.SkyLight, unreal.Vector(0, 0, 500), label="SkyLight")
    try:
        sl.light_component.set_editor_property("real_time_capture", True)
    except Exception as e:
        log("Himmelslicht-Einstellung: %s" % e)
    _spawn(unreal.ExponentialHeightFog, unreal.Vector(0, 0, 0), label="Fog")
    try:
        _spawn(unreal.VolumetricCloud, unreal.Vector(0, 0, 0), label="Clouds")
    except Exception as e:
        log("Wolken nicht möglich: %s" % e)
    log("Himmel, Sonne, Nebel angelegt.")


def player_start(x=0, y=0, z=1):
    """Startpunkt für den Spieler."""
    return _spawn(unreal.PlayerStart, _vec_m(x, y, z + 1.0), label="PlayerStart")


def delete(label_prefix):
    """Löscht alle Objekte, deren Name mit label_prefix beginnt."""
    acs = _actor_sys()
    actors = acs.get_all_level_actors() if acs else unreal.EditorLevelLibrary.get_all_level_actors()
    n = 0
    for a in actors:
        if a.get_actor_label().startswith(label_prefix):
            (acs.destroy_actor(a) if acs else unreal.EditorLevelLibrary.destroy_actor(a))
            n += 1
    log("%d Objekte gelöscht (%s*)" % (n, label_prefix))
    return n


def list_actors():
    """Gibt alle Objekte im Level aus (Name und Typ)."""
    acs = _actor_sys()
    actors = acs.get_all_level_actors() if acs else unreal.EditorLevelLibrary.get_all_level_actors()
    for a in actors:
        log("%s (%s)" % (a.get_actor_label(), a.get_class().get_name()))
    return len(actors)
