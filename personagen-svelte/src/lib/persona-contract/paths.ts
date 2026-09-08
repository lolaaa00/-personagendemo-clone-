/**
 * Persona Model v2 — tiny dotted-path helpers shared by upgrade.ts and store.ts.
 * A leaf module so those two never import each other. No lodash; paths are
 * shallow and known.
 */
export type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** '' / [] / {} — the three shapes that mean "clear" in a patch. */
export const isEmptyValue = (v: unknown): boolean =>
	v === '' || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0);

export function getPath(root: Obj, path: string): unknown {
	let cur: unknown = root;
	for (const seg of path.split('.')) {
		if (!isObj(cur)) return undefined;
		cur = cur[seg];
	}
	return cur;
}

export function setPath(root: Obj, path: string, value: unknown): void {
	const segs = path.split('.');
	let cur: Obj = root;
	for (const seg of segs.slice(0, -1)) {
		if (!isObj(cur[seg])) cur[seg] = {};
		cur = cur[seg] as Obj;
	}
	cur[segs[segs.length - 1]] = value;
}

export function deletePath(root: Obj, path: string): void {
	const segs = path.split('.');
	let cur: unknown = root;
	for (const seg of segs.slice(0, -1)) {
		if (!isObj(cur)) return;
		cur = cur[seg];
	}
	if (isObj(cur)) delete cur[segs[segs.length - 1]];
}

/** Every leaf path (dotted) of a nested plain object; arrays and non-objects are leaves. */
export function leafPaths(value: unknown, prefix = ''): string[] {
	if (!isObj(value)) return prefix ? [prefix] : [];
	const out: string[] = [];
	for (const [k, v] of Object.entries(value)) {
		const p = prefix ? `${prefix}.${k}` : k;
		if (isObj(v) && Object.keys(v).length) out.push(...leafPaths(v, p));
		else out.push(p);
	}
	return out;
}

/** Removes empty nested objects bottom-up (leaves '' and [] alone). */
export function pruneEmptyObjects(value: Obj): void {
	for (const [k, v] of Object.entries(value)) {
		if (isObj(v)) {
			pruneEmptyObjects(v);
			if (Object.keys(v).length === 0) delete value[k];
		}
	}
}

/**
 * STORED-mode normalisation: a record at rest carries no clear markers. Drops
 * every '' / [] / {} leaf under the given top-level sections, then prunes the
 * emptied containers, and removes the matching provenance entries.
 */
export function stripEmptyLeaves(root: Obj, sections: readonly string[], sources?: Record<string, unknown>): void {
	for (const section of sections) {
		const sub = root[section];
		if (!isObj(sub)) {
			if (isEmptyValue(sub)) delete root[section];
			continue;
		}
		for (const leaf of leafPaths(sub, section)) {
			if (isEmptyValue(getPath(root, leaf))) {
				deletePath(root, leaf);
				if (sources) delete sources[leaf];
			}
		}
		pruneEmptyObjects(sub);
		if (Object.keys(sub).length === 0) delete root[section];
	}
}
