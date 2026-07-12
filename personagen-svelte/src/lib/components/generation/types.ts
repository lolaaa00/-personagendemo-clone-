/** Describes one confirm-before-generate flow for the GenerationComposer. */
export interface ComposerSpec {
	/** Endpoint that supports BOTH `preview: true` and a real generate call. */
	endpoint: string;
	/** Fields always sent, e.g. `{ stage: 'side_profiles' }`. */
	baseBody?: Record<string, unknown>;
	title: string;
	subtitle?: string;
	/** Confirm button label, e.g. "Generate post". */
	confirmLabel?: string;
}
