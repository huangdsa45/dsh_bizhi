# Serving large binary assets (MP4 / WebP) from a DSH plugin bundle to the Web page

Research date: 2026-10-01. DSH install: `E:\dsh_windows` (asar `E:\dsh_windows\resources\app.asar`, 121,348,951 bytes).
Live GUI host: `http://127.0.0.1:19387` (PID 30204 owns the listener).

## How to read the citations in this file

Everything under `dsh/...` is a path **inside the asar**. Two local trees hold verbatim copies made with `tools/asar.mjs dump`:

| Citation form | Local path you can open with the read/grep tools |
|---|---|
| `dsh/node_modules/@deepseek-ai/<pkg>/...` | `.work/research/dump2/dsh/node_modules/@deepseek-ai/<pkg>/...` (for the 10 packages dumped there) and `.work/research/dumpall/dsh/node_modules/@deepseek-ai/<pkg>/...` (for all `dsh-*` packages) |
| `lib/main.js` (Electron main at asar root) | `.work/research/dump2/lib/main.js` |

Line numbers quoted below are the line numbers of those local copies.

---

## 0. Executive summary (the four answers)

| Question | Answer |
|---|---|
| Is there a supported way to get a URL for a file in the plugin package dir? | **Yes, exactly one: register your own `webServer` route and serve the bytes yourself.** Nothing in DSH serves a plugin package directory over HTTP. |
| Does the webserver do HTTP Range / 206 for me? | **No.** `@deepseek-ai/dsh-host-webserver` contains no `Range`, `Accept-Ranges`, `Content-Range`, `416`, `ETag`, `Last-Modified` or `If-Range` code at all. Your handler must implement it. |
| Is there a reusable "serve this file" helper? | Only `serveStatic` exported from `@deepseek-ai/dsh-host-frontend-static`, and it is **unusable for MP4**: no Range, no caching headers, fixed MIME table without `.mp4`/`.webp`, buffers the whole file, and it renders the SPA index. Details in §A.4. |
| Do I need a token / cookie for a `<video src="...">`? | **No.** Only the `/api` prefix route and the SPA index are authenticated. Every other registered route is public. Empirically confirmed (§A.6). In DSH Desktop your route is reached through the app's own scheme `dsh-app://app/...`, which forwards to the Host **and attaches the session cookie for you**. |
| Does the client module table expose an asset helper / base URL? | **No.** `require(spec)` + `require.async("./client.<name>.js")` only. There is no `require.resolve`, no asset URL helper, and no client-side equivalent of `ctx.clientModules.clientPath(id)`. Details in §B.3. |

---

## A. Host HTTP route API

### A.1 The exact `WebRoute` type

The package ships no `.d.ts`, but the shipped generated API catalog carries the declaration verbatim.

`dsh/node_modules/@deepseek-ai/dsh-tool-cordis/lib/types/api-catalog.js:7846-7853`:

```js
    {
        name: 'WebRoute',
        declaration: 'export interface WebRoute {\n    kind: WebRouteKind;\n    path: string;\n    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;\n}',
    },
    {
        name: 'WebRouteKind',
        declaration: 'export type WebRouteKind = \'exact\' | \'prefix\';',
    },
```

So:

| Field | Required | Type / meaning |
|---|---|---|
| `kind` | yes | `'exact'` or `'prefix'` — which of the two tables the route goes into |
| `path` | yes | pathname only; **no query string, no wildcard syntax, no trailing-slash magic** |
| `handler` | yes | `(req: IncomingMessage, res: ServerResponse) => void \| Promise<void>` — **raw `node:http` objects, not Fetch `Request`/`Response`** |

`WebUpgradeRoute` (for WebSockets) is `dsh/node_modules/@deepseek-ai/dsh-tool-cordis/lib/types/api-catalog.js:7887-7889`:

```js
        name: 'WebUpgradeRoute',
        declaration: 'export interface WebUpgradeRoute {\n    path: string;\n    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>;\n}',
```

`registerFallback` takes exactly the `handler` of `WebRoute` (`api-catalog.js:3440`):
`signature: 'registerFallback(handler: WebRoute[\'handler\']): () => void'`.

### A.2 `path` / `method` / prefix syntax — the real matching rule

There is **no `method` field**. The handler sees every method and must reject the ones it does not implement.

`dsh/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js:322-332`:

```js
	/** Longest-prefix-wins over the prefix table after an exact-table miss. */
	match(pathname) {
		const exact = this.exact.get(pathname);
		if (exact !== void 0) return exact;
		let best;
		for (const [prefix, route] of this.prefixes) {
			if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;
			if (best === void 0 || prefix.length > best.path.length) best = route;
		}
		return best;
	}
```

Consequences:

* matching is on the **pathname only**; `new URL(req.url ?? "/", "http://x").pathname` is what is matched (`lib/index.js:232`). Query string is available to the handler via `req.url` but never participates in matching.
* `exact` = whole-pathname equality. `prefix` = `pathname === prefix` **or** `pathname.startsWith(prefix + "/")`. `/wallpaper-assets` matches `/wallpaper-assets` and `/wallpaper-assets/x.mp4`, but **not** `/wallpaper-assetsx`.
* HTTP order: exact table first, then longest prefix, then the fallback seat.
* Registering the same `(kind, path)` twice **throws** (`lib/index.js:179`): `throw new Error(\`webserver: duplicate ${route.kind} route "${route.path}"\`)`.
* No wildcards, no `:params`, no regex.

### A.3 What `register` returns and how it is disposed

`dsh/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js:177-184`:

```js
	register(route) {
		const table = route.kind === "exact" ? this.exact : this.prefixes;
		if (table.has(route.path)) throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`);
		table.set(route.path, route);
		return () => {
			table.delete(route.path);
		};
	}
```

It returns a plain zero-arg disposer. The canonical ownership pattern in shipped code wraps it in `ctx.effect`, e.g. `dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:545-551`:

```js
		const registerWebCarrier = (webCtx) => {
			webCtx.effect(() => webCtx.webServer.register({
				kind: "prefix",
				path: PLUGIN_ROUTE,
				handler: this.serveBundle
			}), "client-modules: bundle route");
		};
		ctx.inject(["webServer"], registerWebCarrier);
```

`ctx.effect` semantics, `dsh/node_modules/@deepseek-ai/cordis/src/fiber.ts:402-414`:

```
   * `execute` runs immediately; the disposers it produces are collected and
   * run (in reverse order) either when the returned disposer is called or
   * when the fiber unloads, whichever comes first. Calling the disposer twice
   * is a no-op. ...
   * @param execute — the effect body; see {@link Effect} for accepted shapes.
   * @param label — effect label shown in `getEffects()` diagnostics.
```

with `fiber.ts:74-89`:

```ts
export type Disposable<T = any> = () => T
...
export type Effect<T = any> =
  | SyncEffect<T>
  | AsyncEffect<T>
```

A route registered with a bare `ctx.effect(() => ctx.webServer.register(route), 'label')` is removed on plugin disable/unload and re-added if the `webServer` service is replaced.

### A.4 Range support: the webserver does none

The webserver is 366 lines; I read all of them. It contains no range handling. The only occurrence of the word "range" in the whole host-side `dsh-*` tree is the gzip middleware deliberately **skipping** 206 responses:

`dsh/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js:106-117`:

```js
function createGzipMiddleware(config) {
	const middleware = compressionMiddleware({
		level: config.compressionLevel,
		threshold: config.compressionThresholdBytes,
		filter(request, response) {
			if (response.getHeader("content-range") !== void 0) return false;
			const contentType = response.getHeader("content-type");
			if (typeof contentType === "string" && contentType.toLowerCase().startsWith("text/event-stream")) return false;
			if (typeof contentType === "string" && /^multipart\/form-data(?:;|$)/i.test(contentType)) return true;
			return compressionMiddleware.filter(request, response);
		}
	});
```

The README confirms this is deliberate, `dsh/node_modules/@deepseek-ai/dsh-host-webserver/README.md:41`:

> `Cache-Control: no-transform`, range responses, SSE, ZIP, and the packaged `.gz` Worker image remain unchanged.

Evidence that **nothing** implements range serving (searched every `*.js` of every `@deepseek-ai/dsh-*` package, 2845 files):

* `accept-ranges` / `Accept-Ranges`: the only hits are inside the bundled **pdf.js** client (`dsh-client-ui-sidebar-documentpreview/lib/client.pdf.js:12610`, a *consumer* of ranges), plus the gzip filter line above. No producer.
* `content-range` / `Content-Range`: same — the webserver gzip filter and pdf.js only.
* `416`, `if-range`, `etag`, `last-modified`, `req.headers.range`: **zero** HTTP-server hits anywhere in the host packages. (The `range` hits in `dsh-api-workspace-files/lib/typert.host.js:60` and `dsh-fs-local/lib/index.js:420` are an RPC `offset`/`length` byte-window read, *not* HTTP Range.)

**Conclusion: you must implement `Range` / `Accept-Ranges` / `Content-Range` / `206` / `416` in your own handler.** §C does exactly that.

Existing file-serving helper you could theoretically reuse — `serveStatic` from `@deepseek-ai/dsh-host-frontend-static` (`dsh/node_modules/@deepseek-ai/dsh-host-frontend-static/lib/index.js:49-75`, exported at line 99):

```js
async function serveStatic(pathname, res, distRoot, distIndex, authorizeIndex, renderIndex) {
	const target = resolve(normalize(join(distRoot, pathname)));
	if (target !== distRoot && !target.startsWith(distRoot + sep)) {
		res.writeHead(403);
		res.end();
		return;
	}
	let body;
	let type;
	try {
		if (target === distRoot || target === distIndex) {
			if (!authorizeIndex()) return;
			body = await renderIndex();
			type = HTML_MIME;
		} else {
			body = await readFile(target);
			type = MIME[extname(target)] ?? "application/octet-stream";
		}
	} catch (error) {
		if (!STATIC_MISS_CODES.has(error.code)) throw error;
		res.writeHead(404);
		res.end();
		return;
	}
	res.writeHead(200, { "content-type": type });
	res.end(body);
}
```

Its MIME table (`lib/index.js:24-33`) is `.html .js .css .svg .json .map .webmanifest .gz` only — **no `.mp4`, no `.webp`** (`application/octet-stream`). It has **no** `Range`, **no** `Cache-Control`, **no** `ETag`/`Last-Modified`, and it **buffers the whole file** with `readFile`. It is also coupled to index rendering/authorization. Verdict: reusable only as a reference, **not usable for a video**.

### A.5 `WebServer` service surface (for reference)

`dsh/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js:139-170` declares `class WebServer extends Service { ... constructor(ctx, config) { super(ctx, "webServer"); ... } }`, i.e. the service key is `webServer`, and two getters exist: `get port()` and `get host()`.

Full method list as catalogued in `dsh/node_modules/@deepseek-ai/dsh-tool-cordis/lib/types/api-catalog.js:3423-3470`:

```
signature: 'register(route: WebRoute): () => void'
signature: 'registerUpgrade(route: WebUpgradeRoute): () => void'
signature: 'registerFallback(handler: WebRoute[\'handler\']): () => void'
signature: 'tapIndex(transform: (html: string) => string): () => void'
signature: 'applyIndexTaps(html: string): string'
signature: 'collectIndexInjections(): IndexInjection[]'
signature: 'renderIndex(html: string): string'
```

`registerFallback` is a **single seat**: `lib/index.js:206-212` — `if (this.fallback !== void 0) throw new Error("webserver: fallback already registered");`. In the shipped Web composition it is already owned by `frontend-static` (`dsh/node_modules/@deepseek-ai/dsh-host-frontend-static/lib/index.js:87`), so a plugin must **not** call `registerFallback`.

Also note `tapIndex` is a *raw-HTML index transform* and is **not** needed for assets (its only legitimate use is markup no `IndexInjection` row expresses; `README.md:51`).

### A.6 Authentication gate — empirically none on register()ed routes

The only gate is inside the `/api` prefix handler. `dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js:830-843`:

```js
		const route = {
			kind: "prefix",
			path: API_PATH,
			handler: async (req, res) => {
				const admission = connection.admit(req);
				if ("rejection" in admission) {
					res.writeHead(admission.rejection);
					res.end(admission.rejection === 401 ? "unauthorized" : "forbidden");
					return;
				}
				await webCtx.waterfall("connection/request", req, res, () => bridge(req, res, fetchHandler, maxRequestBodyBytes));
			}
		};
		webCtx.effect(() => webCtx.webServer.register(route), "client-connection: /api route");
```

with `lib/index.js:14` `const API_PATH = "/api";`. The trust fence + cookie check live in `requestRejection`/`admit` (`lib/index.js:585-594`) and are **called only from that handler** (and from `registerFetchRoute`'s channel wrapper and `dsh-host-open-in-app`, which opts in deliberately). The webserver itself never authenticates: `dsh/node_modules/@deepseek-ai/dsh-host-webserver/README.md:113`:

> **No server-wide TLS, authentication, or origin policy** — route owners such as `dsh-client-connection` enforce their own request policy.

and `dsh-client-connection/README.md:39`:

> Static assets remain public.

**Live probe on the running GUI (read-only HTTP GET/POST):**

```
GET  http://127.0.0.1:19387/                          -> 401   (index, gated by authorizeIndex)
GET  http://127.0.0.1:19387/plugins/nope/client.js    -> 404   (route reached, NO 401)
GET  http://127.0.0.1:19387/plugins/zzz               -> 404   (route reached, NO 401)
POST http://127.0.0.1:19387/api/zzz                   -> 401   (gated by connection.admit)
GET  http://127.0.0.1:19387/does-not-exist.txt        -> 404   (fallback, non-index => public)
```

So: **a plugin route is public, and a plain `<video src="...">` needs no token, cookie, or extra header.** (If you *want* the cookie gate, call the public `ctx.connection.requestRejection(req)` — `api-catalog.js:668`, `signature: 'requestRejection(request: ConnectionTrustRequest): ConnectionRequestRejection'` — exactly as `dsh-host-open-in-app/lib/index.js:1265` does.)

### A.7 The origin your page actually runs on (DSH Desktop) — important

The GUI window in this install is an **Electron window**, not a browser tab at `127.0.0.1:19387`. Evidence: process `DeepSeek Harness` PID 30372 has the visible window; `http://127.0.0.1:19387` is merely the Host's loopback server (PID 30204).

`lib/main.js` (Electron main, asar root):

* `lib/main.js:6221` — `const SCHEME = "dsh-app";`
* `lib/main.js:11019-11029`:

```js
protocol.registerSchemesAsPrivileged([{
	scheme: SCHEME,
	privileges: {
		standard: true,
		secure: true,
		supportFetchAPI: true,
		corsEnabled: true,
		stream: true,
		codeCache: true
	}
}]);
```

* `lib/main.js:11272` — `const applicationUrl = \`${SCHEME}://app/\`;` and the main window is navigated there (`lib/main.js:11426`, `11450`, `12074`, `12179` — always `navigateMain(applicationUrl)`).
* `lib/main.js:11542-11551` — the protocol handler:

```js
	protocol.handle(SCHEME, (request) => {
		const url = new URL(request.url);
		if (url.hostname === "shell") return serveWebDocument(request, join(app.getAppPath(), "renderer"));
		if (url.hostname === "app") {
			if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname.startsWith("/assets/") || ["/favicon.svg", "/manifest.webmanifest"].includes(url.pathname)) return serveWebDocument(request, join(resources.dsh, "node_modules", "@deepseek-ai", "dsh-web-frontend", "dist"));
			if (backend.host === void 0 || hostUrl === void 0 || hostCookie === void 0) return Promise.resolve(new Response(null, { status: 503 }));
			return forwardWebRequest(request, hostUrl, hostCookie);
		}
		return Promise.resolve(new Response(null, { status: 404 }));
	});
```

* `lib/main.js:7461-7492` — the forwarder:

```js
async function forwardWebRequest(request, host, cookie) {
	const source = new URL(request.url);
	const origin = request.headers.get("origin");
	if (origin !== null && origin !== "dsh-app://app") return new Response(null, { status: 403 });
	const target = new URL(host);
	target.pathname = source.pathname;
	target.search = source.search;
	const headers = new Headers(request.headers);
	for (const name of [
		"host",
		"origin",
		"cookie",
		"sec-fetch-site"
	]) headers.delete(name);
	headers.set("cookie", cookie);
	const init = {
		method: request.method,
		headers,
		body: request.body,
		signal: request.signal,
		duplex: "half",
		redirect: "manual"
	};
	const response = await fetch(target, init);
	const outgoing = new Headers(response.headers);
	for (const name of WITHHELD_RESPONSE_HEADERS) outgoing.delete(name);
	if (PLUGIN_BUNDLE_PATH.test(source.pathname)) outgoing.set("cache-control", "no-store");
	return new Response(response.body, {
		status: response.status,
		headers: outgoing
	});
}
```

with `lib/main.js:7436-7450`:

```js
const WITHHELD_RESPONSE_HEADERS = [
	"set-cookie",
	"content-encoding",
	"content-length",
	"transfer-encoding",
	"connection",
	"keep-alive",
	"te",
	"trailer",
	"upgrade",
	"proxy-authenticate",
	"proxy-authorization"
];
/** Host routes whose responses carry immutable cache headers keyed by a per-process revision. */
const PLUGIN_BUNDLE_PATH = /^\/plugins\//u;
```

**Three consequences that shape the recipe:**

1. A page-relative or path-absolute URL under `dsh-app://app/…` that is **not** in `{"/", "/index.html", "/assets/*", "/favicon.svg", "/manifest.webmanifest"}` is reverse-proxied to the Host HTTP server with the session cookie attached automatically. So a plugin route is reachable as `dsh-app://app/<route-path>` — **same-origin, no CORS, no token**.
2. **Never register your route under the top-level path `/assets`.** In the Electron shell, `dsh-app://app/assets/...` is answered from the packaged dist directory by `serveWebDocument` (`lib/main.js:7395-7416`) and is **never forwarded**; a missing file there returns 404 from the local root, silently shadowing your route.
3. `content-length` is stripped on the way out (chunked), while `content-range` and `accept-ranges` are **relayed**, and the HTTP status (200/206/416) is preserved. Range request headers are forwarded (all headers except `host`/`origin`/`cookie`/`sec-fetch-site` are copied). `stream: true` on the scheme means `<video>` playback over it is supported by Chromium.

> **UNVERIFIED (runtime):** I did not play a video end-to-end. Static analysis says the 206 path works through the Electron forwarder because Chromium's media loader reads `Content-Range` for total length, but a missing `Content-Length` on a 206 is a known source of media bugs. **Verify actual playback and seeking in the running app before shipping.** If seeking misbehaves, the fallback is to answer 200 with the full body and `Accept-Ranges: none` (plays, just no byte-range seeking), or to open the URL at `http://127.0.0.1:<port>/...` in a real browser to compare.

If the user ever opens `http://127.0.0.1:19387` in a normal browser instead, the identical path-absolute URL (`/wallpaper-assets/...`) works, because the same route is registered on the Host webserver itself. This is why the recipe uses a **path-absolute** URL: it is correct under both origins.

---

## B. Static assets for client bundles

### B.1 How the browser loads a client plugin module — exact URL pattern

The Host scans Loader entries for packages whose `package.json` declares `dsh.client`, and serves each built bundle under the `/plugins` prefix route.

Route registration — `dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:545-551` (quoted in §A.3) with `lib/index.js:201`:

```js
/** Absolute route prefix serving every plugin resource. */
const PLUGIN_ROUTE = "/plugins";
```

URL construction — `lib/index.js:203-222`:

```js
function comboSearch(ids, rev, sourceMap = false) {
	return `??${ids.map((id) => `${id}/client.js${sourceMap ? ".map" : ""}`).join(",")}&rev=${rev}`;
}
/** Absolute route URL for one combo resource. */
function comboUrl(ids, rev, sourceMap = false) {
	return `${PLUGIN_ROUTE}/${comboSearch(ids, rev, sourceMap)}`;
}
...
function comboReference(ids, rev, sourceMap = false) {
	return comboUrl(ids, rev, sourceMap).slice(1);
}
/** Absolute route URL for one package-local chunk. */
function chunkUrl(id, fileName, rev, sourceMap = false) {
	return `${PLUGIN_ROUTE}/${id}/${fileName}${sourceMap ? ".map" : ""}?rev=${rev}`;
}
```

So the browser-facing forms are:

* one-package (used for every lazily loaded row, and for HMR of one changed row): `plugins/??<package-name>/client.js&rev=<rev>` (document-relative; the leading `/` is stripped on purpose — see the comment at `lib/index.js:210-218` citing `.agents/notes/implemented/architecture/2026-09-14-web-document-relative-app-routes.md`)
* a package-local **JS chunk** next to `client.js`: `/plugins/<package-name>/client.<name>.js?rev=<rev>`
* startup batches: `/plugins/??<id1>/client.js,<id2>/client.js&rev=<rev>`

The `<id>` is the **package name** — `dsh/node_modules/@deepseek-ai/dsh-client-modules/README.md:38`: “`<id>/client` and the bare id resolve to the same exports, because a plugin bundle is its package's client half.”

### B.2 Does the loader expose the plugin's OWN directory over HTTP? **No.**

The `/plugins` handler is a closed allow-list. `dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:958-978`:

```js
	async bundleResource(method, url) {
		if (method !== "GET" && method !== "HEAD") return { status: 405 };
		const requestUrl = new URL(url, "http://x");
		const resourceUrl = `${requestUrl.pathname}${requestUrl.search}`;
		const response = this.responses.get(resourceUrl) ?? this.previousBatchResponses.get(resourceUrl) ?? this.chunkResponse(requestUrl);
		if (response !== void 0) return {
			status: 200,
			headers: {
				"content-type": response.contentType,
				"cache-control": IMMUTABLE_CACHE
			},
			...method === "HEAD" ? {} : { body: await response.body() }
		};
		return { status: 404 };
	}
	serveBundle = async (req, res) => {
		/* v8 ignore next -- `?? '/'` arm: node:http always sets url on server requests. */
		const response = await this.bundleResource(req.method, req.url ?? "/");
		res.writeHead(response.status, response.headers);
		res.end(response.body);
	};
```

A resource is served only if its **exact** `pathname+search` is already a published combo response (`this.responses`, `this.previousBatchResponses`) or matches a package-local chunk URL. The chunk matcher, `lib/index.js:914-932` and `169`:

```js
	const CLIENT_CHUNK = /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;
...
	chunkRequest(requestUrl) {
		const resourceUrl = `${requestUrl.pathname}${requestUrl.search}`;
		for (const record of this.table.values()) {
			const prefix = `/plugins/${record.entry.id}/`;
			if (!requestUrl.pathname.startsWith(prefix)) continue;
			const requested = requestUrl.pathname.slice(prefix.length);
			const sourceMap = requested.endsWith(".map");
			const fileName = sourceMap ? requested.slice(0, -4) : requested;
			if (!CLIENT_CHUNK.test(fileName)) return void 0;
			if (resourceUrl !== chunkUrl(record.entry.id, fileName, record.entry.rev, sourceMap)) return void 0;
			...
```

`chunkResponse` additionally requires the file to be **sibling of `client.js`** (`lib/index.js:938`): `const clientPath = join(dirname(record.meta.clientPath), fileName);`.

Therefore:

* `/plugins/<pkg>/assets/foo.webp` → `chunkRequest` fails `CLIENT_CHUNK` → 404.
* `/plugins/<pkg>/client.assets.foo.webp` → fails `CLIENT_CHUNK` (must end `.js`) → 404.
* Only `client.<name>.js` and `client.<name>.js.map` beside `client.js` are reachable. **There is no directory exposure.**

### B.3 Is there a documented convention / package.json field for plugin static files?

**No.** The `dsh.client` declaration grammar accepts exactly four fields. `dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:53-72`:

```js
	if (typeof value !== "object" || value === null) throw new Error(`client-modules: ${pkgName} has a non-object dsh.client declaration`);
	...
	if (typeof decl.platform !== "string") throw new Error(`client-modules: ${pkgName} dsh.client.platform must be a string`);
	const inject = optionalStringArray(pkgName, "dsh.client.inject", decl.inject);
	const external = optionalStringArray(pkgName, "dsh.client.external", decl.external);
	if (decl.immediately !== void 0 && typeof decl.immediately !== "boolean") throw new Error(`client-modules: ${pkgName} dsh.client.immediately must be a boolean`);
```

and the bundle location comes only from `exports["./client"]` — `lib/index.js:170-181, 718-723`:

```js
/** Resolve `exports["./client"]` to a relative path, accepting the string and one-level conditional forms. */
function clientExportOf(pkgName, exportsField) {
	if (typeof exportsField !== "object" || exportsField === null) return void 0;
	const client = exportsField["./client"];
	if (client === void 0) return void 0;
	if (typeof client === "string") return client;
	if (typeof client === "object" && client !== null) {
		const fallback = client.default;
		if (typeof fallback === "string") return fallback;
	}
	throw new Error(`client-modules: ${pkgName} exports["./client"] must be a string or an object with a string default`);
}
```
```js
		const clientRel = clientExportOf(packageName, pkg.exports);
		if (clientRel === void 0) throw new Error(`client-modules: ${packageName} declares dsh.client but exports no "./client" bundle`);
```

The boot-graph row carries only `id`, `url`, `rev`, `inject`, `immediately`, `external` — no asset base (`api-catalog.js:7775-7790`):

```js
        name: 'WebBootEntry',
        declaration: 'export interface WebBootEntry {\n    id: string;\n    url: string;\n    rev: string;\n    inject?: string[];\n    immediately?: boolean;\n    external?: string[];\n}',
```

I also searched the shipped authoring guide (`dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/references/ui-plugin.md`, 13 lines, read in full) and `references/host-plugin.md`: neither mentions shipping binary assets, an `assets/` convention, or any asset URL. The only asset-adjacent manifest field documented anywhere is the **plugin-manager card icon**, `host-plugin.md:37-43`:

```json
{ "icon": "./icon.svg", "exports": { "./package.json": "./package.json", "./locale/*.json": "./locale/*.json" }, "files": ["locale/*.json", "icon.svg"] }
```

> "`icon` is a path relative to the manifest directory; SVG, PNG, JPEG, and WebP up to 256 KiB are accepted ..." (`host-plugin.md:45`)

That is a **256 KiB** manifest icon read by the Host for plugin cards — it is *not* an HTTP route for the page. Do not try to reuse it for a 3 MB MP4.

### B.4 Does the client half get `require.resolve` / an asset URL helper / a base URL?

**No.** The module table's entire public require surface is `makeRequire`, `dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js:696-714`:

```js
			makeRequire(ownerId, edges) {
				const require = (spec) => {
					edges.add(spec);
					if (this.seed.has(spec)) return this.seed.get(spec);
					const id = stripClientSuffix(spec);
					const record = this.loadCache.get(id);
					if (record !== void 0) return record.exports;
					if (this.factories.has(id)) return this.materialize(id).exports;
					throw new Error(`client-modules: require("${spec}") missed the module table — ...`);
				};
				require.async = async (spec) => {
					edges.add(spec);
					if (!spec.startsWith("./")) return await this.import(spec);
					const fileName = spec.slice(2);
					if (!CLIENT_CHUNK.test(fileName)) throw new Error(`client-modules: invalid relative chunk request ${JSON.stringify(spec)}`);
					return await this.importChunk(ownerId, fileName);
				};
				return require;
			}
```

* no `require.resolve`
* `require.async('./x')` only accepts `client.<name>.js` (`client.js:470`, `CLIENT_CHUNK`)
* the internal chunk URL builder is not exported (`client.js:479-486`, `function chunkUrl(row, fileName, rev)`)

What the client *does* have is `ctx.modules` — the kernel-built module system instance, published at `client.js:862-868`:

```js
		* Enroll the kernel-built module system as `ctx.modules`.
	...
			ctx.reflect.provide("modules", modules);
```

Its instance fields include `manifest` and `graphRows` (`client.js:506-529`), so a client plugin could in principle read its own row URL:

```js
const row = ctx.modules.manifest.modules.find(r => r.id === '@local/my-bundle')
const ownComboUrl = row.url          // e.g. "plugins/??@local/my-bundle/client.js&rev=abc123"
```

**This is an implementation-level field, not a documented API, and it is useless for assets anyway** — it points at the combo endpoint, which serves only that one concatenated script. `ctx.clientModules.clientPath(id)` (`lib/index.js:569-571`, returns an **absolute filesystem path**) is a **Host-only** method; there is no client equivalent. Treat "the Client half can compute a URL for a file in its own package directory" as **not supported**.

---

## C. RECOMMENDED RECIPE

Serves `assets/wallpaper-1080.mp4` (and the two WebP posters) from the installed bundle directory with correct `Content-Type`, `Accept-Ranges`, `Cache-Control` and full `206` handling.

### C.0 Package layout and manifest

```
my-wallpaper/
  package.json
  cordis.patch.yml
  index.js            <- Host half (ESM, export function apply)
  client.js           <- Client half (plain JS, window.__ModuleLoader__.load)
  assets/
    wallpaper-1080.mp4
    poster-wallpaper-balanced.webp
    poster-wallpaper-eco.webp
```

`package.json`

```json
{
  "name": "@local/my-wallpaper",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true, "inject": [] }
  },
  "files": ["index.js", "client.js", "cordis.patch.yml", "assets/**"]
}
```

`cordis.patch.yml`

```yaml
- insert:
    - id: my-wallpaper
      name: '@local/my-wallpaper'
```

Notes:

* `dsh.bundle.patch` is what makes the directory a **bundle** the `plugin_manager` `install_bundle` action accepts (`host-plugin.md:3`: "A bundle is a package whose `package.json` declares `dsh.bundle.patch`").
* `exports["./client"]` is mandatory — `client-modules` throws `declares dsh.client but exports no "./client" bundle` otherwise.
* `dsh.client` may contain **only** `platform`, `inject`, `external`, `immediately`; anything else throws at activation.
* Install with `plugin_manager install_bundle` and `target: "E:\\vibecoding\\dsh_bizhi\\my-wallpaper"` (absolute path required — `dsh-plugin-manager/lib/index.js:76-77`: "a local path must be absolute").
* **How it lands on disk (verified locally with the bundled pnpm 11.7.0):** `pnpm add <abs dir>` records `link:` and creates a **junction** into the profile's `node_modules`, so `assets/` stays exactly where you wrote it and is fully readable. Probe transcript:

```
dependencies:
+ @local/probe-pkg link:E:/vibecoding/dsh_bizhi/.work/research/pnpm-probe/pkg
...
Name      LinkType Target
probe-pkg Junction {E:\...\pnpm-probe\pkg}
...
selfDir= E:\...\pnpm-probe\pkg\
asset= 102
```

The last line proves `import.meta.url` in the Host half resolves to the **real package directory** and that files in it are readable from the Host process. (The profile uses `nodeLinker: hoisted` — `C:\Users\ASUS\.dsh\profiles\desktop\pnpm-workspace.yaml:4`.) Keep `files` in the manifest anyway so the package still works if it is ever packed/tarballed.

### C.1 Host half — `index.js`

```js
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/**
 * The installed package directory. `import.meta.url` always resolves to the real
 * module location, junction or copy, so this is the one correct anchor for files
 * shipped beside the Host half.
 */
const PACKAGE_DIR = fileURLToPath(new URL('.', import.meta.url))

/**
 * Route prefix. MUST NOT be "/assets": in DSH Desktop, `dsh-app://app/assets/...`
 * is answered from the packaged dist directory and never forwarded to the Host.
 */
const ROUTE_PREFIX = '/wallpaper-assets'

/** Allow-list: request path (after the prefix) -> file under PACKAGE_DIR + media type. */
const FILES = new Map([
  ['/wallpaper-1080.mp4', { file: 'assets/wallpaper-1080.mp4', type: 'video/mp4' }],
  ['/poster-wallpaper-balanced.webp', { file: 'assets/poster-wallpaper-balanced.webp', type: 'image/webp' }],
  ['/poster-wallpaper-eco.webp', { file: 'assets/poster-wallpaper-eco.webp', type: 'image/webp' }],
])

export const inject = ['webServer']

/**
 * Parse a single-range `Range: bytes=...` header.
 * @returns undefined (treat as no range / ignore the header), or
 *          { unsatisfiable: true }, or { start, end } inclusive.
 * A multi-range header (containing a comma) fails the pattern and is ignored,
 * which RFC 9110 permits.
 */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '')
  if (match === null) return undefined
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return undefined
  let start
  let end
  if (rawStart === '') {
    const suffix = Number(rawEnd)          // "bytes=-500"
    if (suffix === 0) return { unsatisfiable: true }
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)               // "bytes=0-" / "bytes=100-200"
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }
  if (!Number.isSafeInteger(start) || start >= size || start > end) return { unsatisfiable: true }
  return { start, end }
}

export function apply(ctx) {
  const route = {
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' })
        res.end()
        return
      }

      const pathname = new URL(req.url ?? '/', 'http://x').pathname
      const entry = FILES.get(pathname.slice(ROUTE_PREFIX.length))
      if (entry === undefined) {
        res.writeHead(404)
        res.end()
        return
      }

      const absolute = join(PACKAGE_DIR, entry.file)
      let size
      try {
        size = (await stat(absolute)).size
      } catch {
        res.writeHead(404)
        res.end()
        return
      }

      // `no-transform` additionally keeps the webserver's gzip middleware off
      // these bytes (documented in the webserver README), on top of the fact
      // that video/mp4 and image/webp are non-compressible media types.
      const base = {
        'content-type': entry.type,
        'accept-ranges': 'bytes',
        'cache-control': 'public, max-age=86400, no-transform',
      }

      const range =
        req.headers.range === undefined ? undefined : parseRange(req.headers.range, size)

      if (range !== undefined && range.unsatisfiable === true) {
        res.writeHead(416, { ...base, 'content-range': `bytes */${size}` })
        res.end()
        return
      }

      const start = range?.start ?? 0
      const end = range?.end ?? size - 1
      const headers =
        range === undefined
          ? { ...base, 'content-length': String(size) }
          : {
              ...base,
              'content-length': String(end - start + 1),
              'content-range': `bytes ${start}-${end}/${size}`,
            }

      // writeHead must happen before any body byte so the gzip filter can see
      // `content-range` and skip the response.
      res.writeHead(range === undefined ? 200 : 206, headers)
      if (req.method === 'HEAD') {
        res.end()
        return
      }

      const stream = createReadStream(absolute, { start, end })
      stream.on('error', () => res.destroy())
      stream.pipe(res)
    },
  }

  // ctx.effect owns the disposer: the route disappears on disable/unload and is
  // re-registered if the webServer service is replaced.
  ctx.effect(() => ctx.webServer.register(route), 'my-wallpaper: asset route')
}
```

Swap `cache-control` for `'public, max-age=31536000, immutable, no-transform'` plus a `?v=<n>` query on the client URL if you want permanent caching; use a shorter max-age while you are still iterating on the media files.

### C.2 Client half — `client.js` (asset URLs)

```js
window.__ModuleLoader__.load({
  id: '@local/my-wallpaper',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // Path-absolute on purpose. It resolves correctly under BOTH page origins:
    //   DSH Desktop          dsh-app://app/wallpaper-assets/...  -> proxied to the Host
    //   plain browser        http://127.0.0.1:19387/wallpaper-assets/...
    // A document-relative form ("wallpaper-assets/...") also works today and is
    // the mount-safe variant if the app is ever served under a path prefix.
    const ASSETS = '/wallpaper-assets'

    function Wallpaper() {
      return h(
        'div',
        { className: 'my-wallpaper', 'aria-hidden': true, style: { position: 'absolute', inset: 0, pointerEvents: 'none' } },
        h('video', {
          src: `${ASSETS}/wallpaper-1080.mp4`,
          poster: `${ASSETS}/poster-wallpaper-balanced.webp`,
          autoPlay: true,
          loop: true,
          muted: true,
          playsInline: true,
          preload: 'auto',
          style: { width: '100%', height: '100%', objectFit: 'cover' },
        }),
        h('img', { src: `${ASSETS}/poster-wallpaper-eco.webp`, alt: '', style: { display: 'none' } }),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // Pick the slot you actually want; this mirrors templates/decoration/client.js.
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'my-wallpaper', order: 10 }, Wallpaper),
        )
      },
    }
  },
})
```

Do **not** add `crossOrigin`/`crossorigin` to the `<video>`/`<img>`: same-origin is what you want, and Electron's forwarder rejects any `Origin` that is not `dsh-app://app` with 403 (`lib/main.js:7464`).

### C.3 Verify after install

1. `plugin_manager` → `action: "list_bundles"` — confirm the row and `application: applied`.
2. Probe the route through the **Host** origin (no cookie needed):

   ```powershell
   curl.exe -s -D - -o NUL "http://127.0.0.1:19387/wallpaper-assets/wallpaper-1080.mp4"
   curl.exe -s -D - -o NUL -H "Range: bytes=0-1023" "http://127.0.0.1:19387/wallpaper-assets/wallpaper-1080.mp4"
   ```
   Expect `200` + `Accept-Ranges: bytes` + `Content-Type: video/mp4`, then `206` + `Content-Range: bytes 0-1023/<size>`.
3. In the running app, confirm the video plays and **seeking** works (this is the part I could not test — see the UNVERIFIED note in §A.7).

### C.4 Client-side `<video>` and Range — what to expect

* Chromium's media stack issues `Range: bytes=0-` first, then seeks with further ranges. Each is forwarded by the Electron shell to your route; each gets a 206.
* You receive `req.headers.range` as a raw string on the **Node** `IncomingMessage`; there is no Fetch `Request` and no `res.sendFile`.
* The webserver's gzip middleware will not touch these responses: `content-range` is present on 206s (explicit filter bail-out, `lib/index.js:111`), and `video/mp4` is `"compressible":false` in `dsh/node_modules/mime-db/db.json` (`video/mp4 {"source":"iana","compressible":false,...}`); `image/webp` has no `compressible` flag and falls through to the non-compressible default. `no-transform` makes this belt-and-braces.
* If your route ever exceeds ~3 MB per request *and* you want zero-copy behaviour, `createReadStream(...).pipe(res)` is already the right shape; do not `readFile` a 6 MB MP4 per request (that is exactly what `frontend-static.serveStatic` would do).

### C.5 Alternatives considered and rejected

| Alternative | Why it does not work |
|---|---|
| `<video src="/plugins/@local/my-wallpaper/assets/x.mp4">` | The `/plugins` handler only serves published combo URLs and `client.<name>.js` chunks; everything else is 404 (`dsh-client-modules/lib/index.js:914-978`). |
| `require.resolve` / an asset URL helper in the Client half | Does not exist (§B.4). |
| `dsh.client.external`, `exports`, `files` with an "assets" convention | No such convention or field exists; `dsh.client` accepts only `platform`/`inject`/`external`/`immediately` (§B.3). |
| Reuse `frontend-static.serveStatic` | No Range, no caching headers, no `.mp4`/`.webp` MIME, buffers the whole file, and is wired to the SPA index (§A.4). |
| `registerFallback` | Single seat, already owned by `frontend-static`; a second registration throws. |
| `ctx.connection.fetch.register(...)` | Those exact Fetch routes are dispatched **under the `/api` prefix** (`dsh-client-connection/lib/index.js:829-843`), so they are authentication-gated and, more importantly, are not usable as a `<video src>` (they are consumed via `fetch()` from the Client). |
| The plugin-card `icon` field | 256 KiB cap and read by the Host for UI cards only — not an HTTP route. |
| Base64 `data:` URL inline in `client.js` | Works, but bloats the bundle ~33 % and puts 4 MB of text into the module graph; only sane for the (30–100 KB) WebP posters as an optional micro-optimisation. |

---

## D. Things I could NOT verify — marked UNVERIFIED

1. **End-to-end `<video>` playback and byte-range seeking through the Electron `dsh-app://` forwarder.** The code path is unambiguous (status, `content-range`, `accept-ranges` relayed; `content-length` deliberately withheld; `stream: true` scheme), but I did not install a bundle and play media. Test this first.
2. **`install_bundle` end-to-end with an absolute directory path.** I reproduced only the package-manager half (`pnpm add <abs dir>` → `link:` junction, verified locally with the bundled pnpm 11.7.0 and a `pnpm-workspace.yaml` copied from the profile). I did not run `plugin_manager`.
3. **Whether `plugin_manager` applies an npm `files` filter when installing a local directory.** Because pnpm used `link:` in my probe, no filtering occurred and `assets/` was reachable. I am asserting nothing about a `file:`-style copy path; keeping `assets/**` in `files` makes the manifest correct either way.
4. **The exact slot id/registration options for the user's UI.** `shell.overlay` is used only as an illustration from the shipped guidance (`ui-plugin.md:5`); query `Slots.listSubTree` for the real target.
5. **No `.d.ts` files ship for `dsh-host-webserver`.** The `WebRoute`/`WebRouteKind`/`WebUpgradeRoute` declarations quoted in §A.1 come from the generated catalog `dsh-tool-cordis/lib/types/api-catalog.js`, cross-checked against the hand-written `lib/index.js` implementation. They match, but they are a generated artifact, not the package's own published types (`package.json` declares `"types": "lib/types/index.d.ts"`, and that file is absent from the asar).

---

## E. Evidence index (file → what it proves)

| File (asar path) | Proves |
|---|---|
| `dsh/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js` | `register`/`registerUpgrade`/`registerFallback`/`tapIndex` implementations, longest-prefix matching, disposer shape, gzip filter's `content-range` bail-out, no Range support |
| `dsh/node_modules/@deepseek-ai/dsh-host-webserver/README.md` | public contract; "No server-wide TLS, authentication, or origin policy"; gzip/`no-transform`/range note |
| `dsh/node_modules/@deepseek-ai/dsh-tool-cordis/lib/types/api-catalog.js` | exact `WebRoute`, `WebRouteKind`, `WebUpgradeRoute`, `IndexInjection`, `clientModules` method signatures |
| `dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js` | `/plugins` prefix route, combo/chunk URL construction, closed allow-list in `bundleResource`, `dsh.client` parser, `clientPath(id)` |
| `dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js` | `require`/`require.async` surface, `CLIENT_CHUNK`, `ctx.modules` publication, `loadBundle` script injection |
| `dsh/node_modules/@deepseek-ai/dsh-client-modules/README.md` | public description of the bundle route and lazy loading |
| `dsh/node_modules/@deepseek-ai/dsh-host-frontend-static/lib/index.js` | exported `serveStatic`, fixed MIME table, fallback seat ownership, `<base href="./">` injection |
| `dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js` | `API_PATH`, `admit`/`requestRejection`, gate applied only inside the `/api` handler |
| `dsh/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml` | shipped webserver config: `compression: gzip`, `compressionLevel: 1`, `compressionThresholdBytes: 1024` |
| `dsh/node_modules/@deepseek-ai/dsh-host-open-in-app/lib/index.js` | non-`/api` route examples, including a binary body with `content-type` + `cache-control` |
| `dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/**` | bundle manifest requirements, Host/Client export forms, decoration template |
| `dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js` | desktop host reports `http://127.0.0.1:${ctx.webServer.port}` + index injections over IPC |
| `lib/main.js` (asar root) | `SCHEME = "dsh-app"`, privileged scheme with `stream: true`, `navigateMain("dsh-app://app/")`, the protocol handler's local-serve list, `forwardWebRequest`, withheld headers |
| `dsh/node_modules/mime-db/db.json` | `video/mp4` compressible:false; `image/webp` unflagged |
| `C:\Users\ASUS\.dsh\profiles\desktop\{package.json,cordis.patch.yml,pnpm-workspace.yaml}` | profile state: no installed bundles/deps; `nodeLinker: hoisted` |
| live probes on `http://127.0.0.1:19387` | 401 on `/`, 404 (not 401) on `/plugins/*`, 401 on `/api/*`, 404 on unknown paths |
| local pnpm probe (`.work/research/pnpm-probe/`) | `pnpm add <abs dir>` → `link:` junction; `import.meta.url` resolves to the real package dir; sibling `assets/` readable |
