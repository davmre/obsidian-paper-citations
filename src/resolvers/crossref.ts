import { parseAuthor } from "../authors";
import { httpJson } from "../http";
import type { Author, PaperMetadata, Recognized, Resolver, FetchContext } from "../types";

/**
 * DOIs are deliberately permissive — anything after the `10.xxxx/` prefix is
 * opaque — so this matches greedily and trims trailing punctuation that is
 * much more likely to be prose than part of the identifier.
 */
const DOI_BODY = String.raw`10\.\d{4,9}\/[^\s"<>]+`;

const DOI_URL_RE = new RegExp(String.raw`^(?:https?:\/\/)?(?:dx\.)?doi\.org\/(${DOI_BODY})$`, "i");
const DOI_PREFIX_RE = new RegExp(String.raw`^doi:\s*(${DOI_BODY})$`, "i");
const DOI_BARE_RE = new RegExp(String.raw`^(${DOI_BODY})$`, "i");

/** Trailing characters that come from surrounding prose, not the DOI. */
export function cleanDoi(raw: string): string {
	return raw.replace(/[).,;:'"\]]+$/, "").toLowerCase();
}

export function createCrossrefResolver(recognizeBareIds: boolean): Resolver {
	return {
		name: "doi",

		recognize(text: string): Recognized | null {
			const match =
				DOI_URL_RE.exec(text) ??
				DOI_PREFIX_RE.exec(text) ??
				(recognizeBareIds ? DOI_BARE_RE.exec(text) : null);
			if (!match) return null;

			const doi = cleanDoi(match[1]);
			return {
				resolver: "doi",
				url: `https://doi.org/${doi}`,
				id: doi,
				key: `doi:${doi}`,
			};
		},

		resolve: (hit, ctx) => resolveDoi(hit.id ?? "", ctx),
	};
}

/**
 * Look a DOI up, trying three registries in turn.
 *
 * Crossref covers journal and conference publishing, but it doesn't mint DOIs
 * for datasets, software or some preprint servers — those live in DataCite.
 * OpenAlex is the final fallback because it aggregates both plus more, at the
 * cost of occasionally messier author strings.
 *
 * Exported because the HTML tier calls it directly when it finds a
 * `citation_doi` on a page: structured registry data beats scraped tags.
 */
export async function resolveDoi(doi: string, ctx: FetchContext): Promise<PaperMetadata> {
	const errors: string[] = [];

	const chain: ((doi: string, ctx: FetchContext) => Promise<PaperMetadata>)[] = [
		fromCrossref,
		fromDataCite,
		fromOpenAlex,
	];

	for (const attempt of chain) {
		try {
			return await attempt(doi, ctx);
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
	}
	throw new Error(`could not resolve DOI ${doi} (${errors.join("; ")})`);
}

interface CrossrefName {
	given?: string;
	family?: string;
	name?: string;
}

interface CrossrefWork {
	message?: {
		title?: string[];
		author?: CrossrefName[];
		issued?: { "date-parts"?: number[][] };
		created?: { "date-time"?: string };
		DOI?: string;
		URL?: string;
		"container-title"?: string[];
		abstract?: string;
		link?: { URL?: string; "content-type"?: string }[];
	};
}

function crossrefAuthors(names: CrossrefName[] | undefined): Author[] {
	return (names ?? []).map((n) => ({
		given: n.given ?? "",
		// A corporate author arrives as `name` with no given/family split.
		family: n.family ?? n.name ?? "",
	}));
}

/** Crossref gives dates as [[2015, 5, 27]]; render what's present. */
function datePartsToIso(parts: number[][] | undefined): string | undefined {
	const first = parts?.[0];
	if (!first?.length) return undefined;
	const [year, month, day] = first;
	return [year, month, day]
		.filter((n): n is number => typeof n === "number")
		.map((n, i) => (i === 0 ? String(n) : String(n).padStart(2, "0")))
		.join("-");
}

async function fromCrossref(doi: string, ctx: FetchContext): Promise<PaperMetadata> {
	// The `mailto` parameter opts into Crossref's "polite pool", which has
	// better latency and lets them contact you instead of just rate-limiting.
	const query = ctx.mailto ? `?mailto=${encodeURIComponent(ctx.mailto)}` : "";
	const body = await httpJson<CrossrefWork>(
		`https://api.crossref.org/works/${encodeURI(doi)}${query}`,
	);

	const work = body.message;
	const title = work?.title?.[0];
	if (!title) throw new Error("Crossref returned no title");

	const pdf = work?.link?.find((l) => l["content-type"] === "application/pdf")?.URL;

	return {
		title,
		authors: crossrefAuthors(work?.author),
		date: datePartsToIso(work?.issued?.["date-parts"]) ?? work?.created?.["date-time"],
		url: work?.URL ?? `https://doi.org/${doi}`,
		pdfUrl: pdf,
		doi: work?.DOI ?? doi,
		id: work?.DOI ?? doi,
		venue: work?.["container-title"]?.[0],
		journalRef: work?.["container-title"]?.[0],
		// Crossref abstracts are JATS XML fragments, so strip the tags.
		abstract: work?.abstract?.replace(/<[^>]+>/g, " "),
		site: "doi.org",
		source: "crossref",
	};
}

interface DataCiteWork {
	data?: {
		attributes?: {
			titles?: { title?: string }[];
			creators?: { givenName?: string; familyName?: string; name?: string }[];
			publicationYear?: number;
			published?: string;
			doi?: string;
			url?: string;
			publisher?: string | { name?: string };
			descriptions?: { description?: string; descriptionType?: string }[];
		};
	};
}

async function fromDataCite(doi: string): Promise<PaperMetadata> {
	const body = await httpJson<DataCiteWork>(`https://api.datacite.org/dois/${encodeURI(doi)}`);
	const attrs = body.data?.attributes;

	const title = attrs?.titles?.[0]?.title;
	if (!title) throw new Error("DataCite returned no title");

	const publisher = typeof attrs?.publisher === "string" ? attrs.publisher : attrs?.publisher?.name;

	return {
		title,
		authors: (attrs?.creators ?? []).map((c) => ({
			given: c.givenName ?? "",
			family: c.familyName ?? c.name ?? "",
		})),
		date: attrs?.published ?? (attrs?.publicationYear ? String(attrs.publicationYear) : undefined),
		url: attrs?.url ?? `https://doi.org/${doi}`,
		doi: attrs?.doi ?? doi,
		id: attrs?.doi ?? doi,
		venue: publisher,
		abstract: attrs?.descriptions?.find((d) => d.descriptionType === "Abstract")?.description,
		site: "doi.org",
		source: "datacite",
	};
}

interface OpenAlexWork {
	title?: string | null;
	display_name?: string | null;
	publication_date?: string | null;
	publication_year?: number | null;
	doi?: string | null;
	authorships?: { author?: { display_name?: string | null } | null }[];
	primary_location?: {
		pdf_url?: string | null;
		source?: { display_name?: string | null } | null;
	} | null;
}

async function fromOpenAlex(doi: string): Promise<PaperMetadata> {
	const body = await httpJson<OpenAlexWork>(
		`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`,
	);

	const title = body.title ?? body.display_name;
	if (!title) throw new Error("OpenAlex returned no title");

	// OpenAlex only gives a display name, so split it the same way we split
	// any other unstructured name.
	return {
		title,
		authors: (body.authorships ?? [])
			.map((a) => a.author?.display_name)
			.filter((name): name is string => Boolean(name))
			.map(parseAuthor),
		date: body.publication_date ?? (body.publication_year ? String(body.publication_year) : undefined),
		url: body.doi ?? `https://doi.org/${doi}`,
		pdfUrl: body.primary_location?.pdf_url ?? undefined,
		doi: body.doi?.replace(/^https?:\/\/doi\.org\//, "") ?? doi,
		id: doi,
		venue: body.primary_location?.source?.display_name ?? undefined,
		site: "doi.org",
		source: "openalex",
	};
}
