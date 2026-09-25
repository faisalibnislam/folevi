#!/usr/bin/env python3
"""Refreshes Folevi/Resources/Localizable.xcstrings (English source strings) from the .stringsdata files
the Swift compiler emits (SWIFT_EMIT_LOC_STRINGS=YES). Run after a build:

    script/build_and_run_macos.sh --no-launch && python3 apps/macos/scripts/update-string-catalog.py

Existing entries (comments, translations) are preserved; strings no longer in the code are marked stale.
"""
import glob
import json
import os

here = os.path.dirname(os.path.abspath(__file__))
macos = os.path.dirname(here)
catalog_path = os.path.join(macos, "Folevi/Resources/Localizable.xcstrings")
pattern = os.path.join(macos, "build/DerivedData/Build/Intermediates.noindex/Folevi.build/*/Folevi.build/Objects-normal/*/*.stringsdata")

keys = {}
for path in glob.glob(pattern):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    for entry in data.get("tables", {}).get("Localizable", []):
        keys.setdefault(entry["key"], entry.get("comment", ""))

catalog = {"sourceLanguage": "en", "strings": {}, "version": "1.0"}
if os.path.exists(catalog_path):
    with open(catalog_path, encoding="utf-8") as f:
        catalog = json.load(f)

strings = catalog.setdefault("strings", {})
for key, comment in keys.items():
    entry = strings.setdefault(key, {})
    entry.pop("extractionState", None)
    if comment:
        entry["comment"] = comment
for key, entry in strings.items():
    if key not in keys:
        entry["extractionState"] = "stale"

catalog["strings"] = dict(sorted(strings.items()))
with open(catalog_path, "w", encoding="utf-8") as f:
    json.dump(catalog, f, ensure_ascii=False, indent=2, sort_keys=True)
    f.write("\n")
print(f"{len(keys)} strings in {os.path.relpath(catalog_path, macos)}")
