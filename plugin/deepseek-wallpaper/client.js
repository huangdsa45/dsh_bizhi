/**
 * Client half of the DeepSeek wallpaper bundle.
 *
 * Renders one decorative, non-interactive backdrop layer behind the whole
 * Harness shell, and makes the shell's two large opaque surfaces translucent so
 * the backdrop is visible while every text-bearing surface above them stays
 * opaque.
 *
 * Performance contract (see README.md):
 *   - the backdrop runs no JavaScript per frame: a plain `<video>` element is
 *     composited by the browser, so the main thread is idle while it plays;
 *   - no decoder exists until the page has been idle, and none runs while the
 *     window is hidden, unfocused, in reduced-motion mode, or (by default) on
 *     battery below 25 %;
 *   - switching the wallpaper off tears the element down (`removeAttribute`
 *     plus `load()`), which releases the decoder instead of parking it.
 */
window.__ModuleLoader__.load({
  id: '@local/deepseek-wallpaper',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // ---------------------------------------------------------------- constants

    const NS = 'deepseek-wallpaper'
    const LAYER_ID = 'dsh-deepseek-wallpaper'
    const STYLE_ID = 'dsh-deepseek-wallpaper-style'
    const FALLBACK_STYLE_ID = 'dsh-deepseek-wallpaper-surface'
    const STORE_KEY = 'dsh.deepseek-wallpaper.settings.v1'
    const FALLBACK_BASE = '/dsh-wallpaper'

    const MODES = ['video', 'mature', 'chibi', 'off']
    const QUALITIES = ['auto', 'high', 'balanced', 'eco']
    const TOGGLES = ['pauseWhenUnfocused', 'batterySaver', 'respectReducedMotion']

    const DEFAULTS = {
      mode: 'video',
      quality: 'auto',
      /** How strongly the backdrop is faded toward the panel colour, 0-80 %. */
      dim: 42,
      /** How translucent the two large shell surfaces become, 0-70 %. */
      translucency: 34,
      pauseWhenUnfocused: true,
      batterySaver: true,
      respectReducedMotion: true,
    }

    const MODE_LABEL = { off: '关闭', video: '循环动画', mature: '成熟比例', chibi: 'Q版大肥鱼' }
    const MODE_HINT = {
      off: '已关闭，不会创建任何解码器或网络请求。',
      video: '15 秒鲸鱼娘动画无缝循环播放；窗口失焦时自动停止解码。',
      mature: '成熟比例鲸鱼娘静态壁纸。',
      chibi: 'Q 版大肥鱼静态壁纸。',
    }
    const QUALITY_LABEL = { auto: '自动', high: '1080p', balanced: '720p', eco: '540p' }
    const QUALITY_TITLE = {
      auto: '自动：按窗口宽度和设备像素比选择清晰度',
      high: '高清 1920×1080',
      balanced: '均衡 1280×720',
      eco: '省电 960×540',
    }

    // ------------------------------------------------------------------- store

    function clampInt(value, min, max, fallback) {
      const n = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(n)) return fallback
      return Math.min(max, Math.max(min, Math.round(n)))
    }

    function readStored() {
      const next = { ...DEFAULTS }
      try {
        const raw = window.localStorage.getItem(STORE_KEY)
        if (raw === null) return next
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return next
        if (MODES.includes(parsed.mode)) next.mode = parsed.mode
        if (QUALITIES.includes(parsed.quality)) next.quality = parsed.quality
        next.dim = clampInt(parsed.dim, 0, 80, DEFAULTS.dim)
        next.translucency = clampInt(parsed.translucency, 0, 70, DEFAULTS.translucency)
        for (const key of TOGGLES) next[key] = parsed[key] !== false
      } catch {
        /* a corrupt or unavailable store falls back to the defaults */
      }
      return next
    }

    function createStore() {
      let value = readStored()
      const listeners = new Set()
      return {
        get: () => value,
        set(patch) {
          const next = { ...value }
          let changed = false
          for (const key of Object.keys(patch)) {
            if (next[key] !== patch[key]) {
              next[key] = patch[key]
              changed = true
            }
          }
          if (!changed) return false
          value = next
          try {
            window.localStorage.setItem(STORE_KEY, JSON.stringify(value))
          } catch {
            /* persistence is best-effort; the session keeps working without it */
          }
          for (const listener of Array.from(listeners)) {
            try {
              listener(value)
            } catch (error) {
              console.error('[deepseek-wallpaper] listener failed', error)
            }
          }
          return true
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    }

    // ------------------------------------------------------------------ helpers

    function assetBase() {
      const injected = window.__DSH_WALLPAPER__
      if (injected !== null && typeof injected === 'object' && typeof injected.base === 'string') {
        return injected.base.replace(/\/+$/, '')
      }
      return FALLBACK_BASE
    }

    /**
     * `auto` follows the CSS pixel width scaled by at most 1.5x of the device
     * pixel ratio, so a 1.25x display still gets an adequate source without
     * ever asking for a larger decode than the compositor can show.
     */
    function pickTier(quality) {
      if (QUALITIES.includes(quality) && quality !== 'auto') return quality
      const width = window.innerWidth || 1280
      const dpr = window.devicePixelRatio || 1
      const effective = width * Math.min(dpr, 1.5)
      if (effective >= 1900) return 'high'
      if (effective >= 1150) return 'balanced'
      return 'eco'
    }

    function readToken(name, fallback) {
      try {
        const value = window.getComputedStyle(document.body).getPropertyValue(name)
        const trimmed = value.trim()
        return trimmed.length > 0 ? trimmed : fallback
      } catch {
        return fallback
      }
    }

    // ------------------------------------------------------------------- styles

    const STYLE_TEXT = `
#${LAYER_ID}{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;background:transparent;contain:layout paint style;--dsh-wp-dim:0.42;--dsh-wp-veil:0.26;--dsh-wp-dim-color:var(--dsw-static-neutral-bluish-00,#ffffff)}
body[data-ds-dark-theme] #${LAYER_ID}{--dsh-wp-dim-color:var(--dsw-static-neutral-bluish-950,#151517)}
#${LAYER_ID}>*{position:absolute;inset:0;width:100%;height:100%;margin:0;border:0;pointer-events:none}
#${LAYER_ID}>.dsh-wp-media{object-fit:cover;object-position:center center;display:block}
#${LAYER_ID}>.dsh-wp-figure{object-fit:contain;object-position:right center;left:auto;width:auto;height:100%}
#${LAYER_ID}>.dsh-wp-dim{background:var(--dsh-wp-dim-color,#000);opacity:var(--dsh-wp-dim,0.42)}
#${LAYER_ID}>.dsh-wp-veil{background:linear-gradient(90deg,var(--dsh-wp-dim-color,#000) 0%,transparent 58%);opacity:var(--dsh-wp-veil,0.3)}
.dsh-wp-row{display:flex;flex-direction:column;gap:10px;padding:4px 0}
.dsh-wp-head{display:flex;flex-direction:column;gap:2px}
.dsh-wp-title{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsh-wp-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#a0a0a0)}
.dsh-wp-controls{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}
.dsh-wp-group{display:flex;align-items:center;gap:8px}
.dsh-wp-group>label{font-size:12px;color:var(--dsw-alias-label-secondary,#a0a0a0);white-space:nowrap}
.dsh-wp-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:8px;overflow:hidden}
.dsh-wp-seg>button{appearance:none;border:0;background:transparent;cursor:pointer;padding:4px 10px;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#a0a0a0);border-right:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35))}
.dsh-wp-seg>button:last-child{border-right:0}
.dsh-wp-seg>button:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.16))}
.dsh-wp-seg>button[data-on="true"]{background:var(--dsw-alias-brand-primary,#4176e6);color:#fff}
.dsh-wp-seg>button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4176e6);outline-offset:-2px}
.dsh-wp-slider{width:104px;accent-color:var(--dsw-alias-brand-primary,#4176e6)}
.dsh-wp-value{font-size:12px;min-width:36px;text-align:right;color:var(--dsw-alias-label-secondary,#a0a0a0);font-variant-numeric:tabular-nums}
.dsh-wp-switch{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary,#a0a0a0);cursor:pointer;user-select:none}
.dsh-wp-switch>input{accent-color:var(--dsw-alias-brand-primary,#4176e6);cursor:pointer}
`

    // ------------------------------------------------------------- backdrop core

    function createBackdrop(ctx, store) {
      let layer = null
      let videoEl = null
      let activeTier = null
      let idleHandle = 0
      let idleViaIdleCallback = false
      let resizeTimer = 0
      let batteryLow = false
      let batteryCleanup = null
      let disposed = false

      let tokenDisposer = null
      let fallbackStyle = null
      const motionQuery =
        typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null

      // ----------------------------------------------------------- style + layer

      function ensureStyle() {
        if (document.getElementById(STYLE_ID) !== null) return
        const tag = document.createElement('style')
        tag.id = STYLE_ID
        tag.dataset.plugin = NS
        tag.textContent = STYLE_TEXT
        document.head.appendChild(tag)
      }

      function ensureLayer() {
        if (document.body === null) return false
        document.getElementById(LAYER_ID)?.remove()
        const el = document.createElement('div')
        el.id = LAYER_ID
        el.setAttribute('aria-hidden', 'true')
        el.setAttribute('data-plugin', NS)
        document.body.insertBefore(el, document.body.firstChild)
        layer = el
        return true
      }

      function clearLayer() {
        if (layer !== null) layer.textContent = ''
      }

      // --------------------------------------------------------- shell surfaces

      /**
       * A previous module generation of this plugin (hot reload, or a profile
       * restart mid-swap) may have left its own surface stylesheet behind.
       * A stale `!important` rule would beat the inline token override, so drop
       * every style tag this plugin owns except the one this generation wrote.
       */
      function purgeStaleSurfaceStyles() {
        for (const node of Array.from(document.querySelectorAll(`style[data-plugin="${NS}"]`))) {
          if (node.id !== STYLE_ID) node.remove()
        }
      }

      function releaseSurfaceOverride() {
        if (tokenDisposer !== null) {
          const disposer = tokenDisposer
          tokenDisposer = null
          try {
            disposer()
          } catch {
            /* the disposer is best-effort */
          }
        }
        if (fallbackStyle !== null) {
          fallbackStyle.remove()
          fallbackStyle = null
        }
        document.getElementById(FALLBACK_STYLE_ID)?.remove()
      }

      /**
       * The two alias tokens that paint the shell's large surfaces. They are
       * mixed from the `--dsw-static-*` palette entries, which no theme layer
       * overrides: that keeps the value from referencing the token it defines,
       * and the literal light/dark pair is what `overrideTokens` requires.
       */
      function surfaceTokens(translucency) {
        const keep = `${100 - translucency}%`
        return {
          '--dsw-alias-bg-base': {
            light: `color-mix(in srgb, var(--dsw-static-neutral-bluish-00) ${keep}, transparent)`,
            dark: `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${keep}, transparent)`,
          },
          '--dsw-specific-sidebar-fill': {
            light: `color-mix(in srgb, var(--dsw-static-neutral-bluish-50) ${keep}, transparent)`,
            dark: `color-mix(in srgb, var(--dsw-static-neutral-bluish-900) ${keep}, transparent)`,
          },
        }
      }

      function applySurfaceOverride() {
        const settings = store.get()
        if (settings.mode === 'off') return
        const translucency = settings.translucency
        if (translucency <= 0) return
        const tokens = surfaceTokens(translucency)

        const theme = ctx.theme
        if (theme !== undefined && theme !== null && typeof theme.overrideTokens === 'function') {
          try {
            const disposer = theme.overrideTokens(NS, tokens)
            if (typeof disposer === 'function') {
              // Trust but verify: a token layer that silently refuses the value
              // would leave the shell opaque and hide the whole backdrop.
              if (readToken('--dsw-alias-bg-base', '').includes('color-mix')) {
                tokenDisposer = disposer
                return
              }
              disposer()
            }
          } catch (error) {
            console.warn('[deepseek-wallpaper] theme.overrideTokens rejected the palette, using a style tag', error)
          }
        }

        const base = tokens['--dsw-alias-bg-base']
        const sidebar = tokens['--dsw-specific-sidebar-fill']
        fallbackStyle = document.createElement('style')
        fallbackStyle.id = FALLBACK_STYLE_ID
        fallbackStyle.dataset.plugin = NS
        fallbackStyle.textContent =
          `body{--dsw-alias-bg-base:${base.light} !important;--dsw-specific-sidebar-fill:${sidebar.light} !important}` +
          `body[data-ds-dark-theme]{--dsw-alias-bg-base:${base.dark} !important;` +
          `--dsw-specific-sidebar-fill:${sidebar.dark} !important}`
        document.head.appendChild(fallbackStyle)
      }

      function updateSurface() {
        if (layer === null) return
        const settings = store.get()
        // The dim colour follows the palette in CSS; only the two strengths
        // come from the user's settings.
        layer.style.setProperty('--dsh-wp-dim', String(settings.dim / 100))
        layer.style.setProperty('--dsh-wp-veil', String(Math.min(0.7, settings.dim / 160)))
      }

      /** Re-apply the surface override after a translucency or mode change. */
      function syncSurface() {
        if (disposed) return
        releaseSurfaceOverride()
        applySurfaceOverride()
        updateSurface()
      }

      // -------------------------------------------------------------- playback

      function clearIdle() {
        if (idleHandle === 0) return
        if (idleViaIdleCallback) window.cancelIdleCallback?.(idleHandle)
        else window.clearTimeout(idleHandle)
        idleHandle = 0
      }

      function releaseMedia() {
        clearIdle()
        if (videoEl === null) return
        const el = videoEl
        videoEl = null
        try {
          el.pause()
          el.removeAttribute('src')
          el.load()
        } catch {
          /* teardown is best-effort */
        }
      }

      function shouldPlay() {
        const settings = store.get()
        if (settings.mode !== 'video') return false
        if (settings.pauseWhenUnfocused && !document.hasFocus()) return false
        if (document.hidden) return false
        if (settings.respectReducedMotion && motionQuery !== null && motionQuery.matches) return false
        if (settings.batterySaver && batteryLow) return false
        return true
      }

      function syncPlayback() {
        const el = videoEl
        if (el === null) return
        if (shouldPlay()) {
          if (el.getAttribute('src') === null && typeof el.dataset.src === 'string') el.src = el.dataset.src
          const attempt = el.play()
          if (attempt !== undefined && typeof attempt.catch === 'function') attempt.catch(() => {})
        } else if (!el.paused) {
          el.pause()
        }
      }

      function beginPlayback() {
        idleHandle = 0
        if (disposed) return
        const el = videoEl
        if (el === null || store.get().mode !== 'video') return
        const source = `${assetBase()}/wallpaper-${pickTier(store.get().quality)}.mp4`
        if (el.dataset.src !== source) {
          el.dataset.src = source
          el.src = source
          el.load()
        }
        syncPlayback()
      }

      function schedulePlayback() {
        clearIdle()
        if (videoEl === null) return
        if (typeof window.requestIdleCallback === 'function') {
          idleViaIdleCallback = true
          idleHandle = window.requestIdleCallback(beginPlayback, { timeout: 2500 })
        } else {
          idleViaIdleCallback = false
          idleHandle = window.setTimeout(beginPlayback, 1200)
        }
      }

      // ------------------------------------------------------------------ render

      function buildVideo(base) {
        const tier = pickTier(store.get().quality)
        activeTier = tier
        const video = document.createElement('video')
        video.className = 'dsh-wp-media'
        video.muted = true
        video.loop = true
        video.playsInline = true
        video.preload = 'none'
        video.autoplay = false
        video.poster = `${base}/poster-wallpaper-${tier}.webp`
        video.setAttribute('muted', '')
        video.setAttribute('playsinline', '')
        video.setAttribute('aria-hidden', 'true')
        video.setAttribute('tabindex', '-1')
        video.setAttribute('disableremoteplayback', '')
        try {
          video.disablePictureInPicture = true
        } catch {
          /* unavailable in some engines */
        }
        layer.appendChild(video)
        videoEl = video
        // The poster paints immediately; the decoder is created once idle.
        schedulePlayback()
      }

      function buildImages(base, slug) {
        const tier = pickTier(store.get().quality)
        activeTier = tier
        // A small window never needs the full-bleed sheet: reuse the 720p cut.
        const coverSuffix = tier === 'eco' ? '-720' : ''
        const cover = document.createElement('img')
        cover.className = 'dsh-wp-media'
        cover.decoding = 'async'
        cover.alt = ''
        cover.setAttribute('aria-hidden', 'true')
        cover.src = `${base}/${slug}-cover${coverSuffix}.webp`

        const figure = document.createElement('img')
        figure.className = 'dsh-wp-media dsh-wp-figure'
        figure.decoding = 'async'
        figure.alt = ''
        figure.setAttribute('aria-hidden', 'true')
        figure.src = `${base}/${slug}-figure.webp`

        const veil = document.createElement('div')
        veil.className = 'dsh-wp-veil'

        layer.appendChild(cover)
        layer.appendChild(figure)
        layer.appendChild(veil)
      }

      function render() {
        if (disposed || layer === null) return
        releaseMedia()
        clearLayer()
        const settings = store.get()
        if (settings.mode === 'off') {
          activeTier = null
          return
        }
        const base = assetBase()
        if (settings.mode === 'video') buildVideo(base)
        else buildImages(base, settings.mode === 'mature' ? 'mature' : 'chibi')
        const dim = document.createElement('div')
        dim.className = 'dsh-wp-dim'
        layer.appendChild(dim)
        updateSurface()
      }

      // ------------------------------------------------------------ event wiring

      function onFocusChange() {
        syncPlayback()
      }

      function onResize() {
        if (disposed) return
        const settings = store.get()
        if (settings.mode !== 'video' || settings.quality !== 'auto') return
        if (resizeTimer !== 0) window.clearTimeout(resizeTimer)
        resizeTimer = window.setTimeout(() => {
          resizeTimer = 0
          if (disposed) return
          if (pickTier('auto') !== activeTier) render()
        }, 1200)
      }

      function subscribeBattery() {
        const getBattery = navigator.getBattery
        if (typeof getBattery !== 'function') return
        let manager = null
        const update = () => {
          if (manager === null) return
          batteryLow = manager.charging === false && manager.level <= 0.25
          syncPlayback()
        }
        Promise.resolve(getBattery.call(navigator))
          .then((value) => {
            if (disposed) return
            manager = value
            manager.addEventListener('chargingchange', update)
            manager.addEventListener('levelchange', update)
            batteryCleanup = () => {
              manager.removeEventListener('chargingchange', update)
              manager.removeEventListener('levelchange', update)
            }
            update()
          })
          .catch(() => {})
      }

      // -------------------------------------------------------------- lifecycle

      function mount() {
        ensureStyle()
        purgeStaleSurfaceStyles()
        if (!ensureLayer()) return
        applySurfaceOverride()

        document.addEventListener('visibilitychange', syncPlayback)
        window.addEventListener('focus', onFocusChange)
        window.addEventListener('blur', onFocusChange)
        window.addEventListener('resize', onResize)
        motionQuery?.addEventListener('change', syncPlayback)
        subscribeBattery()

        render()
      }

      function dispose() {
        disposed = true
        clearIdle()
        if (resizeTimer !== 0) window.clearTimeout(resizeTimer)
        document.removeEventListener('visibilitychange', syncPlayback)
        window.removeEventListener('focus', onFocusChange)
        window.removeEventListener('blur', onFocusChange)
        window.removeEventListener('resize', onResize)
        motionQuery?.removeEventListener('change', syncPlayback)
        batteryCleanup?.()
        batteryCleanup = null
        releaseMedia()
        clearLayer()
        document.getElementById(LAYER_ID)?.remove()
        layer = null
        releaseSurfaceOverride()
        document.getElementById(STYLE_ID)?.remove()
      }

      return { mount, dispose, render, syncSurface, updateSurface, syncPlayback }
    }

    // ------------------------------------------------------------- settings view

    function Segmented({ value, options, onChange }) {
      return h(
        'div',
        { className: 'dsh-wp-seg', role: 'group' },
        options.map((option) =>
          h(
            'button',
            {
              key: option.value,
              type: 'button',
              title: option.title,
              'data-on': option.value === value ? 'true' : 'false',
              'aria-pressed': option.value === value ? 'true' : 'false',
              onClick: () => onChange(option.value),
            },
            option.label,
          ),
        ),
      )
    }

    function Slider({ value, min, max, step, onChange, label }) {
      return h(
        'div',
        { className: 'dsh-wp-group' },
        h('label', null, label),
        h('input', {
          className: 'dsh-wp-slider',
          type: 'range',
          min,
          max,
          step,
          value,
          'aria-label': label,
          onChange: (event) => onChange(Number(event.target.value)),
          onInput: (event) => onChange(Number(event.target.value)),
        }),
        h('span', { className: 'dsh-wp-value' }, `${value}%`),
      )
    }

    function Switch({ checked, onChange, label }) {
      return h(
        'label',
        { className: 'dsh-wp-switch' },
        h('input', { type: 'checkbox', checked, onChange: (event) => onChange(event.target.checked) }),
        label,
      )
    }

    function WallpaperSettingsRow() {
      const [settings, setSettings] = React.useState(store.get())
      React.useEffect(() => store.subscribe(setSettings), [])
      const set = React.useCallback((patch) => store.set(patch), [])
      const on = settings.mode !== 'off'

      return h(
        'div',
        { className: 'dsh-wp-row' },
        h(
          'div',
          { className: 'dsh-wp-head' },
          h('div', { className: 'dsh-wp-title' }, 'DeepSeek 壁纸'),
          h('div', { className: 'dsh-wp-hint' }, MODE_HINT[settings.mode] ?? ''),
        ),
        h(
          'div',
          { className: 'dsh-wp-controls' },
          h(Segmented, {
            value: settings.mode,
            onChange: (value) => set({ mode: value }),
            options: MODES.map((mode) => ({ value: mode, label: MODE_LABEL[mode] })),
          }),
          settings.mode === 'video'
            ? h(Segmented, {
                value: settings.quality,
                onChange: (value) => set({ quality: value }),
                options: QUALITIES.map((quality) => ({
                  value: quality,
                  label: QUALITY_LABEL[quality],
                  title: QUALITY_TITLE[quality],
                })),
              })
            : null,
        ),
        on
          ? h(
              'div',
              { className: 'dsh-wp-controls' },
              h(Slider, {
                label: '画面暗化',
                value: settings.dim,
                min: 0,
                max: 80,
                step: 2,
                onChange: (value) => set({ dim: value }),
              }),
              h(Slider, {
                label: '面板通透',
                value: settings.translucency,
                min: 0,
                max: 70,
                step: 2,
                onChange: (value) => set({ translucency: value }),
              }),
            )
          : null,
        on
          ? h(
              'div',
              { className: 'dsh-wp-controls' },
              h(Switch, {
                label: '失焦暂停',
                checked: settings.pauseWhenUnfocused,
                onChange: (value) => set({ pauseWhenUnfocused: value }),
              }),
              h(Switch, {
                label: '低电量暂停',
                checked: settings.batterySaver,
                onChange: (value) => set({ batterySaver: value }),
              }),
              h(Switch, {
                label: '跟随系统减少动效',
                checked: settings.respectReducedMotion,
                onChange: (value) => set({ respectReducedMotion: value }),
              }),
            )
          : null,
      )
    }

    // ------------------------------------------------------------------- plugin

    let store = null

    return {
      inject: ['slots', 'theme'],
      apply(ctx) {
        store = createStore()
        const backdrop = createBackdrop(ctx, store)
        const state = { mounted: false }

        ctx.effect(() => {
          let mountDispose = null
          const start = () => {
            backdrop.mount()
            state.mounted = true
            return () => {
              state.mounted = false
              backdrop.dispose()
            }
          }
          if (document.body !== null) {
            mountDispose = start()
            return () => mountDispose?.()
          }
          const onReady = () => {
            mountDispose = start()
          }
          document.addEventListener('DOMContentLoaded', onReady, { once: true })
          return () => {
            document.removeEventListener('DOMContentLoaded', onReady)
            mountDispose?.()
          }
        }, 'deepseek-wallpaper: backdrop layer')

        // React to settings by applying the smallest change that suffices.
        let previous = store.get()
        ctx.effect(
          () =>
            store.subscribe((next) => {
              const before = previous
              previous = next
              if (!state.mounted) return
              const modeChanged = before.mode !== next.mode
              const qualityChanged = before.quality !== next.quality
              if (modeChanged || qualityChanged) {
                backdrop.render()
                backdrop.syncSurface()
                return
              }
              if (before.translucency !== next.translucency) {
                backdrop.syncSurface()
                return
              }
              if (before.dim !== next.dim) {
                backdrop.updateSurface()
                return
              }
              if (
                before.pauseWhenUnfocused !== next.pauseWhenUnfocused ||
                before.batterySaver !== next.batterySaver ||
                before.respectReducedMotion !== next.respectReducedMotion
              ) {
                backdrop.syncPlayback()
              }
            }),
          'deepseek-wallpaper: settings sync',
        )

        ctx.effect(
          () =>
            ctx.slots.inject('settings.general.item', () =>
              ctx.slots.register(
                { name: 'settings.general.item', id: 'deepseek-wallpaper', order: 25 },
                WallpaperSettingsRow,
              ),
            ),
          'deepseek-wallpaper: settings row',
        )
      },
    }
  },
})
