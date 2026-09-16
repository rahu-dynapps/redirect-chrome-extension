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
INCLUDE_DIRS = ["icons", "src", "_locales"]
EXCLUDE_SUFFIXES = {".md", ".map"}

# Limites imposées par le Chrome Web Store.
MAX_NAME = 75
MAX_DESCRIPTION = 132

errors: list[str] = []
warnings: list[str] = []


def check_manifest(manifest: dict) -> None:
    version = manifest.get("version", "")

    for field, limit in (("name", MAX_NAME), ("description", MAX_DESCRIPTION)):
        for locale, value in resolve_field(manifest, field).items():
            if not value:
                errors.append(f"{field} ({locale}) : absent.")
            elif len(value) > limit:
                errors.append(
                    f"{field} ({locale}) : {len(value)} caractères, le store refuse au-delà de {limit}."
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


def resolve_field(manifest: dict, field: str) -> dict[str, str]:
    """Valeur du champ par langue : un __MSG_cle__ est résolu dans chaque _locales/<langue>."""
    raw = manifest.get(field, "")
    match = re.fullmatch(r"__MSG_(\w+)__", raw)
    if not match:
        return {"manifest": raw}
    key = match.group(1)
    values = {}
    for messages_path in sorted((ROOT / "_locales").glob("*/messages.json")):
        locale = messages_path.parent.name
        messages = json.loads(messages_path.read_text(encoding="utf-8"))
        values[locale] = messages.get(key, {}).get("message", "")
        if key not in messages:
            errors.append(f"_locales/{locale}/messages.json : message « {key} » manquant.")
    if not values:
        errors.append(f"{field} : __MSG_{key}__ mais aucun catalogue dans _locales/.")
    return values


def check_locales(manifest: dict) -> None:
    """Le store exige un catalogue complet pour la langue par défaut."""
    default_locale = manifest.get("default_locale")
    if not default_locale:
        if (ROOT / "_locales").exists():
            errors.append("default_locale : requis dès qu'un dossier _locales/ est présent.")
        return
    if not (ROOT / "_locales" / default_locale / "messages.json").exists():
        errors.append(f"_locales/{default_locale}/messages.json : absent alors qu'il est la langue par défaut.")
        return

    reference = json.loads((ROOT / "_locales" / default_locale / "messages.json").read_text(encoding="utf-8"))
    for messages_path in sorted((ROOT / "_locales").glob("*/messages.json")):
        locale = messages_path.parent.name
        if locale == default_locale:
            continue
        messages = json.loads(messages_path.read_text(encoding="utf-8"))
        missing = sorted(set(reference) - set(messages))
        extra = sorted(set(messages) - set(reference))
        if missing:
            warnings.append(f"_locales/{locale} : {len(missing)} message(s) non traduit(s) — {', '.join(missing[:5])}…")
        if extra:
            warnings.append(f"_locales/{locale} : {len(extra)} message(s) inconnu(s) — {', '.join(extra[:5])}…")


def check_references(manifest: dict) -> None:
    """Tout fichier cité par le manifest doit exister et être inclus dans l'archive."""
    refs = set(re.findall(r'"([^"]+\.(?:png|js|html|css|json))"', json.dumps(manifest)))
    for ref in sorted(refs):
        if not (ROOT / ref).exists():
            errors.append(f"fichier manquant : {ref}")


def check_i18n_keys(manifest: dict) -> None:
    """Toute clé utilisée par l'interface doit exister dans la langue par défaut, et inversement."""
    default_locale = manifest.get("default_locale")
    path = ROOT / "_locales" / (default_locale or "") / "messages.json"
    if not default_locale or not path.exists():
        return
    known = set(json.loads(path.read_text(encoding="utf-8")))

    sources = {p: p.read_text(encoding="utf-8") for p in (ROOT / "src").rglob("*") if p.suffix in {".html", ".js"}}
    manifest_text = json.dumps(manifest, ensure_ascii=False)

    # Clés explicitement demandées : attributs data-i18n* et appels t('clé').
    requested: set[str] = set()
    for source, text in sources.items():
        if source.suffix == ".html":
            requested |= set(re.findall(r'data-i18n(?:-\w+)?="([^"]+)"', text))
        else:
            requested |= set(re.findall(r"\bt\(\s*'([A-Za-z0-9_]+)'", text))
    for key in sorted(requested - known):
        errors.append(f"message « {key} » utilisé par l'interface mais absent de _locales/{default_locale}.")

    # Clés atteintes indirectement (tables de correspondance, codes d'erreur) : simple présence textuelle.
    referenced = {
        key
        for key in known
        if any(f"'{key}'" in text for text in sources.values()) or f"__MSG_{key}__" in manifest_text
    }
    unused = sorted(known - requested - referenced)
    if unused:
        warnings.append(f"{len(unused)} message(s) jamais utilisé(s) : {', '.join(unused)}")


JS_KEYWORDS = {
    "if", "for", "while", "switch", "catch", "return", "typeof", "function", "new", "await",
    "else", "do", "try", "throw", "delete", "void", "in", "of", "case", "yield", "async",
    "instanceof", "super", "this",
}
JS_GLOBALS = {
    "Array", "Boolean", "Blob", "CSS", "Date", "Error", "File", "JSON", "Map", "Math", "Node",
    "Number", "Object", "Promise", "RegExp", "Set", "String", "URL", "URLSearchParams", "chrome",
    "confirm", "clearTimeout", "console", "document", "encodeURIComponent", "fetch", "globalThis",
    "history", "isNaN", "localStorage", "location", "parseFloat", "parseInt", "setTimeout",
    "structuredClone", "window",
}


def strip_noise(text: str) -> str:
    """Retire commentaires et littéraux, en un seul balayage : l'ordre compte, « /* » dans une
    chaîne comme « *://hote/* » n'ouvre pas un commentaire."""
    out = []
    i, size = 0, len(text)
    while i < size:
        pair = text[i : i + 2]
        if pair == "//":
            newline = text.find("\n", i)
            i = size if newline == -1 else newline
        elif pair == "/*":
            closing = text.find("*/", i + 2)
            i = size if closing == -1 else closing + 2
            out.append(" ")
        elif text[i] in "\"'`":
            quote, i = text[i], i + 1
            while i < size:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == quote:
                    i += 1
                    break
                if quote != "`" and text[i] == "\n":
                    break
                i += 1
            out.append('""')
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


def check_undefined_calls() -> None:
    """Détecte un appel à une fonction qui n'existe nulle part dans le fichier : une suppression
    accidentelle passe la vérification de syntaxe, pas celle-ci."""
    for path in sorted((ROOT / "src").rglob("*.js")):
        text = strip_noise(path.read_text(encoding="utf-8"))

        known = set(re.findall(r"(?:async\s+)?function\s+([A-Za-z_$][\w$]*)", text))
        known |= set(re.findall(r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)", text))
        # Noms importés, déstructurés, et paramètres de fonctions (souvent appelés en rappel).
        for block in re.findall(r"import\s*\{([^}]*)\}", text):
            known |= {part.split(" as ")[-1].strip() for part in block.split(",") if part.strip()}
        for block in re.findall(r"\[([^\[\]]*)\]\s*(?:=|of|in)", text):
            known |= {part.strip() for part in block.split(",") if part.strip()}
        for block in re.findall(r"\{([^{}]*)\}\s*=", text):
            known |= {re.split(r"[:=]", part)[-1].strip() for part in block.split(",") if part.strip()}
        for block in re.findall(r"\(([^()]*)\)\s*(?:=>|\{)", text):
            known |= {re.split(r"[:=]", part)[0].strip() for part in block.split(",") if part.strip()}
        known = {name for name in known if re.fullmatch(r"[A-Za-z_$][\w$]*", name or "")}

        called = set(re.findall(r"(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(", text))
        for name in sorted(called - known - JS_KEYWORDS - JS_GLOBALS):
            errors.append(f"{path.relative_to(ROOT)} : appel à « {name}() » qui n'est défini nulle part.")


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
    check_locales(manifest)
    check_i18n_keys(manifest)
    check_references(manifest)
    check_no_remote_code()
    check_undefined_calls()

    if errors:
        print("Empaquetage refusé :", file=sys.stderr)
        for error in errors:
            print(f"  ✗ {error}", file=sys.stderr)
        return 1
    for warning in warnings:
        print(f"  ! {warning}")

    default_locale = manifest.get("default_locale", "manifest")
    names = resolve_field(manifest, "name")
    slug = re.sub(r"[^a-z0-9]+", "-", next(iter(names.get(default_locale, "extension").split("&")))
                  .strip().lower()).strip("-")
    DIST.mkdir(exist_ok=True)
    target = DIST / f"{slug}-v{manifest['version']}.zip"

    files = collect_files()
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            archive.write(path, path.relative_to(ROOT).as_posix())

    print(f"✓ {target.relative_to(ROOT)} — {len(files)} fichiers, {target.stat().st_size / 1024:.1f} Ko")
    for locale, value in resolve_field(manifest, "name").items():
        print(f"  nom ({locale})  : {value}")
    print(f"  version     : {manifest['version']}")
    for locale, value in resolve_field(manifest, "description").items():
        print(f"  description ({locale}) : {len(value)}/{MAX_DESCRIPTION} caractères")
    print("  À envoyer tel quel dans le Developer Dashboard (manifest.json est à la racine de l'archive).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
