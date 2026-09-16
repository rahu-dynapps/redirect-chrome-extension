#!/usr/bin/env python3
"""Vérifie puis empaquette l'extension pour le Chrome Web Store.

Produit dist/<nom>-v<version>.zip avec manifest.json à la racine de l'archive,
sans les fichiers de développement (tests, outils, dépôt git).

Usage : python3 tools/package.py   (ou npm run package)
"""
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

# Ce qui part dans l'archive : le strict nécessaire au fonctionnement.
INCLUDE_FILES = ["manifest.json"]
INCLUDE_DIRS = ["icons", "src"]
EXCLUDE_SUFFIXES = {".md", ".map"}

# Limites imposées par le Chrome Web Store.
MAX_NAME = 75
MAX_DESCRIPTION = 132

errors: list[str] = []
warnings: list[str] = []


def check_manifest(manifest: dict) -> None:
    name = manifest.get("name", "")
    description = manifest.get("description", "")
    version = manifest.get("version", "")

    if not name or len(name) > MAX_NAME:
        errors.append(f"name : {len(name)} caractères (max {MAX_NAME}).")
    if not description:
        errors.append("description : absente.")
    elif len(description) > MAX_DESCRIPTION:
        errors.append(
            f"description : {len(description)} caractères, le store refuse au-delà de {MAX_DESCRIPTION}."
        )
    if not re.fullmatch(r"\d+(\.\d+){0,3}", version):
        errors.append(f"version : « {version} » doit être 1 à 4 entiers séparés par des points.")
    if manifest.get("manifest_version") != 3:
        errors.append("manifest_version : le store n'accepte plus que la version 3.")
    for size in ("16", "48", "128"):
        if size not in manifest.get("icons", {}):
            errors.append(f"icons : l'icône {size}x{size} est requise.")
    if "author" in manifest and not isinstance(manifest["author"], dict):
        warnings.append("author : Chrome attend un objet {\"email\": \"…\"} ; la chaîne est ignorée.")


def check_references(manifest: dict) -> None:
    """Tout fichier cité par le manifest doit exister et être inclus dans l'archive."""
    refs = set(re.findall(r'"([^"]+\.(?:png|js|html|css|json))"', json.dumps(manifest)))
    for ref in sorted(refs):
        if not (ROOT / ref).exists():
            errors.append(f"fichier manquant : {ref}")


def check_no_remote_code() -> None:
    """Le code hébergé à distance est interdit en MV3 : motif de rejet classique."""
    pattern = re.compile(r"""<script[^>]+src=["']https?://|\bimportScripts\(|\beval\(""")
    for path in (ROOT / "src").rglob("*"):
        if path.suffix not in {".js", ".html"}:
            continue
        if pattern.search(path.read_text(encoding="utf-8")):
            errors.append(f"code distant ou eval() détecté dans {path.relative_to(ROOT)}")


def collect_files() -> list[Path]:
    files = [ROOT / name for name in INCLUDE_FILES]
    for directory in INCLUDE_DIRS:
        for path in sorted((ROOT / directory).rglob("*")):
            if path.is_file() and path.suffix not in EXCLUDE_SUFFIXES:
                files.append(path)
    return files


def main() -> int:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    check_manifest(manifest)
    check_references(manifest)
    check_no_remote_code()

    if errors:
        print("Empaquetage refusé :", file=sys.stderr)
        for error in errors:
            print(f"  ✗ {error}", file=sys.stderr)
        return 1
    for warning in warnings:
        print(f"  ! {warning}")

    slug = re.sub(r"[^a-z0-9]+", "-", manifest["name"].lower()).strip("-")
    DIST.mkdir(exist_ok=True)
    target = DIST / f"{slug}-v{manifest['version']}.zip"

    files = collect_files()
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            archive.write(path, path.relative_to(ROOT).as_posix())

    print(f"✓ {target.relative_to(ROOT)} — {len(files)} fichiers, {target.stat().st_size / 1024:.1f} Ko")
    print(f"  nom         : {manifest['name']}")
    print(f"  version     : {manifest['version']}")
    print(f"  description : {len(manifest['description'])}/{MAX_DESCRIPTION} caractères")
    print("  À envoyer tel quel dans le Developer Dashboard (manifest.json est à la racine de l'archive).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
