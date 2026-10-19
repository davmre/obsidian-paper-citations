import { describe, expect, it } from "vitest";
import { findLinks, linkAt } from "../src/links";
import {
	insertPlaceholder,
	isProtectedContext,
	looksLikePlainUrl,
	replacePlaceholder,
} from "../src/paste";
import type { Editor, EditorPosition } from "obsidian";

/**
 * A minimal stand-in for Obsidian's editor: enough of the surface that the
 * paste pipeline uses, backed by a plain array of lines, so the
 * insert-then-replace dance can be driven and inspected directly.
 */
class FakeEditor {
	lines: string[];
	cursor: EditorPosition = { line: 0, ch: 0 };
	selection = "";

	constructor(text: string, cursor?: EditorPosition) {
		this.lines = text.split("\n");
		if (cursor) this.cursor = cursor;
	}

	getLine(line: number): string {
		return this.lines[line];
	}

	lastLine(): number {
		return this.lines.length - 1;
	}

	getValue(): string {
		return this.lines.join("\n");
	}

	getCursor(): EditorPosition {
		return this.cursor;
	}

	setCursor(position: EditorPosition): void {
		this.cursor = position;
	}

	getSelection(): string {
		return this.selection;
	}

	replaceSelection(text: string): void {
		this.replaceRange(text, this.cursor, this.cursor);
	}

	replaceRange(text: string, from: EditorPosition, to: EditorPosition): void {
		const line = this.lines[from.line];
		const tail = this.lines[to.line].slice(to.ch);
		const replaced = line.slice(0, from.ch) + text + tail;
		this.lines.splice(from.line, to.line - from.line + 1, ...replaced.split("\n"));
		this.cursor = { line: from.line, ch: from.ch + text.length };
	}

	getRange(from: EditorPosition, to: EditorPosition): string {
		if (from.line === to.line) return this.lines[from.line].slice(from.ch, to.ch);
		return "";
	}

	/** Cast for the functions under test, which take the real Editor type. */
	as(): Editor {
		return this as unknown as Editor;
	}
}

describe("deciding whether to intercept a paste", () => {
	it.each([
		"https://arxiv.org/abs/1706.03762",
		"https://doi.org/10.1038/nature14539",
		"arXiv:2301.12345",
	])("accepts %s", (text) => {
		expect(looksLikePlainUrl(text)).toBe(true);
	});

	it("tolerates the newline a clipboard often appends", () => {
		expect(looksLikePlainUrl("https://arxiv.org/abs/1706.03762\n")).toBe(true);
	});

	it.each([
		// Re-pasting a citation this plugin produced must come through whole.
		["[Attention Is All You Need](https://arxiv.org/abs/1706.03762)", "a markdown link"],
		["![alt](https://example.com/x.png)", "an image"],
		["[[Some Note]]", "a wikilink"],
		["see https://arxiv.org/abs/1706.03762", "prose around a URL"],
		["https://a.com/x https://b.com/y", "two URLs at once"],
		["", "nothing"],
		["   ", "whitespace"],
	])("rejects %s (%s)", (text) => {
		expect(looksLikePlainUrl(text)).toBe(false);
	});
});

describe("contexts where a URL must be left alone", () => {
	it("leaves a fenced code block alone", () => {
		const editor = new FakeEditor(
			["prose", "```bash", "curl https://arxiv.org/abs/1706.03762", "```", "more"].join("\n"),
		);
		expect(isProtectedContext(editor.as(), { line: 2, ch: 5 })).toBe(true);
		// Outside the fence it is ordinary prose again.
		expect(isProtectedContext(editor.as(), { line: 4, ch: 0 })).toBe(false);
		expect(isProtectedContext(editor.as(), { line: 0, ch: 0 })).toBe(false);
	});

	it("handles tilde fences too", () => {
		const editor = new FakeEditor(["~~~", "x", "~~~", "after"].join("\n"));
		expect(isProtectedContext(editor.as(), { line: 1, ch: 0 })).toBe(true);
		expect(isProtectedContext(editor.as(), { line: 3, ch: 0 })).toBe(false);
	});

	it("leaves frontmatter alone", () => {
		const editor = new FakeEditor(
			["---", "tags: [papers]", "source: ", "---", "", "body"].join("\n"),
		);
		expect(isProtectedContext(editor.as(), { line: 2, ch: 8 })).toBe(true);
		expect(isProtectedContext(editor.as(), { line: 5, ch: 0 })).toBe(false);
	});

	it("does not treat a mid-note rule as frontmatter", () => {
		// A `---` that is not on line 1 is a horizontal rule, not a delimiter.
		const editor = new FakeEditor(["body", "---", "more"].join("\n"));
		expect(isProtectedContext(editor.as(), { line: 2, ch: 0 })).toBe(false);
	});

	it("leaves an inline code span alone", () => {
		const editor = new FakeEditor("run `curl X` then paste");
		expect(isProtectedContext(editor.as(), { line: 0, ch: 8 })).toBe(true);
		// After the closing backtick the count is even again.
		expect(isProtectedContext(editor.as(), { line: 0, ch: 20 })).toBe(false);
	});
});

describe("the async placeholder swap", () => {
	it("inserts the raw URL, then replaces it with the citation", () => {
		const editor = new FakeEditor("Start: ", { line: 0, ch: 7 });
		const url = "https://arxiv.org/abs/1706.03762";

		const pending = insertPlaceholder(editor.as(), url);
		// Synchronously, the note already holds the URL - which is exactly
		// what a paste without this plugin would have produced.
		expect(editor.getValue()).toBe(`Start: ${url}`);

		expect(replacePlaceholder(editor.as(), pending, "[Attention](x)")).toBe(true);
		expect(editor.getValue()).toBe("Start: [Attention](x)");
	});

	it("leaves the cursor after the citation", () => {
		const editor = new FakeEditor("", { line: 0, ch: 0 });
		const pending = insertPlaceholder(editor.as(), "https://arxiv.org/abs/1706.03762");

		replacePlaceholder(editor.as(), pending, "[A](b)");

		expect(editor.getCursor()).toEqual({ line: 0, ch: 6 });
	});

	it("finds the placeholder again after text is typed above it", () => {
		const editor = new FakeEditor("", { line: 0, ch: 0 });
		const url = "https://arxiv.org/abs/1706.03762";
		const pending = insertPlaceholder(editor.as(), url);

		// Simulate the user typing two new lines above while the fetch runs.
		editor.lines = ["new first line", "new second line", url];

		expect(replacePlaceholder(editor.as(), pending, "[A](b)")).toBe(true);
		expect(editor.lines[2]).toBe("[A](b)");
	});

	it("does nothing when the placeholder is gone", () => {
		// The user undid the paste, or deleted the line, before the fetch
		// returned. Editing anything else here would be a surprise.
		const editor = new FakeEditor("", { line: 0, ch: 0 });
		const pending = insertPlaceholder(editor.as(), "https://arxiv.org/abs/1706.03762");
		editor.lines = ["something else entirely"];

		expect(replacePlaceholder(editor.as(), pending, "[A](b)")).toBe(false);
		expect(editor.getValue()).toBe("something else entirely");
	});

	it("declines when the same URL appears twice on the line", () => {
		// Two candidates and no way to tell which was ours, so leave both.
		const editor = new FakeEditor("", { line: 0, ch: 0 });
		const url = "https://arxiv.org/abs/1706.03762";
		const pending = insertPlaceholder(editor.as(), url);
		editor.lines = [`x ${url} y ${url} z`];

		expect(replacePlaceholder(editor.as(), pending, "[A](b)")).toBe(false);
	});

	it("still replaces when the line shifted but the position is exact", () => {
		const editor = new FakeEditor("prefix ", { line: 0, ch: 7 });
		const url = "https://doi.org/10.1038/nature14539";
		const pending = insertPlaceholder(editor.as(), url);

		expect(replacePlaceholder(editor.as(), pending, "cite")).toBe(true);
		expect(editor.getValue()).toBe("prefix cite");
	});
});

describe("finding links in existing notes", () => {
	it("finds a bare URL and a markdown link, last first", () => {
		const text = "a https://arxiv.org/abs/1 b [T](https://arxiv.org/abs/2) c";
		const found = findLinks(text);

		expect(found).toHaveLength(2);
		// Reversed, so replacing them in order keeps earlier offsets valid.
		expect(found[0].url).toBe("https://arxiv.org/abs/2");
		expect(found[0].text).toBe("[T](https://arxiv.org/abs/2)");
		expect(found[1].url).toBe("https://arxiv.org/abs/1");
		expect(found[1].text).toBe("https://arxiv.org/abs/1");
	});

	it("does not also match the target inside a markdown link", () => {
		// Without the lookbehind this would yield two matches and the
		// note-wide conversion would mangle the link.
		expect(findLinks("[T](https://arxiv.org/abs/1)")).toHaveLength(1);
	});

	it("reports offsets that address the right span", () => {
		const text = "see [T](https://arxiv.org/abs/2) here";
		const [match] = findLinks(text);

		expect(text.slice(match.start, match.start + match.text.length)).toBe(match.text);
	});

	it("drops sentence punctuation from a bare URL", () => {
		expect(findLinks("read https://arxiv.org/abs/1706.03762.")[0].url).toBe(
			"https://arxiv.org/abs/1706.03762",
		);
		expect(findLinks("(see https://arxiv.org/abs/1706.03762)")[0].url).toBe(
			"https://arxiv.org/abs/1706.03762",
		);
	});

	it("keeps a URL that legitimately ends in a paren-free path", () => {
		expect(findLinks("https://en.wikipedia.org/wiki/Bayes_theorem")[0].url).toBe(
			"https://en.wikipedia.org/wiki/Bayes_theorem",
		);
	});

	it("handles the vault's real formatting habits", () => {
		// Shapes taken from existing notes: a titled link, a parenthesised
		// bare URL after an author-year citation, and a bare "see also".
		const text = [
			"(summarizing Minh et al. 2016, [Asynchronous Methods](https://arxiv.org/abs/1602.01783))",
			"Milledge et al. (2022), Universal Hopfield Networks (https://arxiv.org/abs/2202.04557)",
			"see also: https://arxiv.org/abs/2308.08708",
		].join("\n");

		const urls = findLinks(text).map((m) => m.url);

		expect(urls).toEqual([
			"https://arxiv.org/abs/2308.08708",
			"https://arxiv.org/abs/2202.04557",
			"https://arxiv.org/abs/1602.01783",
		]);
	});

	it("finds nothing in a note with no links", () => {
		expect(findLinks("just prose, and an [[internal link]]")).toEqual([]);
	});
});

describe("the link under the cursor", () => {
	const line = "see [T](https://arxiv.org/abs/2) and https://arxiv.org/abs/3 too";

	it("finds a markdown link the cursor sits inside", () => {
		expect(linkAt(line, 10)?.url).toBe("https://arxiv.org/abs/2");
	});

	it("finds a link the cursor rests just after", () => {
		// Where the cursor lands once you finish typing or pasting one.
		const end = line.indexOf(")") + 1;
		expect(linkAt(line, end)?.url).toBe("https://arxiv.org/abs/2");
	});

	it("finds a bare URL", () => {
		expect(linkAt(line, 45)?.url).toBe("https://arxiv.org/abs/3");
	});

	it("returns nothing when the cursor is in plain prose", () => {
		expect(linkAt(line, 1)).toBeNull();
		expect(linkAt("no links at all", 5)).toBeNull();
	});
});
