# DeepSeek 动态壁纸插件

把工作目录里的 `视频.mp4`（15 秒、1920×1080、30fps）做成 Harness Web UI 的循环壁纸，
并把两张拟人化形象（`成熟比例鲸鱼娘.png`、`Q版大肥鱼.png`）做成静态壁纸方案。

这是一个标准的 DSH bundle：Host 半边负责把素材用同源 HTTP 暴露出去，Client 半边负责
渲染与控制。所有素材在构建时已经重新编码，插件运行时不依赖工作目录里的原始文件。

## 安装 / 卸载

安装（当前 profile，一次即可，重启后依然生效）：

```
plugin_manager:
  action: install_bundle
  target: "E:\\vibecoding\\dsh_bizhi\\plugin\\deepseek-wallpaper"
```

卸载：

```
plugin_manager:
  action: remove_bundle
  target: "@local/deepseek-wallpaper"
```

## 使用

安装后壁纸默认开启（循环动画）。调节入口在 **设置 → 通用** 里的
「**DeepSeek 壁纸**」一行：

| 控件 | 说明 |
| --- | --- |
| 关闭 / 循环动画 / 成熟比例 / Q版大肥鱼 | 壁纸方案。选「关闭」会释放解码器并删除 DOM 与网络请求。 |
| 自动 / 1080p / 720p / 540p | 视频清晰度。`自动`按窗口宽度 × 设备像素比（上限 1.5×）选档。 |
| 画面暗化 0–80% | 把画面往面板颜色方向压暗，保证文字对比度。默认 42%。 |
| 面板通透 0–70% | 让 shell 的两块大面板变半透明。默认 34%；设为 0 即恢复原生不透明外观。 |
| 失焦暂停 | 窗口失去焦点时停止解码（默认开）。 |
| 低电量暂停 | 电池供电且电量 ≤25% 时停止解码（默认开）。 |
| 跟随系统减少动效 | 系统开启「减少动态效果」时只显示首帧海报（默认开）。 |

设置保存在 `localStorage` 的 `dsh.deepseek-wallpaper.settings.v1`，立即生效、无需重启。

## 性能设计（为什么它不会拖慢工作）

1. **每帧零 JavaScript。** 画面由浏览器合成 `<video>` 元素，主线程不做任何事；
   插件没有 `requestAnimationFrame` 循环，也不监听滚动或输入。
2. **延迟创建解码器。** 首屏先显示 WebP 海报（首帧），等 `requestIdleCallback`
   （最长 2.5s 兜底）之后才设置 `src`，不和 Harness 自己的启动流程抢 CPU。
3. **不该解码时真的不解码。** 窗口隐藏、失去焦点、系统减少动效、低电量四种情况下
   `pause()`；切到「关闭」或换方案时执行 `removeAttribute('src') + load()`，
   真正释放解码器而不是把它挂着。
4. **不重复劳动。** 只有「方案 / 清晰度」变化才重建媒体元素；暗化只改一个 CSS 变量，
   通透度只重写两个 token，都不会重启视频。
5. **降分辨率而不是降帧。** 窗口变窄时（防抖 1.2s）自动换更低一档的文件，
   小窗口 540p 素材只有 1.7 MB。
6. **没有逐帧滤镜。** 默认不加 `filter: blur()`、不加 `backdrop-filter`；
   暗化是一层纯色 div 的 `opacity`，由合成器处理。
7. **层数固定为 1。** 只创建一个 `position: fixed` 的装饰层，`pointer-events: none`、
   `contain: layout paint style`，不触发宿主布局或重排。

## 素材

原始 `视频.mp4` 不是无缝循环（首帧与末帧 PSNR ≈ 19.9 dB，直接循环会跳帧）。
构建时做了 0.8 秒尾部→头部交叉淡入，把 15s 变成 **14.2s 无缝循环**，
循环点首末帧 PSNR 提升到 30.7 dB（等同相邻帧差异）。

| 文件 | 尺寸 | 大小 | 来源 |
| --- | --- | --- | --- |
| `wallpaper-high.mp4` | 1920×1080 @30fps | 6.2 MB | 视频.mp4，CRF 25 |
| `wallpaper-balanced.mp4` | 1280×720 @30fps | 3.1 MB | 视频.mp4，CRF 25 |
| `wallpaper-eco.mp4` | 960×540 @30fps | 1.7 MB | 视频.mp4，CRF 26 |
| `poster-wallpaper-*.webp` | 对应分辨率 | 37–96 KB | 各档首帧 |
| `mature-cover.webp` / `mature-figure.webp` | 1920×1080 / 340×1000 (RGBA) | 61 KB / 84 KB | 成熟比例鲸鱼娘.png（抠像） |
| `chibi-cover.webp` / `chibi-figure.webp` | 1920×1080 / 875×1000 (RGBA) | 60 KB / 119 KB | Q版大肥鱼.png（抠像） |
| `mature-cover-720.webp` / `chibi-cover-720.webp` | 1280×720 | 30 KB / 30 KB | 窄窗口时替换全尺寸背景 |

全部视频都没有音轨（`-an`），并带 `+faststart`，可边下边播。

抠像用「从图像边界向内洪水填充近白像素」的方式完成：背景判据是**纯白/中性浅灰，或立绘自带的淡蓝灰投影**（而不是单纯亮度阈值），所以白色围裙、白色裤袜不会被打洞；
小于 200px 的透明连通块与小于 400px 的不透明连通块被丢弃，鞋下投影按与鞋底的距离淡出，
边缘 1.5px 羽化前先向外填了 5px 角色颜色，因此半透明边缘带的是角色色而不是白边。
背景封面按 COVER 居中裁切（无拉伸），2px 高斯模糊、压暗约 45%、降饱和、径向暗角加纵向渐变。

## 实现说明

- `index.js`（Host）：注册 `prefix` 路由 `/dsh-wallpaper`，实现 `ETag` / `304` /
  `Range` / `206` / `416`。Harness 自带的 dist 服务器没有 `Accept-Ranges`，
  而 `<video>` 在 seek 与循环重播时一定会发 Range 请求，所以必须自己实现。
  素材名单是白名单常量，请求路径不参与拼路径。
- `client.js`（Client）：创建 `#dsh-deepseek-wallpaper` 装饰层（`z-index:-1`，
  作为 `body` 的第一个子节点），把 `--dsw-alias-bg-base` 与
  `--dsw-specific-sidebar-fill` 覆盖为半透明色。这两块正是 `.BynINW_frame`、
  `.BynINW_centerCol`、`.BynINW_sidebarCol` 与 Conversation 根节点唯一的不透明
  底色来源；卡片、菜单、弹层等承载文字的表面保持不透明，因此文字始终在壁纸之上。
- 覆盖走 `ctx.theme.overrideTokens(source, tokens)`。该 API 要求**每个 token 同时给出
  light / dark 两个值**，因此值写成
  `color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 66%, transparent)` 这类形式：
  引用的是**永远不会被覆盖的** `--dsw-static-*` 静态色板，既避免 token 自引用，
  又天然适配明暗两套主题（由 ui-layout 的 presenter 以内联样式写在 `body` 上）。
  Harness 若换了主题实现，写入后读回校验失败时会自动退回等效的 `<style>` 声明，
  两条路径都能被插件卸载干净。
- 暗化层与左侧渐变都只依赖 `--dsw-static-*` 与自身的 `--dsh-wp-*` 变量，
  具体数值（暗化强度、遮罩强度）由 JS 写成内联变量，改滑块不会重建媒体元素。

## 重新加载

Client 半边的代码是普通 JS 模块，由 Harness 在启动时按版本号登记。**如果修改了
`client.js`，需要重启 DeepSeek Harness 才能让页面加载到新的模块世代**；只刷新页面
一般会命中同版本的缓存。`.md`、`assets/` 里的素材以及设置项不需要重启。

## 已知限制

- 无浏览器控制能力，因此**没有做过截图级视觉验证**。已完成的验证是：JS 语法检查、
  manifest 与素材白名单校验、`plugin_manager` 安装结果、真实 HTTP 上素材路由的
  200/206/304/416/405/404 语义、用 `ffprobe` 读取路由上的 mp4/webp，以及 live Client
  slot 注册状态。像素层面的观感（壁纸亮度、文字对比度、播放流畅度）需要你亲眼看一次。
- 页面实际来源是 Electron 的 `dsh-app://app/`，非 `/assets` 开头的路径会被转发到
  Host HTTP 服务；插件路由用的是路径绝对地址 `/dsh-wallpaper/...`，两种来源下都同源，
  不需要 token。转发过程会去掉 `content-length`（改 chunked），但保留状态码、
  `content-range` 与 `accept-ranges`。
- `--dsw-alias-bg-base` 同时也是输入框、文件 chip 等小组件的底色，因此它们也会一起变
  半透明。默认 34% 下可读性正常；若觉得输入框太透，把「面板通透」调小或设为 0 即可。
- 菜单、弹层、用户气泡用的是另外的 token（`--dsw-specific-menu` 等），本插件**故意
  不覆盖**，以保证菜单和消息的可读性。
- 视频原素材为 AI 生成的 15 秒片段，交叉淡化段（前 0.8 秒）会有轻微重影。
