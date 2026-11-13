# Changelog

All notable changes to this library are written down here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the library
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0 (unreleased)

First version.

- `identify` matches against the organisation's own catalogues (uploaded in
  the console; turned on per organisation). Without it the API answers
  `404 not_found` (`NotFoundError`). A catalogue is one of seven kinds of
  product, and the evidence and the label's values follow it: `sku`, `brand`,
  `quantity`, `pack`, `spf`, `strength`, `count`, `spec`, `model` beside the
  wine and spirits ones.
- `Photos` client: API key and base URL from arguments or the environment
  (`PHOTOS_API_KEY`, `PHOTOS_BASE_URL`), a 120 s timeout, two retries on a busy
  `503` (honouring `Retry-After`) and on failed connections, an injectable `fetch`,
  and an `AbortSignal` on every method.
- Edit: `removeBackground`, `resize`, `upscale`, `erase`, `removeText`, `run`.
- Editing tools: `enhance`, `crop`, `watermark` (text, or a logo sent as a
  `watermark` part), `expand`, `vectorize` (an SVG, with `paths` and `text()`),
  `blurFaces`, `idPhoto` and `idPhotos`, `denoise`, `colorize`, `select`
  (`points` and `exclude` repeat as `point` and `exclude`), `restoreFaces`.
- `removeBackground` stages the cutout: `width`, `height`, `fill`, `align`,
  `shadow`, `reflection`, `blur`, and `backgroundImage` (sent as a
  `background` part). `resize` takes `trim`, `trimTolerance` and `dpi`.
- Results carry what the API says in headers: `subjectFound` on
  `removeBackground` and `crop` (`undefined` when the API does not say),
  `faces` on `blurFaces`, `passed`, `findings` and `headMm` on `idPhoto`,
  `score` on `select`, `faces` and `facesSkipped` on `restoreFaces`.
- Check and fix: `check`, `fix`, `marketplaces`.
- Read: `readBarcodes`, `readText`, `readLabel`, `identify`, `palette`,
  `findFaces`, `caption`.
- Account: `account`, `presets`, `health`, `webhookSecret`.
- Batch jobs: `jobs.create`, `jobs.get`, `jobs.list`, `jobs.delete`,
  `jobs.result`, `jobs.wait`. A job item result has `image()`, `json()`,
  `text()`, and for `remove-text` and `fix` jobs `removeText()` and `fix()`
  with the counts and the verdict.
- Batch jobs take the operations `enhance`, `crop`, `palette`, `watermark`,
  `expand`, `vectorize`, `faces`, `blur-faces`, `id-photo`, `denoise`,
  `colorize`, `select`, `restore-faces` and `caption`. A job item result has
  `removeBackground()`, `crop()`, `vectorize()`, `blurFaces()`, `idPhoto()`,
  `select()` and `restoreFaces()` for the results of those jobs. A `select`
  job takes `points`, `exclude` and `box` as the method does.
- Webhooks: `verifyWebhook` (also `Photos.verifyWebhook`), on Web Crypto.
- Errors: `PhotosError`, `ApiError` and a subclass per API error code,
  `ConnectionError`, `TimeoutError`, `WebhookError`.
