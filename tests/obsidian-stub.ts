/**
 * Stands in for the `obsidian` module, which only exists inside the app.
 *
 * Only `requestUrl` matters for the resolver tests: everything the resolvers
 * fetch goes through it, so routing it to a table of recorded fixtures makes
 * the whole chain testable without a network.
 */

export interface RequestUrlParam {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	throw?: boolean;
}

export interface RequestUrlResponse {
	status: number;
	text: string;
	json: unknown;
	headers: Record<string, string>;
}

export interface StubRoute {
	status?: number;
	body: string;
}

type RouteMatcher = (url: string, request: RequestUrlParam) => StubRoute | undefined;

const routes: RouteMatcher[] = [];
const calls: RequestUrlParam[] = [];

/** Serve `body` for any URL containing `fragment`. */
export function stubUrl(fragment: string, body: string, status = 200): void {
	routes.push((url) => (url.includes(fragment) ? { body, status } : undefined));
}

/** Full control, for asserting on method or request body. */
export function stubMatcher(matcher: RouteMatcher): void {
	routes.push(matcher);
}

export function resetStubs(): void {
	routes.length = 0;
	calls.length = 0;
}

/** Every request made since the last reset, in order. */
export function stubCalls(): RequestUrlParam[] {
	return calls;
}

export async function requestUrl(param: RequestUrlParam): Promise<RequestUrlResponse> {
	calls.push(param);

	for (const matcher of routes) {
		const route = matcher(param.url, param);
		if (!route) continue;

		const status = route.status ?? 200;
		return {
			status,
			text: route.body,
			get json() {
				return JSON.parse(route.body);
			},
			headers: {},
		};
	}

	// An unrouted request is a test bug, not a network failure: say so loudly
	// rather than letting a resolver silently fall through to the next tier.
	throw new Error(`no stub registered for ${param.method ?? "GET"} ${param.url}`);
}

/* Unused by the tests, but imported transitively by the modules under test. */
export class Notice {
	constructor(public message: string | DocumentFragment) {}
	setMessage(): this {
		return this;
	}
	hide(): void {}
}

export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class SuggestModal {}
export class App {}
export class Modal {}
export class MarkdownView {}
