# Install and test Kirket on iPhone

Kirket is an installable web app (PWA). Camera/clipboard/service-worker features
require a public **HTTPS** address. The Cloud Agent's `localhost` or private
`172.x.x.x` address is not reachable from your phone and is not the final
deployment URL.

## Recommended deployment: Vercel

1. Merge the pull request into the repository's main branch.
2. Sign in to [vercel.com](https://vercel.com) with the GitHub account that can
   access the repository.
3. Choose **Add New → Project** and import this repository.
4. Vercel should detect Vite automatically. Confirm:
   - Build command: `npm run build`
   - Output directory: `dist`
   - Install command: `npm ci`
5. Deploy.
6. Open the resulting `https://...vercel.app` address on the iPhone in Safari.

Netlify or Cloudflare Pages also work with the same build command and `dist`
output directory.

## Add to the iPhone Home Screen

1. Open the deployed HTTPS address in **Safari**.
2. Tap the Safari **Share** button.
3. Scroll and tap **Add to Home Screen**.
4. Keep the name `Kirket`, then tap **Add**.
5. Launch Kirket from the new Home Screen icon.

The app shell is cached after first load. Large videos are never cached by the
service worker.

## First test

1. Open **1. Calibrate**.
2. Upload a setup picture and run auto-detect.
3. Zoom/pan and correct every required marker.
4. Run calibration. Do not trust a result marked `needs-work`.
5. Open **2. Detect shot**.
6. Upload a short original-quality 120/240 fps video.
7. Grab a frame just before contact and tap the yellow ball.
8. Confirm capture FPS and timeline mode, then process.
9. Open **3. Simulate** to inspect the measured trajectory and result.

## Privacy

The current app processes images and videos locally in Safari. It has no upload
server, analytics, user account, or remote media storage. OpenCV is bundled with
the app rather than fetched from a third-party CDN.

## Before trusting measurements

This build is ready for controlled field testing, not yet validated as a
measurement instrument. Collect multiple real iPhone 16 Pro clips with:

- the phone fixed in the calibrated mount;
- the same 1× camera, orientation, crop, and resolution;
- measured ball diameter;
- strong lighting;
- manually verified ball tracks.

Compare detected speed/direction against known test shots or an independent
reference before using results competitively.
