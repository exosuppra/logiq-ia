# Outil hors site : régénère public/models/kart-*.glb depuis le projet Kartoche (Blender 5.1).
# blender -b --factory-startup -P tools/build_kart.py -- KartFusee CharBoulon public/models/kart-boulon.glb
# blender -b --factory-startup -P tools/build_kart.py -- KartFlamme CharPicante public/models/kart-picante.glb
# Assemble un kart de Kartoche pour le web, roues mobiles comprises.
# La carrosserie (modèle généré depuis une image) a ses roues fondues dans la
# masse : on repère chaque roue, on la découpe en pièce indépendante dont
# l'origine est sur l'axe, pour que la page puisse la faire tourner.
# usage : blender -b -P build_kart2.py -- KartId CharId sortie.glb [apercu.png]
import bpy, bmesh, json, math, sys
import numpy as np
from mathutils import Vector

ART = "C:/Users/quent/OneDrive/Documents/Game Project/Kartoche/Art/"
args = sys.argv[sys.argv.index("--") + 1:]
kart, char, out = args[:3]
preview = args[3] if len(args) > 3 else None
K = json.load(open(ART + "data/karts.json", encoding="utf-8"))[kart]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def imp(path):
    before = set(bpy.data.objects)
    try:
        bpy.ops.wm.fbx_import(filepath=path)
    except Exception:
        bpy.ops.import_scene.fbx(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


root = bpy.data.objects.new("kart", None)
scene.collection.objects.link(root)
body = next(o for o in imp(ART + f"fbx/SM_{kart}_Body.fbx") if o.type == "MESH")
body.name = "body"
body.parent = root

# ---------------------------------------------------------------- repérage
co = np.array([v.co[:] for v in body.data.vertices])
H = co[:, 2].max()
wheels = {}
for key in ("FL", "FR", "RL", "RR"):
    sx = 1 if key[0] == "F" else -1
    sy = 1 if key[1] == "L" else -1
    q = co[(np.sign(co[:, 0]) == sx) & (co[:, 1] * sy > 0.2) & (co[:, 2] < H * 0.62)]
    ymax = (q[:, 1] * sy).max()
    # flanc extérieur de la roue : ce qui dépasse le plus sur le côté
    # 1) le moyeu (ce qui dépasse le plus) donne une première position fiable
    hub = q[q[:, 1] * sy > ymax - 0.05]
    hx, hz = np.median(hub[:, 0]), np.median(hub[:, 2])
    # 2) le pneu entier autour de ce moyeu donne le centre exact et le rayon ;
    #    les ailerons ou pare-chocs voisins, plus loin, sont écartés
    jr = K["wheel_radius_front" if key[0] == "F" else "wheel_radius_rear"]
    deep = q[(q[:, 1] * sy > ymax - 0.12) & (np.hypot(q[:, 0] - hx, q[:, 2] - hz) < jr * 1.35)]
    lo, hi = np.percentile(deep, 1, axis=0), np.percentile(deep, 99, axis=0)
    cx, cz = (lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2
    r = min(max(max(hi[0] - lo[0], hi[2] - lo[2]) / 2, jr * 0.8), jr * 1.15)
    wheels[key] = dict(cx=float(cx), cz=float(cz), r=float(r), ymax=float(ymax), sy=sy)
print("ROUES", {k: {kk: round(vv, 3) for kk, vv in v.items()} for k, v in wheels.items()})

# ---------------------------------------------------------------- découpe
for key, w in wheels.items():
    bm = bmesh.new()
    bm.from_mesh(body.data)
    width = w["r"] * 0.85  # épaisseur prise côté extérieur (le reste est caché par la caisse)
    sel = []
    for f in bm.faces:
        c = f.calc_center_median()
        if math.hypot(c.x - w["cx"], c.z - w["cz"]) < w["r"] * 1.01 and c.y * w["sy"] > w["ymax"] - width:
            sel.append(f)
    # pièce de roue = copie des faces sélectionnées ; on les retire de la caisse
    wm = bmesh.new()
    uvl_src = bm.loops.layers.uv.active
    uvl_dst = wm.loops.layers.uv.new("UVMap")
    vmap = {}
    for f in sel:
        vs = []
        for v in f.verts:
            if v.index not in vmap:
                vmap[v.index] = wm.verts.new(v.co)
            vs.append(vmap[v.index])
        try:
            nf = wm.faces.new(vs)
        except ValueError:
            continue
        nf.material_index = f.material_index
        nf.smooth = f.smooth
        for a_, b_ in zip(f.loops, nf.loops):  # coordonnées de texture recopiées
            b_[uvl_dst].uv = a_[uvl_src].uv
    bmesh.ops.delete(bm, geom=sel, context="FACES")
    bm.to_mesh(body.data)
    bm.free()

    me = bpy.data.meshes.new("wheel_" + key)
    wm.to_mesh(me)
    wm.free()
    for m in body.data.materials:
        me.materials.append(m)
    ob = bpy.data.objects.new("wheel_" + key, me)
    scene.collection.objects.link(ob)
    # origine sur l'axe de la roue (axe = Y local)
    ys = [v.co.y for v in me.vertices]
    cy = (min(ys) + max(ys)) / 2 if ys else w["ymax"] * w["sy"]
    centre = Vector((w["cx"], cy, w["cz"]))
    for v in me.vertices:
        v.co -= centre
    ob.location = centre
    ob.parent = root
    print("PIECE", key, "faces", len(me.polygons), "centre", [round(c, 3) for c in centre])

# ---------------------------------------------------------------- pilote
pilot = imp(ART + f"fbx/SK_{char}.fbx")
arm = next((o for o in pilot if o.type == "ARMATURE"), None)
for o in pilot:
    if o.type == "MESH":
        for m in list(o.modifiers):
            if m.type == "ARMATURE":
                o.modifiers.remove(m)
        mw = o.matrix_world.copy()
        o.parent = root
        o.matrix_world = mw
        o.location.x += K["seat"][0]
        o.location.y += K["seat"][1]
        o.location.z += K["seat"][2]
        o.name = "pilot"
if arm:
    bpy.data.objects.remove(arm, do_unlink=True)

# ---------------------------------------------------------------- matériaux
for img in bpy.data.images:
    if img.size[0] > 1024:
        img.scale(1024, 1024)
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        continue
    for l in list(bsdf.inputs["Normal"].links):
        nt.links.remove(l)
    bsdf.inputs["Roughness"].default_value = 0.34
    for n in list(nt.nodes):
        if n.type == "TEX_IMAGE" and n.image and n.image.name.endswith("_N.png"):
            nt.nodes.remove(n)

bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_image_format="WEBP", export_image_quality=80,
                          export_apply=True, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
                          export_animations=False, export_skins=False, export_cameras=False, export_lights=False)
import os
print("GLB", os.path.getsize(out))

# ---------------------------------------------------------------- contrôle
if preview:
    sun = bpy.data.objects.new("s", bpy.data.lights.new("s", "SUN"))
    scene.collection.objects.link(sun)
    sun.rotation_euler = (0.8, 0.2, -0.6)
    sun.data.energy = 4
    wd = bpy.data.worlds.new("w"); scene.world = wd; wd.use_nodes = True
    wd.node_tree.nodes["Background"].inputs[0].default_value = (0.6, 0.6, 0.65, 1)
    cam_d = bpy.data.cameras.new("c"); cam_d.type = "ORTHO"; cam_d.ortho_scale = 2.4
    cam = bpy.data.objects.new("c", cam_d); scene.collection.objects.link(cam); scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = 640, 380
    scene.render.engine = "BLENDER_EEVEE"
    wheel_objs = [o for o in bpy.data.objects if o.name.startswith("wheel_")]
    for angle in (0, 50):
        for o in wheel_objs:
            o.rotation_euler = (0, math.radians(angle), 0)
        for side in ("L", "R"):
            cam.location = (0, 6 if side == "L" else -6, 0.45)
            cam.rotation_euler = (math.radians(90), 0, math.pi if side == "L" else 0)
            scene.render.filepath = preview.replace(".png", f"-{side}{angle}.png")
            bpy.ops.render.render(write_still=True)
    # vue de trois-quarts, roues tournées
    cam_d.type = "PERSP"
    cam.location = (2.6, 3.2, 1.5)
    cam.rotation_euler = (Vector((0, 0, 0.4)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = preview.replace(".png", "-34.png")
    bpy.ops.render.render(write_still=True)
