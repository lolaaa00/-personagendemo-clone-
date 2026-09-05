/**
 * Graceful shutdown registry.
 *
 * The container runs `node build/index.js` as PID 1; EasyPanel redeploys with
 * SIGTERM and a 10 s grace period. Without a handler Node exits immediately,
 * which is fine for a request/response server but loses anything buffered in
 * memory (the activity-event queue) and drops the scheduler mid-tick. Modules
 * that hold in-memory state register a flusher here; on the first signal we
 * run every flusher with a hard budget and then exit. A second signal exits
 * at once (operator escape hatch).
 *
 * Money is never buffered — credit debits are synchronous DB calls — so this
 * only protects observability and tidy scheduler exit (durable plan, D8).
 */

type Flusher = () => Promise<void> | void;

const flushers: { name: string; fn: Flusher }[] = [];
let installed = false;
let shuttingDown = false;

const SHUTDOWN_BUDGET_MS = 5_000;

export function onShutdown(name: string, fn: Flusher): void {
	flushers.push({ name, fn });
}

export function isShuttingDown(): boolean {
	return shuttingDown;
}

/** Runs every registered flusher (each bounded), in registration order. Exported for tests. */
export async function runShutdown(reason: string): Promise<{ ok: string[]; failed: string[] }> {
	const ok: string[] = [];
	const failed: string[] = [];
	const deadline = Date.now() + SHUTDOWN_BUDGET_MS;
	for (const { name, fn } of flushers) {
		const remaining = Math.max(0, deadline - Date.now());
		try {
			await Promise.race([
				Promise.resolve(fn()),
				new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), remaining))
			]);
			ok.push(name);
		} catch (e) {
			failed.push(`${name}: ${(e as Error).message}`);
		}
	}
	console.log(`[lifecycle] ${reason}: flushed ${ok.length}/${flushers.length} (${ok.join(', ') || 'none'})${failed.length ? ` — FAILED ${failed.join('; ')}` : ''}`);
	return { ok, failed };
}

/** Idempotent. Call once at server boot (hooks.server.ts). */
export function installLifecycle(): void {
	if (installed) return;
	installed = true;
	const handler = (signal: NodeJS.Signals) => {
		if (shuttingDown) {
			console.warn(`[lifecycle] second ${signal} — exiting immediately`);
			process.exit(130);
		}
		shuttingDown = true;
		runShutdown(signal)
			.catch((e) => console.error('[lifecycle] shutdown error:', e))
			.finally(() => process.exit(0));
	};
	process.on('SIGTERM', handler);
	process.on('SIGINT', handler);
}

/** Test-only: forget every registered flusher. */
export function _resetLifecycleForTests(): void {
	flushers.length = 0;
	shuttingDown = false;
}
