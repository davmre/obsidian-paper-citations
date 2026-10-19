import { fullName, parseAuthor } from "../authors";
import { hostOf, httpText, parseDocument } from "../http";
import { cleanDoi, resolveDoi } from "./crossref";
import type { Author, FetchContext, PaperMetadata, Recognized, Resolver } from "../types";

/**
 * The generic tier, and the reason this plugin doesn't need an integration per
 * site. Four embedded-metadata conventions are tried in descending order of
 * trustworthiness:
 *
 *  1. Highwire Press (`citation_title`, `citation_author`, ...) - the academic
 *     web's de facto standard. Verified present on arXiv, ACL Anthology,
 *     LessWrong, the Alignment Forum, and most journal publishers.
 *  2. Dublin Core (`DC.title`, `DC.creator`) - older, still common on
 *     institutional repositories.
 *  3. schema.org JSON-LD - what most modern blogs and news sites emit.
 *  4. OpenGraph - nearly universal, but only reliably carries a title.
 *
 * Whatever is found, if the page also advertises a DOI we hand off to the
 * registry and let structured data win; scraped tags only fill the gaps.
 */
const HIGHWIRE = {
	title: "citation_title",
	author: "citation_author",
	authorList: "citation_authors",
	date: ["citation_publication_date", "citation_date", "citation_online_date"],
	doi: "citation_doi",
	// Only the text tag. `citation_abstract_html_url` is a link to the
	// abstract page, not the abstract itself.
	abstract: "citation_abstract",
	pdf: "citation_pdf_url",
	venue: [
		"citation_journal_title",
		"citation_conference_title",
		"citation_inbook_title",
		"citation_technical_report_institution",
	],
};

/** Separators a site might use before appending its own name to a title. */
const TITLE_SEPARATORS = ["—", "–", "-", "|", "·", ":"];

/**
 * Titles that mean "you did not reach the document".
 *
 * Bot challenges and error pages are served with HTTP 200 and a perfectly
 * well-formed `<title>`, so without this check a Cloudflare interstitial
 * becomes a citation reading "Just a moment..." - which looks like a real
 * result and is far worse than a reported failure. Only consulted when the
 * page offered no real metadata, so a document genuinely titled "Access
 * Denied" is still citable from its `citation_*` tags.
 */
const INTERSTITIAL_TITLES = [
	/^just a moment/i,
	/verif(y|ying) (you|your browser)/i,
	/checking your browser/i,
	/are you a (robot|human)/i,
	/attention required/i,
	/access denied/i,
	/security check/i,
	/captcha/i,
	/enable javascript/i,
	/challenge/i,
	/^(4\d\d|5\d\d)\b/,
	/^(page )?not found/i,
	/^forbidden/i,
	/^error\b/i,
];

function looksLikeInterstitial(title: string): boolean {
	return INTERSTITIAL_TITLES.some((pattern) => pattern.test(title.trim()));
}

/**
 * Read `<meta name=... content=...>`, also accepting `property=`.
 *
 * Case-insensitive and attribute-order independent: ACL Anthology writes
 * `<meta content="..." name="citation_title">` while arXiv writes them the
 * other way round, and a selector-based lookup doesn't care.
 */
function metaContents(doc: Document, name: string): string[] {
	const escaped = name.replace(/"/g, '\\"');
	const nodes = doc.querySelectorAll(`meta[name="${escaped}" i], meta[property="${escaped}" i]`);
	return Array.from(nodes)
		.map((el) => el.getAttribute("content")?.trim() ?? "")
		.filter(Boolean);
}

function firstMeta(doc: Document, names: string | string[]): string | undefined {
	for (const name of Array.isArray(names) ? names : [names]) {
		const value = metaContents(doc, name)[0];
		if (value) return value;
	}
	return undefined;
}

/** schema.org `author` is a string, an object, or an array of either. */
function jsonLdAuthors(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(jsonLdAuthors);
	if (value && typeof value === "object") {
		const name = (value as { name?: unknown }).name;
		if (typeof name === "string") return [name];
	}
	return [];
}

const ARTICLE_TYPES = new Set([
	"article",
	"scholarlyarticle",
	"newsarticle",
	"blogposting",
	"techarticle",
	"report",
	"webpage",
	"creativework",
]);

interface JsonLdArticle {
	headline?: string;
	name?: string;
	author?: unknown;
	datePublished?: string;
	dateCreated?: string;
	publisher?: { name?: string } | string;
}

/**
 * Pull the first article-shaped node out of the page's JSON-LD, looking inside
 * `@graph` since many content systems nest everything under one.
 */
function readJsonLd(doc: Document): JsonLdArticle | undefined {
	const scripts = doc.querySelectorAll('script[type="application/ld+json"]');

	for (const script of Array.from(scripts)) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(script.textContent ?? "");
		} catch {
			// Hand-rolled JSON-LD is often malformed; skip and keep looking.
			continue;
		}

		const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
		const candidates: unknown[] = [];
		while (queue.length) {
			const node = queue.shift();
			if (!node || typeof node !== "object") continue;
			const graph = (node as { "@graph"?: unknown })["@graph"];
			if (Array.isArray(graph)) queue.push(...graph);
			candidates.push(node);
		}

		for (const node of candidates) {
			const rawType = (node as { "@type"?: unknown })["@type"];
			const types = (Array.isArray(rawType) ? rawType : [rawType])
				.filter((t): t is string => typeof t === "string")
				.map((t) => t.toLowerCase());
			const article = node as JsonLdArticle;
			if (types.some((t) => ARTICLE_TYPES.has(t)) && (article.headline || article.name)) {
				return article;
			}
		}
	}
	return undefined;
}

/**
 * Strip the site name that so many pages append to `<title>`.
 *
 * Deliberately conservative: it only cuts at a real separator, and only when
 * the trailing fragment looks like the site's own name. A paper titled
 * "Attention Is All You Need - A Retrospective" keeps its subtitle.
 */
function cleanPageTitle(raw: string, host: string): string {
	const trimmed = raw.replace(/\s+/g, " ").trim();
	const label = host.split(".").slice(0, -1).pop();
	if (!label) return trimmed;

	for (const separator of TITLE_SEPARATORS) {
		const at = trimmed.lastIndexOf(` ${separator} `);
		if (at <= 0) continue;
		const head = trimmed.slice(0, at).trim();
		const tail = trimmed.slice(at + separator.length + 2).trim();
		if (head && tail.length <= 40 && tail.toLowerCase().includes(label.toLowerCase())) {
			return head;
		}
	}
	return trimmed;
}

/** Everything the page itself claims about the document. */
export function scrapeMetadata(doc: Document, url: string): PaperMetadata | null {
	const host = hostOf(url);
	let title = firstMeta(doc, HIGHWIRE.title);
	let authorNames = metaContents(doc, HIGHWIRE.author);
	let date = firstMeta(doc, HIGHWIRE.date);
	let venue = firstMeta(doc, HIGHWIRE.venue);
	let tier = "highwire";

	// `citation_authors` is the semicolon-joined variant some publishers use in
	// place of repeated `citation_author` tags.
	if (title && authorNames.length === 0) {
		const joined = firstMeta(doc, HIGHWIRE.authorList);
		if (joined) authorNames = joined.split(/\s*;\s*/).filter(Boolean);
	}

	if (!title) {
		title = firstMeta(doc, ["DC.title", "dcterms.title"]);
		if (title) {
			authorNames = metaContents(doc, "DC.creator").concat(metaContents(doc, "dcterms.creator"));
			date = firstMeta(doc, ["DC.date", "DC.date.issued", "dcterms.issued"]);
			venue = venue ?? firstMeta(doc, ["DC.publisher", "dcterms.publisher"]);
			tier = "dublincore";
		}
	}

	if (!title) {
		const article = readJsonLd(doc);
		if (article) {
			title = article.headline ?? article.name;
			authorNames = jsonLdAuthors(article.author);
			date = article.datePublished ?? article.dateCreated;
			venue =
				venue ??
				(typeof article.publisher === "string" ? article.publisher : article.publisher?.name);
			tier = "jsonld";
		}
	}

	if (!title) {
		title = firstMeta(doc, "og:title");
		if (title) {
			// `article:author` is often a profile URL rather than a name, so
			// only take it when it reads like one.
			authorNames = metaContents(doc, "article:author").filter((a) => !/^https?:\/\//.test(a));
			date = firstMeta(doc, ["article:published_time", "article:modified_time"]);
			venue = venue ?? firstMeta(doc, "og:site_name");
			tier = "opengraph";
		}
	}

	if (!title) {
		const pageTitle = doc.querySelector("title")?.textContent?.trim();
		if (!pageTitle) return null;
		title = pageTitle;
		tier = "pagetitle";
	}

	// OpenGraph titles and `<title>` both routinely carry the site name;
	// citation_* and JSON-LD values are already clean.
	const cleaned =
		tier === "pagetitle" || tier === "opengraph"
			? cleanPageTitle(title, host)
			: title.replace(/\s+/g, " ").trim();

	// A page whose only metadata is a title, and whose title is a challenge or
	// error message, is not a document. Refuse it rather than citing it.
	if ((tier === "pagetitle" || tier === "opengraph") && looksLikeInterstitial(cleaned)) {
		return null;
	}

	const authors: Author[] = authorNames.map(parseAuthor);
	const doi = firstMeta(doc, HIGHWIRE.doi);

	const scraped: PaperMetadata = {
		title: cleaned,
		authors,
		date,
		url,
		pdfUrl: firstMeta(doc, HIGHWIRE.pdf),
		doi: doi ? cleanDoi(doi) : undefined,
		venue,
		// Only tags that claim to *be* an abstract count as one.
		abstract: firstMeta(doc, HIGHWIRE.abstract) ?? jsonLdAbstract(doc),
		site: host,
		source: `html:${tier}`,
	};

	// `og:description` is whatever the site decided to put there: the
	// abstract, the author list, or a truncated excerpt. Keep it only when it
	// adds something the metadata does not already say.
	const described = firstMeta(doc, [
		"og:description",
		"description",
		"DC.description",
		"dcterms.abstract",
	]);
	if (described && !isRedundantDescription(described, scraped)) {
		scraped.description = described;
	}

	return scraped;
}

/**
 * True when a scraped description just restates the citation.
 *
 * A very common publisher pattern is to fill `og:description` with the author
 * list and the proceedings title - ACL Anthology's reads "Yajiao Liu, Xin
 * Jiang, ... Proceedings of the 61st Annual Meeting ... 2023." Passing that
 * along as a summary puts the authors in the body of a card directly under the
 * authors in its header, which is worse than having no summary at all.
 *
 * Works by removing everything already known from the text and seeing whether
 * anything substantial is left. A description that really is an abstract
 * survives this easily; one assembled from metadata does not.
 */
function isRedundantDescription(description: string, meta: PaperMetadata): boolean {
	const known = [
		meta.title,
		meta.venue,
		meta.journalRef,
		meta.date?.match(/\d{4}/)?.[0],
		...meta.authors.map(fullName),
		...meta.authors.map((a) => a.family),
	];

	let remainder = description;
	for (const piece of known) {
		if (piece && piece.length > 2) remainder = remainder.split(piece).join(" ");
	}
	// Whatever is left is only punctuation and joining words if the
	// description was assembled rather than written.
	remainder = remainder.replace(/[\s.,;:|()[\]{}·—–-]+/g, " ").trim();

	return remainder.length < 40 || remainder.length < description.length * 0.3;
}

/** A JSON-LD `abstract`, which some publishers emit and which is trustworthy. */
function jsonLdAbstract(doc: Document): string | undefined {
	const article = readJsonLd(doc) as (JsonLdArticle & { abstract?: unknown }) | undefined;
	const value = article?.abstract;
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Prefer registry values, keep scraped ones where the registry is silent. */
function merge(registry: PaperMetadata, scraped: PaperMetadata): PaperMetadata {
	return {
		...scraped,
		...registry,
		authors: registry.authors.length ? registry.authors : scraped.authors,
		// The page the user pasted is the link they want, not whatever landing
		// page the DOI happens to resolve to.
		url: scraped.url,
		pdfUrl: registry.pdfUrl ?? scraped.pdfUrl,
		venue: registry.venue ?? scraped.venue,
		abstract: registry.abstract ?? scraped.abstract,
		description: registry.description ?? scraped.description,
		comment: registry.comment ?? scraped.comment,
		categories: registry.categories ?? scraped.categories,
		source: `${registry.source}+${scraped.source}`,
	};
}

export const htmlResolver: Resolver = {
	name: "html",

	recognize(text: string): Recognized | null {
		// The last tier before Citoid, so it claims any plain http(s) URL and
		// lets the fetch decide whether there is anything worth citing.
		if (!/^https?:\/\/\S+$/i.test(text)) return null;
		try {
			const url = new URL(text);
			if (!url.hostname.includes(".")) return null;
			return { resolver: "html", url: text, key: text };
		} catch {
			return null;
		}
	},

	async resolve(hit: Recognized, ctx: FetchContext): Promise<PaperMetadata> {
		const html = await httpText(hit.url, { headers: { Accept: "text/html,*/*" } });
		const scraped = scrapeMetadata(parseDocument(html, "text/html"), hit.url);

		if (!scraped) throw new Error(`${hostOf(hit.url)} published no title for that page`);

		// A page that names its own DOI is telling us where the authoritative
		// record lives. Take it, but don't fail the resolve if the registry is
		// unreachable - the scraped metadata is still usable on its own.
		if (scraped.doi) {
			try {
				return merge(await resolveDoi(scraped.doi, ctx), scraped);
			} catch {
				return scraped;
			}
		}
		return scraped;
	},
};
