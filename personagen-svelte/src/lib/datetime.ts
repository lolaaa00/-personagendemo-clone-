/**
 * One date/time convention for every surface that shows a post's slot.
 *
 * A client audit (UI-005) and its re-audit found three forms for the same
 * post: the calendar chip printed raw 24-hour "14:00" even in en-US, the
 * Review Queue printed "2:00 PM", and the post drawer a third "Sep 21, 07:10
 * AM" — and screen-reader labels kept US order under en-GB.
 *
 * The locale is the one the portal already resolves on the SERVER for money
 * (Accept-Language → pricing context), so a date renders identically in the
 * server HTML and after hydration, and in the same convention as the prices
 * beside it. Slots are wall-clock times: parsed as local and printed back as
 * local, so the time shown is exactly the time stored.
 *
 * Client- and server-safe.
 */
import { pricingContext } from '$lib/stores/pricing.svelte';

function locale(): string | undefined {
	return pricingContext().locale ?? undefined;
}

/**
 * The viewer's zone for INSTANTS only. A slot is a wall-clock time and is
 * deliberately printed zone-free; an instant (created_at, a ledger row) is a
 * moment, and must print the same moment on the server and after hydration.
 */
function zone(): string | undefined {
	return pricingContext().timeZone ?? undefined;
}

/** A stored slot ("2026-09-22", "14:00:00") as a Date, or null. */
export function slotDate(date: string | null | undefined, time?: string | null): Date | null {
	if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
	const hhmm = /^\d{2}:\d{2}/.test(time ?? '') ? String(time).slice(0, 5) : '00:00';
	const d = new Date(`${date.slice(0, 10)}T${hhmm}:00`);
	return Number.isNaN(d.getTime()) ? null : d;
}

/** "2:00 PM" (en-US) / "14:00" (en-GB). Falls back to the raw HH:MM. */
export function slotTime(date: string | null | undefined, time: string | null | undefined): string {
	const d = slotDate(date ?? '2000-01-01', time);
	if (!d || !time) return time ? String(time).slice(0, 5) : '';
	return d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
}

/** "Tue 22 Sept, 14:00" / "Tue, Sep 22, 2:00 PM" — the Review Queue's form. */
export function slotDateTime(date: string | null | undefined, time: string | null | undefined): string {
	const d = slotDate(date, time);
	if (!d) return date ? `${date}${time ? ` · ${String(time).slice(0, 5)}` : ''}` : 'Unscheduled';
	return d.toLocaleString(locale(), {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		...(time ? { hour: 'numeric', minute: '2-digit' } : {})
	});
}

/** An instant (ISO string) in the same form. */
export function instantDateTime(iso: string | null | undefined): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleString(locale(), {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZone: zone()
	});
}

/** An instant as "Sep 9, 9:15 PM" — the Billing / Admin ledger form. */
export function instantShort(iso: string | null | undefined): string {
	if (!iso) return '—';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '—';
	return d.toLocaleString(locale(), {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZone: zone()
	});
}

/** A calendar date in the viewer's order, with any Intl options. */
export function localDate(d: Date, opts: Intl.DateTimeFormatOptions): string {
	return d.toLocaleDateString(locale(), opts);
}
