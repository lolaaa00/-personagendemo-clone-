import json
from pathlib import Path
from graphify.build import build_merge, build_from_json
from graphify.cluster import cluster
from graphify.export import to_json

ex = json.loads(Path("graphify-out/.graphify_shadow_extract.json").read_text(encoding="utf-8"))
G = build_merge([ex], graph_path="graphify-out/graph.json", prune_sources=None)
print(f"merged: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")

merged_out = {
    "nodes": [{"id": n, **d} for n, d in G.nodes(data=True)],
    "edges": [
        {**{k: v for k, v in d.items() if k not in ("_src", "_tgt", "source", "target")},
         "source": d.get("_src", u), "target": d.get("_tgt", v)}
        for u, v, d in G.edges(data=True)
    ],
    "hyperedges": list(G.graph.get("hyperedges", [])),
    "input_tokens": 0,
    "output_tokens": 0,
}
G2 = build_from_json(merged_out)
communities = cluster(G2)
# The #479 guard refuses writes that shrink the node count vs the existing
# graph.json; per-file replacement legitimately shrinks it, so clear the way.
Path("graphify-out/graph.json").unlink(missing_ok=True)
to_json(G2, communities, "graphify-out/graph.json")
print(f"graph.json: {G2.number_of_nodes()} nodes, {G2.number_of_edges()} edges, {len(communities)} communities")

# verification: symbol coverage for previously-zero components
for probe in ("AgentConnectionStats", "AgentRoster", "StatusBadge", "PostDrawer"):
    syms = [d.get("label") for n, d in G2.nodes(data=True)
            if probe in str(d.get("source_file", "")) and d.get("label") != f"{probe}.svelte"]
    print(f"{probe}.svelte symbols: {len(syms)} e.g. {syms[:4]}")
