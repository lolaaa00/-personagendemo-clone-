/**
 * Minimal in-memory stand-in for the supabase-js query builder used by the
 * server modules under test. Records the full call chain of every query and
 * hands it to a per-test handler, so tests assert on the exact SQL-ish shape
 * (table, op, filters, payload) without any network or credentials.
 */

export type Op = 'select' | 'insert' | 'update' | 'delete';

export interface RecordedQuery {
	table: string;
	op: Op;
	/** Payload passed to insert()/update(). */
	payload?: any;
	/** Every chained filter/modifier, in call order: ['eq', 'status', 'scheduled'] */
	chain: any[][];
	/** Terminal modifier, if any: 'maybeSingle' | 'single'. */
	terminal?: string;
	/** Convenience: value of the first .eq() on `col`. */
	eqOf(col: string): any;
	/** Convenience: was `method` called with `col` (and optionally `val`)? */
	has(method: string, col?: string, val?: any): boolean;
}

export interface QueryResult {
	data?: any;
	error?: any;
}

export type Handler = (q: RecordedQuery) => QueryResult | undefined;

/** Deep copy of a write payload, mirroring the real client's serialise-on-call. */
function snapshot<T>(payload: T): T {
	if (payload === null || typeof payload !== 'object') return payload;
	return JSON.parse(JSON.stringify(payload));
}

class Builder implements PromiseLike<QueryResult> {
	table: string;
	op: Op = 'select';
	payload: any;
	chain: any[][] = [];
	terminal?: string;

	constructor(
		table: string,
		private handler: Handler,
		private log: RecordedQuery[]
	) {
		this.table = table;
	}

	eqOf(col: string) {
		return this.chain.find((c) => c[0] === 'eq' && c[1] === col)?.[2];
	}

	has(method: string, col?: string, val?: any) {
		return this.chain.some(
			(c) =>
				c[0] === method &&
				(col === undefined || c[1] === col) &&
				(val === undefined || JSON.stringify(c[2]) === JSON.stringify(val))
		);
	}

	// -- ops -----------------------------------------------------------------
	select(...args: any[]) {
		if (this.op === 'select') this.chain.push(['select', ...args]);
		else this.chain.push(['select', ...args]); // e.g. update().select('id')
		return this;
	}
	insert(payload: any) {
		this.op = 'insert';
		this.payload = snapshot(payload);
		return this;
	}
	update(payload: any) {
		this.op = 'update';
		// Snapshot: the real client serialises the payload at call time, while the
		// server code keeps mutating the same publication_results object afterwards.
		// Holding the live reference would make assertions see the FINAL state of an
		// EARLIER query.
		this.payload = snapshot(payload);
		return this;
	}
	delete() {
		this.op = 'delete';
		return this;
	}

	// -- filters -------------------------------------------------------------
	eq(col: string, val: any) {
		this.chain.push(['eq', col, val]);
		return this;
	}
	neq(col: string, val: any) {
		this.chain.push(['neq', col, val]);
		return this;
	}
	gte(col: string, val: any) {
		this.chain.push(['gte', col, val]);
		return this;
	}
	lte(col: string, val: any) {
		this.chain.push(['lte', col, val]);
		return this;
	}
	lt(col: string, val: any) {
		this.chain.push(['lt', col, val]);
		return this;
	}
	in(col: string, vals: any[]) {
		this.chain.push(['in', col, vals]);
		return this;
	}
	not(col: string, op: string, val: any) {
		this.chain.push(['not', col, op, val]);
		return this;
	}
	order(col: string, opts?: any) {
		this.chain.push(['order', col, opts]);
		return this;
	}
	limit(n: number) {
		this.chain.push(['limit', n]);
		return this;
	}

	// -- terminals -----------------------------------------------------------
	private resolve(): QueryResult {
		this.log.push(this as unknown as RecordedQuery);
		const res = this.handler(this as unknown as RecordedQuery);
		return res ?? { data: [], error: null };
	}

	maybeSingle() {
		this.terminal = 'maybeSingle';
		return Promise.resolve(this.resolve());
	}
	single() {
		this.terminal = 'single';
		return Promise.resolve(this.resolve());
	}
	then<R1 = QueryResult, R2 = never>(
		onfulfilled?: ((v: QueryResult) => R1 | PromiseLike<R1>) | null,
		onrejected?: ((r: any) => R2 | PromiseLike<R2>) | null
	): PromiseLike<R1 | R2> {
		return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
	}
}

export interface MockSupabase {
	from(table: string): any;
	/** Every query that was awaited, in order. */
	queries: RecordedQuery[];
	/** Queries for one table (optionally one op). */
	of(table: string, op?: Op): RecordedQuery[];
}

export function createMockSupabase(handler: Handler): MockSupabase {
	const queries: RecordedQuery[] = [];
	return {
		from: (table: string) => new Builder(table, handler, queries),
		queries,
		of: (table: string, op?: Op) =>
			queries.filter((q) => q.table === table && (op === undefined || q.op === op))
	};
}
