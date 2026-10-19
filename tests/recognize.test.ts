import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/defaults";
import { buildResolvers, recognize } from "../src/resolvers/index";
import type { PaperCitationsSettings } from "../src/types";

function resolvers(overrides: Partial<PaperCitationsSettings> = {}) {
	return buildResolvers({ ...DEFAULT_SETTINGS, ...overrides });
}

const chain = resolvers();
const withBareIds = resolvers({ recognizeBareIds: true });
const withCitoid = resolvers({ allowCitoid: true });

describe("arXiv recognition", () => {
	it.each([
		["https://arxiv.org/abs/1706.03762", "1706.03762"],
		["http://arxiv.org/abs/1706.03762", "1706.03762"],
		["https://www.arxiv.org/abs/1706.03762", "1706.03762"],
		["https://export.arxiv.org/abs/1706.03762", "1706.03762"],
		["arxiv.org/abs/1706.03762", "1706.03762"],
		["https://arxiv.org/abs/1706.03762v7", "1706.03762v7"],
		["https://arxiv.org/pdf/2412.06769v1", "2412.06769v1"],
		["https://arxiv.org/pdf/2412.06769.pdf", "2412.06769"],
		["https://arxiv.org/pdf/2412.06769v1.pdf", "2412.06769v1"],
		["https://arxiv.org/html/2301.12345v2", "2301.12345v2"],
		["https://arxiv.org/format/2301.12345", "2301.12345"],
		["https://arxiv.org/abs/2301.12345?context=cs", "2301.12345"],
		["https://arxiv.org/abs/2301.12345#abstract", "2301.12345"],
		["https://arxiv.org/abs/2301.12345/", "2301.12345"],
		// Five-digit sequence numbers, used since 2015.
		["https://arxiv.org/abs/2301.123456".replace("123456", "12345"), "2301.12345"],
	])("claims %s", (input, id) => {
		const hit = recognize(input, chain);
		expect(hit?.resolver).toBe("arxiv");
		expect(hit?.id).toBe(id);
	});

	it.each([
		// Pre-2007 identifiers, which still appear in older notes.
		["https://arxiv.org/abs/math/9404236", "math/9404236"],
		["https://arxiv.org/abs/cs/9901002v1", "cs/9901002v1"],
		["https://arxiv.org/abs/cond-mat/0501001", "cond-mat/0501001"],
		["https://arxiv.org/abs/cs.CL/9901002", "cs.CL/9901002"],
		["https://arxiv.org/pdf/astro-ph/9812133", "astro-ph/9812133"],
	])("claims old-style %s", (input, id) => {
		const hit = recognize(input, chain);
		expect(hit?.resolver).toBe("arxiv");
		expect(hit?.id).toBe(id);
	});

	it("normalizes every form to the abstract page", () => {
		for (const input of [
			"https://arxiv.org/pdf/1706.03762.pdf",
			"https://arxiv.org/html/1706.03762",
			"http://export.arxiv.org/abs/1706.03762",
		]) {
			expect(recognize(input, chain)?.url).toBe("https://arxiv.org/abs/1706.03762");
		}
	});

	it("keeps the version suffix in the normalized URL", () => {
		expect(recognize("https://arxiv.org/pdf/1706.03762v3", chain)?.url).toBe(
			"https://arxiv.org/abs/1706.03762v3",
		);
	});

	it("claims a prefixed identifier without a URL", () => {
		expect(recognize("arXiv:2301.12345v2", chain)).toMatchObject({
			resolver: "arxiv",
			id: "2301.12345v2",
		});
	});

	it("ignores a bare identifier unless that is switched on", () => {
		expect(recognize("2301.12345", chain)).toBeNull();
		expect(recognize("2301.12345", withBareIds)).toMatchObject({ resolver: "arxiv" });
	});
});

describe("DOI recognition", () => {
	it.each([
		"https://doi.org/10.1038/nature14539",
		"http://dx.doi.org/10.1038/nature14539",
		"doi.org/10.1038/nature14539",
		"doi:10.1038/nature14539",
	])("claims %s", (input) => {
		expect(recognize(input, chain)).toMatchObject({
			resolver: "doi",
			id: "10.1038/nature14539",
			url: "https://doi.org/10.1038/nature14539",
		});
	});

	it("lowercases the DOI, which is case-insensitive by spec", () => {
		expect(recognize("https://doi.org/10.1038/NATURE14539", chain)?.id).toBe(
			"10.1038/nature14539",
		);
	});

	it("strips punctuation carried in from prose", () => {
		expect(recognize("https://doi.org/10.1234/abc.", chain)?.id).toBe("10.1234/abc");
		expect(recognize("https://doi.org/10.1234/abc).", chain)?.id).toBe("10.1234/abc");
	});

	it("ignores a bare DOI unless that is switched on", () => {
		expect(recognize("10.1038/nature14539", chain)).toBeNull();
		expect(recognize("10.1038/nature14539", withBareIds)).toMatchObject({ resolver: "doi" });
	});
});

describe("forum and OpenReview recognition", () => {
	it.each([
		["https://www.lesswrong.com/posts/vJ7ggyjuP4u2yHNcP/threat-resistant", "www.lesswrong.com"],
		["https://lesswrong.com/posts/vJ7ggyjuP4u2yHNcP", "www.lesswrong.com"],
		["https://www.alignmentforum.org/posts/pdaGN6pQyQarFHXF4/reward-is-not", "www.alignmentforum.org"],
		["https://forum.effectivealtruism.org/posts/abcdefghij1234/some-post", "forum.effectivealtruism.org"],
	])("claims %s", (input, host) => {
		const hit = recognize(input, chain);
		expect(hit?.resolver).toBe("forummagnum");
		expect(hit?.url).toContain(host);
	});

	it("preserves the host so the citation links back to the site pasted", () => {
		const af = recognize("https://www.alignmentforum.org/posts/pdaGN6pQyQarFHXF4/x", chain);
		expect(af?.url).toBe("https://www.alignmentforum.org/posts/pdaGN6pQyQarFHXF4/x");
	});

	it("does not claim a /posts/ path on an unrelated site", () => {
		const hit = recognize("https://example.com/posts/abcdefghij1234/x", chain);
		expect(hit?.resolver).toBe("html");
	});

	it.each([
		"https://openreview.net/forum?id=z71OSKqTFh7",
		"https://openreview.net/pdf?id=z71OSKqTFh7",
		"https://openreview.net/forum?noteId=abc&id=z71OSKqTFh7",
	])("claims %s", (input) => {
		expect(recognize(input, chain)).toMatchObject({
			resolver: "openreview",
			id: "z71OSKqTFh7",
			url: "https://openreview.net/forum?id=z71OSKqTFh7",
		});
	});
});

describe("the generic tiers", () => {
	it("falls through to the HTML tier for an ordinary page", () => {
		expect(recognize("https://aclanthology.org/2023.acl-long.1/", chain)).toMatchObject({
			resolver: "html",
		});
	});

	it("does not reach Citoid while it is switched off", () => {
		// Both claim any URL, so the only way to tell them apart is that the
		// HTML tier comes first and Citoid is absent from the chain.
		expect(chain.some((r) => r.name === "citoid")).toBe(false);
		expect(withCitoid.some((r) => r.name === "citoid")).toBe(true);
	});

	it("rejects things that are not links at all", () => {
		for (const input of [
			"",
			"   ",
			"just some prose",
			"see https://arxiv.org/abs/1706.03762 for details",
			"https://arxiv.org/abs/1706.03762 and more",
			"[Attention Is All You Need](https://arxiv.org/abs/1706.03762)",
			"ftp://example.com/paper.pdf",
			"https://localhost/paper",
		]) {
			expect(recognize(input, chain), input).toBeNull();
		}
	});

	it("tolerates surrounding whitespace, which a clipboard often adds", () => {
		expect(recognize("  https://arxiv.org/abs/1706.03762\n", chain)).toMatchObject({
			resolver: "arxiv",
		});
	});
});

describe("resolver ordering", () => {
	it("prefers a site resolver over the DOI and HTML tiers", () => {
		expect(chain.map((r) => r.name)).toEqual([
			"arxiv",
			"forummagnum",
			"openreview",
			"doi",
			"html",
		]);
	});

	it("omits a resolver the user switched off", () => {
		const noArxiv = resolvers({
			enabledResolvers: { ...DEFAULT_SETTINGS.enabledResolvers, arxiv: false },
		});
		expect(noArxiv.map((r) => r.name)).not.toContain("arxiv");
		// Without it, an arXiv URL is still citable through the generic tier.
		expect(recognize("https://arxiv.org/abs/1706.03762", noArxiv)?.resolver).toBe("html");
	});

	it("enables a resolver that old saved settings never mentioned", () => {
		const legacy = resolvers({ enabledResolvers: { arxiv: true } });
		expect(legacy.map((r) => r.name)).toContain("openreview");
	});
});
