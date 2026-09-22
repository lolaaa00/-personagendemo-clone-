/**
 * What the connection check does to a persona's status.
 *
 * It used to pause ANY persona with no active connection, on every page
 * view (accounts API → check_status). A persona the user had just switched
 * on went back to Paused the next time its page loaded — the Active switch
 * could not hold — and a round-2 re-audit watched personas change state with
 * no action of their own.
 *
 * The rule it was protecting is real: a persona that LOSES its accounts
 * should stop generating for platforms it can no longer reach. So only that
 * transition pauses — it had connections at the last check and has none now.
 * A persona that never had one keeps whatever the user set. First connection
 * still wakes a pending persona, as before.
 */
export type AgentStatus = 'active' | 'paused' | 'pending';

export function statusAfterConnectionCheck(
	current: AgentStatus,
	previousConnectionCount: number | null | undefined,
	activeConnections: number
): AgentStatus {
	const had = Number(previousConnectionCount ?? 0) > 0;
	if (activeConnections === 0) return had && current === 'active' ? 'paused' : current;
	return current === 'paused' ? current : 'active';
}
