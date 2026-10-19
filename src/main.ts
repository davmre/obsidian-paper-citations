import {
	Editor,
	MarkdownFileInfo,
	MarkdownView,
	Notice,
	Plugin,
	type EditorPosition,
} from "obsidian";
import { MetadataCache } from "./cache";
import { DEFAULT_SETTINGS } from "./defaults";
import { PresetPickerModal } from "./modals";
import {
	insertPlaceholder,
	isProtectedContext,
	looksLikePlainUrl,
	replacePlaceholder,
	type PendingReplacement,
} from "./paste";
import { findLinks, linkAt } from "./links";
import { buildResolvers, recognize, resolveText } from "./resolvers/index";
import { PaperCitationsSettingTab } from "./settings";
import { buildVars, render } from "./template";
import type { FetchContext, PaperCitationsSettings, PaperMetadata, Resolver } from "./types";

interface PluginData {
	settings?: Partial<PaperCitationsSettings>;
	cache?: Record<string, { fetchedAt: number; meta: PaperMetadata }>;
}

export default class PaperCitationsPlugin extends Plugin {
	// The base class declares `settings?: unknown` and asks subclasses to
	// narrow it, which is what `declare` does here.
	declare settings: PaperCitationsSettings;
	cache!: MetadataCache;
	private resolvers: Resolver[] = [];

	async onload(): Promise<void> {
		const data = ((await this.loadData()) ?? {}) as PluginData;
		this.settings = mergeSettings(data.settings);

		this.cache = new MetadataCache(data.cache, this.settings.cacheTtlDays, (entries) => {
			void this.persist({ cache: entries });
		});

		this.rebuildResolvers();
		this.addSettingTab(new PaperCitationsSettingTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on("editor-paste", (evt, editor, info) => {
				this.onPaste(evt, editor, info);
			}),
		);

		this.registerCommands();
	}

	/** Pick up edits to data.json made by Obsidian Sync or another machine. */
	async onExternalSettingsChange(): Promise<void> {
		const data = ((await this.loadData()) ?? {}) as PluginData;
		this.settings = mergeSettings(data.settings);
		this.cache.setTtl(this.settings.cacheTtlDays);
		this.rebuildResolvers();
	}

	private registerCommands(): void {
		this.addCommand({
			id: "paste-citation",
			name: "Paste citation",
			editorCallback: (editor) => void this.pasteFromClipboard(editor, this.settings.defaultTemplate),
		});

		this.addCommand({
			id: "paste-citation-as",
			name: "Paste citation as...",
			editorCallback: (editor) => {
				new PresetPickerModal(this.app, this.settings.presets, (preset) => {
					void this.pasteFromClipboard(editor, preset.template);
				}).open();
			},
		});

		this.addCommand({
			id: "convert-link-under-cursor",
			name: "Convert link under cursor",
			editorCallback: (editor) => void this.convertUnderCursor(editor, this.settings.defaultTemplate),
		});

		this.addCommand({
			id: "convert-link-under-cursor-as",
			name: "Convert link under cursor as...",
			editorCallback: (editor) => {
				new PresetPickerModal(this.app, this.settings.presets, (preset) => {
					void this.convertUnderCursor(editor, preset.template);
				}).open();
			},
		});

		this.addCommand({
			id: "convert-all-links",
			name: "Convert all paper links in note",
			editorCallback: (editor) => void this.convertAll(editor),
		});

		this.addCommand({
			id: "toggle-convert-on-paste",
			name: "Toggle converting links on paste",
			callback: async () => {
				this.settings.convertOnPaste = !this.settings.convertOnPaste;
				await this.saveSettings();
				new Notice(
					this.settings.convertOnPaste
						? "Paper links will be converted on paste."
						: "Paper links will be pasted as-is.",
				);
			},
		});
	}

	rebuildResolvers(): void {
		this.resolvers = buildResolvers(this.settings);
	}

	async saveSettings(): Promise<void> {
		await this.persist({ settings: this.settings });
	}

	/**
	 * Settings and cache share one data file, so each write has to preserve
	 * the half it isn't changing.
	 */
	private async persist(patch: PluginData): Promise<void> {
		const existing = ((await this.loadData()) ?? {}) as PluginData;
		await this.saveData({ ...existing, ...patch });
	}

	private context(): FetchContext {
		return {
			mailto: this.settings.crossrefMailto,
			allowCitoid: this.settings.allowCitoid,
		};
	}

	/** Resolve through the cache, so repeats cost nothing. */
	private async lookup(text: string): Promise<PaperMetadata> {
		const hit = recognize(text, this.resolvers);
		const key = hit?.key ?? hit?.url ?? text;

		if (this.settings.cacheEnabled) {
			const cached = this.cache.get(key);
			if (cached) return cached;
		}

		const meta = await resolveText(text, this.resolvers, this.context());
		if (this.settings.cacheEnabled) this.cache.set(key, meta);
		return meta;
	}

	private format(meta: PaperMetadata, template: string, selection = ""): string {
		return render(template, buildVars(meta, this.settings.authorFormat, selection));
	}

	private onPaste(evt: ClipboardEvent, editor: Editor, _info: MarkdownView | MarkdownFileInfo): void {
		if (!this.settings.convertOnPaste) return;
		// Another handler already dealt with it.
		if (evt.defaultPrevented) return;

		const text = evt.clipboardData?.getData("text/plain") ?? "";
		if (!looksLikePlainUrl(text)) return;

		const trimmed = text.trim();
		if (!recognize(trimmed, this.resolvers)) return;
		if (isProtectedContext(editor, editor.getCursor("from"))) return;

		evt.preventDefault();

		const selection = editor.getSelection();
		const pending = insertPlaceholder(editor, trimmed);
		void this.resolveInto(editor, pending, trimmed, this.settings.defaultTemplate, selection);
	}

	/**
	 * Fetch, then replace the placeholder.
	 *
	 * Failures are reported but never edit the document: the raw URL is
	 * already in place, which is exactly what a paste without this plugin
	 * would have produced.
	 */
	private async resolveInto(
		editor: Editor,
		pending: PendingReplacement,
		text: string,
		template: string,
		selection: string,
	): Promise<void> {
		try {
			const meta = await this.lookup(text);
			const replaced = replacePlaceholder(editor, pending, this.format(meta, template, selection));
			if (!replaced) {
				new Notice("Paper Citations: the pasted link moved before the citation was ready.");
			}
		} catch (error) {
			new Notice(`Paper Citations: ${message(error)}`, 8000);
		}
	}

	private async pasteFromClipboard(editor: Editor, template: string): Promise<void> {
		// A command rather than the paste event, because some mobile keyboards
		// never fire a paste event at all.
		let text = "";
		try {
			text = await navigator.clipboard.readText();
		} catch {
			new Notice("Paper Citations: could not read the clipboard.");
			return;
		}

		const trimmed = text.trim();
		if (!trimmed) return;

		if (!recognize(trimmed, this.resolvers)) {
			editor.replaceSelection(text);
			return;
		}

		const selection = editor.getSelection();
		const pending = insertPlaceholder(editor, trimmed);
		await this.resolveInto(editor, pending, trimmed, template, selection);
	}

	private async convertUnderCursor(editor: Editor, template: string): Promise<void> {
		const cursor = editor.getCursor();
		const found = linkAt(editor.getLine(cursor.line), cursor.ch);
		if (!found) {
			new Notice("Paper Citations: no link under the cursor.");
			return;
		}

		const pending: PendingReplacement = {
			placeholder: found.text,
			from: { line: cursor.line, ch: found.start },
		};
		await this.resolveInto(editor, pending, found.url, template, "");
	}

	/**
	 * Convert every paper link in the note.
	 *
	 * Works bottom-up so each replacement can't shift the offsets of the ones
	 * still to come, and only touches links a specific resolver claims, so a
	 * note full of ordinary web links is left alone.
	 */
	private async convertAll(editor: Editor): Promise<void> {
		const matches = findLinks(editor.getValue()).filter((m) => {
			const hit = recognize(m.url, this.resolvers);
			return hit !== null && hit.resolver !== "html" && hit.resolver !== "citoid";
		});

		if (matches.length === 0) {
			new Notice("Paper Citations: no paper links found in this note.");
			return;
		}

		const notice = new Notice(`Paper Citations: converting 0/${matches.length}...`, 0);
		let converted = 0;
		const failures: string[] = [];

		// Sequential, not parallel: arXiv's API guidelines ask for a pause
		// between successive calls, and a note can hold dozens of links.
		for (const [index, match] of matches.entries()) {
			notice.setMessage(`Paper Citations: converting ${index + 1}/${matches.length}...`);
			try {
				const meta = await this.lookup(match.url);
				const replacement = this.format(meta, this.settings.defaultTemplate);
				// Re-derive positions from the current text each time, since
				// earlier replacements changed the document.
				const from = editor.offsetToPos(match.start);
				const to = editor.offsetToPos(match.start + match.text.length);
				if (editor.getRange(from, to) === match.text) {
					editor.replaceRange(replacement, from, to);
					converted++;
				}
			} catch (error) {
				failures.push(`${match.url}: ${message(error)}`);
			}
		}

		notice.hide();
		new Notice(
			failures.length === 0
				? `Paper Citations: converted ${converted} link${converted === 1 ? "" : "s"}.`
				: `Paper Citations: converted ${converted}, failed ${failures.length}. First error - ${failures[0]}`,
			8000,
		);
	}
}

/**
 * Fold saved settings onto the defaults.
 *
 * The nested objects have to be merged by hand: a plain spread would let a
 * data.json written by an earlier version drop whichever keys were added
 * since, leaving e.g. `authorFormat.etAlThreshold` undefined.
 */
function mergeSettings(saved: Partial<PaperCitationsSettings> | undefined): PaperCitationsSettings {
	return {
		...DEFAULT_SETTINGS,
		...saved,
		authorFormat: { ...DEFAULT_SETTINGS.authorFormat, ...saved?.authorFormat },
		enabledResolvers: { ...DEFAULT_SETTINGS.enabledResolvers, ...saved?.enabledResolvers },
		// Presets are a list the user curates, so an empty one is a real
		// choice and must not be refilled from the defaults.
		presets: saved?.presets ?? DEFAULT_SETTINGS.presets.map((p) => ({ ...p })),
	};
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
