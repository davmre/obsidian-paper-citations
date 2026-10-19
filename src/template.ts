import { formatAuthors, fullName, lastName } from "./authors";
import type { AuthorFormat, PaperMetadata } from "./types";

export type TemplateVars = Record<string, string>;

/**
 * Flatten metadata into the variables a template can reference.
 *
 * Missing values become "" rather than being left out, so a stray `{{doi}}`
 * never renders literally. Use a conditional block to drop the surrounding
 * text instead.
 */
export function buildVars(
	meta: PaperMetadata,
	fmt: AuthorFormat,
	selection = "",
): TemplateVars {
	const first = meta.authors[0];
	// Dates arrive as "2017-06-12T00:00:00Z", "2017-06-12" or bare "2017".
	const year = meta.date?.match(/\d{4}/)?.[0] ?? "";

	return {
		title: collapse(meta.title),
		authors: formatAuthors(meta.authors, fmt),
		authors_full: meta.authors.map(fullName).join(", "),
		first_author: first ? fullName(first) : "",
		first_author_last: first ? lastName(first) : "",
		year,
		date: meta.date?.slice(0, 10) ?? "",
		url: meta.url,
		abs_url: meta.url,
		pdf_url: meta.pdfUrl ?? "",
		doi: meta.doi ?? "",
		doi_url: meta.doi ? `https://doi.org/${meta.doi}` : "",
		id: meta.id ?? "",
		venue: meta.venue ?? "",
		journal_ref: meta.journalRef ?? "",
		abstract: collapse(meta.abstract ?? ""),
		description: collapse(meta.description ?? ""),
		// One variable that does the right thing per source: a real abstract
		// where there is one, otherwise the page's own summary. Card templates
		// want this; `{{abstract}}` stays strict for anyone who wants only a
		// genuine abstract and nothing in its place.
		summary: collapse(meta.abstract ?? meta.description ?? ""),
		comment: collapse(meta.comment ?? ""),
		categories: (meta.categories ?? []).join(", "),
		primary_category: meta.categories?.[0] ?? "",
		site: meta.site ?? "",
		selection,
	};
}

/** arXiv wraps titles and abstracts across lines; notes want one line. */
function collapse(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/**
 * Render a template.
 *
 * Two forms: `{{name}}` substitutes a value, and `{{#name}}...{{/name}}`
 * keeps its body only when `name` is non-empty. The conditional matters
 * because the same template meets sources with wildly different coverage — a
 * `\[[pdf]\]({{pdf_url}})` suffix has to disappear for a LessWrong post
 * rather than render an empty link.
 *
 * Substitution is literal, with no escaping of any kind, so templates can
 * contain `[[wikilinks]]`, `\[` escapes and arbitrary markdown.
 */
export function render(template: string, vars: TemplateVars): string {
	// Conditionals first, so a dropped block's `{{vars}}` are never expanded.
	// Non-greedy body, and the closing tag must name the same variable, which
	// keeps nested blocks for different variables working.
	const withBlocks = template.replace(
		/\{\{#([a-z_][a-z0-9_]*)\}\}([\s\S]*?)\{\{\/\1\}\}/gi,
		(_match, name: string, body: string) => (vars[name] ? body : ""),
	);

	return withBlocks.replace(/\{\{([a-z_][a-z0-9_]*)\}\}/gi, (match, name: string) =>
		name in vars ? vars[name] : match,
	);
}

/** Variable names a template may use, for the settings-tab reference. */
export const TEMPLATE_VARIABLES = [
	"title", "authors", "authors_full", "first_author", "first_author_last",
	"year", "date", "url", "abs_url", "pdf_url", "doi", "doi_url",
	"id", "venue", "journal_ref", "comment", "categories", "primary_category",
	"summary", "abstract", "description", "site", "selection",
] as const;
