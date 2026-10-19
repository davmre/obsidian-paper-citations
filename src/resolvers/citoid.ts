import { parseAuthor } from "../authors";
import { hostOf, httpJson } from "../http";
import type { Author, PaperMetadata, Recognized, Resolver } from "../types";

/**
 * The long-tail fallback, off by default.
 *
 * Citoid is Wikimedia's citation service, and behind it sits a Zotero
 * translation server with Zotero's several hundred hand-written site
 * translators. That is the real general-purpose answer for sites that publish
 * no machine-readable metadata of their own - but it means sending the URL you
 * pasted to a third party, which should be a deliberate choice rather than a
 * default. Hence `allowCitoid`.
 */
const ENDPOINT = "https://en.wikipedia.org/api/rest_v1/data/citation/mediawiki";

/** Citoid's "mediawiki" format. Fields are optional almost everywhere. */
interface CitoidEntry {
	title?: string;
	author?: string[][];
	date?: string;
	url?: string;
	DOI?: string;
	publicationTitle?: string;
	websiteTitle?: string;
	abstractNote?: string;
	itemType?: string;
}

/**
 * Citoid returns each author as a `[given, family]` pair, with either half
 * possibly empty - a handle arrives as `["", "Diffractor"]`.
 */
function citoidAuthors(pairs: string[][] | undefined): Author[] {
	return (pairs ?? [])
		.map(([given, family]) => {
			const g = (given ?? "").trim();
			const f = (family ?? "").trim();
			if (g && f) return { given: g, family: f };
			// Only one half present: let the shared parser decide how to split
			// it, so "Jane Q. Smith" in a single field still works.
			return parseAuthor(g || f);
		})
		.filter((a) => a.given || a.family);
}

export const citoidResolver: Resolver = {
	name: "citoid",

	recognize(text: string): Recognized | null {
		if (!/^https?:\/\/\S+$/i.test(text)) return null;
		try {
			const url = new URL(text);
			if (!url.hostname.includes(".")) return null;
			return { resolver: "citoid", url: text, key: `citoid:${text}` };
		} catch {
			return null;
		}
	},

	async resolve(hit: Recognized): Promise<PaperMetadata> {
		const entries = await httpJson<CitoidEntry[]>(
			`${ENDPOINT}/${encodeURIComponent(hit.url)}`,
		);

		const entry = Array.isArray(entries) ? entries[0] : undefined;
		if (!entry?.title) throw new Error("Citoid found no citation for that URL");

		return {
			title: entry.title,
			authors: citoidAuthors(entry.author),
			date: entry.date,
			url: entry.url ?? hit.url,
			doi: entry.DOI,
			venue: entry.publicationTitle ?? entry.websiteTitle,
			abstract: entry.abstractNote,
			site: hostOf(hit.url),
			source: "citoid",
		};
	},
};
