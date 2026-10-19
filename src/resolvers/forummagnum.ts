import { parseAuthor } from "../authors";
import { httpJson } from "../http";
import type { PaperMetadata, Recognized, Resolver } from "../types";

/**
 * LessWrong, the Alignment Forum and the EA Forum all run ForumMagnum, so one
 * GraphQL query covers all three. Post ids are shared between LessWrong and
 * the Alignment Forum (AF posts are LessWrong posts), but we query whichever
 * host was pasted so the resulting link stays on that site.
 *
 * The generic HTML tier would already get title and author here, from the
 * `citation_*` tags ForumMagnum emits — but those tags carry no date, and a
 * citation without a year is half a citation. Hence the API call.
 */
const SITES: Record<string, string> = {
	"lesswrong.com": "https://www.lesswrong.com",
	"www.lesswrong.com": "https://www.lesswrong.com",
	"alignmentforum.org": "https://www.alignmentforum.org",
	"www.alignmentforum.org": "https://www.alignmentforum.org",
	"forum.effectivealtruism.org": "https://forum.effectivealtruism.org",
	"eaforum.posts.in": "https://forum.effectivealtruism.org",
};

const POST_RE = /^(?:https?:\/\/)?([a-z0-9.-]+)\/posts\/([A-Za-z0-9]{10,24})(?:\/([^?#]*))?/i;

const QUERY = `query Post($id: String!) {
  post(input: { selector: { _id: $id } }) {
    result {
      _id
      title
      slug
      postedAt
      user { displayName username }
      coauthors { displayName username }
    }
  }
}`;

interface ForumUser {
	displayName?: string | null;
	username?: string | null;
}

interface ForumResponse {
	data?: {
		post?: {
			result?: {
				_id: string;
				title?: string | null;
				slug?: string | null;
				postedAt?: string | null;
				user?: ForumUser | null;
				coauthors?: ForumUser[] | null;
			} | null;
		} | null;
	} | null;
	errors?: { message: string }[];
}

function displayName(user: ForumUser | null | undefined): string | undefined {
	return user?.displayName || user?.username || undefined;
}

export const forumMagnumResolver: Resolver = {
	name: "forummagnum",

	recognize(text: string): Recognized | null {
		const match = POST_RE.exec(text);
		if (!match) return null;

		const origin = SITES[match[1].toLowerCase()];
		if (!origin) return null;

		const id = match[2];
		const slug = match[3] ?? "";
		return {
			resolver: "forummagnum",
			// Keep the pasted slug if there was one; the canonical slug comes
			// back from the API and replaces it after the fetch.
			url: slug ? `${origin}/posts/${id}/${slug}` : `${origin}/posts/${id}`,
			id: `${origin}|${id}`,
			key: `forummagnum:${origin}:${id}`,
		};
	},

	async resolve(hit: Recognized): Promise<PaperMetadata> {
		const [origin, id] = (hit.id ?? "").split("|");
		const response = await httpJson<ForumResponse>(`${origin}/graphql`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ query: QUERY, variables: { id } }),
		});

		if (response.errors?.length) throw new Error(response.errors[0].message);

		const post = response.data?.post?.result;
		if (!post?.title) throw new Error(`no post found for id ${id}`);

		const names = [
			displayName(post.user),
			...(post.coauthors ?? []).map(displayName),
		].filter((name): name is string => Boolean(name));

		const host = new URL(origin).hostname;
		return {
			title: post.title,
			authors: names.map(parseAuthor),
			date: post.postedAt ?? undefined,
			url: post.slug ? `${origin}/posts/${post._id}/${post.slug}` : hit.url,
			id: post._id,
			venue: host === "www.lesswrong.com" ? "LessWrong"
				: host === "www.alignmentforum.org" ? "Alignment Forum"
				: "EA Forum",
			site: host.replace(/^www\./, ""),
			source: "forummagnum",
		};
	},
};
