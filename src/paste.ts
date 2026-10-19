import type { Editor, EditorPosition } from "obsidian";

/**
 * True when the cursor sits inside markdown link syntax, where a citation
 * would be nonsense.
 *
 * The case that matters: writing `see [this paper](` and then pasting. The URL
 * belongs in the destination exactly as copied, and expanding it there yields
 * `[this paper]([Authors (Year). Title](url))`, which is broken markdown and
 * loses the link text you just wrote. The same applies inside the link text
 * itself, and inside a reference-style definition.
 *
 * Operates on the text before the cursor on one line, since a destination
 * cannot span lines in practice.
 */
export function isInLinkSyntax(before: string): boolean {
	// A reference-style definition: `[label]: ` with the destination to come.
	if (/^\s{0,3}!?\[[^\]]*\]:\s*$/.test(before)) return true;

	// An open destination: the last `](` has no closing paren after it. URLs
	// containing parens are fine here - we only care whether the destination
	// has been closed yet, not how it is spelled.
	const open = before.lastIndexOf("](");
	if (open !== -1 && !before.includes(")", open + 2)) {
		// Confirm it really is link syntax by finding the text's opener.
		if (before.lastIndexOf("[", open) !== -1) return true;
	}

	// An unclosed `[`, so the cursor is in link text or a wikilink. Pasting a
	// citation here would nest brackets inside brackets.
	let depth = 0;
	for (const char of before) {
		if (char === "[") depth++;
		else if (char === "]" && depth > 0) depth--;
	}
	return depth > 0;
}

/**
 * Markdown contexts where a URL is not prose and must be left exactly as
 * typed: fenced code, inline code, the YAML frontmatter block, and link
 * syntax.
 */
export function isProtectedContext(editor: Editor, cursor: EditorPosition): boolean {
	const line = editor.getLine(cursor.line);
	const before = line.slice(0, cursor.ch);

	// Inline code: count backticks before the cursor on this line. An odd
	// count means we are inside a span.
	if ((before.match(/`/g) ?? []).length % 2 === 1) return true;

	if (isInLinkSyntax(before)) return true;

	let inFence = false;
	let inFrontmatter = false;

	for (let i = 0; i < cursor.line; i++) {
		const text = editor.getLine(i);

		// Frontmatter only counts when the document opens with the delimiter.
		if (i === 0 && /^---\s*$/.test(text)) {
			inFrontmatter = true;
			continue;
		}
		if (inFrontmatter) {
			if (/^(---|\.\.\.)\s*$/.test(text)) inFrontmatter = false;
			continue;
		}
		if (/^\s*(```|~~~)/.test(text)) inFence = !inFence;
	}

	return inFence || inFrontmatter;
}

/**
 * Text that should never be intercepted on paste, whatever the resolvers say.
 *
 * The markdown checks matter most: re-pasting a citation this plugin produced,
 * or a link copied from an existing note, must come through untouched rather
 * than being re-resolved into something nested.
 */
export function looksLikePlainUrl(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return false;
	// A single token only - anything with internal whitespace is prose, a
	// list, or several links at once, none of which we should rewrite.
	if (/\s/.test(trimmed)) return false;
	// Already markdown: a link, an image, or a wikilink.
	if (/[[\]()<>]/.test(trimmed) && !/^https?:\/\/\S+$/i.test(trimmed)) return false;
	if (/^!?\[/.test(trimmed)) return false;
	return true;
}

/**
 * A pending async replacement.
 *
 * The placeholder is the raw pasted text, inserted synchronously so the paste
 * never appears to do nothing and so a failed fetch degrades to exactly the
 * behaviour of pasting without this plugin.
 */
export interface PendingReplacement {
	placeholder: string;
	from: EditorPosition;
}

/** Insert the placeholder and return where it landed. */
export function insertPlaceholder(editor: Editor, text: string): PendingReplacement {
	const from = editor.getCursor("from");
	// replaceSelection, not replaceRange, so pasting over a selection behaves
	// the way a normal paste does.
	editor.replaceSelection(text);
	return { placeholder: text, from };
}

/**
 * Swap the placeholder for the rendered citation.
 *
 * The recorded position can be stale by the time the fetch returns - you may
 * have typed above it, or undone the paste entirely - so verify the text is
 * still there before touching it, and search nearby lines if it has shifted.
 * When it can't be found, do nothing: a surprise edit somewhere else in the
 * document is far worse than a link that stayed a link.
 */
export function replacePlaceholder(
	editor: Editor,
	pending: PendingReplacement,
	replacement: string,
): boolean {
	const found = locate(editor, pending);
	if (!found) return false;

	editor.replaceRange(replacement, found, {
		line: found.line,
		ch: found.ch + pending.placeholder.length,
	});

	// Leave the cursor after the inserted text, which is where it would be if
	// the citation had been pasted directly.
	const lines = replacement.split("\n");
	editor.setCursor(
		lines.length === 1
			? { line: found.line, ch: found.ch + replacement.length }
			: { line: found.line + lines.length - 1, ch: lines[lines.length - 1].length },
	);
	return true;
}

/** How many lines either side of the recorded position to search. */
const SEARCH_RADIUS = 20;

function locate(editor: Editor, pending: PendingReplacement): EditorPosition | null {
	const { placeholder, from } = pending;
	const lastLine = editor.lastLine();

	const exact = editor.getLine(Math.min(from.line, lastLine));
	if (exact?.startsWith(placeholder, from.ch)) return from;

	// Text may have shifted: scan outward from the recorded line, taking the
	// first unambiguous occurrence.
	for (let offset = 0; offset <= SEARCH_RADIUS; offset++) {
		for (const line of offset === 0 ? [from.line] : [from.line - offset, from.line + offset]) {
			if (line < 0 || line > lastLine) continue;
			const text = editor.getLine(line);
			if (!text) continue;
			const ch = text.indexOf(placeholder);
			// Only act when there is exactly one match on the line; two means
			// we cannot tell which one was ours.
			if (ch !== -1 && text.indexOf(placeholder, ch + 1) === -1) return { line, ch };
		}
	}
	return null;
}
