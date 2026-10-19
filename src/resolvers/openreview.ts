import { parseAuthor } from "../authors";
import { httpJson } from "../http";
import type { PaperMetadata, Recognized, Resolver } from "../types";

/**
 * OpenReview renders entirely client-side, so there are no meta tags for the
 * generic HTML tier to read — it needs the API. There are two: api2 serves
 * venues from 2023 on, and the original api serves everything older, so we try
 * api2 first and fall back.
 */
const FORUM_RE = /^(?:https?:\/\/)?(?:www\.)?openreview\.net\/(?:forum|pdf|references)\?(?:[^#]*&)?id=([A-Za-z0-9_-]+)/i;

interface OpenReviewNote {
	id?: string;
	forum?: string;
	cdate?: number;
	pdate?: number;
	content?: Record<string, unknown>;
}

/** Either a notes payload or one of OpenReview's error envelopes. */
interface OpenReviewPayload {
	notes?: OpenReviewNote[];
	name?: string;
	message?: string;
}

/**
 * api2 wraps every field as `{ value: ... }` while api1 stores the bare value.
 * Unwrap both so the rest of the function doesn't care which one answered.
 */
function fieldValue(content: Record<string, unknown> | undefined, key: string): unknown {
	const raw = content?.[key];
	if (raw && typeof raw === "object" && "value" in (raw as object)) {
		return (raw as { value: unknown }).value;
	}
	return raw;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export const openReviewResolver: Resolver = {
	name: "openreview",

	recognize(text: string): Recognized | null {
		const match = FORUM_RE.exec(text);
		if (!match) return null;
		const id = match[1];
		return {
			resolver: "openreview",
			url: `https://openreview.net/forum?id=${id}`,
			id,
			key: `openreview:${id}`,
		};
	},

	async resolve(hit: Recognized): Promise<PaperMetadata> {
		const id = hit.id ?? "";
		const note = await fetchNote(id);
		const content = note.content;

		const title = asString(fieldValue(content, "title"));
		if (!title) throw new Error(`OpenReview returned no title for ${id}`);

		const authors = asStringArray(fieldValue(content, "authors"));
		const venue = asString(fieldValue(content, "venue"));
		const stamp = note.pdate ?? note.cdate;

		return {
			title,
			authors: authors.map(parseAuthor),
			date: stamp ? new Date(stamp).toISOString() : undefined,
			url: `https://openreview.net/forum?id=${note.forum ?? id}`,
			pdfUrl: `https://openreview.net/pdf?id=${id}`,
			id,
			venue: venue ?? "OpenReview",
			abstract: asString(fieldValue(content, "abstract")),
			site: "openreview.net",
			source: "openreview",
		};
	},
};

async function fetchNote(id: string): Promise<OpenReviewNote> {
	const endpoints = [
		`https://api2.openreview.net/notes?id=${encodeURIComponent(id)}`,
		`https://api.openreview.net/notes?id=${encodeURIComponent(id)}`,
	];

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			// Read the body even on a 403: the challenge notice lives there.
			const body = await httpJson<OpenReviewPayload>(endpoint, { acceptAnyStatus: true });

			// As of late 2026 OpenReview answers unauthenticated API requests
			// with a bot challenge instead of data. Say so plainly: the user
			// can then copy the title by hand rather than wonder why an
			// OpenReview link silently refuses to convert.
			if (body.name === "ChallengeRequiredError") {
				throw new Error(
					"OpenReview is requiring browser verification for API requests, so its metadata " +
						"cannot be fetched. Open the page and copy the title, or cite the paper's arXiv " +
						"version if it has one.",
				);
			}

			const note = body.notes?.[0];
			if (note) return note;
		} catch (error) {
			lastError = error;
			// A challenge is the same on both endpoints, so stop rather than
			// making a second pointless request.
			if (error instanceof Error && error.message.includes("browser verification")) throw error;
		}
	}
	throw lastError instanceof Error ? lastError : new Error(`OpenReview has no record for ${id}`);
}
