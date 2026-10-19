import { parseAuthor } from "../authors";
import { childrenByLocalName, httpText, parseDocument, textByLocalName } from "../http";
import type { PaperMetadata, Recognized, Resolver } from "../types";

/**
 * arXiv has had two identifier schemes and we have to handle both: the modern
 * `2301.12345` (4-or-5 digit sequence since 2015) and the pre-2007
 * `math/9404236` style, whose archive part may carry a subject class like
 * `cs.CL`. Old-style ids still turn up in older notes.
 */
const NEW_ID = String.raw`\d{4}\.\d{4,5}`;
const OLD_ID = String.raw`[a-z-]+(?:\.[A-Za-z]{2})?\/\d{7}`;
const ID = `(?:${NEW_ID}|${OLD_ID})`;

/**
 * An arXiv URL in any of the shapes the site serves. `/format/` and `/ps/`
 * are included because they appear in older bookmarks, and all of them carry
 * the same identifier.
 */
const URL_RE = new RegExp(
	String.raw`^(?:https?:\/\/)?(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf|html|format|ps)\/(${ID})(v\d+)?(?:\.pdf)?\/?(?:[?#].*)?$`,
	"i",
);

/** "arXiv:2301.12345v2", as printed on paper PDFs and in reference lists. */
const PREFIXED_RE = new RegExp(String.raw`^arxiv:\s*(${ID})(v\d+)?$`, "i");

/** A bare identifier with no context at all. Opt-in, since it's ambiguous. */
const BARE_RE = new RegExp(String.raw`^(${ID})(v\d+)?$`, "i");

export function createArxivResolver(recognizeBareIds: boolean): Resolver {
	return {
		name: "arxiv",

		recognize(text: string): Recognized | null {
			const match =
				URL_RE.exec(text) ??
				PREFIXED_RE.exec(text) ??
				(recognizeBareIds ? BARE_RE.exec(text) : null);
			if (!match) return null;

			const id = match[1];
			const version = match[2] ?? "";
			return {
				resolver: "arxiv",
				// Always normalize to the abstract page, whatever was pasted:
				// that's the link you want to follow, and a /pdf/ paste should
				// still produce a citation that points at the abstract.
				url: `https://arxiv.org/abs/${id}${version}`,
				id: id + version,
				key: `arxiv:${id}${version}`,
			};
		},

		async resolve(hit: Recognized): Promise<PaperMetadata> {
			// The id_list form returns the exact paper rather than a search
			// ranking, and keeping the version suffix pins the metadata to the
			// version that was linked.
			const api = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(hit.id ?? "")}&max_results=1`;
			const doc = parseDocument(await httpText(api), "application/xml");

			const entry = childrenByLocalName(doc, "entry")[0];
			if (!entry) throw new Error(`arXiv has no record for ${hit.id}`);

			const title = textByLocalName(entry, "title");
			// A bad id still returns 200 with a single entry titled "Error"
			// whose summary explains the problem, so check for that shape
			// before trusting the result.
			if (!title || title === "Error") {
				throw new Error(textByLocalName(entry, "summary") ?? `arXiv has no record for ${hit.id}`);
			}

			const authors = childrenByLocalName(entry, "author")
				.map((el) => textByLocalName(el, "name"))
				.filter((name): name is string => Boolean(name))
				.map(parseAuthor);

			const idUrl = textByLocalName(entry, "id") ?? hit.url;
			const versioned = idUrl.match(/arxiv\.org\/abs\/(.+)$/i)?.[1] ?? hit.id;

			return {
				title,
				authors,
				// `published` is v1's submission date. Prefer it over
				// `updated` so the year matches how the paper is cited.
				date: textByLocalName(entry, "published"),
				url: `https://arxiv.org/abs/${versioned}`,
				pdfUrl: `https://arxiv.org/pdf/${versioned}`,
				doi: textByLocalName(entry, "doi"),
				id: versioned,
				venue: "arXiv",
				journalRef: textByLocalName(entry, "journal_ref"),
				abstract: textByLocalName(entry, "summary"),
				// Often says where the paper was published, which is exactly
				// the kind of thing a card wants: "Accepted at NeurIPS 2023".
				comment: textByLocalName(entry, "comment"),
				categories: childrenByLocalName(entry, "category")
					.map((el) => el.getAttribute("term"))
					.filter((term): term is string => Boolean(term)),
				site: "arxiv.org",
				source: "arxiv",
			};
		},
	};
}
