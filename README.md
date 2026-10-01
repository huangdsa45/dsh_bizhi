# DeepSeek Harness 动态壁纸插件

把一段 15 秒的鲸鱼娘动画做成 **DeepSeek Harness Web UI** 的循环壁纸，并把两张拟人化立绘做成可切换的静态壁纸方案。
插件以标准 DSH bundle 的形式发布：**Host 半边**把素材用同源 HTTP 暴露给页面，**Client 半边**负责渲染、设置行与性能策略。

> 状态：**已在本机安装并生效**（`application: applied`、`warnings: []`）。像素级的观感未经截图验证，见 [验证状态](#验证状态)。

<p align="center">
  <img src="plugin/deepseek-wallpaper/assets/poster-wallpaper-high.webp" width="660" alt="循环动画方案（1080p 首帧海报）">
</p>
<p align="center">
  <img src="plugin/deepseek-wallpaper/assets/mature-figure.webp" height="300" alt="成熟比例鲸鱼娘">
  &nbsp;&nbsp;&nbsp;
  <img src="plugin/deepseek-wallpaper/assets/chibi-figure.webp" height="300" alt="Q版大肥鱼">
</p>

---

## 目录

- [特性](#特性)
- [环境要求](#环境要求)
- [安装](#安装)
- [使用](#使用)
- [设置项](#设置项)
- [性能设计](#性能设计)
- [架构](#架构)
  - [Host 半边：素材路由](#host-半边素材路由)
  - [Client 半边：装饰层与主题覆盖](#client-半边装饰层与主题覆盖)
- [素材管线](#素材管线)
- [仓库结构](#仓库结构)
- [验证状态](#验证状态)
- [已知限制](#已知限制)
- [开发与调试](#开发与调试)
- [卸载](#卸载)
- [许可](#许可)

---

## 特性

| 特性 | 说明 |
| --- | --- |
| 四种壁纸方案 | 关闭 / 循环动画 / 成熟比例 / Q版大肥鱼，切换即时生效，无需重启 |
| 真正无缝循环 | 原片首末帧 PSNR 仅 19.9 dB（直接循环会跳帧），构建时做 0.8 s 尾部→头部交叉淡化，循环点提升到 30.7 dB |
| 三档清晰度 | 1080p / 720p / 540p，`自动`档按窗口宽度 × 设备像素比选档；窄窗口自动降档 |
| 每帧零 JavaScript | 画面交给浏览器合成 `<video>`，主线程不参与渲染，无 `requestAnimationFrame` 循环 |
| 该省电时真的停 | 窗口隐藏、失焦、系统「减少动态效果」、电池 ≤25% 四种情况下 `pause()`；切「关闭」直接释放解码器 |
| 观感可调 | 「画面暗化」与「面板通透」两个滑块，只改 CSS 变量，不重启视频 |
| 宿主零污染 | 只创建一个 `pointer-events:none` 的装饰层并覆盖两个 shell 背景 token；卸载后不留残留 |
| 同源素材路由 | Host 自实现 `ETag` / `304` / `Range` / `206` / `416`，满足 `<video>` 的 seek 与循环重播需求 |

## 环境要求

- DeepSeek Harness（桌面版或 `dsh web`），需要 `plugin_manager` 能力来安装 bundle；
- 插件运行**不依赖** Node 依赖、不需要构建步骤、不需要网络：`index.js` / `client.js` 是普通 ESM 与浏览器模块，素材已随包发布；
- 仅重建素材时需要 `ffmpeg` 与 Python（`numpy`、`Pillow`），见 [素材管线](#素材管线)。

## 安装

一次即可，安装结果在重启后依然生效：

```
plugin_manager:
  action: install_bundle
  target: "<本仓库路径>\\plugin\\deepseek-wallpaper"
```

例如本机为：

```
plugin_manager:
  action: install_bundle
  target: "E:\\vibecoding\\dsh_bizhi\\plugin\\deepseek-wallpaper"
```

安装后 `plugin_manager` 的 `list_bundles` 中会出现 `@local/deepseek-wallpaper`，`cordis.patch.yml` 会自动把它插入 profile 并附默认配置：

```yaml
- insert:
    - id: deepseek-wallpaper
      name: '@local/deepseek-wallpaper'
      config:
        enabled: true
```

Host 半边还支持 `injectConfigIntoIndex`（默认 `true`）：它把 `window.__DSH_WALLPAPER__ = { base, assetVersion }` 注入页面 `<head>`，Client 半边据此得到素材地址；关掉它 Client 会退回默认前缀 `/dsh-wallpaper`。

## 使用

安装后壁纸**默认开启**（循环动画）。调节入口：**设置 → 通用 → 「DeepSeek 壁纸」**。

| 控件 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| 壁纸方案 | 关闭 / 循环动画 / 成熟比例 / Q版大肥鱼 | 循环动画 | 选「关闭」会移除 DOM 并释放解码器，不产生任何网络请求 |
| 清晰度 | 自动 / 1080p / 720p / 540p | 自动 | 仅在「循环动画」方案下显示 |
| 画面暗化 | 0–80%，步长 2 | 42% | 往面板颜色方向压暗，保证文字对比度 |
| 面板通透 | 0–70%，步长 2 | 34% | 让 shell 的两块大面板半透明；设为 0 恢复原生不透明外观 |
| 失焦暂停 | 开 / 关 | 开 | 窗口失去焦点时停止解码 |
| 低电量暂停 | 开 / 关 | 开 | 电池供电且电量 ≤25% 时停止解码 |
| 跟随系统减少动效 | 开 / 关 | 开 | 系统开启「减少动态效果」时只显示首帧海报 |

设置即时生效并写入 `localStorage` 的 `dsh.deepseek-wallpaper.settings.v1`；读取时逐项做范围收敛与类型校验，损坏的存储会安全回退到默认值。

## 性能设计

1. **每帧零 JavaScript。** 画面由浏览器合成 `<video>` 元素，主线程不做任何事；插件没有动画循环，也不监听滚动或输入。
2. **延迟创建解码器。** 首屏先显示 WebP 首帧海报，等 `requestIdleCallback`（`timeout: 2500`，无该 API 时退回 `setTimeout` 1200 ms）之后才设置 `src`，不与 Harness 自身启动流程抢 CPU。
3. **不该解码时真的不解码。** 失焦 / 页面隐藏 / 系统减少动效 / 低电量四种情况下 `pause()`；切「关闭」或换方案时执行 `removeAttribute('src') + load()`，真正释放解码器而不是挂着。
4. **不重复劳动。** 只有「方案」「清晰度」变化才重建媒体元素；「暗化」只改一个 CSS 变量，「通透度」只重写两个 token，都不会重启视频。
5. **降分辨率而不是降帧。** 窗口变窄时（防抖 1200 ms）自动换更低一档文件，540p 素材只有 1.7 MB。
6. **没有逐帧滤镜。** 不加 `filter: blur()`、不加 `backdrop-filter`；暗化是一层纯色 div 的 `opacity`，由合成器处理。
7. **层数固定为 1。** 只创建一个 `position: fixed` 装饰层，`aria-hidden`、`pointer-events: none`、`contain: layout paint style`，不触发宿主布局或重排。

## 架构

```
                 Host (Node)                         Client (Web)
  ┌──────────────────────────────┐    HTTP     ┌──────────────────────────────┐
  │ index.js                     │  same-origin│ client.js                    │
  │  webServer.register(prefix)  ├────────────►│  <video>/<img> 装饰层        │
  │   · 白名单素材表              │  /dsh-wallpaper│  ctx.theme.overrideTokens │
  │   · ETag/304/Range/206/416   │             │  slots.register(settings…)   │
  │  webServer.tapIndex(config)  │             │  localStorage 设置           │
  └──────────────────────────────┘             └──────────────────────────────┘
```

### Host 半边：素材路由

`index.js` 只做一件事：把本包的 `assets/` 通过页面已经在用的 loopback HTTP 服务发布出去。内置的 dist 服务器只回 `Content-Length`，而 Chromium 在 seek 与循环重播时必然会发 Range 请求，所以这里自己实现条件请求与 RFC 9110 单区间响应。

请求路径**不参与拼接**：素材表是显式白名单常量（12 个文件），不在表内的名字一律 404，目录穿越无法命中任何文件。

| 情况 | 响应 |
| --- | --- |
| `GET` / `HEAD` 正常 | `200` + `Content-Type` + `Content-Length` + `Accept-Ranges: bytes` + `ETag` + `Last-Modified` + `Cache-Control: public, max-age=3600` + `X-Content-Type-Options: nosniff` |
| 合法 `Range: bytes=a-b` | `206` + `Content-Range: bytes a-b/size` |
| `If-None-Match` 命中 ETag | `304`（带同一组缓存头，无 body） |
| Range 语法正确但不可满足 | `416` + `Content-Range: bytes */size` |
| 其它方法 | `405` + `Allow: GET, HEAD` |
| 白名单外 / 目录穿越 / 文件缺失 | `404` + JSON 错误体 |
| URL 无法解析 | `400`；内部异常 `500` |

`ETag` 由「文件大小 + mtime」构成，因此替换素材后无需清缓存；`Cache-Control` 只给 1 小时，避免长期驻留。

### Client 半边：装饰层与主题覆盖

- **装饰层**：`#dsh-deepseek-wallpaper`，作为 `document.body` 的第一个子节点插入，`z-index:-1`、`pointer-events:none`，这是保证「画在所有 UI 文字之下、又高于 `body` 背景」的稳妥位置。层内元素全部 `position:absolute; inset:0`，`object-fit: cover` 铺满；立绘用 `object-fit: contain` 靠右居中。
- **可见性**：shell 唯一不透明底色的来源是 `--dsw-alias-bg-base`（`frame` / `centerCol` / Conversation 根节点）与 `--dsw-specific-sidebar-fill`（`sidebarCol`）。插件只覆盖这两个 token，卡片、菜单、弹层、消息气泡等承载文字的表面保持不透明，因此文字始终在壁纸之上。
- **覆盖方式**：走 `ctx.theme.overrideTokens('deepseek-wallpaper', tokens)`。该 API 要求每个 token 同时给出 light / dark 两个值，因此值写成 `color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 66%, transparent)` 这类形式——引用的是**永远不会被覆盖**的 `--dsw-static-*` 静态色板，既避免 token 自引用，又天然适配明暗主题。
- **写入后回读校验**：如果 `overrideTokens` 被静默拒绝（读回的 token 不含 `color-mix`），自动退回等效的 `<style id="dsh-deepseek-wallpaper-surface">` 声明；两条路径都能被卸载干净。
- **热重载安全**：旧世代模块可能留下带 `!important` 的样式表并压过新覆盖，因此挂载时会清理所有 `data-plugin="deepseek-wallpaper"` 的旧 `<style>`。
- **设置行**：`ctx.slots.register({ name: 'settings.general.item', id: 'deepseek-wallpaper', order: 25 }, WallpaperSettingsRow)`；设置变化时按「最小必要动作」响应：方案/清晰度变化才重建，通透度只重写 token，暗化只改变量，三个开关只同步播放状态。

## 素材管线

### 视频

原始 `视频.mp4` 的参数（`ffprobe` 实测）：

| 项目 | 值 |
| --- | --- |
| 编码 / 分辨率 / 帧率 | H.264 / 1920×1080 / 30 fps |
| 时长 / 帧数 | 15.02 s / 450 帧 |
| 音轨 | AAC（成品已去掉） |
| 码率 / 大小 | 25.4 Mbps / 47,645,158 B |

原片**不是无缝循环**：首帧与末帧 PSNR 只有 19.9 dB，直接循环会跳帧。构建时做 0.8 秒「尾部→头部」交叉淡化，输出 14.2 秒（426 帧）真正无缝的循环，循环点 PSNR 30.7 dB，等同相邻帧差异。

成品三档（均为无音轨、`+faststart`，可边下边播）：

| 文件 | 分辨率 | 时长 / 帧数 | 大小 | 码率 | CRF |
| --- | --- | --- | --- | --- | --- |
| `wallpaper-high.mp4` | 1920×1080 | 14.2 s / 426 | 6,206,085 B（5.92 MiB） | 3.50 Mbps | 25 |
| `wallpaper-balanced.mp4` | 1280×720 | 14.2 s / 426 | 3,111,156 B（2.97 MiB） | 1.75 Mbps | 25 |
| `wallpaper-eco.mp4` | 960×540 | 14.2 s / 426 | 1,692,900 B（1.61 MiB） | 0.95 Mbps | 26 |

另有对应的三张首帧海报 `poster-wallpaper-*.webp`（37–96 KB），用于首屏瞬时显示。

> 原始命令行没有逐字保留，下面是**等价重建流程**（参数取自产物元数据，未逐字复现原始命令）：
>
> ```bash
> # 1) 0.8 s 尾部→头部交叉淡化，做成无缝循环
> ffmpeg -i 视频.mp4 -filter_complex \
>   "[0:v]split[a][b];[a]trim=start=0:end=14.2,setpts=PTS-STARTPTS[main];\
>    [b]trim=start=14.2,setpts=PTS-STARTPTS[tail];\
>    [main][tail]xfade=transition=fade:duration=0.8:offset=13.4[v]" \
>   -map "[v]" -an -c:v libx264 -crf 25 -pix_fmt yuv420p -movflags +faststart wallpaper-high.mp4
> # 2) 缩放得到 720p / 540p 两档（540p 用 CRF 26），同样 -an 与 +faststart
> # 3) 各档首帧导出为 WebP 海报
> ffmpeg -i wallpaper-high.mp4 -frames:v 1 -c:v libwebp -quality 82 poster-wallpaper-high.webp
> ```

### 立绘（两张静态方案）

`.work/tools/build_assets.py` 从原图生成每个方案的「背景封面 + 透明立绘」两张 WebP，客户端用 CSS 合成：

```
python .work\tools\build_assets.py          # all / figure / cover 可选
```

抠像不是简单的亮度阈值，而是**从图像边界向内洪水填充近白像素**：

1. 背景判据是「纯白或中性浅灰」或「立绘自带的淡蓝灰投影」（蓝通道略高于红、低饱和），并先做 4px 膨胀、再由边界连通性约束——所以白色围裙、白色裤袜不会被打开洞；
2. 丢弃 <200 px 的透明连通块与 <400 px 的不透明连通块，去掉噪点；
3. 鞋下地面投影按「与鞋底的距离」用倒角距离场淡出，而不是整体改透明度，因此被角色包围的白色区域仍然全不透明；
4. 羽化前先向外填充 5 px 角色颜色，使 1.5 px 羽化边缘带的是角色色而不是白边；
5. 紧裁到角色外接框并缩放到高 1000 px，以 WebP（`quality=88`，含 alpha）输出。

背景封面则按 COVER 居中裁切（不拉伸）、2 px 高斯模糊、压暗约 45%、降饱和，并叠加径向暗角与纵向渐变，让近白背景读起来是深蓝灰而不是灰。

| 文件 | 尺寸 | 说明 |
| --- | --- | --- |
| `mature-cover.webp` / `mature-cover-720.webp` | 1920×1080 / 1280×720 | 成熟比例方案背景（窄窗口用 720p 版） |
| `mature-figure.webp` | 340×1000 RGBA | 成熟比例方案立绘 |
| `chibi-cover.webp` / `chibi-cover-720.webp` | 1920×1080 / 1280×720 | Q 版方案背景 |
| `chibi-figure.webp` | 875×1000 RGBA | Q 版方案立绘 |

## 仓库结构

```
dsh_bizhi/
├─ plugin/deepseek-wallpaper/        ← 可安装的插件包（主交付物，约 11.3 MB）
│  ├─ index.js                       Host 半边：素材 HTTP 路由（白名单 + Range/ETag）
│  ├─ client.js                      Client 半边：装饰层 + 设置行 + 性能策略
│  ├─ package.json                   DSH bundle / client 清单
│  ├─ cordis.patch.yml               profile 插入片段
│  ├─ icon.svg  locale/{zh,en}.json  图标与本地化文案
│  ├─ assets/                        12 个重新编码后的素材
│  └─ README.md                      插件包自身的说明
├─ tools/
│  ├─ asar.mjs                       Electron asar 读取小工具（list / cat / dump）
│  └─ asar-debug.mjs                 asar 文件头调试输出
├─ .work/
│  ├─ research/layering.md           宿主主题 API 与 CSS 层叠的取证报告
│  ├─ research/assets.md             插件静态素材与 HTTP 路由的取证报告
│  ├─ tools/build_assets.py          立绘/封面构建脚本
│  └─ index.css                      前端样式快照（取证用）
├─ 视频.mp4                          原始素材（1920×1080 / 15 s / 47.6 MB）
├─ 成熟比例鲸鱼娘.png · Q版大肥鱼.png  原始立绘（各 1448×1086）
├─ LICENSE                           MIT
└─ README.md                         本文件
```

原始素材并未被修改，它们只作为构建输入存在；插件运行时只读取 `plugin/deepseek-wallpaper/assets/`。

## 验证状态

**已验证：**

- 插件安装结果 `application: applied`、`warnings: []`；
- 素材路由在真实 HTTP 上通过全部语义测试：`200` / `206 Partial Content` + `Content-Range` / `304`（ETag）/ `416` / `405`（非 GET）/ `404`（白名单外与目录穿越）；
- 用 `ffprobe` 直接读取插件 HTTP 路由上的 mp4 与 webp：容器与流参数正确、可 seek；
- 实时 Client slot 注册：`settings.general.item` 中 `deepseek-wallpaper` 状态 `active: true`；
- JS 语法检查、manifest 与素材白名单一致性；
- 素材本身用 `ffprobe` 复核：三档视频 14.2 s / 426 帧 / 无音轨，立绘为带 alpha 的 WebP（见上表）。

**未验证：**

- 没有浏览器控制能力，因此**没有做过截图级的视觉确认**——壁纸实际观感、文字对比度、播放流畅度需要你亲眼看一次；
- 未在除本机（Windows / 当前 Harness 版本）以外的环境安装过。

## 已知限制

- **页面来源**：实际来源是 Electron 的 `dsh-app://app/`，非 `/assets` 开头的路径会被转发到 Host HTTP 服务；插件路由用路径绝对地址 `/dsh-wallpaper/...`，两种来源下都同源，不需要 token。转发会去掉 `content-length`（改 chunked），但保留状态码、`content-range` 与 `accept-ranges`。
- **输入框也会变半透明**：`--dsw-alias-bg-base` 同时也是输入框、文件 chip 等小组件的底色。默认 34% 下可读性正常；若觉得太透，把「面板通透」调小或设为 0。
- **菜单与气泡故意不覆盖**：菜单、弹层、用户气泡用的是另外的 token（`--dsw-specific-menu` 等），插件不覆盖它们以保证可读性。
- **交叉淡化段有轻微重影**：原片是 AI 生成的 15 秒片段，前 0.8 秒是淡入淡出叠加区。
- **改 `client.js` 需要重启**：见下一节。

## 开发与调试

- **Client 半边**（`client.js`）是普通 JS 模块，Harness 启动时按版本号登记。**修改后需要重启 DeepSeek Harness**才能让页面加载到新的模块世代；只刷新页面一般会命中同版本缓存。
- **`.md`、`assets/` 里的素材、设置项**改动不需要重启。
- 无需构建：没有 bundler、没有 `npm install`。改完 `index.js` 或素材后重新安装 bundle（或重启）即可生效。
- 想核对宿主与主题 API 的行为依据，读 `.work/research/layering.md`（主题覆盖与层叠）和 `.work/research/assets.md`（素材路由与 Range）。
- 用 `node tools/asar.mjs list <archive> <filter>` 可以从 Electron 的 `app.asar` 里直接读取宿主实现，用于对照版本行为。

## 卸载

```
plugin_manager:
  action: remove_bundle
  target: "@local/deepseek-wallpaper"
```

卸载后装饰层、样式表、主题覆盖与设置行都会随 `ctx.effect` 的销毁回调一并移除；`localStorage` 里的设置会保留，重新安装后沿用。

## 许可

本仓库以 [MIT](LICENSE) 许可发布（Copyright © 2026 huangdsa45）。
原始视频与两张立绘为 AI 生成的素材，随仓库一并提供，仅用于壁纸展示。
