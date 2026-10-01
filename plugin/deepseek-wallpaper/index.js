/**
 * Host half of the DeepSeek wallpaper bundle.
 *
 * It owns exactly one job: publish this package's `assets/` directory over the
 * loopback HTTP carrier the Web GUI is already loaded from, so the Client half
 * can hand real same-origin URLs to `<video>` / `<img>`.
 *
 * The built-in frontend dist server answers with `Content-Length` only, which
 * is not enough for a media element: Chromium asks for byte ranges whenever it
 * seeks or restarts the loop. This route therefore implements conditional
 * requests and RFC 9110 single-range responses itself.
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Shared with the Client half; the two files are installed together. */
const ROUTE_PREFIX = '/dsh-wallpaper'

const PACKAGE_DIR = fileURLToPath(new URL('.', import.meta.url))

/**
 * Explicit allow-list. The route never joins request input onto a path, so a
 * traversal attempt cannot reach anything that is not named here.
 * @type {ReadonlyMap<string, string>}
 */
const ASSETS = new Map([
  ['wallpaper-high.mp4', 'video/mp4'],
  ['wallpaper-balanced.mp4', 'video/mp4'],
  ['wallpaper-eco.mp4', 'video/mp4'],
  ['poster-wallpaper-high.webp', 'image/webp'],
  ['poster-wallpaper-balanced.webp', 'image/webp'],
  ['poster-wallpaper-eco.webp', 'image/webp'],
  ['mature-cover.webp', 'image/webp'],
  ['mature-cover-720.webp', 'image/webp'],
  ['mature-figure.webp', 'image/webp'],
  ['chibi-cover.webp', 'image/webp'],
  ['chibi-cover-720.webp', 'image/webp'],
  ['chibi-figure.webp', 'image/webp'],
])

/** One hour: long enough to keep a 15 s loop off the disk, short enough that
 * replacing an asset is visible without clearing a cache. */
const CACHE_CONTROL = 'public, max-age=3600'

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  })
  res.end(text)
}

/**
 * Single-range parser for `bytes=` requests.
 * @returns {{ start: number, end: number } | 'invalid' | null}
 */
function parseRange(header, size) {
  if (typeof header !== 'string' || header.length === 0) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return 'invalid'
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return 'invalid'
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'invalid'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(rawStart)
  if (!Number.isSafeInteger(start) || start >= size) return 'invalid'
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (!Number.isSafeInteger(end) || end < start) return 'invalid'
  return { start, end }
}

/** @param {import('node:http').ServerResponse} res */
function unsupportedRange(res, size) {
  res.writeHead(416, {
    'Content-Range': `bytes */${size}`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  })
  res.end()
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function serveAsset(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' })
    res.end()
    return
  }

  let pathname
  try {
    pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  } catch {
    sendJson(res, 400, { error: 'bad-request' })
    return
  }

  const name = pathname.slice(ROUTE_PREFIX.length).replace(/^\/+/, '')
  const contentType = name.length > 0 && !name.includes('/') ? ASSETS.get(name) : undefined
  if (contentType === undefined) {
    sendJson(res, 404, { error: 'not-found', name })
    return
  }

  const file = join(PACKAGE_DIR, 'assets', name)
  let info
  try {
    info = await stat(file)
  } catch {
    sendJson(res, 404, { error: 'missing-asset', name })
    return
  }
  if (!info.isFile()) {
    sendJson(res, 404, { error: 'not-a-file', name })
    return
  }

  const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': CACHE_CONTROL,
    'Accept-Ranges': 'bytes',
    'ETag': etag,
    'Last-Modified': info.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
  }

  const ifNoneMatch = req.headers['if-none-match']
  if (typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').some((tag) => tag.trim() === etag)) {
    res.writeHead(304, headers)
    res.end()
    return
  }

  const range = parseRange(req.headers.range, info.size)
  if (range === 'invalid') {
    unsupportedRange(res, info.size)
    return
  }

  const start = range === null ? 0 : range.start
  const end = range === null ? info.size - 1 : range.end
  const status = range === null ? 200 : 206
  headers['Content-Length'] = String(end - start + 1)
  if (range !== null) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`

  res.writeHead(status, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }

  const stream = createReadStream(file, { start, end })
  stream.on('error', () => {
    res.destroy()
  })
  req.on('close', () => {
    stream.destroy()
  })
  stream.pipe(res)
}

/** Host-side defaults. A user can override any of them in the profile patch. */
const DEFAULT_CONFIG = {
  enabled: true,
  injectConfigIntoIndex: true,
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ enabled?: boolean, injectConfigIntoIndex?: boolean } | undefined} config
 */
export function apply(ctx, config) {
  const resolved = { ...DEFAULT_CONFIG, ...(config ?? {}) }
  if (resolved.enabled === false) return

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: (req, res) => {
          serveAsset(req, res).catch(() => {
            if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
            else res.destroy()
          })
        },
      }),
    'deepseek-wallpaper: asset route',
  )

  if (resolved.injectConfigIntoIndex === false) return

  const payload = { base: ROUTE_PREFIX, assetVersion: 1 }
  const script = `<script>window.__DSH_WALLPAPER__=${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>`
  ctx.effect(
    () =>
      ctx.webServer.tapIndex((html) =>
        html.includes('</head>') ? html.replace('</head>', `${script}</head>`) : `${script}${html}`,
      ),
    'deepseek-wallpaper: index config',
  )
}

export const inject = ['webServer']
