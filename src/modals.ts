import { App, SuggestModal } from "obsidian";
import type { Preset } from "./types";

/**
 * Pick a format for one conversion, without changing the default.
 *
 * Shows each preset's rendered template as the description, because the
 * template string is the only thing that actually distinguishes them and the
 * names alone are easy to forget.
 */
export class PresetPickerModal extends SuggestModal<Preset> {
	constructor(
		app: App,
		private presets: Preset[],
		private onChoose: (preset: Preset) => void,
	) {
		super(app);
		this.setPlaceholder("Choose a citation format");
	}

	getSuggestions(query: string): Preset[] {
		const needle = query.toLowerCase();
		return this.presets.filter(
			(p) =>
				p.name.toLowerCase().includes(needle) ||
				p.template.toLowerCase().includes(needle),
		);
	}

	renderSuggestion(preset: Preset, el: HTMLElement): void {
		el.createEl("div", { text: preset.name });
		el.createEl("small", {
			text: preset.template,
			cls: "paper-citations-preset-template",
		});
	}

	onChooseSuggestion(preset: Preset): void {
		this.onChoose(preset);
	}
}
