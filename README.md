# FreeMemes

A browser-based image and GIF editor inspired by Imgflip. Uploaded and pasted files are decoded, edited, and exported locally. A small Node import service fetches image URLs and converts YouTube clips into editable animations. Fonts and the starter image are bundled with the app.

## Docker

```sh
docker compose up --build -d
```

Open [FreeMemes](http://localhost:5173). The image includes Node, yt-dlp with its YouTube JavaScript support package, Python, FFmpeg, and ffprobe. No host installation of those tools is required. Both the frontend and the URL/YouTube import API are served by the container, with a maximum of 60 seconds per YouTube clip.

```sh
docker compose ps
docker compose logs -f freememes
docker compose down
```

To use another host port, set `FREEMEMES_PORT`, for example `FREEMEMES_PORT=8080 docker compose up --build -d`. The published address defaults to `127.0.0.1`; set `FREEMEMES_HOST=0.0.0.0` to expose it on other network interfaces.

The multi-stage image compiles the frontend and runs the production server as the unprivileged `node` user. Compose uses a read-only filesystem with a writable, temporary `/tmp` of up to 1 GiB for imports, accommodating the two concurrent YouTube imports allowed by the server. Nothing needs a persistent volume: local uploads stay in the browser, and server downloads are temporary. Docker monitors the HTTP server with the image's health check.

yt-dlp is pinned to `2026.10.26`. Set `YT_DLP_VERSION` to another release when rebuilding to update it. The Dockerfile's `NODE_VERSION` build argument defaults to `24.21.0`, matching `.nvmrc`. These defaults support Linux amd64 and arm64 without a platform override.

To check the installed media tools:

```sh
docker compose exec freememes yt-dlp --version
docker compose exec freememes ffmpeg -version
docker compose exec freememes ffprobe -version
```

## Run locally

Requires Node.js 22.16 or newer.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. The development server includes the URL import API.

For production, run `npm run build` and `npm start`. The Node server serves `dist` and the import API at `http://127.0.0.1:5173`. Configure `HOST` and `PORT` as needed. Serving `dist` from a static-only host supports uploads and pastes; URL imports require the Node service.

## YouTube setup

Docker includes the required tools automatically. When running without Docker, install a current [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) and [FFmpeg](https://ffmpeg.org/download.html), including `ffprobe`, on the machine running the import service. On macOS:

```sh
brew install yt-dlp ffmpeg
```

Restart the dev server after installing the tools. Node is supplied to yt-dlp as its JavaScript runtime. Binaries can be specified explicitly with `YT_DLP_PATH`, `FFMPEG_PATH`, and `FFPROBE_PATH`; otherwise they are found on `PATH`.

YouTube imports take **up to 60 seconds from the link’s timestamp**, including links copied with “Copy video URL at current time.” For example, `?t=120` imports seconds 120–180 of a longer video. `t=2m`, `t=2m0s`, `start=120`, and `#t=120` are also supported. Without a timestamp, the first 60 seconds are imported. Near the end, the clip ends with the video; a timestamp at or beyond the end is rejected. An `end` parameter does not override the 60-second window.

The service verifies the video metadata, downloads only the selected section through yt-dlp/FFmpeg, and verifies the section with ffprobe before conversion. Downloaded YouTube clips and their prepared videos may each be **up to 200 MB** (200 × 1024² bytes). This allowance also applies when the browser loads the resulting video; GIF uploads and pasted GIFs also allow 200 MB; other image uploads, other clipboard images, and direct image URLs retain their 30 MB limit. Imports have up to five minutes to complete. Unknown durations and live/upcoming sources are rejected. The downloader requests the best available video stream without a height cap or a lowest-quality fallback. Clips are prepared as silent H.264 MP4 videos at the downloaded video’s source frame rate and original pixel dimensions. If a source dimension is odd, the encoder pads that edge by one pixel; the editor excludes the padding and retains the exact visible dimensions, including 474 × 843 portrait clips. Temporary downloads are removed after success or failure. Private, restricted, or unavailable videos may not be importable.

YouTube previews use native browser video decoding on demand. They no longer convert to a low-frame-rate GIF on import or allocate a full-resolution canvas for every frame. The 90-million-pixel decoded-frame budget still applies to uploaded GIF/WebP animations. Preview drawing runs independently of React, reuses its canvas, and limits its backing resolution to a 1280-pixel long edge without changing the source or export dimensions. Playback uses the video clock so overlays stay synchronized, and the editor’s time displays update at 10 Hz. Previously imported GIFs have already lost their extra frames; re-import the YouTube link after updating to use native playback.

## Editing

- Click **New image** to paste an image, enter an image/YouTube URL, or upload a file from your computer. You can also drop files into the dialog or onto the editor. Successfully opening a new background clears all text content; text boxes also start empty on launch and when added. Paste with Ctrl+V/⌘V or use the clipboard button; the shortcut works when clipboard permission is unavailable.
- PNG, GIF, WebP, JPEG, and AVIF are detected from file contents, regardless of extension or MIME header. The canvas toolbar shows the actual imported format. Image URLs may include query parameters or have no extension. GIF uploads, including pasted and dropped GIFs, accept up to 200 MB (200 × 1024² bytes). Other image files and direct image URLs retain their 30 MB limit. GIFs still have separate decoded limits of 90 million pixels across frames and 1200 frames to protect browser memory.
- Animated WebP imports use the browser’s `ImageDecoder` API where supported. Browsers without that API show an error rather than silently discarding the animation.
- Add text and image layers from the left toolkit. Drag to position, resize horizontally or vertically with the side handles, or resize both axes with a corner handle. Text resizing wraps the content and adjusts its font size to fit both dimensions, preserving the letters’ natural proportions. Drag the circular handle above a selected text or image object to rotate it; hold Shift to snap to 15° increments. The **Object** tab also has width, height, a rotation slider and numeric angle, opacity, and stacking controls. Animated image layers use their first frame.
- Set text, outline, and shadow colors in **Object**. Text supports left/center/right and top/middle/bottom alignment within its box. Each box has a **Max font size** cap (default 1000); resizing and text/font edits refit the text up to that cap. **Font size** can set a smaller size and always respects the box constraints and cap. Hold either font-size button to keep changing the size; release, cancellation, loss of pointer capture, or window blur stops repetition. One undo reverses the entire hold.
- **Apply formatting to all text boxes** copies the selected text’s font, size, maximum size, colors, outline, shadow, alignment, and opacity. Text still fits each destination box’s constraints. Content, position, box dimensions, stacking, rotation, and keyframes are preserved.
- Selecting objects from the layer list or canvas retains the active right-side tab. Adding or duplicating a layer also retains that tab.
- In **Canvas**, set **Above** and **Below** pixel heights to add blank space around the cropped source image, with independent color pickers. Setting a height to zero removes that band. Adding space preserves existing objects’ sizes and positions relative to the image, including position keyframes. The added space can hold text/image objects and is included in the preview and PNG/GIF exports. Original export size includes the added height without resizing the source. Replacing the background starts with no added space.
- All crop settings are in the right-side **Canvas** tab. Choose a preset, enter dimensions and offsets, or start a crop and drag a rectangle on the image. Cropping applies to every frame.
- The **GIF** tab contains the timeline, frame stepping, scrubbing, and start/end trim controls. Thin vertical lines mark the exact cutoffs; the grips sit outside the kept interval so the last included frame stays visible and reachable. Grabbing a trim grip preserves its current cutoff until you move it. It appears for GIF sources with multiple frames and imported YouTube videos. Still images and single-frame GIFs have no trim controls. Animated WebP can be previewed and animated, but does not expose GIF trimming.
- The right-side **Animation** tab has the same source-image thumbnail timeline as GIF, with scrubbing, a frame counter, previous/next-frame buttons, playback, a seconds input, keyframe actions, and interpolation settings. The timeline also appears for still images and animated WebP; trim handles remain in GIF. After trimming, Animation fits the kept section to the full timeline width with a zero-based ruler, elapsed-time input, clip-relative frame counter, and matching thumbnails/playhead/keyframe positions. GIF retains the full source timeline for adjusting the cut. Keyframes retain their source timestamps; keys outside the kept section are hidden from Animation until you expand the trim again. With the timeline focused, use Left/Right to step frames and Home/End to jump to the trim boundaries. GIF stepping follows source frame delays, video stepping uses the reported frame rate (30 fps if unavailable; variable-frame-rate videos are approximate), and still-image animation steps in 50 ms intervals. Add a position keyframe, move the playhead, and drag the object to create another position. Add **Show object** and **Hide object** keyframes to switch visibility instantly; visibility stays in effect until the next visibility keyframe. Visibility and movement can share a keyframe and be edited independently. Choose linear or smooth movement. **Copy keyframes** snapshots the selected object’s movement, show/hide events, original times, and easing. Select another text or image object and choose **Paste keyframes** to replace its animation in one undoable action. Ctrl/Cmd+C and Ctrl/Cmd+V do the same in Animation when you are not editing a form field. Opening a new background clears this animation clipboard. Still images can also become animated GIFs.
- Press Space to play or pause. Use the timeline to scrub and inspect individual moments.
- Exports default to **Original**, using the current canvas’s full pixel dimensions. Cropping preserves its natural pixel resolution. For GIF exports, **GIF FPS** accepts 1–50 FPS, including fractional values; leave it blank for Auto. Custom FPS resamples the whole retained clip without changing its duration. Auto keeps GIF/WebP source timing where possible and uses the video’s reported frame rate (up to 50 FPS). Very close transitions are combined into playable frame delays. The result shows its actual average FPS and encoded duration. **Smaller GIF options** offers one-click 75%, 50%, and 25% widths with proportional heights and pixel-reduction percentages. A 50% width generally means 75% fewer pixels per frame, but does not guarantee a 75% smaller file. The source-based size estimate accounts for crop, retained frames, export dimensions, and added animation; text, image layers, palette changes, and compression can change the final result. Resizing affects only the export, leaving the canvas untouched. Choose PNG or animated GIF and click **Generate**. PNG exports the currently previewed moment; GIF exports the animation, honoring trim and visibility keyframes. PNG results support direct copying and the browser’s right-click copy/save menu. For animated GIFs, use **Download GIF** and attach the downloaded file: right-click **Copy image** can put only a still image on the clipboard. **Copy GIF** appears only when the browser reports native `image/gif` clipboard support, and failures never fall back to PNG. **Share GIF** appears when the browser supports sharing that GIF as a file; it passes the original encoded animation to the system share dialog. Receiving apps must support animated GIFs.
- For **Chrome → Slack**, click **Download GIF**, then drag the downloaded `.gif` from your downloads into the Slack message field or attach it with Slack’s plus button. See [Slack’s file upload guide](https://slack.com/help/articles/201330736-Add-files-to-Slack). A local `blob:` preview URL is not a shareable public GIF URL. Browser clipboard format support is documented by [MDN](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardItem/supports_static).
- **My creations** holds generated results for the current session. Download results before refreshing or closing the tab.

Keyboard shortcuts: `T` adds text, `Delete` removes the selected object, `Space` plays/pauses, `Ctrl/Cmd+Z` undoes, and `Ctrl/Cmd+Shift+Z` redoes. In Animation, `Ctrl/Cmd+C` copies the selected object’s keyframes and `Ctrl/Cmd+V` pastes them onto the selected object. Shortcuts are inactive while editing form fields.

PNG retains transparency. GIF output uses a white matte. GIF encoding runs in a web worker, with 256-color palettes and 10 ms timing resolution. Custom FPS uses a uniform sampling grid; movement and visibility changes are evaluated at those sample times. Auto preserves source boundaries and visibility event times where playable, adding 20 fps movement samples for GIF/WebP/still sources. Automatic video sampling follows the source frame rate, at least 20 fps when animating objects, with a 50 fps maximum. All encoded frames last at least 20 ms: [Chromium expands GIF delays of 10 ms or less to 100 ms](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/graphics/deferred_image_decoder.cc#L307), which can otherwise make an export play too slowly. Cumulative timing quantization retains the clip length to the GIF format’s 10 ms precision (20 ms minimum total); very short transitions or partial final frames may be combined. Large holds are split within GIF’s delay-field limits. An independent video decoder seeks each export frame without moving the preview. The encoder rejects invalid short frame delays instead of producing an animation that browsers slow down. Source-based GIF size estimates apply only to GIF inputs; compressed MP4 bytes are not used to predict GIF size. Still images retain their original dimensions on import; images over 40 megapixels are rejected to protect browser memory.

## Validation

```sh
npm test
```

Builds the production app and runs tests covering source detection, supported YouTube URL variants, timestamp parsing and preservation, 60-second clip windows, video-end clipping, unknown/live durations, invalid timestamps rejected before download, section revalidation before conversion, portrait resolution and source frame-rate preservation, on-demand video decoding, independent export seeking, temporary-file cleanup, image proxy validation and redirects, the import API, interpolation, trimming, GIF disposal, crop output, layers, text effects, and the production GIF worker. Playback tests verify redraw cadence, throttled editor updates, recovery after stalls, video clock synchronization, trim looping, and cancellation. Pixel tests use `@napi-rs/canvas` and verify canvas reuse and exclusion of encoder padding.

The interaction test mounts the real React editor in Happy DOM with native canvas rendering and a simulated video decoder. It verifies video import metadata, playback, pause and seeking, tab retention when switching layers or selecting on canvas, large GIF uploads through both upload controls, panel organization, conditional GIF controls, original export defaults, downscaling suggestions without canvas changes, repeating font-size controls and undo, formatting across layers, font-size caps, fitting text after resizing on either axis, rotation dragging and undo, independently colored canvas space, animation timeline scrubbing and frame stepping, keyframe transfer between objects with undo and keyboard shortcuts, configured-FPS GIF generation, visibility keyframes, and cropping with added space. Size-limit tests verify the 200 MB GIF/YouTube allowance, 30 MB limit for other image uploads and direct image URLs, and rejection of oversized source and converted files before reading their full contents. Clipboard/share tests decode the GIF payload after handoff to verify every frame and delay, reject web-custom formats as native GIF support, confirm no PNG fallback on unsupported or denied GIF copying, and cover conditional result buttons and share cancellation. Encoded timing tests cover custom/fractional FPS, short-tail merging, native-video automatic cadence, long holds, browser-delay clamping, and duration preservation. Pixel tests also verify vertical alignment, natural letter proportions, consistent preview/export layout, colored bands and timing in encoded GIFs, rotated text/image objects, and show/hide events in encoded GIF frames.

The real FFmpeg conversion test runs when `FFMPEG_PATH` and `FFPROBE_PATH` are set; otherwise that test is skipped. It generates a local video fixture and tests the actual probe/conversion pipeline without requiring YouTube network access. A second optional integration test runs the real yt-dlp section downloader when `YT_DLP_TEST_PATH` points to the official Python zipapp, alongside `FFMPEG_PATH` and `FFPROBE_PATH`. It uses a local red/blue video to verify that the downloaded section starts at the requested timestamp rather than an earlier keyframe. Other download cases use an injected process runner; live YouTube access has not been verified in the restricted development environment.

```sh
npx playwright install chromium
npm run test:browser
```

The browser suite checks the New image dialog, clipboard paste, URL imports, content detection, out-of-range YouTube timestamp errors, upload and editing interactions, undo/redo, dragging, generation, cropping, trimming, keyframes, pause/play, image layers, and mobile overflow. It uses an intercepted local origin with mocked remote import responses and requires no HTTP server. It writes screenshots and generated files to `test-results/`. If Chromium is installed externally, set `BROWSER_EXECUTABLE` to its executable path.

Browser execution was blocked by the development host’s sandbox restrictions, so the browser suite remains unverified there.

## Stack and assets

React, Vite, Lucide, `gifuct-js` for GIF decoding, and `gifenc` for worker-based encoding. The bundled fonts (DM Sans, Space Grotesk, and Anton) are distributed under the SIL Open Font License; license files are in `public/fonts/`.

Starter photograph: [Manja Vitolic on Unsplash](https://unsplash.com/photos/a-black-and-white-cat-lying-on-a-brown-bamboo-chair-gKXKBY-C-Dk), used under the [Unsplash license](https://unsplash.com/license).
