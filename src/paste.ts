import type { Editor, EditorPosition } from "obsidian";

/**
 * Markdown contexts where a URL is not prose and must be left exactly as
 * typed: fenced code, inline code, and the YAML frontmatter block.
 */
export function isProtectedContext(editor: Editor, cursor: EditorPosition): boolean {
	const line = editor.getLine(cursor.line);

	// Inline code: count backticks before the cursor on this line. An odd
	// count means we are inside a span.
	const before = line.slice(0, cursor.ch);
	if ((before.match(/`/g) ?? []).length % 2 === 1) return true;

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
