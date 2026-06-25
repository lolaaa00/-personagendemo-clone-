import { redirect } from '@sveltejs/kit';

export const load: any = () => {
	throw redirect(307, '/brand-brief?tab=intel');
};
