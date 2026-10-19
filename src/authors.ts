import type { Author, AuthorFormat } from "./types";

/** Suffixes that trail a name and must not be mistaken for the family name. */
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "phd", "ph.d"]);

/** Particles that belong to the family name, not the given names. */
const PARTICLES = new Set([
	"van", "von", "de", "del", "della", "der", "den",
	"di", "da", "dos", "du", "la", "le", "ter", "bin", "al",
]);

function isSuffix(part: string): boolean {
	return SUFFIXES.has(part.toLowerCase().replace(/\.$/, ""));
}

/**
 * Parse a name string into given/family parts.
 *
 * Sources disagree about format: arXiv's API returns "Vaswani, Ashish",
 * Crossref hands over given/family already split, and LessWrong returns a
 * handle like "Diffractor" with no structure at all. Anything we can't split
 * confidently becomes a mononym — all `family`, no `given` — which every
 * formatting style below renders as-is.
 */
export function parseAuthor(raw: string): Author {
	const name = raw.replace(/\s+/g, " ").trim();
	if (!name) return { given: "", family: "" };

	// "Family, Given" — the comma is an explicit signal, so trust it.
	const comma = name.indexOf(",");
	if (comma > 0) {
		const family = name.slice(0, comma).trim();
		const given = name.slice(comma + 1).trim();
		// "Smith, Jr." is a suffix, not a given name; keep the name whole.
		if (!given || isSuffix(given)) return { given: "", family: name };
		return { given, family };
	}

	const parts = name.split(" ");
	if (parts.length === 1) return { given: "", family: parts[0] };

	// Walk back past any suffix, then back again over particles, so
	// "Ludwig van Beethoven" keeps "van Beethoven" together.
	let end = parts.length;
	while (end > 1 && isSuffix(parts[end - 1])) end--;
	let start = end - 1;
	while (start > 1 && PARTICLES.has(parts[start - 1].toLowerCase())) start--;

	return {
		given: parts.slice(0, start).join(" "),
		family: parts.slice(start).join(" "),
	};
}

/** "Ashish Vaswani" — given names first, as you'd write it in prose. */
export function fullName(a: Author): string {
	return a.given ? `${a.given} ${a.family}` : a.family;
}

/** "A. Vaswani". Handles multiple and already-initialed given names. */
export function initialsName(a: Author): string {
	if (!a.given) return a.family;
	const initials = a.given
		.split(/[\s.]+/)
		.filter(Boolean)
		.map((part) => `${part[0].toUpperCase()}.`)
		.join(" ");
	return initials ? `${initials} ${a.family}` : a.family;
}

/** The surname alone, falling back to whatever we have. */
export function lastName(a: Author): string {
	return a.family || a.given;
}

/** Join names with the configured separators: "a, b, and c". */
function joinNames(names: string[], fmt: AuthorFormat): string {
	if (names.length === 0) return "";
	if (names.length === 1) return names[0];

	// With exactly two names the serial comma has nothing to separate, so drop
	// it: "Smith and Jones", not "Smith, and Jones". Only strip when the final
	// separator actually opens with a comma.
	const finalSep =
		names.length === 2 ? fmt.finalSeparator.replace(/^\s*,\s*/, " ") : fmt.finalSeparator;

	return names.slice(0, -1).join(fmt.separator) + finalSep + names[names.length - 1];
}

/** Render an author list per the user's settings. */
export function formatAuthors(authors: Author[], fmt: AuthorFormat): string {
	if (authors.length === 0) return "";

	switch (fmt.style) {
		case "full":
			return joinNames(authors.map(fullName), fmt);
		case "initials":
			return joinNames(authors.map(initialsName), fmt);
		case "lastNames":
			return joinNames(authors.map(lastName), fmt);
		case "etAl": {
			const names = authors.map(fullName);
			if (names.length <= fmt.etAlThreshold) return joinNames(names, fmt);
			return `${names[0]} et al.`;
		}
	}
}
