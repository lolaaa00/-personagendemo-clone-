/**
 * Live docs demos — miniatures of the real UI a reader can click, embedded in
 * a guide step in place of (or next to) a screenshot. A guide step names one
 * by id (`demo: 'format-explorer'`) and the Docs page renders it inline.
 *
 * Add a demo: one component here, one id in DEMO_IDS. The explorer-style demos
 * read the same catalogs the app runs on (FORMAT_CATALOG, pricing), so they
 * cannot say something the product does not do.
 */
import FormatExplorer from './FormatExplorer.svelte';
import KeyRoutingDemo from './KeyRoutingDemo.svelte';
import SidebarMap from './SidebarMap.svelte';
import PostLifecycle from './PostLifecycle.svelte';

export { default as ShotFigure } from './ShotFigure.svelte';
export { default as DocsDemo } from './DocsDemo.svelte';

export const DEMOS = {
	'format-explorer': FormatExplorer,
	'key-routing': KeyRoutingDemo,
	'sidebar-map': SidebarMap,
	'post-lifecycle': PostLifecycle
} as const;

export type DemoId = keyof typeof DEMOS;
