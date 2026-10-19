import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { formatAuthors } from "./authors";
import { DEFAULT_PRESETS } from "./defaults";
import { RESOLVER_LABELS, RESOLVER_NAMES } from "./resolvers/index";
import { buildVars, render, TEMPLATE_VARIABLES } from "./template";
import type { AuthorStyle, PaperMetadata } from "./types";
import type PaperCitationsPlugin from "./main";

/** Stand-in metadata for the live preview, so a template can be checked. */
const SAMPLE: PaperMetadata = {
	title: "Attention Is All You Need",
	authors: [
		{ given: "Ashish", family: "Vaswani" },
		{ given: "Noam", family: "Shazeer" },
		{ given: "Niki", family: "Parmar" },
		{ given: "Jakob", family: "Uszkoreit" },
	],
	date: "2017-06-12",
	url: "https://arxiv.org/abs/1706.03762",
	pdfUrl: "https://arxiv.org/pdf/1706.03762",
	id: "1706.03762",
	venue: "arXiv",
	site: "arxiv.org",
};

const AUTHOR_STYLES: Record<AuthorStyle, string> = {
	full: "Full names",
	etAl: "Full names, then et al.",
	lastNames: "Surnames only",
	initials: "Initials and surname",
};

export class PaperCitationsSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: PaperCitationsPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.addPasteSection();
		this.addTemplateSection();
		this.addAuthorSection();
		this.addPresetSection();
		this.addSourceSection();
		this.addCacheSection();
	}

	private settings() {
		return this.plugin.settings;
	}

	private async save(): Promise<void> {
		await this.plugin.saveSettings();
	}

	private addPasteSection(): void {
		new Setting(this.containerEl).setName("Pasting").setHeading();

		new Setting(this.containerEl)
			.setName("Convert links on paste")
			.setDesc(
				"When off, pasting is left alone and the commands are the only way to convert a link.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.settings().convertOnPaste).onChange(async (value) => {
					this.settings().convertOnPaste = value;
					await this.save();
				}),
			);

		new Setting(this.containerEl)
			.setName("Recognize bare identifiers")
			.setDesc(
				'Also convert a pasted "2301.12345" or "10.1038/nature14539" with no surrounding URL. ' +
					"Off by default, because those are hard to tell from ordinary text.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.settings().recognizeBareIds).onChange(async (value) => {
					this.settings().recognizeBareIds = value;
					await this.save();
					this.plugin.rebuildResolvers();
				}),
			);
	}

	private addTemplateSection(): void {
		new Setting(this.containerEl).setName("Format").setHeading();

		const preview = createDiv({ cls: "paper-citations-preview" });

		const refresh = () => {
			preview.empty();
			preview.createEl("small", { text: "Preview" });
			preview.createEl("code", {
				text: render(
					this.settings().defaultTemplate,
					buildVars(SAMPLE, this.settings().authorFormat),
				),
			});
		};

		new Setting(this.containerEl)
			.setName("Template used on paste")
			.setDesc(
				"Substitution is literal, so wikilinks and escapes such as \\[ pass through untouched. " +
					"Wrap text in {{#name}}...{{/name}} to drop it when that value is missing.",
			)
			.addTextArea((area) => {
				area.inputEl.rows = 3;
				area.inputEl.addClass("paper-citations-template-input");
				area
					.setValue(this.settings().defaultTemplate)
					.onChange(async (value) => {
						this.settings().defaultTemplate = value;
						refresh();
						await this.save();
					});
			});

		this.containerEl.appendChild(preview);
		refresh();

		const vars = this.containerEl.createDiv({ cls: "paper-citations-variables" });
		vars.createEl("small", { text: "Available: " });
		vars.createEl("small", {
			text: TEMPLATE_VARIABLES.map((name) => `{{${name}}}`).join("  "),
			cls: "paper-citations-variable-list",
		});
	}

	private addAuthorSection(): void {
		new Setting(this.containerEl).setName("Authors").setHeading();

		const sample = createDiv({ cls: "paper-citations-preview" });
		const refresh = () => {
			sample.empty();
			sample.createEl("small", { text: "Preview" });
			sample.createEl("code", {
				text: formatAuthors(SAMPLE.authors, this.settings().authorFormat) || "(none)",
			});
		};

		new Setting(this.containerEl).setName("Name style").addDropdown((dropdown) => {
			for (const [value, label] of Object.entries(AUTHOR_STYLES)) {
				dropdown.addOption(value, label);
			}
			dropdown.setValue(this.settings().authorFormat.style).onChange(async (value) => {
				this.settings().authorFormat.style = value as AuthorStyle;
				refresh();
				await this.save();
			});
		});

		new Setting(this.containerEl)
			.setName("Collapse to et al. above")
			.setDesc('Only used by the "Full names, then et al." style.')
			.addText((text) =>
				text
					.setValue(String(this.settings().authorFormat.etAlThreshold))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						// Ignore an unparseable value rather than storing NaN
						// and silently breaking every later render.
						if (!Number.isFinite(parsed) || parsed < 1) return;
						this.settings().authorFormat.etAlThreshold = parsed;
						refresh();
						await this.save();
					}),
			);

		new Setting(this.containerEl)
			.setName("Separator")
			.addText((text) =>
				text
					.setPlaceholder(", ")
					.setValue(this.settings().authorFormat.separator)
					.onChange(async (value) => {
						this.settings().authorFormat.separator = value;
						refresh();
						await this.save();
					}),
			);

		new Setting(this.containerEl)
			.setName("Separator before the last name")
			.setDesc("With exactly two authors a leading comma is dropped automatically.")
			.addText((text) =>
				text
					.setPlaceholder(", and ")
					.setValue(this.settings().authorFormat.finalSeparator)
					.onChange(async (value) => {
						this.settings().authorFormat.finalSeparator = value;
						refresh();
						await this.save();
					}),
			);

		this.containerEl.appendChild(sample);
		refresh();
	}

	private addPresetSection(): void {
		new Setting(this.containerEl).setName("Saved formats").setHeading();

		new Setting(this.containerEl)
			.setDesc(
				'Reachable from the "Paste citation as..." and "Convert link under cursor as..." commands.',
			)
			.addButton((button) =>
				button.setButtonText("Add").onClick(async () => {
					this.settings().presets.push({ name: "New format", template: "[{{title}}]({{abs_url}})" });
					await this.save();
					this.display();
				}),
			)
			.addButton((button) =>
				button.setButtonText("Restore defaults").onClick(async () => {
					this.settings().presets = DEFAULT_PRESETS.map((p) => ({ ...p }));
					await this.save();
					this.display();
					new Notice("Saved formats restored.");
				}),
			);

		this.settings().presets.forEach((preset, index) => {
			const setting = new Setting(this.containerEl)
				.addText((text) =>
					text
						.setPlaceholder("Name")
						.setValue(preset.name)
						.onChange(async (value) => {
							preset.name = value;
							await this.save();
						}),
				)
				.addTextArea((area) => {
					area.inputEl.rows = 2;
					area.inputEl.addClass("paper-citations-template-input");
					area.setValue(preset.template).onChange(async (value) => {
						preset.template = value;
						await this.save();
					});
				})
				.addExtraButton((button) =>
					button
						.setIcon("clipboard-copy")
						.setTooltip("Use as the paste template")
						.onClick(async () => {
							this.settings().defaultTemplate = preset.template;
							await this.save();
							this.display();
							new Notice(`"${preset.name}" is now the paste format.`);
						}),
				)
				.addExtraButton((button) =>
					button
						.setIcon("trash-2")
						.setTooltip("Remove")
						.onClick(async () => {
							this.settings().presets.splice(index, 1);
							await this.save();
							this.display();
						}),
				);
			setting.settingEl.addClass("paper-citations-preset-row");
		});
	}

	private addSourceSection(): void {
		new Setting(this.containerEl).setName("Sources").setHeading();

		for (const name of RESOLVER_NAMES) {
			new Setting(this.containerEl)
				.setName(RESOLVER_LABELS[name])
				.addToggle((toggle) =>
					toggle
						.setValue(this.settings().enabledResolvers[name] !== false)
						.onChange(async (value) => {
							this.settings().enabledResolvers[name] = value;
							await this.save();
							this.plugin.rebuildResolvers();
						}),
				);
		}

		new Setting(this.containerEl)
			.setName(RESOLVER_LABELS.citoid)
			.setDesc(
				"A last resort for sites that publish no metadata of their own. It works by sending the " +
					"pasted URL to Wikimedia's citation service, which runs Zotero's site translators. " +
					"Off by default because of that.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.settings().allowCitoid).onChange(async (value) => {
					this.settings().allowCitoid = value;
					await this.save();
					this.plugin.rebuildResolvers();
				}),
			);

		new Setting(this.containerEl)
			.setName("Contact address for Crossref")
			.setDesc(
				"Optional. Crossref asks API callers to identify themselves, and in exchange routes " +
					"them to a faster pool of servers.",
			)
			.addText((text) =>
				text
					.setPlaceholder("you@example.com")
					.setValue(this.settings().crossrefMailto)
					.onChange(async (value) => {
						this.settings().crossrefMailto = value.trim();
						await this.save();
					}),
			);
	}

	private addCacheSection(): void {
		new Setting(this.containerEl).setName("Cache").setHeading();

		new Setting(this.containerEl)
			.setName("Remember fetched metadata")
			.setDesc(
				"arXiv's API guidelines ask callers to cache results rather than re-request them, and " +
					"re-pasting a link you have already cited becomes instant.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.settings().cacheEnabled).onChange(async (value) => {
					this.settings().cacheEnabled = value;
					await this.save();
				}),
			);

		new Setting(this.containerEl)
			.setName("Keep entries for")
			.setDesc("Days. Set to 0 to keep them indefinitely.")
			.addText((text) =>
				text.setValue(String(this.settings().cacheTtlDays)).onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					if (!Number.isFinite(parsed) || parsed < 0) return;
					this.settings().cacheTtlDays = parsed;
					this.plugin.cache.setTtl(parsed);
					await this.save();
				}),
			);

		new Setting(this.containerEl)
			.setName(`Cached entries: ${this.plugin.cache.size}`)
			.addButton((button) =>
				button.setButtonText("Clear").onClick(() => {
					this.plugin.cache.clear();
					this.display();
					new Notice("Cached metadata cleared.");
				}),
			);
	}
}
