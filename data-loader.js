// ═══════════════════════════════════════
// DATA LOADER — Unified fetch layer
// ═══════════════════════════════════════
// RULE: All data flows through response.json() — never JSON.stringify input,
// never double-parse. This prevents the serialization divergence landmine.

const DATA = {};

async function loadData() {
    const files = {
        agents:    'data/agents.json',
        trends:    'data/trends.json',
        templates: 'data/templates.json',
        platforms: 'data/platforms.json',
        scouts:    'data/scouts.json'
    };

    const entries = Object.entries(files);
    const results = await Promise.allSettled(
        entries.map(([key, path]) =>
            fetch(path).then(r => {
                if (!r.ok) throw new Error(`${path}: ${r.status}`);
                return r.json(); // Always .json() — never stringify
            })
        )
    );

    results.forEach((result, i) => {
        const [key] = entries[i];
        if (result.status === 'fulfilled') {
            DATA[key] = result.value;
        } else {
            console.warn(`[PersonaGen] Failed to load ${key}:`, result.reason);
            DATA[key] = null;
        }
    });

    return DATA;
}
