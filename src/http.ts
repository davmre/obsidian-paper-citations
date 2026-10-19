import { requestUrl } from "obsidian";

const USER_AGENT = "obsidian-paper-citations/1.0 (https://github.com/davmre/obsidian-paper-citations)";

export interface HttpOptions {
	method?: "GET" | "POST";
	headers?: Record<string, string>;
	body?: string;
	/**
	 * Return the body even on a non-2xx status instead of throwing. For APIs
	 * that put a machine-readable explanation in the body of an error
	 * response, which is worth reading before giving up.
	 */
	acceptAnyStatus?: boolean;
}

/**
 * Fetch a URL and return the body as text.
 *
 * Everything goes through Obsidian's `requestUrl` rather than `fetch`: it runs
 * outside the renderer's origin, so there is no CORS preflight to satisfy for
 * arXiv, Crossref or an arbitrary publisher's HTML, and it behaves the same on
 * mobile. `throw: false` lets us turn a 404 into a readable message instead of
 * an opaque network error.
 */
export async function httpText(url: string, opts: HttpOptions = {}): Promise<string> {
	const response = await requestUrl({
		url,
		method: opts.method ?? "GET",
		headers: { "User-Agent": USER_AGENT, ...opts.headers },
		body: opts.body,
		throw: false,
	});

	if (!opts.acceptAnyStatus && (response.status < 200 || response.status >= 300)) {
		throw new Error(`${hostOf(url)} returned HTTP ${response.status}`);
	}
	return response.text;
}

export async function httpJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
	const text = await httpText(url, {
		...opts,
		headers: { Accept: "application/json", ...opts.headers },
	});
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new Error(`${hostOf(url)} returned a response that was not JSON`);
	}
}

export function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

/** Parse XML or HTML into a Document, with a clear error if it won't parse. */
export function parseDocument(text: string, type: DOMParserSupportedType): Document {
	const doc = new DOMParser().parseFromString(text, type);
	if (type !== "text/html" && doc.getElementsByTagName("parsererror").length > 0) {
		throw new Error("could not parse the response as XML");
	}
	return doc;
}

/**
 * Find descendants by local name, ignoring namespace prefixes.
 *
 * arXiv's Atom feed mixes default-namespace Atom elements with prefixed ones
 * like `arxiv:doi`, and whether `getElementsByTagName("arxiv:doi")` matches
 * depends on the prefix the server happened to use. Matching on local name
 * sidesteps that.
 */
export function childrenByLocalName(root: Element | Document, local: string): Element[] {
	return Array.from(root.getElementsByTagName("*")).filter(
		(el) => (el.localName ?? el.nodeName.replace(/^.*:/, "")) === local,
	);
}

export function textByLocalName(root: Element | Document, local: string): string | undefined {
	const value = childrenByLocalName(root, local)[0]?.textContent?.trim();
	return value || undefined;
}
