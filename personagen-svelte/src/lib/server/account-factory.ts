import { env } from '$env/dynamic/private';

type FactoryPayload = Record<string, unknown>;

export class AccountFactoryClient {
	private readonly baseUrl: string;
	private readonly apiKey: string;

	constructor() {
		this.baseUrl = (env.FACTORY_URL || '').replace(/\/$/, '');
		this.apiKey = env.FACTORY_API_KEY || '';
	}

	private assertConfigured() {
		if (!this.baseUrl || !this.apiKey) {
			throw new Error('Account factory is not configured. Set FACTORY_URL and FACTORY_API_KEY.');
		}
	}

	private async request(path: string, init: RequestInit = {}) {
		this.assertConfigured();
		const headers = new Headers(init.headers);
		headers.set('Content-Type', 'application/json');
		headers.set('Authorization', `Bearer ${this.apiKey}`);

		const res = await fetch(`${this.baseUrl}${path}`, {
			...init,
			headers
		});

		let data: unknown = null;
		try {
			data = await res.json();
		} catch {
			// Keep null body for non-JSON errors.
		}

		if (!res.ok) {
			const message =
				data && typeof data === 'object' && 'error' in data
					? String((data as { error: unknown }).error)
					: `Account factory request failed with HTTP ${res.status}`;
			throw new Error(message);
		}

		return data;
	}

	createAccount(payload: FactoryPayload) {
		return this.request('/api/accounts/create', {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	getStatus(accountId: string) {
		return this.request(`/api/accounts/${encodeURIComponent(accountId)}/status`);
	}

	listAccounts() {
		return this.request('/api/accounts');
	}

	retry(accountId: string, fromStep?: string) {
		return this.request(`/api/accounts/${encodeURIComponent(accountId)}/retry`, {
			method: 'POST',
			body: JSON.stringify(fromStep ? { fromStep } : {})
		});
	}

	refreshSession(accountId: string) {
		return this.request(`/api/accounts/${encodeURIComponent(accountId)}/refresh`, {
			method: 'POST',
			body: JSON.stringify({})
		});
	}

	healthCheck(accountId: string) {
		return this.request(`/api/accounts/${encodeURIComponent(accountId)}/health`);
	}
}
