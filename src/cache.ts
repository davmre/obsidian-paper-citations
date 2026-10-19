import type { PaperMetadata } from "./types";

interface CacheEntry {
	fetchedAt: number;
	meta: PaperMetadata;
}

/** Drop the oldest entries past this, so plugin data stays small. */
const MAX_ENTRIES = 500;

/**
 * A persisted metadata cache, keyed by the resolver's cache key.
 *
 * Worth having for three reasons: arXiv's API manual explicitly asks callers
 * to cache rather than re-request, Crossref's polite pool is a shared
 * resource, and re-pasting a link you already cited should be instant instead
 * of a round trip.
 */
export class MetadataCache {
	private entries: Record<string, CacheEntry>;

	constructor(
		entries: Record<string, CacheEntry> | undefined,
		private ttlDays: number,
		private save: (entries: Record<string, CacheEntry>) => void,
	) {
		this.entries = entries ?? {};
	}

	get(key: string): PaperMetadata | null {
		const entry = this.entries[key];
		if (!entry) return null;

		if (this.ttlDays > 0) {
			const ageDays = (Date.now() - entry.fetchedAt) / 86_400_000;
			if (ageDays > this.ttlDays) {
				delete this.entries[key];
				return null;
			}
		}
		return entry.meta;
	}

	set(key: string, meta: PaperMetadata): void {
		this.entries[key] = { fetchedAt: Date.now(), meta };
		this.evict();
		this.save(this.entries);
	}

	clear(): void {
		this.entries = {};
		this.save(this.entries);
	}

	get size(): number {
		return Object.keys(this.entries).length;
	}

	setTtl(days: number): void {
		this.ttlDays = days;
	}

	private evict(): void {
		const keys = Object.keys(this.entries);
		if (keys.length <= MAX_ENTRIES) return;

		keys
			.sort((a, b) => this.entries[a].fetchedAt - this.entries[b].fetchedAt)
			.slice(0, keys.length - MAX_ENTRIES)
			.forEach((key) => delete this.entries[key]);
	}
}
