"""Shadow-tree v2: full corpus mirror so imports resolve like the real tree.

- Every manifest file copied verbatim, except .svelte files which become:
  (a) an empty placeholder at the same .svelte path (so './X.svelte' probes hit), and
  (b) a blanked shadow .ts holding only <script> bodies at original line offsets.
- .svelte-kit/tsconfig.json copied too so $lib alias resolution works.
"""
import json
import re
import shutil
from pathlib import Path

from graphify.extract import extract

ROOT = Path(r"c:\Users\nexal\personagendemo")
SCRATCH = Path(r"C:\Users\nexal\AppData\Local\Temp\claude\c--Users-nexal-personagendemo\a660d3a1-71fe-479b-af2e-851c4b72b1c9\scratchpad")
SHADOW = SCRATCH / "svelte-shadow-v2"
if SHADOW.exists():
    shutil.rmtree(SHADOW)

manifest = json.loads((ROOT / "graphify-out/manifest.json").read_text(encoding="utf-8"))
script_re = re.compile(r"<script\b[^>]*>([\s\S]*?)</script\s*>", re.IGNORECASE)

pairs = []  # (shadow_rel_ts, orig_rel_svelte)
copied = 0
for rel in manifest:
    p = Path(rel)
    if p.is_absolute():
        try:
            rel = p.relative_to(ROOT).as_posix()
        except ValueError:
            continue  # outside the project root
    src_path = ROOT / rel
    if not src_path.exists():
        continue
    dst = SHADOW / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    if rel.endswith(".svelte"):
        dst.write_text("", encoding="utf-8")  # placeholder for import probes
        src = src_path.read_text(encoding="utf-8", errors="replace")
        lines = src.split("\n")
        keep = [""] * len(lines)
        for m in script_re.finditer(src):
            body = m.group(1)
            start_line = src[: m.start(1)].count("\n")
            for i, bl in enumerate(body.split("\n")):
                if start_line + i < len(keep):
                    keep[start_line + i] = bl
        shadow_rel = rel[: -len(".svelte")] + ".ts"
        (SHADOW / shadow_rel).write_text("\n".join(keep), encoding="utf-8")
        pairs.append((shadow_rel, rel))
    else:
        shutil.copyfile(src_path, dst)
        copied += 1

# alias resolution support (not in manifest)
sk = ROOT / "personagen-svelte/.svelte-kit/tsconfig.json"
if sk.exists():
    dst = SHADOW / "personagen-svelte/.svelte-kit/tsconfig.json"
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(sk, dst)

# manifest can list one file under two path styles — dedup
pairs = list(dict.fromkeys(pairs))
print(f"mirror: {copied} files copied, {len(pairs)} svelte shadows")

shadow_paths = [SHADOW / s for s, _ in pairs]
result = extract(shadow_paths, cache_root=SHADOW, root=SHADOW, parallel=False)

remap = {s.replace("\\", "/"): o.replace("\\", "/") for s, o in pairs}


def fix(p):
    if not isinstance(p, str):
        return p
    return remap.get(p.replace("\\", "/"), p)


fixed_labels = 0
for n in result["nodes"]:
    if "source_file" in n:
        n["source_file"] = fix(n["source_file"])
        sf = str(n["source_file"])
        lbl = n.get("label", "")
        if sf.endswith(".svelte") and isinstance(lbl, str) and lbl.endswith(".ts"):
            base = sf.replace("\\", "/").rsplit("/", 1)[-1]
            if lbl[:-3] == base[: -len(".svelte")]:
                n["label"] = base
                fixed_labels += 1
for e in result["edges"]:
    for k in ("source_file", "target_file"):
        if k in e:
            e[k] = fix(e[k])

out = {
    "nodes": result["nodes"],
    "edges": result["edges"],
    "hyperedges": [],
    "input_tokens": 0,
    "output_tokens": 0,
}
(ROOT / "graphify-out/.graphify_shadow_extract.json").write_text(
    json.dumps(out, ensure_ascii=False), encoding="utf-8"
)
print(f"shadow extraction: {len(result['nodes'])} nodes, {len(result['edges'])} edges, labels fixed: {fixed_labels}")

# resolution quality check: how many import edges carry a resolved target_file?
imp = [e for e in result["edges"] if e.get("type") in ("imports_from", "dynamic_import", "imports")]
resolved = [e for e in imp if e.get("target_file")]
print(f"import edges: {len(imp)}, resolved to real files: {len(resolved)}")
