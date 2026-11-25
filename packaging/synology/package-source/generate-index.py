#!/usr/bin/env python3
"""Make the static JSON index for Folevi's Synology package source.

Package Center (Settings > Package Sources) asks the source URL for a JSON list of packages, sending the NAS's
arch, DSM build and language as query parameters (GET or POST). This writes:

  <out>/index.json              every package (fallback)
  <out>/index-<arch>.json       per DSM arch (x86_64, armv8): what a static host should answer for ?arch=<arch>
  <out>/nginx-folevi-source.conf  an nginx snippet that picks the per-arch file from the query

Usage: generate-index.py --spks <dir with .spk> --base-url https://pkg.folevi.com/synology --out <dir>
       [--changelog "text"]

The .spk files must be uploaded next to the index under <base-url>/<file>.spk. The format follows the fields
SynoCommunity's and SSPKS's sources return; unverified against current DSM 7.2: test on a real NAS.
Optional package signing ("keyrings") is not used: DSM 7 dropped third-party package signature checks.
"""
import argparse, hashlib, json, os, sys, tarfile

def read_info(path):
    with tarfile.open(path, "r:") as t:
        raw = t.extractfile("INFO").read().decode("utf-8")
    info = {}
    for line in raw.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            info[k.strip()] = v.strip().strip('"')
    return info

def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spks", required=True)
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--changelog", default="")
    a = ap.parse_args()
    base = a.base_url.rstrip("/")
    os.makedirs(a.out, exist_ok=True)
    entries = []
    for fn in sorted(os.listdir(a.spks)):
        if not fn.endswith(".spk"):
            continue
        p = os.path.join(a.spks, fn)
        info = read_info(p)
        entries.append({
            "package": info["package"],
            "version": info["version"],
            "dname": info.get("displayname", info["package"]),
            "desc": info.get("description", ""),
            "price": 0,
            "download_count": 0,
            "recent_download_count": 0,
            "link": f"{base}/{fn}",
            "size": os.path.getsize(p),
            "md5": md5(p),
            "thumbnail": [f"{base}/icons/folevi-72.png", f"{base}/icons/folevi-256.png"],
            "thumbnail_retina": [f"{base}/icons/folevi-144.png", f"{base}/icons/folevi-512.png"],
            "snapshot": [],
            "qinst": False,
            "qstart": True,
            "qupgrade": True,
            "depsers": None,
            "deppkgs": None,
            "conflictpkgs": None,
            "start": True,
            "maintainer": info.get("maintainer", "Folevi"),
            "maintainer_url": info.get("maintainer_url", "https://folevi.com"),
            "distributor": info.get("distributor", "Folevi"),
            "distributor_url": info.get("distributor_url", "https://folevi.com"),
            "support_url": info.get("support_url", ""),
            "changelog": a.changelog,
            "thirdparty": True,
            "category": 0,
            "subcategory": 0,
            "type": 0,
            "silent_install": False,
            "silent_uninstall": False,
            "silent_upgrade": info.get("silent_upgrade") == "yes",
            "auto_upgrade_from": None,
            "beta": info.get("beta") == "yes",
            "os_min_ver": info.get("os_min_ver", ""),
            "_arch": info.get("arch", ""),
        })
    if not entries:
        sys.exit("no .spk files found")
    def dump(name, items):
        clean = [{k: v for k, v in e.items() if not k.startswith("_")} for e in items]
        with open(os.path.join(a.out, name), "w") as f:
            json.dump({"packages": clean, "keyrings": []}, f, indent=1)
    dump("index.json", entries)
    arches = sorted({x for e in entries for x in e["_arch"].split()})
    for arch in arches:
        dump(f"index-{arch}.json", [e for e in entries if arch in e["_arch"].split()])
    with open(os.path.join(a.out, "nginx-folevi-source.conf"), "w") as f:
        f.write("# Package Center sends ?arch=<platform or family>. Answer with the matching static index.\n")
        f.write("map $arg_arch $folevi_index {\n    default index.json;\n")
        for arch in arches:
            f.write(f"    {arch} index-{arch}.json;\n")
        # Platform names some models send instead of the family (partial list; extend as needed).
        for plat in ("apollolake", "geminilake", "denverton", "v1000", "r1000", "broadwellnk", "epyc7002"):
            if "x86_64" in arches:
                f.write(f"    {plat} index-x86_64.json;\n")
        for plat in ("rtd1296", "rtd1619b", "armada37xx"):
            if "armv8" in arches:
                f.write(f"    {plat} index-armv8.json;\n")
        f.write("}\nlocation = /synology/ { default_type application/json; try_files /synology/$folevi_index =404; }\n")
    print(f"wrote {len(entries)} package(s), arches: {', '.join(arches)}")

if __name__ == "__main__":
    main()
