import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/defaults";
import { buildResolvers, resolveText } from "../src/resolvers/index";
import type { FetchContext } from "../src/types";

/**
 * Hits the real services. Run with `npm run smoke`, not as part of `npm test`.
 *
 * The point is not to re-test the parsing logic - the fixture suite does that
 * offline - but to notice when an upstream response shape changes underneath
 * us. Each case asserts only on facts about a specific published document that
 * will not change: who wrote it, roughly when, and what it is called.
 */
const ctx: FetchContext = { mailto: "", allowCitoid: false };
const chain = buildResolvers(DEFAULT_SETTINGS);

/** arXiv's API guidelines ask for a pause between successive calls. */
async function pause(ms = 3100): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("upstream services", () => {
	it("arXiv still serves Atom with per-author names", async () => {
		const meta = await resolveText("https://arxiv.org/abs/1706.03762", chain, ctx);

		expect(meta.title).toBe("Attention Is All You Need");
		expect(meta.authors).toHaveLength(8);
		expect(meta.authors[0].family).toBe("Vaswani");
		expect(meta.date?.startsWith("2017")).toBe(true);
		expect(meta.pdfUrl).toContain("/pdf/1706.03762");
		await pause();
	});

	it("arXiv still accepts pre-2007 identifiers", async () => {
		const meta = await resolveText("https://arxiv.org/abs/math/9404236", chain, ctx);

		expect(meta.title).toBe("On proof and progress in mathematics");
		expect(meta.authors[0].family).toBe("Thurston");
		await pause();
	});

	it("ForumMagnum's GraphQL schema still answers the post query", async () => {
		const meta = await resolveText(
			"https://www.lesswrong.com/posts/vJ7ggyjuP4u2yHNcP/x",
			chain,
			ctx,
		);

		expect(meta.title).toContain("ROSE Value");
		expect(meta.authors[0].family).toBe("Diffractor");
		// The date is the whole reason this resolver exists rather than
		// letting the HTML tier handle LessWrong.
		expect(meta.date?.startsWith("2022")).toBe(true);
		expect(meta.source).toBe("forummagnum");
	});

	it("Crossref still returns title, authors and issued date", async () => {
		const meta = await resolveText("https://doi.org/10.1038/nature14539", chain, ctx);

		expect(meta.title).toBe("Deep learning");
		expect(meta.authors.map((a) => a.family)).toEqual(["LeCun", "Bengio", "Hinton"]);
		expect(meta.venue).toBe("Nature");
		expect(meta.source).toBe("crossref");
	});

	it("ACL Anthology still publishes Highwire tags", async () => {
		const meta = await resolveText("https://aclanthology.org/2023.acl-long.1/", chain, ctx);

		expect(meta.title).toContain("One Cannot Stand for Everyone");
		expect(meta.authors.length).toBeGreaterThan(1);
		expect(meta.source).toContain("highwire");
	});

	/**
	 * OpenReview gates unauthenticated API access behind a browser challenge
	 * (confirmed on both api.openreview.net and api2.openreview.net on
	 * 2026-10-19), and its forum pages are client-rendered with no metadata in
	 * the HTML. So there is nothing to fetch, and the honest behaviour is a
	 * clear error rather than a citation built from the challenge page.
	 *
	 * This test asserts whichever of those two outcomes holds. If the
	 * challenge is ever lifted, the first branch starts passing and the
	 * resolver works unchanged.
	 */
	it("OpenReview either answers or explains why it cannot", async () => {
		const result = await resolveText(
			"https://openreview.net/forum?id=z71OSKqTFh7",
			chain,
			ctx,
		).then(
			(meta) => ({ ok: true as const, meta }),
			(error: Error) => ({ ok: false as const, error }),
		);

		if (result.ok) {
			expect(result.meta.title).toContain("Universal Law of Robustness");
			expect(result.meta.source).toBe("openreview");
			return;
		}

		// Blocked: the message must name the cause, and must not be a citation
		// scraped from the interstitial.
		expect(result.error.message).toMatch(/browser verification|HTTP 403/);
		expect(result.error.message).not.toMatch(/Verifying your browser/);
	});
});

describe("abstract and summary coverage", () => {
	/**
	 * Which sources actually carry a usable summary, checked live. This is the
	 * table the README's coverage claims rest on, so it is worth asserting
	 * rather than assuming.
	 */
	it("arXiv carries a full abstract", async () => {
		const meta = await resolveText("https://arxiv.org/abs/1706.03762", chain, ctx);

		expect(meta.abstract).toContain("dominant sequence transduction models");
		// Long enough to be the real abstract, not a truncated blurb.
		expect(meta.abstract!.length).toBeGreaterThan(500);
		await pause();
	});

	it("LessWrong carries an excerpt, and no abstract", async () => {
		const meta = await resolveText(
			"https://www.lesswrong.com/posts/vJ7ggyjuP4u2yHNcP/x",
			chain,
			ctx,
		);

		expect(meta.abstract).toBeUndefined();
		expect(meta.description!.length).toBeGreaterThan(300);
	});

	it("ACL Anthology yields no summary rather than its author list", async () => {
		// Its og:description is the authors plus the proceedings title.
		const meta = await resolveText("https://aclanthology.org/2023.acl-long.1/", chain, ctx);

		expect(meta.abstract).toBeUndefined();
		expect(meta.description).toBeUndefined();
	});
});
