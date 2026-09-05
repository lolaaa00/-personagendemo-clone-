import type { SupabaseClient, Session, User } from '@supabase/supabase-js';

declare global {
	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}
		interface Locals {
			supabase: SupabaseClient;
			safeGetSession: () => Promise<{ session: Session | null; user: User | null }>;
			/** Per-request id (also sent as X-Request-Id) — ties activity rows of one request together. */
			requestId?: string;
			/** Reduced, PII-free client context for the activity log (hooks.server.ts). */
			activityContext?: import('$lib/server/activity').RequestContext | null;
			activitySessionHash?: string | null;
		}
	}
}

export {};
