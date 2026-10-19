/**
 * A markdown link's URL, or a bare URL that isn't already inside one.
 *
 * The lookbehind keeps the two alternatives from overlapping: without it the
 * bare-URL branch could also match the target inside `[x](url)` and the
 * note-wide conversion would rewrite half of an existing link. It tests for
 * `](` specifically rather than a bare `(`, because wrapping a plain URL in
 * parentheses - `Universal Hopfield Networks (https://arxiv.org/abs/...)` - is
 * an ordinary way to write one and must still be recognized.
 */
export const LINK_PATTERN = /\[[^\]\n]*\]\((https?:\/\/[^)\s]+)\)|(?<!\]\()\b(https?:\/\/[^\s)<>\]]+)/g;

export interface LinkMatch {
	/** The whole span to replace: a complete markdown link, or a bare URL. */
	text: string;
	url: string;
	start: number;
}

/** Trailing characters that are punctuation in prose, not part of the URL. */
const TRAILING_PUNCTUATION = /[.,;:!?'"]+$/;

function cleanMatch(text: string, url: string, start: number): LinkMatch {
	// Only a bare URL can pick up sentence punctuation; inside `](...)` the
	// closing paren already bounds it.
	if (text === url) {
		const trimmed = url.replace(TRAILING_PUNCTUATION, "");
		return { text: trimmed, url: trimmed, start };
	}
	return { text, url, start };
}

/**
 * Every link in the text.
 *
 * Returned last-first so a caller replacing them in sequence doesn't
 * invalidate the offsets of the ones it hasn't reached yet.
 */
export function findLinks(text: string): LinkMatch[] {
	const matches: LinkMatch[] = [];

	for (const match of text.matchAll(LINK_PATTERN)) {
		const url = match[1] ?? match[2];
		if (!url) continue;
		matches.push(cleanMatch(match[0], url, match.index));
	}
	return matches.reverse();
}

/**
 * The link the cursor sits in, if any.
 *
 * `ch` is inclusive at both ends, so a cursor resting immediately after a
 * link still counts - that's where it lands after you finish typing one.
 */
export function linkAt(line: string, ch: number): LinkMatch | null {
	for (const match of line.matchAll(LINK_PATTERN)) {
		const url = match[1] ?? match[2];
		if (!url) continue;

		const cleaned = cleanMatch(match[0], url, match.index);
		if (ch >= cleaned.start && ch <= cleaned.start + cleaned.text.length) return cleaned;
	}
	return null;
}
