/** Compatibility readers for legacy and Basil-version Stripe webhook objects. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StripeObject = Record<string, any>;

function id(value: unknown): string | null {
	if (typeof value === 'string' && value) return value;
	if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string')
		return (value as { id: string }).id;
	return null;
}

export function invoiceSubscriptionId(invoice: StripeObject): string | null {
	return (
		id(invoice?.parent?.subscription_details?.subscription) ??
		id(invoice?.subscription) ??
		id(
			invoice?.lines?.data?.find(
				(line: StripeObject) => line?.parent?.subscription_item_details?.subscription
			)?.parent?.subscription_item_details?.subscription
		) ??
		id(invoice?.lines?.data?.find((line: StripeObject) => line?.subscription)?.subscription)
	);
}

export function invoiceSubscriptionMetadata(invoice: StripeObject): Record<string, unknown> {
	const candidates = [
		invoice?.parent?.subscription_details?.metadata,
		invoice?.subscription_details?.metadata,
		...(Array.isArray(invoice?.lines?.data)
			? invoice.lines.data.map((line: StripeObject) => line?.metadata)
			: [])
	];
	return (
		candidates.find((value) => value && typeof value === 'object' && !Array.isArray(value)) ?? {}
	);
}

export function invoiceServicePeriod(
	invoice: StripeObject
): { start: string; end: string | null } | null {
	const lines = Array.isArray(invoice?.lines?.data) ? invoice.lines.data : [];
	const line =
		lines.find((candidate: StripeObject) => {
			const details = candidate?.parent?.subscription_item_details;
			return candidate?.period?.start && candidate?.period?.end && details?.proration !== true;
		}) ??
		lines.find((candidate: StripeObject) => candidate?.period?.start && candidate?.period?.end);
	const start = Number(line?.period?.start ?? invoice?.period_start);
	const end = Number(line?.period?.end ?? invoice?.period_end);
	if (!Number.isFinite(start) || start <= 0) return null;
	return {
		start: new Date(start * 1000).toISOString(),
		end: Number.isFinite(end) && end > 0 ? new Date(end * 1000).toISOString() : null
	};
}

export function subscriptionServicePeriod(subscription: StripeObject): {
	start?: string;
	end?: string;
} {
	const item = Array.isArray(subscription?.items?.data) ? subscription.items.data[0] : null;
	const start = Number(item?.current_period_start ?? subscription?.current_period_start);
	const end = Number(item?.current_period_end ?? subscription?.current_period_end);
	return {
		...(Number.isFinite(start) && start > 0 ? { start: new Date(start * 1000).toISOString() } : {}),
		...(Number.isFinite(end) && end > 0 ? { end: new Date(end * 1000).toISOString() } : {})
	};
}
