/**
 * View-model shape every calendar surface (global /calendar page, persona
 * Calendar tab) maps its posts into. Deliberately loose on `status` so DB rows
 * and page-local unions both fit structurally.
 */
export interface CalendarPost {
	id: string;
	agentId: string;
	agentName: string;
	/** Raw post content (JSON-stringified or plain text) — rendered via getPostDisplay. */
	text: string;
	platforms: string[];
	/** YYYY-MM-DD placement date. Posts without one are not shown. */
	date: string;
	/** HH:MM */
	time: string;
	status: string;
	publication_results?: Record<string, any> | null;
	analytics?: { views: number; likes: number; comments: number; shares: number } | null;
}
