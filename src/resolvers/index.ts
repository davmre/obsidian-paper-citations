import { createArxivResolver } from "./arxiv";
import { citoidResolver } from "./citoid";
import { createCrossrefResolver } from "./crossref";
import { forumMagnumResolver } from "./forummagnum";
import { htmlResolver } from "./html";
import { openReviewResolver } from "./openreview";
import type {
	FetchContext,
	PaperCitationsSettings,
	PaperMetadata,
	Recognized,
	Resolver,
} from "../types";

/**
 * Build the resolver chain, most specific first.
 *
 * Order is the whole design. The site resolvers know exactly where the
 * authoritative metadata lives for their source, so they get first refusal.
 * The DOI tier handles anything with a registry record. Only then does the
 * generic HTML scraper run, since it claims *any* URL - and Citoid last,
 * because it involves a third party.
 */
export function buildResolvers(settings: PaperCitationsSettings): Resolver[] {
	const all: Resolver[] = [
		createArxivResolver(settings.recognizeBareIds),
		forumMagnumResolver,
		openReviewResolver,
		createCrossrefResolver(settings.recognizeBareIds),
		htmlResolver,
		citoidResolver,
	];

	return all.filter((resolver) => {
		if (resolver.name === "citoid") return settings.allowCitoid;
		// Default to enabled: a resolver added in a later version shouldn't
		// stay silent just because old settings don't mention it.
		return settings.enabledResolvers[resolver.name] !== false;
	});
}

/** Resolver names in chain order, for building the settings toggles. */
export const RESOLVER_NAMES = [
	"arxiv",
	"forummagnum",
	"openreview",
	"doi",
	"html",
] as const;

export const RESOLVER_LABELS: Record<string, string> = {
	arxiv: "arXiv",
	forummagnum: "LessWrong / Alignment Forum / EA Forum",
	openreview: "OpenReview",
	doi: "DOI (Crossref, DataCite, OpenAlex)",
	html: "Any other page (citation_* tags, JSON-LD, OpenGraph)",
	citoid: "Citoid fallback (sends the URL to Wikimedia)",
};

/**
 * Text that looks like a link we could convert, before any network call.
 *
 * `html` and `citoid` both claim any URL, so this answers "is this a link at
 * all" rather than "is this a paper". The paste handler uses it to decide
 * whether to intercept.
 */
export function recognize(text: string, resolvers: Resolver[]): Recognized | null {
	const trimmed = text.trim();
	if (!trimmed || /\s/.test(trimmed)) return null;

	for (const resolver of resolvers) {
		const hit = resolver.recognize(trimmed);
		if (hit) return hit;
	}
	return null;
}

/** True when a resolver other than the catch-all tiers claims the text. */
export function isSpecificLink(text: string, resolvers: Resolver[]): boolean {
	const hit = recognize(text, resolvers);
	return hit !== null && hit.resolver !== "html" && hit.resolver !== "citoid";
}

/**
 * Resolve recognized text to metadata, walking down the chain on failure.
 *
 * Falling through matters in practice: a DOI that Crossref has never heard of
 * can still be scraped from the publisher's page, and an arXiv outage
 * shouldn't stop an arXiv link from becoming a citation via its meta tags. The
 * collected errors are reported together if every tier fails.
 */
export async function resolveText(
	text: string,
	resolvers: Resolver[],
	ctx: FetchContext,
): Promise<PaperMetadata> {
	const trimmed = text.trim();
	const attempted: string[] = [];
	const failures: string[] = [];

	for (const resolver of resolvers) {
		const hit = resolver.recognize(trimmed);
		if (!hit) continue;

		attempted.push(resolver.name);
		try {
			const meta = await resolver.resolve(hit, ctx);
			if (meta.title.trim()) return meta;
			failures.push(`${resolver.name}: no title`);
		} catch (error) {
			failures.push(`${resolver.name}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	if (attempted.length === 0) throw new Error("that doesn't look like a link I can cite");
	throw new Error(failures.join("; "));
}
