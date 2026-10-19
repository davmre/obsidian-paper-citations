import { describe, expect, it } from "vitest";
import { formatAuthors, initialsName, parseAuthor } from "../src/authors";
import { DEFAULT_PRESETS, DEFAULT_SETTINGS } from "../src/defaults";
import { buildVars, render } from "../src/template";
import type { AuthorFormat, PaperMetadata } from "../src/types";

const fmt = DEFAULT_SETTINGS.authorFormat;

function withFormat(overrides: Partial<AuthorFormat>): AuthorFormat {
	return { ...fmt, ...overrides };
}

describe("parsing names", () => {
	it.each([
		// arXiv's API hands back "Family, Given".
		["Vaswani, Ashish", { given: "Ashish", family: "Vaswani" }],
		["Gomez, Aidan N.", { given: "Aidan N.", family: "Gomez" }],
		// Prose order.
		["Ashish Vaswani", { given: "Ashish", family: "Vaswani" }],
		["William P. Thurston", { given: "William P.", family: "Thurston" }],
		["Jane Q. Public Smith", { given: "Jane Q. Public", family: "Smith" }],
		// A LessWrong handle has no structure to find.
		["Diffractor", { given: "", family: "Diffractor" }],
		["TurnTrout", { given: "", family: "TurnTrout" }],
		// Particles belong to the family name.
		["Ludwig van Beethoven", { given: "Ludwig", family: "van Beethoven" }],
		["Vincent van der Berg", { given: "Vincent", family: "van der Berg" }],
		// Suffixes are not family names.
		["Martin Luther King Jr.", { given: "Martin Luther", family: "King Jr." }],
		["King, Jr.", { given: "", family: "King, Jr." }],
	])("parses %s", (input, expected) => {
		expect(parseAuthor(input)).toEqual(expected);
	});

	it("collapses stray whitespace, which arXiv's XML is full of", () => {
		expect(parseAuthor("  Ashish   Vaswani\n")).toEqual({ given: "Ashish", family: "Vaswani" });
	});

	it("survives an empty name", () => {
		expect(parseAuthor("   ")).toEqual({ given: "", family: "" });
	});
});

describe("formatting author lists", () => {
	const four = ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit"].map(parseAuthor);
	const two = four.slice(0, 2);
	const one = four.slice(0, 1);
	const handle = [parseAuthor("Diffractor")];

	it("writes full names", () => {
		expect(formatAuthors(four, withFormat({ style: "full" }))).toBe(
			"Ashish Vaswani, Noam Shazeer, Niki Parmar, and Jakob Uszkoreit",
		);
	});

	it("drops the serial comma for exactly two names", () => {
		expect(formatAuthors(two, withFormat({ style: "full" }))).toBe("Ashish Vaswani and Noam Shazeer");
	});

	it("uses no separator at all for one name", () => {
		expect(formatAuthors(one, withFormat({ style: "full" }))).toBe("Ashish Vaswani");
	});

	it("collapses past the threshold with et al.", () => {
		expect(formatAuthors(four, withFormat({ style: "etAl", etAlThreshold: 3 }))).toBe(
			"Ashish Vaswani et al.",
		);
		// At or under the threshold, every name is listed.
		expect(formatAuthors(two, withFormat({ style: "etAl", etAlThreshold: 3 }))).toBe(
			"Ashish Vaswani and Noam Shazeer",
		);
	});

	it("writes surnames only", () => {
		expect(formatAuthors(four, withFormat({ style: "lastNames" }))).toBe(
			"Vaswani, Shazeer, Parmar, and Uszkoreit",
		);
	});

	it("writes initials", () => {
		expect(formatAuthors(two, withFormat({ style: "initials" }))).toBe("A. Vaswani and N. Shazeer");
		expect(initialsName(parseAuthor("William P. Thurston"))).toBe("W. P. Thurston");
	});

	it("renders a mononym unchanged in every style", () => {
		for (const style of ["full", "etAl", "lastNames", "initials"] as const) {
			expect(formatAuthors(handle, withFormat({ style })), style).toBe("Diffractor");
		}
	});

	it("honours custom separators", () => {
		expect(
			formatAuthors(four, withFormat({ style: "full", separator: "; ", finalSeparator: "; " })),
		).toBe("Ashish Vaswani; Noam Shazeer; Niki Parmar; Jakob Uszkoreit");
	});

	it("returns nothing for no authors", () => {
		expect(formatAuthors([], fmt)).toBe("");
	});
});

const paper: PaperMetadata = {
	title: "Attention Is All You Need",
	// Four authors, one past the default et al. threshold of three.
	authors: ["Vaswani, Ashish", "Shazeer, Noam", "Parmar, Niki", "Uszkoreit, Jakob"].map(
		parseAuthor,
	),
	date: "2017-06-12T17:57:34Z",
	url: "https://arxiv.org/abs/1706.03762v7",
	pdfUrl: "https://arxiv.org/pdf/1706.03762v7",
	id: "1706.03762v7",
	venue: "arXiv",
	site: "arxiv.org",
};

const post: PaperMetadata = {
	title: "Reward is not the optimization target",
	authors: [parseAuthor("TurnTrout")],
	date: "2022-07-25T00:03:18.064Z",
	url: "https://www.alignmentforum.org/posts/pdaGN6pQyQarFHXF4/x",
	venue: "Alignment Forum",
	site: "alignmentforum.org",
};

describe("template variables", () => {
	const vars = buildVars(paper, fmt);

	it("exposes the pieces a citation needs", () => {
		expect(vars.title).toBe("Attention Is All You Need");
		expect(vars.authors).toBe("Ashish Vaswani et al.");
		expect(vars.authors_full).toBe(
			"Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit",
		);
		expect(vars.first_author).toBe("Ashish Vaswani");
		expect(vars.first_author_last).toBe("Vaswani");
		expect(vars.year).toBe("2017");
		expect(vars.date).toBe("2017-06-12");
		expect(vars.pdf_url).toBe("https://arxiv.org/pdf/1706.03762v7");
	});

	it("collapses a title that arrived wrapped across lines", () => {
		// arXiv's Atom feed hard-wraps long titles and indents the
		// continuation, which would otherwise land in the note verbatim.
		const wrapped = buildVars(
			{ ...paper, title: "Optimizing Neural Networks with\n  Kronecker-factored Approximate\n  Curvature" },
			fmt,
		);
		expect(wrapped.title).toBe(
			"Optimizing Neural Networks with Kronecker-factored Approximate Curvature",
		);
	});

	it("renders missing values as empty, never as undefined", () => {
		const sparse = buildVars(post, fmt);
		expect(sparse.pdf_url).toBe("");
		expect(sparse.doi).toBe("");
		expect(sparse.doi_url).toBe("");
		expect(sparse.journal_ref).toBe("");
	});

	it("keeps {{abstract}} strict and lets {{summary}} fall back", () => {
		// A paper with a real abstract: both are the abstract.
		const withAbstract = buildVars({ ...paper, abstract: "We propose a thing." }, fmt);
		expect(withAbstract.abstract).toBe("We propose a thing.");
		expect(withAbstract.summary).toBe("We propose a thing.");

		// A post with only an excerpt: {{abstract}} stays empty so a template
		// asking for an abstract gets nothing rather than something else,
		// while {{summary}} gives a card something to show.
		const withExcerpt = buildVars({ ...post, description: "The opening paragraph." }, fmt);
		expect(withExcerpt.abstract).toBe("");
		expect(withExcerpt.description).toBe("The opening paragraph.");
		expect(withExcerpt.summary).toBe("The opening paragraph.");

		// Neither: everything is empty and conditionals drop.
		expect(buildVars(post, fmt).summary).toBe("");
	});

	it("prefers the abstract over the description in {{summary}}", () => {
		const both = buildVars(
			{ ...paper, abstract: "The real abstract.", description: "A blurb." },
			fmt,
		);
		expect(both.summary).toBe("The real abstract.");
	});

	it("exposes arXiv's comment and categories", () => {
		const vars = buildVars(
			{ ...paper, comment: "Accepted at NeurIPS 2017", categories: ["cs.CL", "cs.LG"] },
			fmt,
		);
		expect(vars.comment).toBe("Accepted at NeurIPS 2017");
		expect(vars.categories).toBe("cs.CL, cs.LG");
		expect(vars.primary_category).toBe("cs.CL");
	});

	it("collapses a wrapped abstract to one line", () => {
		// arXiv hard-wraps abstracts; a callout wants a single line it can
		// wrap itself, not embedded newlines that would break out of it.
		const vars = buildVars({ ...paper, abstract: "One line.\n  Then another.\n" }, fmt);
		expect(vars.abstract).toBe("One line. Then another.");
	});

	it("builds a DOI link only when there is a DOI", () => {
		expect(buildVars({ ...paper, doi: "10.1038/nature14539" }, fmt).doi_url).toBe(
			"https://doi.org/10.1038/nature14539",
		);
	});

	it("takes the year from a bare year string", () => {
		expect(buildVars({ ...paper, date: "1994" }, fmt).year).toBe("1994");
	});
});

describe("rendering", () => {
	it("substitutes variables", () => {
		expect(render("[{{title}}]({{abs_url}})", buildVars(paper, fmt))).toBe(
			"[Attention Is All You Need](https://arxiv.org/abs/1706.03762v7)",
		);
	});

	it("leaves an unknown variable alone rather than blanking it", () => {
		// A typo should be visible in the note, not silently swallowed.
		expect(render("{{titel}}", buildVars(paper, fmt))).toBe("{{titel}}");
	});

	it("keeps a conditional block when the value is present", () => {
		expect(
			render("abs{{#pdf_url}} and pdf{{/pdf_url}}", buildVars(paper, fmt)),
		).toBe("abs and pdf");
	});

	it("drops a conditional block when the value is missing", () => {
		expect(render("abs{{#pdf_url}} and pdf{{/pdf_url}}", buildVars(post, fmt))).toBe("abs");
	});

	it("handles several independent conditionals", () => {
		const template = "{{#doi}}DOI{{/doi}}{{#pdf_url}}PDF{{/pdf_url}}{{#venue}}V{{/venue}}";
		expect(render(template, buildVars(paper, fmt))).toBe("PDFV");
	});

	it("passes markdown and wikilink syntax through untouched", () => {
		// The whole point of literal substitution: a template that wraps the
		// output in escapes or wikilinks must survive byte-for-byte.
		const template = "[[{{title}}]] \\[[abs]\\]({{abs_url}}) *{{venue}}* `{{id}}`";
		expect(render(template, buildVars(paper, fmt))).toBe(
			"[[Attention Is All You Need]] \\[[abs]\\](https://arxiv.org/abs/1706.03762v7) *arXiv* `1706.03762v7`",
		);
	});

	it("does not expand variables inside a dropped block", () => {
		expect(render("{{#doi}}{{title}}{{/doi}}", buildVars(paper, fmt))).toBe("");
	});
});

describe("the shipped presets", () => {
	const byName = (name: string) => {
		const preset = DEFAULT_PRESETS.find((p) => p.name === name);
		if (!preset) throw new Error(`no preset named ${name}`);
		return preset.template;
	};

	it.each([
		[
			"Linked title and authors",
			paper,
			"[Ashish Vaswani et al. (2017). Attention Is All You Need](https://arxiv.org/abs/1706.03762v7)",
		],
		["Bare link", paper, "[Attention Is All You Need](https://arxiv.org/abs/1706.03762v7)"],
		[
			"With format links",
			paper,
			"Ashish Vaswani et al., *Attention Is All You Need*. \\[[abs]\\](https://arxiv.org/abs/1706.03762v7) \\[[pdf]\\](https://arxiv.org/pdf/1706.03762v7)",
		],
		["Inline citation", paper, "[Vaswani et al., 2017](https://arxiv.org/abs/1706.03762v7)"],
	])("renders %s", (name, meta, expected) => {
		expect(render(byName(name), buildVars(meta, fmt))).toBe(expected);
	});

	it("omits the pdf link for a source that has none", () => {
		expect(render(byName("With format links"), buildVars(post, fmt))).toBe(
			"TurnTrout, *Reward is not the optimization target*. \\[[abs]\\](https://www.alignmentforum.org/posts/pdaGN6pQyQarFHXF4/x)",
		);
	});

	it("renders the paper card with every optional part present", () => {
		const full = {
			...paper,
			abstract: "We propose a new architecture.",
			comment: "Accepted at NeurIPS 2017",
			doi: "10.5555/attention",
		};

		expect(render(byName("Paper card"), buildVars(full, fmt))).toBe(
			[
				"> [!abstract] [Attention Is All You Need](https://arxiv.org/abs/1706.03762v7)",
				"> Ashish Vaswani et al. (2017) · arXiv",
				"> *Accepted at NeurIPS 2017*",
				">",
				"> We propose a new architecture.",
				">",
				"> [abs](https://arxiv.org/abs/1706.03762v7) · [pdf](https://arxiv.org/pdf/1706.03762v7) · [doi](https://doi.org/10.5555/attention)",
			].join("\n"),
		);
	});

	it("renders the paper card for a source with no pdf, doi or comment", () => {
		// Each optional part carries its own newline inside the conditional,
		// so dropping one must not leave a bare `>` line behind.
		const withExcerpt = { ...post, description: "The first paragraph of the post." };

		expect(render(byName("Paper card"), buildVars(withExcerpt, fmt))).toBe(
			[
				"> [!abstract] [Reward is not the optimization target](https://www.alignmentforum.org/posts/pdaGN6pQyQarFHXF4/x)",
				"> TurnTrout (2022) · Alignment Forum",
				">",
				"> The first paragraph of the post.",
				">",
				"> [abs](https://www.alignmentforum.org/posts/pdaGN6pQyQarFHXF4/x)",
			].join("\n"),
		);
	});

	it("renders the paper card with no summary at all", () => {
		expect(render(byName("Paper card"), buildVars(paper, fmt))).toBe(
			[
				"> [!abstract] [Attention Is All You Need](https://arxiv.org/abs/1706.03762v7)",
				"> Ashish Vaswani et al. (2017) · arXiv",
				">",
				"> [abs](https://arxiv.org/abs/1706.03762v7) · [pdf](https://arxiv.org/pdf/1706.03762v7)",
			].join("\n"),
		);
	});

	it("never leaves an empty callout line in the card", () => {
		for (const meta of [paper, post, { ...paper, abstract: "x" }, { ...post, description: "y" }]) {
			const lines = render(byName("Paper card"), buildVars(meta, fmt)).split("\n");
			// Every line belongs to the callout, and none is a lone marker
			// followed by another lone marker.
			expect(lines.every((l) => l.startsWith(">"))).toBe(true);
			expect(lines.join("\n")).not.toContain(">\n>\n");
		}
	});

	it("renders every preset without leaving template syntax behind", () => {
		for (const preset of DEFAULT_PRESETS) {
			for (const meta of [paper, post]) {
				const out = render(preset.template, buildVars(meta, fmt));
				expect(out, `${preset.name}`).not.toMatch(/\{\{|\}\}/);
				// An empty markdown link means a conditional was needed and
				// missing - worse than omitting the text entirely.
				expect(out, `${preset.name}`).not.toContain("]()");
			}
		}
	});
});
