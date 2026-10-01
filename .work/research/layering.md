# DSH Web-UI wallpaper: theme-override API + CSS stacking report

Read-only research. Nothing outside `E:\vibecoding\dsh_bizhi\.work\research\` was modified.

## 0. Method, artifacts and citation convention

DSH packages live inside the asar `E:\dsh_windows\resources\app.asar` under
`dsh/node_modules/@deepseek-ai/…`. They were read with
`E:\vibecoding\dsh_bizhi\tools\asar.mjs` and copied into this research dir; the extracted
artifacts used below are mine (not DSH source files):

| Artifact | Origin |
| --- | --- |
| `.work/research/dump/dsh/node_modules/@deepseek-ai/<pkg>/…` | asar dump of that package |
| `.work/research/extracted/dsh-client-ui-<pkg>.css` | every `*css* = "…"` string literal un-escaped out of that package's `lib/client.js` |
| `.work/research/extracted/frontend-index.css` | `.work/index.css` (= `dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-BPHePDI_.css`), reformatted one rule per line |
| `.work/research/extracted/frontend-index.utf8.js` | `…/dist/assets/index-5SrrfWpU.js` (UTF‑8 normalised) |
| `.work/research/extracted/preload-app.cjs`, `main.js`, `window-material.css` | `lib/preload-app.cjs`, `lib/main.js`, `renderer/assets/window-material.css` from the asar root (Electron shell) |

Citation shorthand: **`theme:lib/client.js:1474`** means
`dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js` line 1474 of the dump
(= identical byte content to the asar member). Line numbers are therefore valid both for
the dump and for the asar member.

Runtime: Electron **44.0.0** (`E:\dsh_windows\version`), so Chromium supports
`color-mix()` (Chrome 111+), `prefers-reduced-transparency` (118+) and `display:contents`.
No `.d.ts` ships for `dsh-client-ui-theme` (`lib/types/**` is declared in `package.json`
but absent from `files`/the asar), so the TypeScript shapes below are reconstructed from
JSDoc + the runtime validator. That reconstruction is marked where it matters.

---

# A. Theme override API

## A.1 The `ctx.theme` service is the raw `ThemeRuntime` instance

`theme:lib/client.js:1579-1582`:

```js
function apply(ctx) {
    installThemeStyles(ctx);
    const theme = new ThemeRuntime(ctx, ctx.configForms.get(THEME_SETTINGS_NAMESPACE));
    ctx.provide("theme", theme);
```

There is **no façade wrapper** in the shipped tree: nothing else in the asar calls
`overrideTokens` (grep over every dumped `*.js`: only the JSDoc mention at
`theme:lib/client.js:1339` and the implementation at `:1474`; the frontend bundle
`frontend-index.utf8.js` contains no `overrideTokens` at all). So `ctx.theme` **is** the
`ThemeRuntime` object and `ctx.theme.overrideTokens(...)` is that class method.
Existing consumers of the service obtain it by declaring it as an injected service —
`layout:lib/client.js:567-572` `const inject = ["slots","theme","locale","shortcuts"]`
and `:676` `presenter.apply(ctx.theme.getTheme())`; also
`dsh-client-ui-sidebar-terminal/lib/client.js:460` `getSnapshot: () => ctx.theme.getTheme()`.

## A.2 `ThemeDefinition` (argument of `register`)

Built-in definitions, `theme:lib/client.js:1225-1233`:

```js
const BUILTIN_THEMES = Object.freeze([Object.freeze({
    id: "light",
    colorScheme: "light",
    tokens: Object.freeze({})
}), Object.freeze({
    id: "dark",
    colorScheme: "dark",
    tokens: Object.freeze({})
})]);
```

Reconstructed shape:

```ts
interface ThemeDefinition {
  id: string;                         // "system" is rejected; duplicate id throws
  colorScheme: "light" | "dark";      // any string at runtime, but only these two exist
  tokens: Record<string, string>;     // alias-name -> a single CSS value string
}
```

Two hard facts:

* The registered `tokens` map is **single-valued, not per-palette**. `composeActive`
  (`theme:lib/client.js:1506-1514`) reads it as `tokens[name] = modes[active.colorScheme]`
  only for *override layers*; a registered definition's `tokens` values are taken verbatim:
  `const tokens = { ...active.tokens };`. A registered theme is therefore already bound to
  its own `colorScheme` (that is why both built-ins carry `tokens: {}` and get their real
  palette from CSS `body{}` / `body[data-ds-dark-theme]{}`).
* `register()` performs **no value validation at all** (`:1446-1457`) — unlike
  `overrideTokens`, it never calls `validateOverrides`. Any string passes.

```js
register(definition) {
    if (definition.id === "system") throw new Error("\"system\" is a preference, not a registrable theme id");
    if (this.themes.some((t) => t.id === definition.id)) throw new Error(`theme "${definition.id}" is already registered`);
    this.themes = [...this.themes, definition];
    this.publish();
    return () => {
        if (!this.themes.some((t) => t.id === definition.id)) return;
        this.themes = this.themes.filter((t) => t.id !== definition.id);
        if (this.preference === definition.id) this.preference = DEFAULT_PREFERENCE;
        this.publish();
    };
}
```

`register` returns a disposer (throws on `id === "system"` / duplicate id). Note the
README calls this an extension point, not a product: *"registering one means overriding
same-named alias variables; no validation exists that an override set is complete"*
(`theme:README.md:125`).

## A.3 `ThemeTokenOverrides` (argument of `overrideTokens`) — exact shape

`theme:lib/client.js:1540-1552` (verbatim):

```js
function validateOverrides(source, tokens) {
    const validated = {};
    for (const [name, value] of Object.entries(tokens)) {
        if (typeof value === "string") throw new TypeError(`theme override "${name}" from "${source}" is a bare string — pass { light: ${JSON.stringify(value)}, dark: ${JSON.stringify(value)} } (repeat the value when it is the same in both palettes); a single value goes illegible when the user switches color scheme`);
        if (typeof value !== "object" || value === null || typeof value.light !== "string" || typeof value.dark !== "string") throw new TypeError(`theme override "${name}" from "${source}" must map to a { light, dark } pair of strings — one value per color scheme`);
        const modes = value;
        validated[name] = {
            light: modes.light,
            dark: modes.dark
        };
    }
    return validated;
}
```

```ts
type ThemeTokenOverrides = Record<string /* CSS custom property name */,
                                   { light: string; dark: string }>;
```

* **Both palettes are mandatory.** A bare string throws the teaching `TypeError` above.
* **There is no allow-list of keys and no CSS colour validation.** The only test on a value
  is `typeof … === "string"`. Any custom-property name is accepted (including names not in
  `BUILTIN_INSPECT_TOKENS`, `theme:lib/client.js:1234-1333`, which merely feeds
  `exportInspectTokens()`).
* Values are defensively copied into a fresh object, so later caller mutation cannot reach
  the stored layer.

## A.4 `overrideTokens` implementation and layering rules

`theme:lib/client.js:1474-1486` (verbatim):

```js
overrideTokens(source, tokens) {
    const layer = {
        seq: this.overrideSeq++,
        tokens: validateOverrides(source, tokens)
    };
    this.overrides.set(source, layer);
    this.publish();
    return () => {
        if (this.overrides.get(source) !== layer) return;
        this.overrides.delete(source);
        this.publish();
    };
}
```

Semantics (JSDoc `theme:lib/client.js:1458-1473`, code `:1354-1356`, `:1506-1514`):

* One layer **per `source`** (`overrides = new Map()`), stacked by a monotonic `seq`
  (`overrideSeq`), later layers winning **per token**.
* Calling again with the same `source` **replaces** that source's whole layer and restacks
  it on top.
* The returned disposer removes **exactly the layer that call created**; it is a no-op if
  the source has since been re-overridden (`if (this.overrides.get(source) !== layer) return;`)
  — the newer layer is *not* torn down.
* Removing a layer restores whatever it covered; the registry/preference is never touched.
* `source` is a layer identity string; the JSDoc says dynamic packages pass their package
  id. **UNVERIFIED:** that a dynamic-package façade pins `source` for third-party plugins —
  no such façade exists in the shipped asar (grep above), so whatever string you pass is
  the string used.

## A.5 Does an override survive light/dark switching automatically?

**Yes — provided you supply both values.** `composeActive` picks per active colour scheme at
snapshot-build time (`theme:lib/client.js:1509`):

```js
for (const layer of [...this.overrides.values()].sort((a, b) => a.seq - b.seq))
    for (const [name, modes] of Object.entries(layer.tokens)) tokens[name] = modes[active.colorScheme];
```

`buildSnapshot` (`:1487-1499`) resolves `system` to `light`/`dark` via
`matchMedia("(prefers-color-scheme: dark)")`, and the media listener re-publishes on OS
scheme flips (`:1368-1380`). `setTheme`/`adopt` also publish. So a palette switch rebuilds
the snapshot with the other half of your pair. You never need to re-call `overrideTokens`.

## A.6 Observable: `theme/change`

`theme:lib/client.js:1515-1519`:

```js
publish() {
    this.revision += 1;
    this.snapshot = this.buildSnapshot();
    this.ctx.emit("theme/change", this.snapshot);
}
```

* Event name: **`theme/change`**, emitted on the owning context (`ctx.on("theme/change", …)`).
* Payload: the frozen snapshot `{ preference, fontSize, active, themes, revision }`
  (`:1492-1498`), where `active` is the **composed** `{ id, colorScheme, tokens }`
  (`:1510-1513`) — i.e. your overrides are already folded in. `revision` is monotonic.
* Consumer pattern in the shipped code — `layout:lib/client.js:674-684`:

```js
const presenter = new ThemePresenter();
presenter.apply(ctx.theme.getTheme());
const off = ctx.on("theme/change", (snapshot) => { presenter.apply(snapshot); });
return () => { off(); presenter.dispose(); };
```

* Other emitters of `theme/change`: `setTheme` (`:1409`), `setFontSize` (`:1422`),
  `register`/its disposer, `overrideTokens`/its disposer, `adopt` (`:1430`).
* `setTheme(id)` (`:1409-1415`) is the only preference write entry:
  `if (id !== "system" && !this.themes.some((t) => t.id === id)) throw new Error(...)`.

## A.7 How the values are consumed (this is what makes non-colour values work)

`layout:lib/client.js:532-548` (verbatim excerpt):

```js
apply(snapshot) {
    const scheme = snapshot.active.colorScheme;
    document.documentElement.style.colorScheme = scheme;
    document.documentElement.setAttribute(THEME_SOURCE_ATTRIBUTE, snapshot.preference === "system" ? "system" : scheme);
    const body = document.body;
    if (scheme === "dark") body.setAttribute(DARK_ATTRIBUTE, "");
    else body.removeAttribute(DARK_ATTRIBUTE);
    body.style.setProperty(CONTENT_FONT_SIZE_VARIABLE, `${snapshot.fontSize}px`);
    for (const name of this.appliedTokens) body.style.removeProperty(name);
    this.appliedTokens = [];
    for (const [name, value] of Object.entries(snapshot.active.tokens)) {
        body.style.setProperty(name, value);
        this.appliedTokens.push(name);
    }
    this.themeColorMeta.content = getComputedStyle(body).backgroundColor;
    if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta);
}
```

Consequences:

1. Tokens are written as **inline styles on `document.body`** → they beat every stylesheet
   rule that declares the same token on `body` or `body[data-ds-dark-theme]` (the palette
   sheets in `theme:lib/client.js:1148`) purely on specificity. No `!important` needed.
2. Because they are inherited CSS custom properties, every descendant that reads
   `var(--dsw-…)` picks up your value, in both palettes, with zero extra work.
3. **Non-colour values.** `overrideTokens` never parses the value, and `setProperty`
   accepts any string that is a valid *custom-property* value — `url(...)`,
   `color-mix(in srgb, … 70%, transparent)`, `linear-gradient(...)`, `image-set(...)` all
   pass validation and are stored verbatim. What varies is the **consuming property**:
   * `background: var(--x)` / `background-image: var(--x)` → `url(...)` and `color-mix(...)`
     both work.
   * `background-color: var(--x)` → a `url()` value makes the declaration
     *invalid at computed-value time*, which the CSS Variables spec treats as **unset**, so
     the used `background-color` becomes `transparent` (initial). Not an error, but a
     surprise. `color-mix(...)`/any `<color>` works there.
   DSH itself consumes the tokens both ways (e.g. `background-color:var(--dsw-alias-bg-base)`
   in the theme sheet `theme:lib/client.js:1148` vs `background:var(--dsw-alias-bg-base)` in
   `layout:lib/client.js:73`), so **use a `<color>` value (`color-mix(...)`) for these
   background tokens**; reserving `url(...)` for a token consumed only by a shorthand
   `background` is possible but fragile.
4. `color-mix()` is already used by shipped CSS for exactly this kind of translucency, e.g.
   `layout:lib/client.js:73` `background:linear-gradient(...), color-mix(in srgb, color-mix(in srgb, var(--dsw-specific-sidebar-fill) 97%, #7a9bf0) 40%, transparent)`.

## A.8 `ctx.effect` / disposal semantics

* `ctx.effect(callback, label)` runs `callback` and registers the function it **returns** as
  the disposer; the label is diagnostic. Evidence, `theme:lib/client.js:1181-1193`:

```js
function installThemeStyles(ctx) {
    if (typeof document === "undefined") return;
    for (const [name, css] of STYLES) ctx.effect(() => {
        const tag = document.createElement("style");
        …
        document.head.appendChild(tag);
        return () => { tag.remove(); };
    }, `ui-theme: ${name} stylesheet`);
}
```

* **`overrideTokens` returns its own disposer** (`theme:lib/client.js:1481-1485`), so the
  idiomatic usage is to hand it straight to `ctx.effect`:
  `ctx.effect(() => ctx.theme.overrideTokens(SOURCE, TOKENS), "label")`.
* `ctx.on(event, handler)` returns an unsubscribe function (`layout:lib/client.js:677-683`).
* Disposal order inside the effect, plus `ctx.theme` service lifetime, is Cordis/fiber
  owned; the theme service is provided for the ui-theme plugin's lifetime
  (`ctx.provide("theme", theme)` at `theme:lib/client.js:1582`, inside `apply`).

---

# B. CSS stacking and where the UI background is painted

## B.1 Full DOM structure of the app frame

`dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html` (asar member, verbatim body):

```html
<body>
  <div id="root"></div>
</body>
```

The boot kernel resolves it, `frontend-index.utf8.js`:

```js
const e=document.getElementById("root");
if(e===null)throw new Error("web app: missing #root");
const n=new dM(e);   // dM.container = e ; dM.page = new tM(e)  (boot screen appended into #root)
…
await nM(u,this.container)   // uiRenderer.mount(container)  → React root into #root
```

`dsh-client-ui-renderer/lib/client.js:1823-1837` mounts React **directly** into that
container (`createRoot(container)` / `hydrateRoot(container, …)`); there is no wrapper div
of its own. The 'root' slot outlet then adds one anchor, `renderer:lib/client.js:1094`
and `:1217-1219`:

```js
const ANCHOR_STYLE = { display: "contents" };
…
return (0, react_jsx_runtime.jsx)("div", {
    "data-slot": "root",
    style: ANCHOR_STYLE,
    children: …
```

`display:contents` generates **no box**, so this element cannot be positioned, cannot clip
and cannot establish a stacking context.

`layout:lib/client.js:315-368` renders the frame; the resulting tree (Reconciled DOM):

```
html[data-platform=win32|darwin][data-windows-titlebar][data-fullscreen]
     (inline: style.colorScheme, plus --dsh-windows-titlebar-height:40px written by the
      Windows preload; --dsh-frame-top-clearance / --dsh-frame-overlay-top /
      --dsh-frame-chrome-top come from stylesheet rules on html[])
└─ body   (inline: all ctx.theme token variables, --dsh-content-font-size;
           class-less; background: var(--dsw-alias-bg-base, #fff))
   ├─ div#root                      (height:100%; margin:0 — nothing else)
   │  └─ div[data-slot="root"]      (style="display:contents")
   │     └─ div.BynINW_frame        (grid; position:relative; overflow:hidden; background:…)
   │        ├─ div.BynINW_sidebarCol
   │        ├─ div.BynINW_centerCol
   │        ├─ div.BynINW_rightbarCol           (data-rightbar-col)
   │        ├─ div.BynINW_overlayLayer          (data-shell-overlay; slot 'shell.overlay')
   │        ├─ div.BynINW_leadingSeat           (darwin + collapsed sidebar only)
   │        └─ div.BynINW_handle × 0..2         (data-side=sidebar|rightbar)
   ├─ div[data-windows-menu]        (Windows only; position:fixed; z-index:1100; shadow DOM)
   └─ span                          (Windows only; position:fixed; visibility:hidden; the caption‑colour probe)
```

The two non-`#root` body children are created by the Electron preload:
`preload-app.cjs:544` `document.body.append(host)` (Windows caption menubar) and
`preload-app.cjs:587` `document.body.append(probe)`. This matters: **`body` legitimately
has children besides `#root`**, and `html[data-platform=darwin] body>:not(#root)` is an
existing CSS rule (`frontend-index.css:682`) that assumes it.

## B.2 FULL rule text (verbatim)

### `html`, `body`, `#root` — `frontend-index.css:676-683`

```css
html,body,#root{height:100%;margin:0}
body{font-family:var( --dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif );-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;color:var(--dsw-alias-label-primary, #0f1115);background:var(--dsw-alias-bg-base, #fff);text-autospace:normal}
html[data-platform=darwin],html[data-platform=darwin] body{background:transparent}
html[data-platform=darwin] body{isolation:isolate}
html[data-platform=darwin] [data-window-drag]{-webkit-app-region:drag}
html[data-platform=darwin] [data-window-drag-recall]{-webkit-app-region:no-drag}
html[data-platform=darwin] body>:not(#root){-webkit-app-region:no-drag}
html[data-platform=darwin] :is(button,a,input,select,textarea,summary,[contenteditable=true],[tabindex],[role=dialog],…){-webkit-app-region:no-drag}
```

Additional rules that touch the same elements (full inventory — `roots.mjs` over every
extracted stylesheet):

* `frontend-vendor.css:251` `body{counter-reset:katexEqnNo mmlEqnNo}` (KaTeX, only).
* `theme` `base.css` (`theme:lib/client.js:1142`): `:root{--dsw-font-family…--dsw-radius-panel:28px}` and `body{--dsw-alias-settings-card-fill:var(--dsw-alias-bg-layer-2);--dsw-alias-settings-card-stroke:var(--dsw-alias-border-l4)}`.
* `theme` `design-platform.css` (`theme:lib/client.js:1148`): `body{ …static palette…; …alias palette…; background-color:var(--dsw-alias-bg-base)}` and `body[data-ds-dark-theme]{ …dark palette… }` and `html[data-platform=darwin] body{--dsw-specific-menu:#f8f9faf0}` / `html[data-platform=darwin] body[data-ds-dark-theme]{--dsw-specific-menu:#303136f0}`.
* `theme` `focus.css` (`theme:lib/client.js:1151`): `:root{--dsw-focus-ring-width:2px}`, `html[data-input-modality=pointer] body :focus-visible:not(:read-write){…}`.
* `theme` `onboarding.css` / `scrollbar.css` / `gradient-shadow-text.css` / `shiki.css` (`theme:lib/client.js:1154-1163`): `body{--dsw-…}` token declarations only.
* Host boot CSS, `theme:lib/index.js:39-45`: `body{background-color:#fff;--dsh-boot-bg:#fff}` (light) / `#151517` (dark), injected into `<head>` per index render.
* Windows preload: only *reads* `html` (`preload-app.cjs:575-578` `root.dataset.windowsTitlebar=""; root.style.setProperty("--dsh-windows-titlebar-height","40px")`).

**No rule anywhere sets `position`, `z-index`, `transform`, `filter`, `opacity`,
`will-change` or `contain` on `html`, `body`, or `#root`.**

### AppFrame CSS — `layout:lib/client.js:73` (the complete stylesheet, 4018 chars)

```css
.BynINW_frame{background:var(--dsw-alias-bg-base);grid-template-rows:100%;height:100%;display:grid;position:relative;overflow:hidden}
.BynINW_frame[data-animating]{transition:grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.BynINW_frame[data-dragging]{transition:none}
[data-windows-titlebar] .BynINW_frame{--dsh-windows-content-radius:16px;box-sizing:border-box;padding-top:var(--dsh-windows-titlebar-height);background:var(--dsw-specific-sidebar-fill);grid-template-rows:minmax(0,1fr)}
[data-windows-titlebar] .BynINW_centerCol{background:var(--dsw-alias-bg-base);border-radius:var(--dsh-windows-content-radius) 0 0 0;corner-shape:round}
[data-windows-titlebar] .BynINW_frame:before{content:"";height:var(--dsh-windows-titlebar-height);background:var(--dsw-specific-sidebar-fill);-webkit-app-region:drag;position:absolute;inset:0 0 auto}
[data-windows-titlebar] .BynINW_sidebarCol{border-right:none}
[data-windows-titlebar] .BynINW_handle{top:var(--dsh-windows-titlebar-height)}
@media (prefers-reduced-motion:reduce){.BynINW_frame[data-animating]{transition:none}}
.BynINW_sidebarCol{background:var(--dsw-specific-sidebar-fill);border-right:.5px solid var(--dsw-alias-border-l3);min-width:0;overflow:hidden}
.BynINW_centerCol{flex-direction:column;min-width:0;display:flex;overflow:hidden}
[data-platform=darwin] .BynINW_frame{background:0 0}
html[data-platform=darwin]{--dsh-frame-top-clearance:48px}
html[data-windows-titlebar]{--dsh-frame-top-clearance:var(--dsh-windows-titlebar-height);--dsh-frame-chrome-top:var(--dsh-windows-titlebar-height)}
html[data-platform=darwin],html[data-windows-titlebar]{--dsh-frame-overlay-top:calc(var(--dsh-frame-top-clearance) + 20px)}
html[data-platform=darwin][data-fullscreen],html[data-windows-titlebar][data-fullscreen]{--dsh-frame-overlay-top:20px;--dsh-frame-chrome-top:0px}
[data-platform=darwin] .BynINW_sidebarCol{background:linear-gradient(to bottom, #7a9bf01a, #7a9bf000 35%, #8f89b800 68%, #8f89b817), color-mix(in srgb, color-mix(in srgb, var(--dsw-specific-sidebar-fill) 97%, #7a9bf0) 40%, transparent);border-right:none}
[data-platform=darwin] [data-ds-dark-theme] .BynINW_sidebarCol{background:linear-gradient(to bottom, #7a9bf014, #7a9bf000 35%, #8f89b800 68%, #8f89b812), color-mix(in srgb, var(--dsw-specific-sidebar-fill) 50%, transparent)}
@media (prefers-reduced-transparency:reduce){[data-platform=darwin] .BynINW_sidebarCol,[data-platform=darwin] [data-ds-dark-theme] .BynINW_sidebarCol{background:color-mix(in srgb, var(--dsw-specific-sidebar-fill) 90%, transparent)}}
[data-platform=darwin] .BynINW_centerCol{background:var(--dsw-alias-bg-base);border-left:.5px solid var(--dsw-alias-border-l3)}
[data-platform=darwin] .BynINW_rightbarCol{background:var(--dsw-alias-bg-base)}
[data-platform=darwin] [data-sidebar-collapsed] .BynINW_centerCol{border-left:none}
[data-platform=darwin] .BynINW_frame[data-sidebar-collapsed]{--dsh-frame-leading-clearance:160px}
[data-platform=darwin][data-fullscreen] .BynINW_frame[data-sidebar-collapsed]{--dsh-frame-leading-clearance:84px}
[data-platform=darwin][data-fullscreen] .BynINW_leadingSeat{left:12px}
.BynINW_leadingSeat{z-index:15;-webkit-app-region:no-drag;align-items:center;display:flex;position:absolute;top:11px;left:88px}
.BynINW_handle{cursor:col-resize;z-index:11;touch-action:none;width:8px;margin-left:-4px;position:absolute;top:0;bottom:0}
.BynINW_frame[data-animating] .BynINW_handle{transition:left var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.BynINW_frame[data-dragging] .BynINW_handle,.BynINW_frame[data-rightbar-fullscreen],.BynINW_frame[data-rightbar-fullscreen] .BynINW_handle,.BynINW_frame[data-rightbar-instant],.BynINW_frame[data-rightbar-instant] .BynINW_handle{transition:none}
@media (prefers-reduced-motion:reduce){.BynINW_frame[data-animating] .BynINW_handle{transition:none}}
.BynINW_rightbarCol{min-width:0;position:relative;overflow:visible}
.BynINW_overlayLayer{z-index:20;pointer-events:none;position:absolute;inset:0}
.BynINW_overlayLayer>*{pointer-events:auto}
```

Your two known rules are **confirmed verbatim** (`.BynINW_overlayLayer` and
`.BynINW_frame`), including that the frame's Windows variant re-points its own background
to `--dsw-specific-sidebar-fill`.

## B.3 Does `body` or `#root` create a stacking context?

| Element | SC-creating declaration present? | Verdict |
| --- | --- | --- |
| `html` | none (`color-scheme` and custom props are not SC triggers) | root element ⇒ always the root stacking context |
| `body` | **on macOS only**: `html[data-platform=darwin] body{isolation:isolate}` (`frontend-index.css:679`) | **macOS: YES.** Windows/Linux/web: **NO** |
| `#root` | none — its only rule is `html,body,#root{height:100%;margin:0}` | **NO** |
| `div[data-slot="root"]` | `style="display:contents"` (`renderer:lib/client.js:1094,1219`) | **NO** (no box at all) |
| `div.BynINW_frame` | `position:relative` but `z-index:auto`; `overflow:hidden` is not an SC trigger | **NO** |
| `div.BynINW_sidebarCol` | `background`, `border-right`, `min-width`, `overflow:hidden` | **NO** |
| `div.BynINW_centerCol` | `display:flex`, `flex-direction`, `min-width`, `overflow:hidden` | **NO** |
| `div.BynINW_rightbarCol` | `position:relative`, `z-index:auto`, `overflow:visible` | **NO** |
| `div.BynINW_overlayLayer` | `position:absolute; inset:0; z-index:20` | **YES** |
| `div.BynINW_handle`, `div.BynINW_leadingSeat` | `position:absolute` + `z-index:11` / `:15` | **YES** |

`overflow:hidden` is emphatically **not** a stacking-context trigger, and neither is a
`transition`; so `.BynINW_frame` — which one might expect to isolate the app — does not.

## B.4 Which element paints the base background, and from which variable

Bottom-to-top paint order of opaque/near-opaque app surfaces (all citations above):

1. **Canvas** — the `body` background is propagated to the canvas because `html` computes
   to `background-color: transparent` / `background-image: none` (no rule sets an `html`
   background; on macOS `html` is explicitly `background:transparent`).
   Fed by `--dsw-alias-bg-base` — `frontend-index.css:677`
   `body{…;background:var(--dsw-alias-bg-base, #fff);…}` and `theme:lib/client.js:1148`
   `body{ …; background-color:var(--dsw-alias-bg-base)}`; pre-script boot value from
   `theme:lib/index.js:39-45` (`#fff` / `#151517`).
2. **Windows: `.BynINW_frame`** — `[data-windows-titlebar] .BynINW_frame{…;background:var(--dsw-specific-sidebar-fill);…}`
   (covers the whole viewport, caption row included).
   **macOS: `.BynINW_frame{background:0 0}`** (no paint; the native `vibrancy:"sidebar"`
   window material shows through — `main.js` `createWindow`: darwin branch sets
   `vibrancy:"sidebar"`, `backgroundColor:"#00000000"`).
3. **Columns** —
   * `.BynINW_sidebarCol{background:var(--dsw-specific-sidebar-fill)}` (both platforms;
     macOS overrides it with the blue gradient + `color-mix(… sidebar-fill 97%/50% …)`).
   * `.BynINW_centerCol` — only `[data-windows-titlebar]` and `[data-platform=darwin]`
     variants paint `--dsw-alias-bg-base`; in the plain web build the center column has no
     background of its own.
   * `.BynINW_rightbarCol` — darwin only, `--dsw-alias-bg-base`.
4. **Sidebar occupant** — `dsh-client-ui-sidebar/lib/client.js:91`
   `._2H3hWW_root{…;background:var(--dsw-specific-sidebar-fill);…}` (`
   [data-platform=darwin] ._2H3hWW_root{background:0 0}`).
5. **Conversation pane** — `dsh-client-ui-conversation/lib/client.js` (extracted
   `dsh-client-ui-conversation.css`)
   `.Dc7zOa_root{background:var(--dsw-alias-bg-base);flex-direction:column;min-width:0;height:100%;display:flex;position:relative}`
   plus
   `.Dc7zOa_root[data-phase=active] .Dc7zOa_composerSeat,…{background:linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0px, var(--dsw-alias-bg-base) 36px)}`.
6. **Smaller surfaces** — `--dsw-specific-menu` (composer dock panel, chat step panel,
   popovers), `--dsw-specific-input-major` (composer card, image lightbox, file cards),
   `--dsw-specific-bubble` (user bubble), `--dsw-alias-bg-layer-1/2/3`,
   `--dsw-alias-bg-module-platform` — see §C.

**Windows caption row specifically:** `.BynINW_frame`'s `padding-top` reserves 40px and the
band is painted twice — once by the frame itself (`background:var(--dsw-specific-sidebar-fill)`)
and once by `[data-windows-titlebar] .BynINW_frame:before{…;background:var(--dsw-specific-sidebar-fill);-webkit-app-region:drag;position:absolute;inset:0 0 auto}`.
Above the web content, Electron draws the native window-controls overlay
(`main.js` `createWindow`, win32 primary: `titleBarStyle:"hidden"`, `titleBarOverlay:{height:40,color:chromeFallbackFill(),…}`,
`chromeFallbackFill()` = `#f9fafb` light / `#1b1b1c` dark). The preload then measures the
computed `--dsw-specific-sidebar-fill` with a hidden probe and pushes it to main
(`preload-app.cjs:586-613`), which validates it and calls
`mainWindow.setTitleBarOverlay({color, symbolColor})` (`main.js` `ipcMain.on(DESKTOP_IPC.windowsAppearance, …)`,
`validColor = /^(?:#[\da-f]{3,8}|rgba?\([\d.,%\s]+\))$/iu`) — i.e. **the native caption colour
follows your override, and an `rgba()` with alpha is accepted by the validator** (whether
Electron 44 composites that alpha over web content is UNVERIFIED).

## B.5 THE CRITICAL QUESTION — where does a `position:fixed; inset:0; z-index:-1; pointer-events:none` layer paint?

Ground rules used (CSS 2.1 Appendix E painting order for a stacking context):
canvas/root background → *negative* stack levels → in-flow block backgrounds → floats →
inline content → `z-index:auto/0` positioned boxes → *positive* stack levels.

### (a) as the FIRST child of `document.body` → **paints behind all UI text. GUARANTEED.**

* Its nearest stacking-context ancestor is the **root element** on Windows/Linux/web
  (`body` and `#root` are not stacking contexts — §B.3), and **`body`** on macOS — in both
  cases the layer is a *negative-z-index child* of that context, so it is painted at step 2,
  before every in-flow box of `#root` (which is painted at step 3+ of the same context, or
  of `body`'s context on macOS).
* The canvas background — the propagated `body` background
  (`background:var(--dsw-alias-bg-base,#fff)`) — is painted *before* step 2, so the layer
  covers the canvas rather than being covered by it. This is the crux of why the technique
  works: `html` computes to `background-color:transparent` with `background-image:none`, so
  the body background propagates to the canvas and is **not** painted on body's own box.
* The layer is the *first* child of body, so among sibling negative-z-index contexts it is
  painted first = lowest. (Not required for correctness, but it also means DSH's own
  negative-z-index descendants, e.g. `frontend-index.css:149`
  `html[data-platform=darwin] ._backing_ri079_2{…;z-index:-1;background:var(--dsw-alias-bg-base);pointer-events:none}`
  and `frontend-index.css:147` `._material_ri079_21{position:absolute;inset:0;z-index:-1;…}`
  — the menu backing/material technique, itself confined by
  `._surface_ri079_1{anchor-name:var(--dsh-menu-anchor);isolation:isolate}` at
  `frontend-index.css:146` — paint **above** your layer, which is what you want.)
* Nothing in `#root` can be painted below it except another negative-z-index element.
* Preconditions that make this a *guarantee*: (i) no `isolation`/`transform`/`filter`/
  `contain`/`opacity<1`/`will-change` on `html`/`body` — true today (§B.2); (ii) `html`
  keeps `background-image:none` + `background-color:transparent` so the body background
  keeps propagating — true today on Windows, explicitly true on macOS. Making
  `--dsw-alias-bg-base` translucent (which the wallpaper needs anyway) makes the layer
  visible even if (ii) is ever violated, because then body's own background is translucent.
* `pointer-events:none` keeps every hit-test, drag region and text selection in the UI;
  `position:fixed` + `inset:0` makes it viewport-sized and immune to ancestor
  `overflow:hidden` (no transformed ancestor exists because it hangs off `body`).

### (b) inside the `shell.overlay` slot → **WRONG: it paints ABOVE the text.**

The slot is rendered into `div.BynINW_overlayLayer` (`layout:lib/client.js:343-347`,
`renderSlot("shell.overlay", {})`), whose rule is
`.BynINW_overlayLayer{z-index:20;pointer-events:none;position:absolute;inset:0}`.

Reasoning: `position:absolute` + `z-index:20` makes the overlay layer **a stacking context**
of its own, participating in the nearest ancestor stacking context — which on Windows is the
**root element** (`.BynINW_frame` is `position:relative; z-index:auto` and therefore *not* an
SC). It is thus painted at step 7 (positive stack levels), i.e. **after** all in-flow
content of `#root`, which includes `.BynINW_sidebarCol`, `.BynINW_centerCol` and every
glyph inside them. A descendant of the overlay layer — at *any* `z-index`, including
`-1` — can never escape that stacking context; `z-index:-1` there only puts it below the
overlay layer's *siblings*, which are already above the whole UI. Dialogs/menus are placed
in `shell.overlay` precisely so they float above the columns; a wallpaper there will cover
UI text (clicks still work thanks to `pointer-events:none`, which makes the failure purely
visual and therefore easy to miss).

### (c) inside a slot mounted in the center column → **UNPREDICTABLE; same result as (a)
only if every ancestor between the element and `body` is a non-stacking, non-transformed box.**

* Measured chain for a `main`-slot occupant: `… → .BynINW_centerCol → .BynINW_frame →
  div[data-slot="root"] (display:contents) → div#root → body`. None of these is a stacking
  context today (§B.3), so a `position:fixed; z-index:-1` element mounted here *would* land
  in the root/body stacking context at negative level and behave exactly like case (a).
* It becomes wrong or unpredictable as soon as **any** ancestor between the element and
  `body` (i) establishes a stacking context (`isolation:isolate`, `position`+`z-index`,
  `transform`, `filter`, `backdrop-filter`, `perspective`, `contain:paint|layout|strict|content`,
  `opacity<1`, `will-change`), or (ii) has `transform`/`filter`/`perspective`/`contain`,
  which additionally makes that ancestor the **containing block** of the fixed element (so
  it stops being viewport-sized and starts being clipped by ancestor `overflow`).
* That is not hypothetical: the shipped CSS already contains such ancestors inside panels —
  `dsh-client-ui-conversation.css` `… .v1kfCW_panel{isolation:isolate;border-radius:…;width:100%;padding:2px 0;position:relative;overflow:hidden}`
  with `.v1kfCW_panel:before{z-index:-1;border-radius:inherit;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);content:"";pointer-events:none;position:absolute;inset:0}`
  (a menu-material layer deliberately trapped in its own panel), and
  `frontend-index.css:146` `._surface_ri079_1{…;isolation:isolate}`. Any plugin or future
  version may add more.
* Since a slot's mount point is chosen by the host panel, not by you, **do not rely on (c)**.
  If you must use (c), the exact ancestors that would need to have no stacking context are:
  the immediate React/slot wrapper chain, the panel root (e.g. `.Dc7zOa_root` — itself only
  `position:relative`, so safe today), `.BynINW_centerCol`, `.BynINW_frame`,
  `div[data-slot="root"]`, `#root` and `body` — and no ancestor anywhere may carry
  `transform`/`filter`/`perspective`/`contain`/`backdrop-filter`.

**Answer to the critical question: use (a).** (b) is provably wrong; (c) is
position-dependent and can silently degrade into "wallpaper on top of the text".

---

# C. Which CSS variables must become translucent

Definitions come from `theme` `design-platform.css` (`theme:lib/client.js:1148`), light in
`body{…}` / dark in `body[data-ds-dark-theme]{…}`; static palette values are in the same
sheet (`--dsw-static-neutral-bluish-00:#fff`, `-50:#f9fafb`, `-850:#2c2c2e`, `-875:#232324`,
`-900:#1b1b1c`, `-950:#151517`, `-60:#f5f6f7` light / `#f9fafb` dark, `-150:#e9ecf2`,
`-700:#61666b`, `deepseek-50:#edf3fe`).

| Token | Light default (resolved) | Dark default (resolved) | Where it is consumed as an opaque background (file : selector) |
| --- | --- | --- | --- |
| `--dsw-alias-bg-base` | `#fff` (`bluish-00`) | `#151517` (`bluish-950`) | canvas: `frontend-index.css:677 body{background:var(--dsw-alias-bg-base,#fff)}`; `theme:lib/client.js:1148 body{…;background-color:var(--dsw-alias-bg-base)}`; frame: `layout:lib/client.js:73 .BynINW_frame`; `[data-windows-titlebar] .BynINW_centerCol`; `[data-platform=darwin] .BynINW_centerCol`; `[data-platform=darwin] .BynINW_rightbarCol`; `dsh-client-ui-conversation.css .Dc7zOa_root`; `… .Dc7zOa_root[data-phase=active] .Dc7zOa_composerSeat` (gradient); chat: `.cJsG2q_compactionRow:has(.cJsG2q_compactionBody) .cJsG2q_compactionButton`, `._3GBCTG_root[data-expanded] [data-open] [data-disclosure-row]`; dockkit `frontend-index.css:599 ._tabHost_6nhg2_162:not(._float_6nhg2_156),._emptyTabHost_6nhg2_143`, `:149 ._backing_ri079_2` |
| `--dsw-specific-sidebar-fill` | `#f9fafb` (`bluish-50`) | `#1b1b1c` (`bluish-900`) | `layout:lib/client.js:73 .BynINW_sidebarCol`; `[data-windows-titlebar] .BynINW_frame`; `[data-windows-titlebar] .BynINW_frame:before` (caption band); macOS sidebar gradient (`color-mix(… 97%/50% …)`); `dsh-client-ui-sidebar/lib/client.js:91 ._2H3hWW_root`; `dsh-client-ui-workspace.css ._9lTDKa_fade{background:linear-gradient(to bottom, transparent, var(--dsw-specific-sidebar-fill))}` |
| `--dsw-alias-bg-layer-1` | `#fff` | `bluish-875 #232324` | chat `dsh-client-ui-chat.css .xpvNua_preview`; `.v1kfCW_*` file/thumb/editor surfaces in `dsh-client-ui-conversation.css` |
| `--dsw-alias-bg-layer-2` | `#fff` | `bluish-850 #2c2c2e` | raised surfaces; also `theme base.css` `--dsw-alias-settings-card-fill` |
| `--dsw-alias-bg-layer-3` | `#fff` | `bluish-800 #353638` | `frontend-index.css:._indicator_1p79o_9`, `._input_bjqpo_107` |
| `--dsw-alias-bg-module-platform` | `bluish-60 #f5f6f7` | `bluish-800 #353638` | `frontend-index.css:._tabs_1p79o_1`, `._tag_brmue_4[data-tone=neutral]`; `dsh-client-ui-conversation.css .mP3ANa_selector`; `dsh-client-ui-chat.css .XZcbxG_selector` |
| `--dsw-alias-bg-overlay` | `bluish-150 #e9ecf2` | `bluish-700 #61666b` | overlay/popover surfaces |
| `--dsw-specific-input-major` | `#fff` (`bluish-00`) | `bluish-850 #2c2c2e` | `dsh-client-ui-conversation.css .RlGAzG_card` (composer card); `dsh-client-ui-chat.css .cJsG2q_fileCard`; `frontend-index.css:546 ._image_1hos8_18`, `:547 ._close_1hos8_29` |
| `--dsw-specific-bubble` | `deepseek-50 #edf3fe` | `bluish-850 #2c2c2e` | `dsh-client-ui-chat.css .cJsG2q_bubble` (user message bubble) |
| `--dsw-specific-menu` | `= --dsw-menu-surface-fill #f8f9fa94` (58% α) | `#43454a73` (45% α) | `dsh-client-ui-conversation.css .v1kfCW_panel:before`, `.aSus8q_root`, `._2WTFBq_panel`; `dsh-client-ui-chat.css .Xt1eiG_panel`; `frontend-index.css:._media_38jqx_80` |
| `--dsw-menu-surface-fill` | `#f8f9fa94` | `#43454a73` | **consumed directly** by `frontend-index.css:._material_ri079_21` and `._surface_ri079_1` menu material — override it too, or menus keep the old fill |
| `--dsw-alias-markdown-code-block` / `-banner`, `--dsw-alias-markdown-inline-code`, `--dsw-alias-turn-trigger-bg`, `--dsw-alias-tooltip-bg`, `--dsw-alias-toast-bg` | opaque static colours | opaque static colours | code blocks, inline code, tooltips, toasts — **optional**, and safest left opaque for legibility |

Minimum set for "frame + center + sidebar + chat let the backdrop through":
`--dsw-alias-bg-base`, `--dsw-specific-sidebar-fill` (frame/columns/canvas), plus
`--dsw-specific-input-major`, `--dsw-specific-bubble`, `--dsw-specific-menu`
(+ `--dsw-menu-surface-fill`) for the composer/bubble/menu surfaces. `--dsw-alias-bg-layer-1/2/3`
and `--dsw-alias-bg-module-platform` are optional polish; make them only *slightly*
translucent because they carry text.

Note that these are exactly the tokens the theme package itself advertises as
overridable: `BUILTIN_INSPECT_TOKENS` (`theme:lib/client.js:1234-1333`) lists
`bg-base`, `bg-layer-1`, `bg-layer-2`, `bg-overlay`, `border-l1`, `border-l2`,
`brand-primary`, `label-primary`, `label-secondary`, the four state colours and
`--dsw-specific-sidebar-fill`, each tagged `requiresLightAndDark: true`.

---

# RECOMMENDED IMPLEMENTATION

## R.1 Stacking strategy (guaranteed layer)

Insert **one** element as the first child of `document.body`, sized and stacked as:

```css
[data-dsh-wallpaper] {
  position: fixed;
  inset: 0;
  z-index: -1;              /* negative stack level of the root/body stacking context */
  pointer-events: none;
  overflow: hidden;
  contain: strict;          /* optional; harmless because the element is the layer root */
}
[data-dsh-wallpaper] > * {  /* the video / img itself */
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}
/* Legibility scrim, painted INSIDE the wallpaper layer (still below all UI text).
   Static palette tokens are used so the override of --dsw-alias-bg-base cannot recurse. */
[data-dsh-wallpaper]::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 45%, transparent);
}
body[data-ds-dark-theme] [data-dsh-wallpaper]::after {
  background: color-mix(in srgb, var(--dsw-static-neutral-bluish-950) 55%, transparent);
}
@media (prefers-reduced-transparency: reduce) {
  [data-dsh-wallpaper] { display: none; }
}
```

Do **not** put `transform`, `filter`, `opacity`, `will-change`, `isolation`, `position` with a
non-auto `z-index`, or `contain` on `html`, `body` or `#root`, and do not mount this in
`shell.overlay`.

## R.2 Token values to feed `ctx.theme.overrideTokens`

```js
// lib/client.js — package: @your-scope/dsh-client-ui-wallpaper
const SOURCE = "@your-scope/dsh-client-ui-wallpaper";

const TOKENS = {
  // canvas + frame + center column + conversation pane
  "--dsw-alias-bg-base": {
    light: "color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 62%, transparent)",
    dark:  "color-mix(in srgb, var(--dsw-static-neutral-bluish-950) 62%, transparent)",
  },
  // frame (Windows), sidebar column, sidebar root, session-list fade
  "--dsw-specific-sidebar-fill": {
    light: "color-mix(in srgb, var(--dsw-static-neutral-bluish-50) 72%, transparent)",
    dark:  "color-mix(in srgb, var(--dsw-static-neutral-bluish-900) 72%, transparent)",
  },
  // composer card / image surfaces
  "--dsw-specific-input-major": {
    light: "color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 78%, transparent)",
    dark:  "color-mix(in srgb, var(--dsw-static-neutral-bluish-850) 78%, transparent)",
  },
  // user bubble
  "--dsw-specific-bubble": {
    light: "color-mix(in srgb, var(--dsw-static-deepseek-50) 80%, transparent)",
    dark:  "color-mix(in srgb, var(--dsw-static-neutral-bluish-850) 80%, transparent)",
  },
  // menus / popovers (they keep their backdrop-filter blur)
  "--dsw-menu-surface-fill": {
    light: "color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 82%, transparent)",
    dark:  "color-mix(in srgb, var(--dsw-static-neutral-bluish-850) 78%, transparent)",
  },
  "--dsw-specific-menu": {
    light: "color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 82%, transparent)",
    dark:  "color-mix(in srgb, var(--dsw-static-neutral-bluish-850) 78%, transparent)",
  },
  // optional polish: raised text surfaces stay mostly opaque
  "--dsw-alias-bg-layer-1": {
    light: "color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 88%, transparent)",
    dark:  "color-mix(in srgb, var(--dsw-static-neutral-bluish-875) 88%, transparent)",
  },
  "--dsw-alias-bg-layer-2": {
    light: "color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 92%, transparent)",
    dark:  "color-mix(in srgb, var(--dsw-static-neutral-bluish-850) 92%, transparent)",
  },
  "--dsw-alias-bg-overlay": {
    light: "color-mix(in srgb, var(--dsw-static-neutral-bluish-150) 92%, transparent)",
    dark:  "color-mix(in srgb, var(--dsw-static-neutral-bluish-700) 92%, transparent)",
  },
};
```

Notes: every value is a `<color>` (safe for both `background:` and `background-color:`);
`--dsw-static-*` tokens are never overridden, so `color-mix()` cannot self-reference; a
`url(...)` value would be accepted by `validateOverrides` but is avoidable here.

## R.3 Plugin code (real API names)

```js
// lib/client.js  — client half of the plugin
const SOURCE = "@your-scope/dsh-client-ui-wallpaper";

// runtime service injection, mirroring ui-layout's `inject = ["slots","theme","locale","shortcuts"]`
export const inject = ["theme"];

export function apply(ctx) {
  // (1) Stylesheet first, so the layer is styled before it is inserted.
  //     Pattern copied from ui-theme's installThemeStyles (theme:lib/client.js:1181-1193).
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.plugin = "@your-scope/dsh-client-ui-wallpaper";
    tag.textContent = CSS;                 // the R.1 rules
    document.head.appendChild(tag);
    return () => tag.remove();
  }, "wallpaper: stylesheet");

  // (2) Token overrides. ctx.theme IS the ThemeRuntime (theme:lib/client.js:1582);
  //     overrideTokens returns its own disposer (theme:lib/client.js:1481-1485),
  //     which ctx.effect registers as the cleanup.
  ctx.effect(
    () => ctx.theme.overrideTokens(SOURCE, TOKENS),
    "wallpaper: token overrides",
  );

  // (3) The wallpaper layer, as the FIRST child of document.body.
  ctx.effect(() => {
    const layer = document.createElement("div");
    layer.setAttribute("data-dsh-wallpaper", "");
    layer.setAttribute("aria-hidden", "true");
    const media = document.createElement("video");   // or <img> for a still
    media.src = VIDEO_URL;
    media.autoplay = true;
    media.loop = true;
    media.muted = true;
    media.playsInline = true;
    layer.append(media);
    document.body.prepend(layer);
    return () => layer.remove();
  }, "wallpaper: backdrop layer");

  // (4) Optional: react to palette changes for non-token styling.
  const off = ctx.on("theme/change", (snapshot) => {
    // snapshot = { preference, fontSize, active: { id, colorScheme, tokens }, themes, revision }
    layer?.setAttribute("data-scheme", snapshot.active.colorScheme);
  });
  ctx.effect(() => off, "wallpaper: theme subscription");
}
```

`package.json` (client plugin manifest, fields copied from
`dsh-client-ui-brand-official/package.json` and `dsh-client-ui-theme/package.json`):

```json
{
  "name": "@your-scope/dsh-client-ui-wallpaper",
  "type": "module",
  "main": "lib/index.js",
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-ui-renderer",
        "@deepseek-ai/dsh-client-ui-theme"
      ],
      "platform": "web"
    }
  }
}
```

A host half (`lib/index.js` exporting `apply`) is only needed if you want settings
persistence; the client half alone is sufficient for the wallpaper.

## R.4 What is guaranteed, and what breaks it

* **Guaranteed today (verified from the shipped CSS):** a `position:fixed; inset:0;
  z-index:-1; pointer-events:none` element that is a child of `document.body` is painted
  after the canvas background and **before every box inside `#root`** — sidebar, center
  column, conversation, composer, menus — on Windows, Linux, plain web **and** macOS
  (on macOS `body{isolation:isolate}` makes body its stacking context, but the layer is
  still step 2 of that context and `#root` is step 3+). No ancestor of such an element
  exists other than `body`/`html`, so no panel-level stacking context can capture it.
* **Breaks (or needs re-verification) if:**
  1. a future DSH version sets `background`/`background-color` on **`html`** (then the body
     background stops propagating and is painted on body's own box, above the negative
     layer) **and** `--dsw-alias-bg-base` is left opaque. Mitigation: override
     `--dsw-alias-bg-base` to a translucent colour (R.2 already does).
  2. a future DSH version adds `isolation`/`transform`/`filter`/`contain`/`opacity<1` to
     **`body`** *and* the layer is inserted anywhere other than as a body child — irrelevant
     for case (a) (macOS already has `isolation:isolate` and behaves correctly).
  3. you mount the layer in `shell.overlay` (case (b)) — it lands in
     `.BynINW_overlayLayer`'s `z-index:20` stacking context and **always paints above UI
     text**.
  4. you mount the layer inside a center-column slot (case (c)) and any wrapper between the
     element and `body` gains a stacking context or a transform: then it is captured (drawn
     above that panel's background, below/above its content depending on the wrapper) or it
     becomes clipped and no longer viewport-sized. Ancestors that would need to remain
     stacking-context-free: the slot/panel wrapper chain, `.Dc7zOa_root` (safe today),
     `.BynINW_centerCol`, `.BynINW_frame`, `div[data-slot="root"]`, `#root`, `body`.
* **Without the token overrides the layer is invisible**, not harmful: the opaque
  `--dsw-alias-bg-base` frame/columns/canvas sit above it.
* Readability is a design choice, not a stacking risk: the wallpaper can never cover text
  in case (a); text contrast is set by how translucent you make
  `--dsw-alias-bg-base` / `--dsw-specific-sidebar-fill` plus the R.1 scrim.

---

# UNVERIFIED

1. **Runtime confirmation of the paint order in this exact Electron build** — the analysis
   above is CSS-2.1-Appendix-E reasoning over the shipped, byte-exact stylesheets; no
   browser/DevTools session was run in this read-only research session.
2. **`url(...)` as a token value's end-to-end behaviour** — accepted by `validateOverrides`
   (only `typeof === "string"` is checked) and by `CSSStyleDeclaration.setProperty`, but the
   "invalid at computed-value time" fallback for consumers that use `background-color:` is
   spec-derived, not observed in this app.
3. **Electron compositing of an alpha `titleBarOverlay.color`** — `main.js`'s `validColor`
   regex accepts `rgba(...)`, but whether Electron 44 blends that alpha over the web
   content in the 40px caption band is untested here.
4. **Any façade that pins `source` to a package id for third-party plugins** — the JSDoc
   claims one (`theme:lib/client.js:1465-1467`), but no such code ships in the asar.
5. **Whether a `-webkit-app-region:no-drag` body child (`frontend-index.css:682`) could
   affect macOS window dragging under a `pointer-events:none`, `z-index:-1` layer** — hit
   testing should skip it; not verified.
6. **Third-party/injected CSS beyond the shipped packages** (only DSH's own packages plus
   the frontend bundle were inventoried) could add stacking contexts not listed in §B.3.
