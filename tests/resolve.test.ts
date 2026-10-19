import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetStubs, stubCalls, stubMatcher, stubUrl } from "./obsidian-stub";
import { DEFAULT_SETTINGS } from "../src/defaults";
import { buildResolvers, resolveText } from "../src/resolvers/index";
import type { FetchContext, PaperCitationsSettings } from "../src/types";

/**
 * Fixtures are real recorded responses, captured 2026-10-19. Hand-written
 * ones would drift from what the services actually send - the ACL page's
 * attribute order and LessWrong's missing date are both things a plausible
 * hand-written fixture would have got wrong.
 */
function fixture(name: string): string {
	return readFileSync(join(__dirname, "fixtures", name), "utf8");
}

const ctx: FetchContext = { mailto: "", allowCitoid: false };

function chain(overrides: Partial<PaperCitationsSettings> = {}) {
	return buildResolvers({ ...DEFAULT_SETTINGS, ...overrides });
}

beforeEach(resetStubs);

describe("arXiv", () => {
	it("reads title, every author, date and PDF link", async () => {
		stubUrl("export.arxiv.org/api/query", fixture("arxiv-attention.xml"));

		const meta = await resolveText("https://arxiv.org/abs/1706.03762", chain(), ctx);

		expect(meta.title).toBe("Attention Is All You Need");
		expect(meta.authors).toHaveLength(8);
		expect(meta.authors[0]).toEqual({ given: "Ashish", family: "Vaswani" });
		expect(meta.authors[7]).toEqual({ given: "Illia", family: "Polosukhin" });
		expect(meta.date).toMatch(/^2017-06-12/);
		expect(meta.venue).toBe("arXiv");
		expect(meta.source).toBe("arxiv");
	});

	it("pins the URLs to the version arXiv reports", async () => {
		stubUrl("export.arxiv.org/api/query", fixture("arxiv-attention.xml"));

		const meta = await resolveText("https://arxiv.org/abs/1706.03762", chain(), ctx);

		// The fixture's <id> is v7, so the citation should point there rather
		// than at the unversioned path that was pasted.
		expect(meta.url).toBe("https://arxiv.org/abs/1706.03762v7");
		expect(meta.pdfUrl).toBe("https://arxiv.org/pdf/1706.03762v7");
		expect(meta.id).toBe("1706.03762v7");
	});

	it("handles a pre-2007 identifier", async () => {
		stubUrl("export.arxiv.org/api/query", fixture("arxiv-old-id.xml"));

		const meta = await resolveText("https://arxiv.org/abs/math/9404236", chain(), ctx);

		expect(meta.title).toBe("On proof and progress in mathematics");
		expect(meta.authors).toEqual([{ given: "William P.", family: "Thurston" }]);
		expect(meta.date).toMatch(/^1994-04-01/);
		expect(meta.url).toBe("https://arxiv.org/abs/math/9404236v1");
	});

	it("does not mistake the feed title for the paper title", async () => {
		// The Atom feed's own <title> is "arXiv Query: ..." and precedes the
		// entry, so a document-wide lookup would pick up the wrong one.
		stubUrl("export.arxiv.org/api/query", fixture("arxiv-old-id.xml"));

		const meta = await resolveText("https://arxiv.org/abs/math/9404236", chain(), ctx);

		expect(meta.title).not.toContain("arXiv Query");
	});

	it("picks up journal_ref and doi when the authors supplied them", async () => {
		stubUrl("export.arxiv.org/api/query", fixture("arxiv-journal-ref.xml"));

		const meta = await resolveText("https://arxiv.org/abs/astro-ph/9812133", chain(), ctx);

		expect(meta.journalRef).toBe("Astrophys.J.517:565-586,1999");
		expect(meta.doi).toBe("10.1086/307221");
	});

	it("leaves journal_ref and doi undefined when they are absent", async () => {
		stubUrl("export.arxiv.org/api/query", fixture("arxiv-kfac.xml"));

		const meta = await resolveText("https://arxiv.org/abs/1503.05671", chain(), ctx);

		expect(meta.title).toBe("Optimizing Neural Networks with Kronecker-factored Approximate Curvature");
		expect(meta.journalRef).toBeUndefined();
		expect(meta.doi).toBeUndefined();
	});

	it("requests the pasted version, not just the paper", async () => {
		stubUrl("export.arxiv.org/api/query", fixture("arxiv-attention.xml"));

		await resolveText("https://arxiv.org/abs/1706.03762v3", chain(), ctx);

		expect(stubCalls()[0].url).toContain("id_list=1706.03762v3");
	});

	it("falls through to the HTML tier when arXiv knows nothing", async () => {
		// An unknown but well-formed id gets an empty feed, not an error entry.
		stubUrl("export.arxiv.org/api/query", fixture("arxiv-error.xml"));
		stubUrl("arxiv.org/abs/", "<html><head><title>Nothing</title></head></html>");

		const meta = await resolveText("https://arxiv.org/abs/9999.99999", chain(), ctx);

		expect(meta.source).toBe("html:pagetitle");
	});
});

describe("LessWrong and the Alignment Forum", () => {
	it("reads title, author and date from the GraphQL API", async () => {
		stubUrl("lesswrong.com/graphql", fixture("lesswrong-graphql.json"));

		const meta = await resolveText(
			"https://www.lesswrong.com/posts/vJ7ggyjuP4u2yHNcP/threat-resistant",
			chain(),
			ctx,
		);

		expect(meta.title).toBe("Threat-Resistant Bargaining Megapost: Introducing the ROSE Value");
		// A handle has no given/family split, so it stays whole.
		expect(meta.authors).toEqual([{ given: "", family: "Diffractor" }]);
		expect(meta.date).toBe("2022-09-28T01:20:11.605Z");
		expect(meta.venue).toBe("LessWrong");
		expect(meta.url).toBe(
			"https://www.lesswrong.com/posts/vJ7ggyjuP4u2yHNcP/threat-resistant-bargaining-megapost-introducing-the-rose",
		);
	});

	it("corrects a stale slug from the canonical one", async () => {
		stubUrl("lesswrong.com/graphql", fixture("lesswrong-graphql.json"));

		const meta = await resolveText(
			"https://www.lesswrong.com/posts/vJ7ggyjuP4u2yHNcP/an-outdated-slug",
			chain(),
			ctx,
		);

		expect(meta.url).toContain("threat-resistant-bargaining-megapost-introducing-the-rose");
	});

	it("queries the host that was pasted", async () => {
		stubUrl("alignmentforum.org/graphql", fixture("lesswrong-graphql.json"));

		const meta = await resolveText(
			"https://www.alignmentforum.org/posts/vJ7ggyjuP4u2yHNcP/x",
			chain(),
			ctx,
		);

		expect(stubCalls()[0].url).toBe("https://www.alignmentforum.org/graphql");
		expect(meta.venue).toBe("Alignment Forum");
		expect(meta.url).toContain("alignmentforum.org");
	});

	it("reports a GraphQL error rather than inventing a citation", async () => {
		stubUrl("lesswrong.com/graphql", JSON.stringify({ errors: [{ message: "post not found" }] }));
		stubUrl("lesswrong.com/posts/", "<html><head></head><body></body></html>");

		await expect(
			resolveText("https://www.lesswrong.com/posts/vJ7ggyjuP4u2yHNcP/x", chain(), ctx),
		).rejects.toThrow(/post not found/);
	});
});

describe("abstracts and descriptions", () => {
	it("takes the abstract, comment and categories from arXiv", async () => {
		stubUrl("export.arxiv.org/api/query", fixture("arxiv-journal-ref.xml"));

		const meta = await resolveText("https://arxiv.org/abs/astro-ph/9812133", chain(), ctx);

		expect(meta.abstract).toContain("We report measurements of the mass density");
		expect(meta.comment).toContain("Accepted for publication in the Astrophysical Journal");
		expect(meta.categories?.[0]).toMatch(/astro-ph/);
	});

	it("takes a forum post's excerpt as a description, not an abstract", async () => {
		// A post has no abstract. Its GraphQL excerpt runs to ~2000 characters,
		// where the og:description on the page is truncated at about 160.
		stubUrl(
			"lesswrong.com/graphql",
			JSON.stringify({
				data: {
					post: {
						result: {
							_id: "pdaGN6pQyQarFHXF4",
							title: "A Post",
							slug: "a-post",
							postedAt: "2022-09-28T01:20:11.605Z",
							user: { displayName: "Diffractor" },
							coauthors: [],
							contents: { plaintextDescription: "The first few paragraphs of the post." },
						},
					},
				},
			}),
		);

		const meta = await resolveText(
			"https://www.lesswrong.com/posts/pdaGN6pQyQarFHXF4/x",
			chain(),
			ctx,
		);

		expect(meta.description).toBe("The first few paragraphs of the post.");
		expect(meta.abstract).toBeUndefined();
	});

	it("treats citation_abstract as a real abstract", async () => {
		stubUrl(
			"example.com",
			`<html><head><meta name="citation_title" content="A Paper">
			<meta name="citation_abstract" content="We prove a thing about things."></head></html>`,
		);

		const meta = await resolveText("https://example.com/x", chain(), ctx);

		expect(meta.abstract).toBe("We prove a thing about things.");
	});

	it("keeps an og:description that is genuinely a summary", async () => {
		stubUrl(
			"example.com",
			`<html><head><meta name="citation_title" content="A Paper">
			<meta name="citation_author" content="Smith, Jane">
			<meta property="og:description" content="We introduce a method for estimating widget density from noisy observations, and show it beats the state of the art on three benchmarks."></head></html>`,
		);

		const meta = await resolveText("https://example.com/x", chain(), ctx);

		expect(meta.description).toContain("estimating widget density");
		// It is a description, not an abstract: nothing claimed it was one.
		expect(meta.abstract).toBeUndefined();
	});

	it("discards an og:description that only restates the citation", async () => {
		// ACL Anthology's real shape: the author list plus the proceedings
		// title. Repeating that under the authors in a card is worse than
		// showing no summary.
		stubUrl("aclanthology.org", fixture("acl-paper.html"));

		const meta = await resolveText("https://aclanthology.org/2023.acl-long.1/", chain(), ctx);

		expect(meta.title).toContain("One Cannot Stand for Everyone");
		expect(meta.abstract).toBeUndefined();
		expect(meta.description).toBeUndefined();
	});

	it("discards a description that is just the title again", async () => {
		stubUrl(
			"example.com",
			`<html><head><meta name="citation_title" content="Attention Is All You Need">
			<meta property="og:description" content="Attention Is All You Need"></head></html>`,
		);

		const meta = await resolveText("https://example.com/x", chain(), ctx);

		expect(meta.description).toBeUndefined();
	});

	it("prefers a registry abstract over a scraped description", async () => {
		stubUrl(
			"publisher.example",
			`<html><head><meta name="citation_title" content="Deep learning">
			<meta name="citation_doi" content="10.1038/nature14539">
			<meta property="og:description" content="Read this landmark review of deep learning methods and their many applications across science."></head></html>`,
		);
		stubUrl(
			"api.crossref.org",
			JSON.stringify({
				message: {
					title: ["Deep learning"],
					author: [],
					DOI: "10.1038/nature14539",
					abstract: "<jats:p>Deep learning allows computational models to learn representations.</jats:p>",
				},
			}),
		);

		const meta = await resolveText("https://publisher.example/article", chain(), ctx);

		expect(meta.abstract).toContain("learn representations");
		expect(meta.description).toContain("landmark review");
	});
});

describe("OpenReview", () => {
	it("reads a note from the api2 payload shape", async () => {
		// api2 wraps every content field as `{ value: ... }`.
		stubUrl(
			"api2.openreview.net",
			JSON.stringify({
				notes: [
					{
						id: "z71OSKqTFh7",
						forum: "z71OSKqTFh7",
						pdate: 1_646_000_000_000,
						content: {
							title: { value: "A Universal Law of Robustness via Isoperimetry" },
							authors: { value: ["Sebastien Bubeck", "Mark Sellke"] },
							venue: { value: "NeurIPS 2021" },
						},
					},
				],
			}),
		);

		const meta = await resolveText("https://openreview.net/forum?id=z71OSKqTFh7", chain(), ctx);

		expect(meta.title).toBe("A Universal Law of Robustness via Isoperimetry");
		expect(meta.authors).toEqual([
			{ given: "Sebastien", family: "Bubeck" },
			{ given: "Mark", family: "Sellke" },
		]);
		expect(meta.venue).toBe("NeurIPS 2021");
		expect(meta.pdfUrl).toBe("https://openreview.net/pdf?id=z71OSKqTFh7");
	});

	it("reads the older bare-value payload shape", async () => {
		stubUrl("api2.openreview.net", JSON.stringify({ notes: [] }));
		stubUrl(
			"api.openreview.net",
			JSON.stringify({
				notes: [{ id: "abc", forum: "abc", cdate: 1_500_000_000_000, content: { title: "An Older Paper", authors: ["Ada Lovelace"] } }],
			}),
		);

		const meta = await resolveText("https://openreview.net/forum?id=abc", chain(), ctx);

		expect(meta.title).toBe("An Older Paper");
		expect(meta.authors).toEqual([{ given: "Ada", family: "Lovelace" }]);
	});

	it("explains the browser challenge instead of citing the challenge page", async () => {
		// OpenReview answers unauthenticated API requests with a 403 and this
		// envelope, and its forum pages are client-rendered, so there is
		// genuinely nothing to cite. The user needs to be told why.
		stubUrl(
			"openreview.net/notes",
			JSON.stringify({
				name: "ChallengeRequiredError",
				message: "Challenge verification required",
				status: 403,
			}),
			403,
		);
		stubUrl(
			"openreview.net/forum",
			"<html><head><title>Verifying your browser</title></head></html>",
		);

		await expect(
			resolveText("https://openreview.net/forum?id=z71OSKqTFh7", chain(), ctx),
		).rejects.toThrow(/browser verification/);
	});

	it("only asks one endpoint when the answer is a challenge", async () => {
		stubUrl(
			"openreview.net/notes",
			JSON.stringify({ name: "ChallengeRequiredError", status: 403 }),
			403,
		);
		stubUrl("openreview.net/forum", "<html><head><title>Verifying your browser</title></head></html>");

		await expect(
			resolveText("https://openreview.net/forum?id=abc", chain(), ctx),
		).rejects.toThrow();

		const apiCalls = stubCalls().filter((c) => c.url.includes("openreview.net/notes"));
		expect(apiCalls).toHaveLength(1);
	});
});

describe("the generic HTML tier", () => {
	it("reads Highwire tags whatever order the attributes come in", async () => {
		// ACL Anthology writes `<meta content="..." name=citation_title>`,
		// unquoted and reversed from how arXiv writes it.
		stubUrl("aclanthology.org", fixture("acl-paper.html"));

		const meta = await resolveText("https://aclanthology.org/2023.acl-long.1/", chain(), ctx);

		expect(meta.title).toBe(
			"One Cannot Stand for Everyone! Leveraging Multiple User Simulators to train Task-oriented Dialogue Systems",
		);
		expect(meta.authors).toHaveLength(8);
		expect(meta.authors[0]).toEqual({ given: "Yajiao", family: "Liu" });
		expect(meta.venue).toContain("Association for Computational Linguistics");
		expect(meta.source).toContain("html:highwire");
	});

	it("leaves the date undefined when a page publishes none", async () => {
		// LessWrong's own tags carry title and author but no date. This is
		// exactly why the ForumMagnum resolver exists above this tier.
		stubUrl("lesswrong.com", fixture("lesswrong-post.html"));

		const meta = await resolveText(
			"https://www.lesswrong.com/posts/vJ7ggyjuP4u2yHNcP/x",
			chain({ enabledResolvers: { ...DEFAULT_SETTINGS.enabledResolvers, forummagnum: false } }),
			ctx,
		);

		expect(meta.title).toBe("Threat-Resistant Bargaining Megapost: Introducing the ROSE Value");
		expect(meta.authors).toEqual([{ given: "", family: "Diffractor" }]);
		expect(meta.date).toBeUndefined();
		expect(meta.source).toBe("html:highwire");
	});

	it("reads schema.org JSON-LD when there are no citation tags", async () => {
		stubUrl(
			"example.com",
			`<html><head><script type="application/ld+json">
			{"@context":"https://schema.org","@graph":[
			  {"@type":"WebSite","name":"A Site"},
			  {"@type":"BlogPosting","headline":"On Widgets",
			   "author":[{"@type":"Person","name":"Jane Q. Smith"},{"@type":"Person","name":"Ada Lovelace"}],
			   "datePublished":"2024-03-04T10:00:00Z","publisher":{"name":"Widget Weekly"}}
			]}</script></head></html>`,
		);

		const meta = await resolveText("https://example.com/widgets", chain(), ctx);

		expect(meta.title).toBe("On Widgets");
		expect(meta.authors).toEqual([
			{ given: "Jane Q.", family: "Smith" },
			{ given: "Ada", family: "Lovelace" },
		]);
		expect(meta.date).toBe("2024-03-04T10:00:00Z");
		expect(meta.venue).toBe("Widget Weekly");
		expect(meta.source).toBe("html:jsonld");
	});

	it("ignores malformed JSON-LD instead of failing", async () => {
		stubUrl(
			"example.com",
			`<html><head>
			<script type="application/ld+json">{ this is not json </script>
			<meta property="og:title" content="Fallback Title - Example">
			</head></html>`,
		);

		const meta = await resolveText("https://example.com/x", chain(), ctx);

		expect(meta.title).toBe("Fallback Title");
		expect(meta.source).toBe("html:opengraph");
	});

	it("drops a profile URL masquerading as an author", async () => {
		stubUrl(
			"example.com",
			`<html><head>
			<meta property="og:title" content="A Post">
			<meta property="article:author" content="https://example.com/users/jane">
			</head></html>`,
		);

		const meta = await resolveText("https://example.com/x", chain(), ctx);

		expect(meta.authors).toEqual([]);
	});

	it("falls back to the page title, trimming the site name", async () => {
		stubUrl(
			"example.com",
			"<html><head><title>A Modest Proposal — Example</title></head></html>",
		);

		const meta = await resolveText("https://example.com/x", chain(), ctx);

		expect(meta.title).toBe("A Modest Proposal");
		expect(meta.source).toBe("html:pagetitle");
	});

	it("keeps a subtitle that only looks like a site name", async () => {
		stubUrl(
			"example.com",
			"<html><head><title>Attention Is All You Need - A Retrospective</title></head></html>",
		);

		const meta = await resolveText("https://example.com/x", chain(), ctx);

		expect(meta.title).toBe("Attention Is All You Need - A Retrospective");
	});

	it.each([
		"Just a moment...",
		"Verifying your browser",
		"Checking your browser before accessing",
		"Attention Required! | Cloudflare",
		"Access denied",
		"403 Forbidden",
		"Page not found",
		"Please enable JavaScript to continue",
	])("refuses to cite an interstitial titled %s", async (title) => {
		// These arrive with HTTP 200 and a well-formed <title>, so without an
		// explicit check they become citations that look real but say nothing
		// about the document. A reported failure is strictly better.
		stubUrl("example.com", `<html><head><title>${title}</title></head></html>`);

		await expect(resolveText("https://example.com/x", chain(), ctx)).rejects.toThrow(
			/published no title/,
		);
	});

	it("still cites a real document whose own title looks alarming", async () => {
		// The guard only applies when a page offered no real metadata, so a
		// paper actually called "Access Denied" is unaffected.
		stubUrl(
			"example.com",
			`<html><head><meta name="citation_title" content="Access Denied: A Study of Paywalls">
			<meta name="citation_author" content="Jane Smith"></head></html>`,
		);

		const meta = await resolveText("https://example.com/x", chain(), ctx);

		expect(meta.title).toBe("Access Denied: A Study of Paywalls");
	});

	it("fails cleanly on a page with no title at all", async () => {
		stubUrl("example.com", "<html><head></head><body>hi</body></html>");

		await expect(resolveText("https://example.com/x", chain(), ctx)).rejects.toThrow(
			/published no title/,
		);
	});

	it("reports an HTTP failure with the status", async () => {
		stubUrl("example.com", "nope", 503);

		await expect(resolveText("https://example.com/x", chain(), ctx)).rejects.toThrow(
			/HTTP 503/,
		);
	});
});

describe("DOI resolution", () => {
	it("reads a Crossref record", async () => {
		stubUrl("api.crossref.org/works", fixture("crossref-deeplearning.json"));

		const meta = await resolveText("https://doi.org/10.1038/nature14539", chain(), ctx);

		expect(meta.title).toBe("Deep learning");
		expect(meta.authors).toEqual([
			{ given: "Yann", family: "LeCun" },
			{ given: "Yoshua", family: "Bengio" },
			{ given: "Geoffrey", family: "Hinton" },
		]);
		expect(meta.date).toBe("2015-05-27");
		expect(meta.venue).toBe("Nature");
		expect(meta.source).toBe("crossref");
	});

	it("adds the contact address when one is configured", async () => {
		stubUrl("api.crossref.org/works", fixture("crossref-deeplearning.json"));

		await resolveText("https://doi.org/10.1038/nature14539", chain(), {
			...ctx,
			mailto: "dave@example.com",
		});

		expect(stubCalls()[0].url).toContain("mailto=dave%40example.com");
	});

	it("falls back to DataCite when Crossref has no record", async () => {
		stubUrl("api.crossref.org", "{}", 404);
		stubUrl(
			"api.datacite.org",
			JSON.stringify({
				data: {
					attributes: {
						titles: [{ title: "A Dataset" }],
						creators: [{ givenName: "Ada", familyName: "Lovelace" }],
						publicationYear: 2021,
						doi: "10.5555/data",
						publisher: { name: "Zenodo" },
					},
				},
			}),
		);

		const meta = await resolveText("https://doi.org/10.5555/data", chain(), ctx);

		expect(meta.title).toBe("A Dataset");
		expect(meta.date).toBe("2021");
		expect(meta.venue).toBe("Zenodo");
		expect(meta.source).toBe("datacite");
	});

	it("falls back to OpenAlex when both registries miss", async () => {
		stubUrl("api.crossref.org", "{}", 404);
		stubUrl("api.datacite.org", "{}", 404);
		stubUrl(
			"api.openalex.org",
			JSON.stringify({
				title: "A Preprint",
				publication_date: "2023-02-01",
				doi: "https://doi.org/10.5555/pre",
				authorships: [{ author: { display_name: "Grace Hopper" } }],
				primary_location: { pdf_url: "https://x/y.pdf", source: { display_name: "bioRxiv" } },
			}),
		);

		const meta = await resolveText("https://doi.org/10.5555/pre", chain(), ctx);

		expect(meta.title).toBe("A Preprint");
		expect(meta.authors).toEqual([{ given: "Grace", family: "Hopper" }]);
		expect(meta.doi).toBe("10.5555/pre");
		expect(meta.source).toBe("openalex");
	});

	it("strips the JATS markup Crossref wraps abstracts in", async () => {
		stubUrl(
			"api.crossref.org",
			JSON.stringify({
				message: {
					title: ["A Paper"],
					author: [],
					DOI: "10.1000/x",
					abstract: "<jats:p>Some <jats:italic>emphasis</jats:italic> here.</jats:p>",
				},
			}),
		);

		const meta = await resolveText("https://doi.org/10.1000/x", chain(), ctx);

		expect(meta.abstract).not.toContain("<");
		expect(meta.abstract).toContain("emphasis");
	});

	it("does not claim a prefix shorter than a real DOI registrant", async () => {
		// DOI prefixes are `10.` plus 4-9 digits; "10.1/x" is not one, and
		// treating it as a DOI would send junk to Crossref.
		stubUrl("doi.org/10.1/x", "<html><head><title>Not a DOI</title></head></html>");

		const meta = await resolveText("https://doi.org/10.1/x", chain(), ctx);

		expect(meta.source).toBe("html:pagetitle");
	});
});

describe("a page that advertises its own DOI", () => {
	const page = `<html><head>
		<meta name="citation_title" content="Scraped Title">
		<meta name="citation_author" content="Page, Only">
		<meta name="citation_doi" content="10.1038/nature14539">
		<meta name="citation_pdf_url" content="https://publisher.example/paper.pdf">
	</head></html>`;

	it("prefers the registry record but keeps the pasted URL", async () => {
		stubUrl("publisher.example/article", page);
		stubUrl("api.crossref.org/works", fixture("crossref-deeplearning.json"));

		const meta = await resolveText("https://publisher.example/article", chain(), ctx);

		// Registry wins on title, authors and - since this record has one -
		// the PDF link.
		expect(meta.title).toBe("Deep learning");
		expect(meta.authors[0]).toEqual({ given: "Yann", family: "LeCun" });
		expect(meta.pdfUrl).toContain("nature.com");
		// But the link stays the page the user actually pasted, not whatever
		// landing page the DOI resolves to.
		expect(meta.url).toBe("https://publisher.example/article");
		expect(meta.source).toBe("crossref+html:highwire");
	});

	it("keeps the scraped PDF when the registry offers none", async () => {
		stubUrl("publisher.example/article", page);
		stubUrl(
			"api.crossref.org/works",
			JSON.stringify({
				message: { title: ["Deep learning"], author: [], DOI: "10.1038/nature14539" },
			}),
		);

		const meta = await resolveText("https://publisher.example/article", chain(), ctx);

		expect(meta.pdfUrl).toBe("https://publisher.example/paper.pdf");
		// Crossref listed no authors either, so the page's survive.
		expect(meta.authors).toEqual([{ given: "Only", family: "Page" }]);
	});

	it("keeps the scraped metadata when the registry is unreachable", async () => {
		stubUrl("publisher.example/article", page);
		stubMatcher((url) =>
			url.includes("api.crossref.org") || url.includes("api.datacite.org") || url.includes("api.openalex.org")
				? { body: "down", status: 500 }
				: undefined,
		);

		const meta = await resolveText("https://publisher.example/article", chain(), ctx);

		expect(meta.title).toBe("Scraped Title");
		expect(meta.doi).toBe("10.1038/nature14539");
		expect(meta.source).toBe("html:highwire");
	});
});

describe("chain fall-through", () => {
	it("tries the HTML tier after a site resolver fails", async () => {
		stubUrl("export.arxiv.org", "upstream is down", 500);
		stubUrl(
			"arxiv.org/abs/1706.03762",
			`<html><head><meta name="citation_title" content="Attention Is All You Need">
			<meta name="citation_author" content="Vaswani, Ashish"></head></html>`,
		);

		const meta = await resolveText("https://arxiv.org/abs/1706.03762", chain(), ctx);

		expect(meta.title).toBe("Attention Is All You Need");
		expect(meta.source).toBe("html:highwire");
	});

	it("reports every tier's error when they all fail", async () => {
		stubUrl("export.arxiv.org", "down", 500);
		stubUrl("arxiv.org/abs/", "also down", 502);

		await expect(resolveText("https://arxiv.org/abs/1706.03762", chain(), ctx)).rejects.toThrow(
			/arxiv: .*HTTP 500.*html: .*HTTP 502/,
		);
	});

	it("says so plainly when nothing claims the text", async () => {
		await expect(resolveText("not a link", chain(), ctx)).rejects.toThrow(
			/doesn't look like a link/,
		);
	});
});

describe("Citoid", () => {
	it("is only reachable once the user opts in", async () => {
		stubUrl("export.arxiv.org", "down", 500);
		stubUrl("arxiv.org/abs/", "<html><head></head></html>");
		stubUrl(
			"rest_v1/data/citation",
			JSON.stringify([
				{
					title: "Attention Is All You Need",
					author: [["Ashish", "Vaswani"], ["", "Diffractor"]],
					date: "2017-06-12",
					itemType: "preprint",
				},
			]),
		);

		// Off: the chain ends at the HTML tier, which finds no title.
		await expect(resolveText("https://arxiv.org/abs/1706.03762", chain(), ctx)).rejects.toThrow();

		const meta = await resolveText(
			"https://arxiv.org/abs/1706.03762",
			chain({ allowCitoid: true }),
			{ ...ctx, allowCitoid: true },
		);

		expect(meta.title).toBe("Attention Is All You Need");
		expect(meta.authors).toEqual([
			{ given: "Ashish", family: "Vaswani" },
			{ given: "", family: "Diffractor" },
		]);
		expect(meta.source).toBe("citoid");
	});
});
