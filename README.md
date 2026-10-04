# VAR Studio

VAR Studio is a local-first football video analysis editor. Footage and projects are stored in the browser; no application backend or paid service is required. The app is a Vite + React + TypeScript PWA and can be deployed as static files.

## Run locally

Requirements: Node.js 20+ and npm.

```powershell
npm ci
npm run dev
```

Open the local URL printed by Vite. The development server sets the cross-origin isolation headers required for browser media workloads. Use a current Chromium-based browser for the broadest WebGPU, speech, and FFmpeg support.

## Free AI setup

Open **Settings** in the app and paste your own API key for either:

- **Gemini**: create a key in Google AI Studio and use the free tier subject to its current quotas and terms.
- **Groq**: create a key in the Groq console and use the free tier subject to its current quotas and terms.

Keys are stored in this browser's local storage and sent directly to the selected provider. They are not written into project archives or sent to a VAR Studio server. Do not use a shared browser profile for private keys.

Whisper runs locally with Transformers.js; the first use downloads the Whisper tiny model. Kokoro neural voiceover is also downloaded and run in-browser the first time it is generated. Model downloads need an internet connection. A browser system voice can be used for quick preview. Model availability, browser support and device memory vary.

## Build

```powershell
npm run build
npm run preview
```

The static production site is written to `dist/`.

GitHub Actions runs the same locked-dependency production build for pushes and pull requests targeting `main`. Node.js 20 or newer is required.

## Deploy for free

### Netlify

1. Push this project to a Git repository.
2. Import it in Netlify.
3. Build command: `npm run build`; publish directory: `dist`.
4. `netlify.toml` configures the build and COOP/COEP headers.

### Vercel Hobby

1. Import the repository in Vercel.
2. Use `npm run build` and `dist` as the output directory.
3. `vercel.json` configures COOP/COEP response headers.

### Cloudflare Pages

1. Create a Pages project from the repository.
2. Build command: `npm run build`; build output directory: `dist`.
3. `public/_headers` publishes COOP/COEP headers. The `credentialless` COEP policy permits the Google Identity Services script while preserving cross-origin isolation in supporting browsers. Verify the deployed response headers and `crossOriginIsolated` before using features that require `SharedArrayBuffer`.

No server-side environment variables are required. `.env.example` documents that AI keys are supplied in browser Settings. Static hosting and free AI/model quotas are subject to provider limits.

The deployment is a static client-side app; connect the repository to your chosen host and use the build/output settings above. Add the deployed site origin (`https://var-studios.pages.dev`) to the Google OAuth web client before connecting a YouTube channel. Verify that the published site returns `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`; in the browser console, `crossOriginIsolated` should be `true`. Browser FFmpeg multithreading depends on cross-origin isolation. `credentialless` also allows the Google Identity Services script to load without requiring a CORS response header.

## First use

1. Import a video file you own or have permission to use by dropping it into the workspace or using **Import footage**.
2. Seek to a moment and add an incident marker. Enter factual notes in the inspector.
3. Select an overlay tool and click the preview to place it. Select it to adjust label, color, and position.
4. Add a transcript locally with Whisper, or paste one into the transcript field. Generate or edit a script with your configured AI provider.
5. Generate captions from the script/transcript, edit their text and timing, then export an SRT file.
6. Export the project archive to back up the IndexedDB project and imported video.
7. Confirm footage rights in the export dialog before rendering. A YouTube reference link is never treated as source footage.

Projects autosave shortly after edits; use **Save** to force an immediate save. The unsaved indicator warns when there are pending edits. Exporting a `.varstudio.zip` archive is the portable backup/import path. Browser storage can be cleared by the user or evicted by the browser, so keep backups of important work.

## Project layout

```text
src/
  App.tsx             Editor UI, workflow and browser event handlers
  style.css           Responsive dark editor interface
  types.ts            Project and editing data types
  lib/
    ai.ts             Gemini/Groq adapter and script/caption helpers
    db.ts             Dexie IndexedDB persistence
    export.ts         SRT, download, project summary and FFmpeg export
    store.ts          Zustand editor state and undo/redo snapshots
public/
  _headers            Cloudflare Pages COOP/COEP headers
  favicon.svg
```

## Legal and rights

VAR Studio renders only video files the user imports from their device. A YouTube link is an optional reference embed for scouting timestamps; the app does not download, extract, or render its contents. To edit a reference video, obtain a permitted copy from the rights holder and import that file. Before exporting or publishing, confirm that you own or have rights to the footage and that your use complies with applicable law. Football match broadcasts are commonly protected by copyright. Fair use/fair dealing is fact-specific, varies by jurisdiction, and is not guaranteed by labeling a video “analysis” or “commentary”. Obtain permission or use footage licensed for your intended use; consult a qualified lawyer for legal advice.

## Publish to your YouTube channel

Publishing is optional and uses Google's official YouTube Data API. The app uploads only an MP4 rendered locally in the current browser session; it cannot publish a YouTube reference link or use that link as footage.

1. In Google Cloud Console, create a project, enable the YouTube Data API v3, and configure an OAuth consent screen for the app.
2. Create an OAuth client ID for a web application and allow the exact origin where VAR Studio is hosted. Follow Google's current OAuth verification and test-user requirements.
3. Open **Settings**, enter the web client ID, and connect the Google account associated with your channel.
4. Import authorized local footage, confirm rights in **Export**, render the MP4, choose its title, description, and visibility, then upload it.

The OAuth access token stays in memory and is revoked after disconnecting or completing an upload. Google API project quotas, OAuth approval requirements, and YouTube channel policies apply. If API authorization is unavailable, download the rendered MP4 and upload it through YouTube Studio.

## Known limits

- The current MP4 renderer encodes the selected source video at 1080p H.264/AAC and fits it to the selected aspect ratio. It does **not** yet composite the multi-track timeline, graphics, trim/split edits, generated voiceover, captions, intro/outro, side-by-side camera angles, or blur-background reframing. Timeline split creates editable metadata segments but does not cut the source media. The export dialog discloses this before rendering.
- Export is a browser-side FFmpeg job. It uses the multi-threaded core when the host provides cross-origin isolation and SharedArrayBuffer; otherwise it uses the single-threaded core. Large 4K/long recordings can exceed device memory or browser execution limits; use short source files and Draft preview. Cancel terminates the FFmpeg worker.
- Overlays are editable preview graphics; only their timeline state is persisted. Full-quality live overlay preview is canvas-rendered; Draft mode disables that overlay pass to conserve resources.
- Whisper tiny transcription and Kokoro TTS need model downloads and significant memory. GPU/WASM support depends on browser/device. This build reports model/load errors; browser speech synthesis is an optional preview fallback.
- AI features require your own provider key and available free-tier quota. Provider data handling and retention are governed by the provider's terms.
- Voiceover is downloaded and saved in the local project archive, but it is not mixed into the current MP4 renderer.
- Multi-angle layout, speed ramps, freeze-frame controls, camera zoom/pan, captions burned into video, track-level audio mixing, and neural-voice timing per incident are not part of this release.
- PWA shell assets are cacheable after the first online visit. Large user media and AI models are not automatically cached for offline use.
- The embedded YouTube reference requires a network connection and may be blocked by the source video's embed settings.
- Browser storage quotas vary by device. Project ZIP archives may be large because original media is included.
