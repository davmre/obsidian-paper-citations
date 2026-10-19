/** A person's name, split where we can manage it. */
export interface Author {
	/** Given/first names, as written. Empty for mononyms and handles. */
	given: string;
	/** Family/last name, or the whole name when it can't be split. */
	family: string;
}

/**
 * Everything a resolver can discover about a document. Only `title` and
 * `url` are ever guaranteed; a LessWrong post has no PDF, a blog post has no
 * DOI, and plenty of pages don't publish a date. Templates handle the gaps
 * with conditional blocks, so resolvers should leave fields undefined rather
 * than inventing placeholder values.
 */
export interface PaperMetadata {
	title: string;
	authors: Author[];
	/** ISO-ish date string as published, e.g. "2017-06-12" or "2017". */
	date?: string;
	/** The canonical landing page: an arXiv /abs/ page, a post, a DOI target. */
	url: string;
	/** Direct PDF link, where one is known. */
	pdfUrl?: string;
	doi?: string;
	/** Source-native identifier, e.g. "1706.03762" or a ForumMagnum post id. */
	id?: string;
	/** Journal, conference or site name. */
	venue?: string;
	/** arXiv's journal_ref / Crossref's container, verbatim. */
	journalRef?: string;
	/**
	 * A genuine abstract: arXiv's summary, a Crossref/DataCite abstract, an
	 * OpenReview abstract, or a page's own `citation_abstract`. Never a
	 * scraped page summary - see `description`.
	 */
	abstract?: string;
	/**
	 * A looser page summary: `og:description`, Dublin Core description, a
	 * forum post's excerpt. Kept apart from `abstract` because the two are
	 * not interchangeable - ACL Anthology's `og:description` is the author
	 * list, and LessWrong truncates its own at about 160 characters.
	 */
	description?: string;
	/** arXiv's author comment, e.g. "Accepted at NeurIPS 2023". */
	comment?: string;
	/** Subject categories, source-native, e.g. ["cs.CL", "cs.LG"]. */
	categories?: string[];
	/** Hostname the metadata came from, for display and debugging. */
	site?: string;
	/** Which resolver produced this, for debugging and tests. */
	source?: string;
}

/** What `recognize` extracts from clipboard text before any network call. */
export interface Recognized {
	/** Resolver name that claimed this input. */
	resolver: string;
	/** Normalized canonical URL for the document. */
	url: string;
	/** Resolver-specific identifier parsed out of the input. */
	id?: string;
	/** Cache key; defaults to `url`. */
	key?: string;
}

export interface FetchContext {
	/** Crossref's polite pool wants a contact address. May be empty. */
	mailto: string;
	/** Whether the Citoid last-resort tier is permitted. */
	allowCitoid: boolean;
}

export interface Resolver {
	name: string;
	/** Claim the input, or return null to pass it down the chain. */
	recognize(text: string): Recognized | null;
	/** Fetch and parse. Throw with a human-readable message on failure. */
	resolve(hit: Recognized, ctx: FetchContext): Promise<PaperMetadata>;
}

export type AuthorStyle = "full" | "etAl" | "lastNames" | "initials";

export interface AuthorFormat {
	style: AuthorStyle;
	/** For "etAl": collapse to "First et al." once there are more than this many. */
	etAlThreshold: number;
	/** Between all but the last two names. */
	separator: string;
	/** Between the last two names. */
	finalSeparator: string;
}

export interface Preset {
	name: string;
	template: string;
}

export interface PaperCitationsSettings {
	/** Applied automatically on paste. */
	defaultTemplate: string;
	presets: Preset[];
	authorFormat: AuthorFormat;
	/** Master switch for intercepting paste. Commands still work when off. */
	convertOnPaste: boolean;
	/** Also treat bare "arXiv:2301.12345" / "10.1234/xyz" as recognizable. */
	recognizeBareIds: boolean;
	/** Per-tier switches, by resolver name. */
	enabledResolvers: Record<string, boolean>;
	/** Sends pasted URLs to Wikimedia. Off by default, deliberately. */
	allowCitoid: boolean;
	crossrefMailto: string;
	cacheEnabled: boolean;
	cacheTtlDays: number;
}
