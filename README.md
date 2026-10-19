# Paper Citations

An Obsidian plugin. Paste a paper link, get a formatted citation with title and
authors, linked back to the source.

```
paste  https://arxiv.org/abs/1706.03762
get    [Ashish Vaswani et al. (2017). Attention Is All You Need](https://arxiv.org/abs/1706.03762v7)
```

The format is a template you control, so the citation comes out the way you
already write them.

## What it recognizes

Four tiers, tried in order. The first one that produces a title wins, and a
lower tier fills in anything the one above left blank.

| Tier | Source | Covers |
| --- | --- | --- |
| 1 | arXiv Atom API | `arxiv.org/abs`, `/pdf`, `/html`, `/format`; both `2301.12345` and pre-2007 `math/9404236` ids; version suffixes |
| 1 | ForumMagnum GraphQL | LessWrong, Alignment Forum, EA Forum |
| 1 | OpenReview API | `openreview.net/forum?id=...` — see the caveat below |
| 2 | Crossref, then DataCite, then OpenAlex | `doi.org/...`, `doi:10...`, bare DOIs |
| 3 | Page metadata | **any other page** that publishes Highwire `citation_*` tags, Dublin Core, schema.org JSON-LD or OpenGraph |
| 4 | [Citoid](https://www.mediawiki.org/wiki/Citoid/API) | the long tail — **off by default** |

Tier 3 is why there is no per-site integration list. Highwire Press
`citation_*` tags are the academic web's metadata standard, and they turn up in
more places than you would expect — ACL Anthology, most journal publishers, and
LessWrong itself all emit them. Anything that publishes them works without a
line of site-specific code.

LessWrong gets a tier-1 resolver anyway for one reason: its `citation_*` tags
carry the title and author but **no date**, and a citation without a year is
half a citation. Its GraphQL API has the `postedAt` timestamp.

Tier 4 exists because Zotero's several hundred hand-written site translators
are the real general-purpose answer for pages with no metadata at all, and
Wikimedia's Citoid service exposes them without self-hosting anything. It is
off by default because using it means sending the URL you pasted to a third
party. Turn it on if you want it.

### OpenReview caveat

As of 2026-10-19 OpenReview answers unauthenticated API requests with a browser
challenge on both `api.openreview.net` and `api2.openreview.net`, and its forum
pages are client-rendered with no metadata in the HTML. There is nothing to
fetch. The resolver is still here and will start working if that gate is ever
lifted; until then an OpenReview link reports why it cannot be converted rather
than inventing a citation from the challenge page.

## Templates

Substitution is literal — no escaping of any kind — so wikilinks, `\[` escapes
and arbitrary markdown pass through untouched.

```
{{title}}    {{authors}}   {{authors_full}}  {{first_author}}  {{first_author_last}}
{{year}}     {{date}}      {{url}}           {{abs_url}}       {{pdf_url}}
{{doi}}      {{doi_url}}   {{id}}            {{venue}}         {{journal_ref}}
{{comment}}  {{categories}}  {{primary_category}}
{{summary}}  {{abstract}}  {{description}}   {{site}}          {{selection}}
```

`{{#name}}...{{/name}}` keeps its body only when `name` is non-empty. You need
this more often than it sounds: a LessWrong post and a bare DOI have no PDF, so

```
{{authors}}, *{{title}}*. \[[abs]\]({{abs_url}}){{#pdf_url}} \[[pdf]\]({{pdf_url}}){{/pdf_url}}
```

renders both of these correctly, rather than leaving an empty `\[[pdf]\]()`
behind on the sources that have no PDF:

```
Ashish Vaswani et al., *Attention Is All You Need*. \[[abs]\](…) \[[pdf]\](…)
TurnTrout, *Reward is not the optimization target*. \[[abs]\](…)
```

Six formats ship as editable presets, reachable from the **Paste citation
as...** command when you want a different one for a single paste without
changing your default. Author rendering is configured separately — full names,
`et al.` past a threshold, surnames only, or initials, with your own separators.

### Summaries, and the three variables for them

`{{abstract}}` is strict: it's only set when a source gives something that
claims to *be* an abstract. `{{description}}` is the looser page summary.
`{{summary}}` is the abstract if there is one, otherwise the description —
that's the one a card wants.

The distinction isn't pedantry; the fields genuinely aren't interchangeable:

| Source | `{{abstract}}` | `{{description}}` |
| --- | --- | --- |
| arXiv | full abstract, always | — |
| Crossref / DataCite | when the publisher deposited one, which is often not | — |
| OpenReview | yes (when reachable) | — |
| LessWrong / AF / EA Forum | — | ~2000-char excerpt from the API |
| Pages with `citation_abstract` or JSON-LD `abstract` | yes | — |
| Other pages | — | `og:description`, if it survives the check below |

Two things worth knowing. A page's `og:description` is whatever the site chose
to put there, and for many publishers that's the citation restated — ACL
Anthology's is the author list followed by the proceedings title. Passing that
through would print the authors in a card's body directly beneath the authors in
its header, so a description that merely restates the title, authors, venue and
year is **discarded** rather than shown. And LessWrong truncates its own
`og:description` at about 160 characters, which is why its resolver pulls the
excerpt from the API instead.

### Paper card

The `Paper card` preset renders a callout, degrading cleanly as fields go
missing:

```markdown
> [!abstract] [Attention Is All You Need](https://arxiv.org/abs/1706.03762v7)
> Ashish Vaswani et al. (2017) · arXiv
> *Accepted at NeurIPS 2017*
>
> The dominant sequence transduction models are based on complex recurrent…
>
> [abs](…) · [pdf](…) · [doi](…)
```

Every optional part carries its own newline inside its conditional, so a
LessWrong post — no PDF, no DOI, no comment — gets a card with no stray `>`
lines, and a paper with no abstract loses the body rather than gaining a blank
one. `{{comment}}` is arXiv's author comment, which frequently says where a
paper was published.

## Commands

| Command | |
| --- | --- |
| Paste citation | for keyboards that don't fire a paste event, mobile mostly |
| Paste citation as... | pick a format for this one paste |
| Convert link under cursor | convert a link already in the note |
| Convert link under cursor as... | same, picking a format |
| Convert all paper links in note | bulk convert; skips links no specific resolver claims |
| Toggle converting links on paste | |

### Right-click menu

Right-clicking a link in the editor offers **Convert to citation**, and for
arXiv, DOI, LessWrong, Alignment Forum, EA Forum and OpenReview links also
**Convert to citation as...**.

The two entries are gated differently on purpose. Converting is offered for any
`http(s)` link, because whether a page is a citable document isn't decidable
without fetching it — that's the premise of the generic metadata tier, and what
makes ACL Anthology and most publishers work. Gating it on the resolver name
would hide the feature for exactly the papers that tier exists to handle.

The format picker is offered only where a resolver recognizes the URL from its
shape alone, so an ordinary web link adds one menu entry rather than two.
Picking a format is a refinement, and it stays available from the command
palette for everything else.

## How the paste works

On paste the raw URL goes in **immediately**, then gets replaced once the fetch
returns. That ordering is deliberate: a slow or failed fetch degrades to exactly
what pasting without this plugin would have given you, and nothing is ever lost.

If the text moved while the fetch was in flight — you typed above it, or undid
the paste — the replacement looks for the placeholder near where it left it, and
does nothing if it can't find it unambiguously. A surprise edit elsewhere in the
note is worse than a link that stayed a link.

Pastes are left alone inside code fences, inline code spans and frontmatter, and
when the clipboard holds anything other than a single bare URL — so re-pasting a
citation this plugin produced comes through untouched.

They're also left alone **inside markdown link syntax**, which matters when
you're writing a link by hand. Typing `see [this paper](` and pasting gives you
the URL in the destination, as copied — expanding it there would produce
`[this paper]([Authors (Year). Title](url))` and throw away the link text you
just wrote. The same applies while the cursor is in link text, in a wikilink, or
after a `[ref]:` definition. Use **Convert link under cursor** afterwards if you
change your mind.

The one accepted false positive: an unclosed `[` anywhere earlier on the line
looks like link text being written, so pasting after `the interval [0, 1` won't
expand. The paste still happens; only the expansion is skipped.

**One known wart:** because the replacement is asynchronous, undo takes two
steps — one for the citation, one for the paste.

## Caching

Fetched metadata is cached, keyed by URL, with a configurable TTL (90 days by
default). arXiv's [API guidelines](https://info.arxiv.org/help/api/user-manual.html)
ask callers to cache rather than re-request, Crossref's polite pool is a shared
resource, and re-pasting a paper you've already cited should be instant.

Setting a contact address for Crossref is optional but worth it: it opts you
into their faster "polite pool".

## Development

```bash
npm install
echo 'C:\path\to\your\vault' > .vault-path   # or set OBSIDIAN_VAULT
npm run dev      # watch, building straight into the vault
npm run build    # typecheck, then minified build
npm test         # 218 offline tests
npm run smoke    # hits the real services; see below
```

With neither `.vault-path` nor `OBSIDIAN_VAULT` set, the build writes
`./main.js`, which is what a release archive wants.

`npm test` is fully offline, driven by real responses recorded from arXiv,
Crossref, LessWrong, ACL Anthology and OpenReview on 2026-10-19 and kept in
`tests/fixtures`. They're recordings rather than hand-written stubs on purpose:
ACL's reversed attribute order and LessWrong's missing date are both things a
plausible hand-written fixture would have got wrong.

`npm run smoke` hits the live services. Its job isn't to re-test the parsing —
the offline suite does that — but to notice when an upstream response shape
changes. Run it when something stops working.

## Licence

MIT.
