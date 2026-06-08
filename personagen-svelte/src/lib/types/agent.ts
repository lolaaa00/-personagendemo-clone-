// Re-export everything from canonical types
// This file exists for backward compatibility with dashboard components
export type { Agent } from '$lib/types';

/** Platform distribution entry */
export interface PlatformData {
	name: string;
	pct: number;
	color: string;
}

/** Spark chart data: engagement rates per day per agent */
export type SparkData = number[][];
