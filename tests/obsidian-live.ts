/**
 * A real-network stand-in for the `obsidian` module, used only by the live
 * smoke test. Mirrors `requestUrl`'s contract closely enough for the
 * resolvers: no CORS to worry about outside a renderer, and `throw: false`
 * means a non-2xx response comes back rather than rejecting.
 */

export interface RequestUrlParam {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	throw?: boolean;
}

export async function requestUrl(param: RequestUrlParam) {
	const response = await fetch(param.url, {
		method: param.method ?? "GET",
		headers: param.headers,
		body: param.body,
	});
	const text = await response.text();
	return {
		status: response.status,
		text,
		get json() {
			return JSON.parse(text);
		},
		headers: Object.fromEntries(response.headers as unknown as Iterable<[string, string]>),
	};
}

export class Notice {
	constructor(public message: string) {}
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
