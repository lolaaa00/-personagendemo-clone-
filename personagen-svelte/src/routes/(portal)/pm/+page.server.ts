import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
	const res = await fetch('/data/agents.json');
	const agents = await res.json();
	return { agents };
};
