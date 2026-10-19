import type { PaperCitationsSettings } from "./types";

/**
 * The shipped presets.
 *
 * Note the conditional block in "with formats": a LessWrong post and a bare
 * DOI have no PDF, and rendering `\[[pdf]\]()` for them would be worse than
 * omitting it.
 */
export const DEFAULT_PRESETS = [
	{
		name: "Linked title and authors",
		template: "[{{authors}} ({{year}}). {{title}}]({{abs_url}})",
	},
	{
		name: "Bare link",
		template: "[{{title}}]({{abs_url}})",
	},
	{
		name: "With format links",
		template:
			"{{authors}}, *{{title}}*. \\[[abs]\\]({{abs_url}}){{#pdf_url}} \\[[pdf]\\]({{pdf_url}}){{/pdf_url}}",
	},
	{
		name: "Inline citation",
		template: "[{{first_author_last}} et al., {{year}}]({{abs_url}})",
	},
	{
		name: "Author, year, title",
		template: "{{authors}} ({{year}}). [{{title}}]({{abs_url}})",
	},
	{
		// Multi-line, and every optional part carries its own newline inside
		// the conditional so a source that lacks it leaves no blank `>` line
		// behind. `{{summary}}` rather than `{{abstract}}` so a forum post
		// gets its excerpt instead of an empty callout.
		name: "Paper card",
		template: [
			"> [!abstract] [{{title}}]({{abs_url}})",
			"> {{authors}}{{#year}} ({{year}}){{/year}}{{#venue}} · {{venue}}{{/venue}}{{#comment}}",
			"> *{{comment}}*{{/comment}}{{#summary}}",
			">",
			"> {{summary}}{{/summary}}",
			">",
			"> [abs]({{abs_url}}){{#pdf_url}} · [pdf]({{pdf_url}}){{/pdf_url}}{{#doi_url}} · [doi]({{doi_url}}){{/doi_url}}",
		].join("\n"),
	},
];

export const DEFAULT_SETTINGS: PaperCitationsSettings = {
	defaultTemplate: DEFAULT_PRESETS[0].template,
	presets: DEFAULT_PRESETS,
	authorFormat: {
		style: "etAl",
		etAlThreshold: 3,
		separator: ", ",
		finalSeparator: ", and ",
	},
	convertOnPaste: true,
	// Off by default: a bare "2301.12345" or "10.1/x" is indistinguishable
	// from ordinary text you might legitimately want to paste.
	recognizeBareIds: false,
	enabledResolvers: {
		arxiv: true,
		forummagnum: true,
		openreview: true,
		doi: true,
		html: true,
	},
	allowCitoid: false,
	crossrefMailto: "",
	cacheEnabled: true,
	cacheTtlDays: 90,
};
