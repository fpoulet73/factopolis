#!/usr/bin/env python3
"""
Génère 4 vues isométriques (N, S, E, W) d'un modèle GLB pour un jeu tycoon isométrique.

Dépendances:
    pip install trimesh pyvista pillow numpy

Usage:
    python render_iso.py model.glb
    python render_iso.py model.glb --size 1024 --output ./renders
    python render_iso.py model.glb --elevation 35.26 --ortho
    python render_iso.py model.glb --fov 40 --bg 0.1 0.1 0.1
"""

import sys
import os
import argparse
import numpy as np


def collect_meshes(model):
    import trimesh
    meshes = []
    if isinstance(model, trimesh.Scene):
        for node_name in model.graph.nodes_geometry:
            transform, geom_name = model.graph[node_name]
            geom = model.geometry.get(geom_name)
            if geom is None or not hasattr(geom, "faces") or len(geom.faces) == 0:
                continue
            transformed = geom.copy()
            transformed.apply_transform(transform)
            meshes.append(transformed)
    elif hasattr(model, "faces") and len(model.faces) > 0:
        meshes.append(model)
    return meshes


def get_mesh_color(mesh):
    """Extrait la couleur diffuse principale du matériau, retourne un triplet [0-1]."""
    try:
        vis = mesh.visual
        if hasattr(vis, "to_color"):
            vis = vis.to_color()
        if hasattr(vis, "vertex_colors") and vis.vertex_colors is not None and len(vis.vertex_colors):
            rgba = vis.vertex_colors.mean(axis=0)
            return (rgba[:3] / 255.0).tolist()
        if hasattr(vis, "material"):
            mat = vis.material
            for attr in ("baseColorFactor", "diffuse", "ambient"):
                val = getattr(mat, attr, None)
                if val is not None:
                    arr = np.array(val, dtype=float)
                    if arr.max() > 1.0:
                        arr = arr / 255.0
                    return arr[:3].tolist()
    except Exception:
        pass
    return [0.72, 0.72, 0.72]


def trimesh_to_pyvista(mesh):
    import pyvista as pv
    verts = mesh.vertices.astype(np.float64)
    # pyvista attend le format [n_pts, v0, v1, v2, ...]
    n = len(mesh.faces)
    faces_flat = np.empty(n * 4, dtype=np.int_)
    faces_flat[0::4] = 3
    faces_flat[1::4] = mesh.faces[:, 0]
    faces_flat[2::4] = mesh.faces[:, 1]
    faces_flat[3::4] = mesh.faces[:, 2]
    pv_mesh = pv.PolyData(verts, faces_flat)

    # Vertex colors si disponibles
    try:
        vis = mesh.visual
        if hasattr(vis, "to_color"):
            vis = vis.to_color()
        if hasattr(vis, "vertex_colors") and vis.vertex_colors is not None:
            vc = vis.vertex_colors[:, :3].astype(np.uint8)
            if len(vc) == len(verts):
                pv_mesh.point_data["RGB"] = vc
    except Exception:
        pass

    return pv_mesh


def camera_eye(center, scale, azim_deg, elev_deg, fov_deg, ortho):
    """Retourne la position de la caméra en coordonnées monde (Y-up)."""
    azim = np.radians(azim_deg)
    elev = np.radians(elev_deg)
    if ortho:
        dist = scale * 3.5
    else:
        half_fov = np.radians(fov_deg) / 2.0
        dist = (scale * 0.85) / np.tan(half_fov) + scale * 0.6
    ex = center[0] + dist * np.cos(elev) * np.sin(azim)
    ey = center[1] + dist * np.sin(elev)
    ez = center[2] + dist * np.cos(elev) * np.cos(azim)
    return (float(ex), float(ey), float(ez))


def render_views(glb_path, output_dir, output_name, image_size, elevation_deg, fov_deg, bg_color, ortho):
    import trimesh
    import pyvista as pv
    from PIL import Image

    pv.global_theme.allow_empty_mesh = True

    print(f"Chargement : {glb_path}")
    model = trimesh.load(glb_path, force="scene")
    meshes = collect_meshes(model)
    if not meshes:
        print("Erreur : aucun maillage trouvé dans le fichier.")
        sys.exit(1)
    print(f"  {len(meshes)} maillage(s) trouvé(s)")

    all_verts = np.vstack([m.vertices for m in meshes])
    bbox_min = all_verts.min(axis=0)
    bbox_max = all_verts.max(axis=0)
    center = (bbox_min + bbox_max) / 2.0
    extents = bbox_max - bbox_min
    scale = float(np.max(extents))
    print(f"  Centre : {center}")
    print(f"  Dimensions : {extents[0]:.3f} x {extents[1]:.3f} x {extents[2]:.3f}")

    pv_meshes = [(trimesh_to_pyvista(m), get_mesh_color(m)) for m in meshes]

    os.makedirs(output_dir, exist_ok=True)
    base = output_name or os.path.splitext(os.path.basename(glb_path))[0]

    views = [("N", 45.0), ("E", 135.0), ("S", 225.0), ("W", 315.0)]

    print(f"\nRendu {'orthographique' if ortho else 'perspectif'} — {image_size}x{image_size}px")
    saved = []

    def make_plotter(bg, eye, azim_deg):
        pl = pv.Plotter(off_screen=True, window_size=[image_size, image_size])
        pl.set_background(bg)
        for pv_mesh, color in pv_meshes:
            if "RGB" in pv_mesh.point_data:
                pl.add_mesh(pv_mesh, scalars="RGB", rgb=True,
                            lighting=True, smooth_shading=False,
                            ambient=0.4, diffuse=0.8)
            else:
                pl.add_mesh(pv_mesh, color=color, lighting=True,
                            smooth_shading=False, specular=0.1, specular_power=8,
                            ambient=0.4, diffuse=0.8)
        pl.camera.position = eye
        pl.camera.focal_point = tuple(center)
        pl.camera.up = (0.0, 1.0, 0.0)
        if ortho:
            pl.camera.parallel_projection = True
            pl.camera.parallel_scale = scale * 0.65
        else:
            pl.camera.view_angle = fov_deg
        pl.remove_all_lights()
        azim_r = np.radians(azim_deg)
        main_offset = np.array([
            np.cos(azim_r + np.radians(45)), 2.0,
            np.sin(azim_r + np.radians(45)),
        ]) * scale * 4
        fill_offset = np.array([
            np.cos(azim_r - np.radians(135)), 0.5,
            np.sin(azim_r - np.radians(135)),
        ]) * scale * 3
        pl.add_light(pv.Light(position=tuple(center + main_offset),
            focal_point=tuple(center), color="white", intensity=1.4, light_type="scene light"))
        pl.add_light(pv.Light(position=tuple(center + fill_offset),
            focal_point=tuple(center), color="white", intensity=0.9, light_type="scene light"))
        pl.add_light(pv.Light(position=tuple(center + np.array([0, -scale * 2, 0])),
            focal_point=tuple(center), color="white", intensity=0.5, light_type="scene light"))
        pl.add_light(pv.Light(position=eye,
            focal_point=tuple(center), color="white", intensity=0.6, light_type="scene light"))
        return pl

    for dir_name, azim_deg in views:
        eye = camera_eye(center, scale, azim_deg, elevation_deg, fov_deg, ortho)

        # Deux plotters séparés : un fond noir, un fond blanc
        pl_black = make_plotter("black", eye, azim_deg)
        black = pl_black.screenshot(return_img=True).astype(np.float32)
        pl_black.close()

        pl_white = make_plotter("white", eye, azim_deg)
        white = pl_white.screenshot(return_img=True).astype(np.float32)
        pl_white.close()

        # Alpha calculé depuis la différence fond noir / fond blanc
        # pixel opaque → black == white, pixel transparent → white = 255, black = 0
        diff = (white - black) / 255.0                          # (H, W, 3), 0=opaque 1=transparent
        alpha_channel = np.clip(1.0 - diff.max(axis=2), 0.0, 1.0)  # (H, W)

        # Récupère la couleur réelle depuis le rendu fond noir (déjà correct pour pixels opaques)
        eps = 1e-6
        rgb = np.zeros_like(black, dtype=np.float32)
        for c in range(3):
            rgb[:, :, c] = np.where(
                alpha_channel > eps,
                np.clip(black[:, :, c] / (alpha_channel + eps), 0, 255),
                0.0,
            )
        rgb_u8 = rgb.astype(np.uint8)
        alpha_u8 = (alpha_channel * 255).astype(np.uint8)

        rgba = np.dstack([rgb_u8, alpha_u8])
        img = Image.fromarray(rgba, mode="RGBA")
        out_path = os.path.join(output_dir, f"{base}-{dir_name}.png")
        img.save(out_path)
        saved.append(out_path)
        print(f"  [{dir_name}] → {out_path}")

    return saved


def main():
    parser = argparse.ArgumentParser(
        description="Génère 4 vues isométriques (N/S/E/W) d'un modèle .glb"
    )
    parser.add_argument("glb", help="Chemin vers le fichier .glb")
    parser.add_argument("--size", type=int, default=512,
                        help="Taille de l'image en pixels (défaut : 512)")
    parser.add_argument("--output", "-o",
                        help="Répertoire de sortie (défaut : dossier du .glb)")
    parser.add_argument("--name", "-n",
                        help="Nom de base des fichiers de sortie (défaut : nom du .glb)")
    parser.add_argument("--elevation", type=float, default=30.0,
                        help="Angle d'élévation caméra (défaut : 30, vrai iso : 35.26)")
    parser.add_argument("--fov", type=float, default=45.0,
                        help="Champ de vision vertical en degrés (défaut : 45, ignoré si --ortho)")
    parser.add_argument("--ortho", action="store_true",
                        help="Projection orthographique (vrai isométrique, recommandé tycoon)")
    parser.add_argument("--bg", type=float, nargs=3, default=[0.12, 0.12, 0.12],
                        metavar=("R", "G", "B"),
                        help="Couleur de fond RGB 0-1 (défaut : 0.12 0.12 0.12)")
    args = parser.parse_args()

    if not os.path.isfile(args.glb):
        print(f"Erreur : fichier introuvable : {args.glb}")
        sys.exit(1)

    output_dir = args.output or os.path.dirname(os.path.abspath(args.glb))

    saved = render_views(
        glb_path=args.glb,
        output_dir=output_dir,
        output_name=args.name,
        image_size=args.size,
        elevation_deg=args.elevation,
        fov_deg=args.fov,
        bg_color=args.bg,
        ortho=args.ortho,
    )
    print(f"\nTerminé — {len(saved)} image(s) générée(s).")


if __name__ == "__main__":
    main()
