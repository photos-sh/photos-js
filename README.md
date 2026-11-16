# Photos.sh for JavaScript and TypeScript

The client library for the [Photos.sh](https://photos.sh) API: image tools for
product photos. Remove and stage backgrounds, resize and compress, upscale,
enhance, crop, watermark, erase objects and text, hide and restore faces,
check and fix photos for marketplaces, read barcodes, text and labels, and run
all of it in batch jobs.

- Written in TypeScript, with types for every option and result.
- No dependencies. Built on `fetch`, `FormData`, `Blob` and Web Crypto, so it
  runs in Node.js 20+, Deno, Bun, Cloudflare Workers and browsers.
- ESM only.

## Install

```sh
npm install @photos-sh/photos
```

## Quick start

```ts
import { Photos } from "@photos-sh/photos";

const photos = new Photos({ apiKey: "your-api-key" });

const cutout = await photos.removeBackground("shoe.jpg");
console.log(cutout.width, cutout.height, cutout.contentType);
await cutout.save("shoe.png");
```

Your API key comes from the API keys page of your organisation in the Photos.sh
console.

## Configuration

```ts
const photos = new Photos({
  apiKey: "your-api-key", // default: the environment variable PHOTOS_API_KEY
  baseUrl: "https://api.photos.sh", // default: PHOTOS_BASE_URL, then this
  timeout: 120_000, // milliseconds per request attempt; this is the default
  maxRetries: 2, // this is the default
  fetch: globalThis.fetch, // bring your own fetch
});
```

Constructing a client without a key (argument or environment) throws a
`PhotosError`. Environment variables are only read where `process.env` exists.

**Retries.** A `503` with the code `busy` (or without the API's JSON error, as
from a proxy) is retried up to `maxRetries` times, after the
`Retry-After` the API gives (at most 30 s), or after 1 s and 2 s without one. A
connection that fails before any response is retried the same way. Nothing
else is retried: not other statuses, and not a `503 model_unavailable`, which
would fail again. `jobs.create` is only retried on a busy `503`.

**Per call.** Every method takes `signal` (an `AbortSignal`) and `timeout`
(milliseconds, for this call) among its options:

```ts
const controller = new AbortController();
const small = await photos.resize("shoe.jpg", {
  width: 800,
  signal: controller.signal,
  timeout: 30_000,
});
```

## Images in

An image argument is one of:

| Type | Notes |
|---|---|
| `string` | A file path, read with `node:fs` (Node.js, Deno, Bun). A string is always a path, never a URL or the image data. |
| `Blob` / `File` | A `File`'s name is sent along. |
| `Uint8Array`, `ArrayBuffer`, any typed array view, `Buffer` | The bytes of the image file. |
| `ReadableStream<Uint8Array>` | Read to the end before sending. |

JPEG, PNG, WebP, GIF, TIFF and BMP are accepted, and HEIC/HEIF and AVIF where
the server supports them.

## Images out

Methods that change a photo return an `ImageResult`:

```ts
const result = await photos.resize("shoe.jpg", { width: 800, format: "webp" });

result.bytes; // Uint8Array: the encoded image
result.contentType; // "image/webp"
result.width; // 800
result.height;
result.quality; // number, or undefined for lossless formats
result.serverTiming; // "decode;dur=3.1, resize;dur=1.2, encode;dur=8.0"
result.headers; // all response headers
result.blob(); // a Blob with the content type
await result.save("shoe.webp"); // Node.js, Deno, Bun
```

Options are camelCase and are sent under the API's names (`maxBytes` becomes
`max_bytes`, `allFormats` becomes `all_formats`). Options you leave out are not
sent, so the API's defaults apply.

## Edit

### Remove the background

```ts
const cutout = await photos.removeBackground("shoe.jpg", {
  format: "png", // "png" | "jpg" | "webp" | "avif"; PNG by default
  background: "white", // composite onto a colour; omit for transparency
  crop: true, // crop to the subject
  padding: 20, // margin around the subject when cropping, in pixels
});

// The greyscale alpha mask instead of the cutout:
const mask = await photos.removeBackground("shoe.jpg", { mask: true });

// A studio shot (a product on a plain, light backdrop, as in a light tent):
// also keep the gift box, case or lid shown with the bottle.
const boxed = await photos.removeBackground("bottle.jpg", { studio: true });
```

`studio` also keeps what clearly stands out from the backdrop and touches the
product, such as a pale box the model left half transparent. Shadows and the
floor below the product are left out. A photo without a plain light backdrop
is cut out as without it.

The same call can stage the cutout: on a canvas, with a shadow or a reflection
under it, and with a colour, an image or the photo's own blurred background
behind it.

```ts
const staged = await photos.removeBackground("shoe.jpg", {
  width: 1600, // a canvas of this size; give both sides
  height: 1600,
  fill: 0.8, // how much of the canvas the subject may take (default 0.85)
  align: "bottom", // "center" | "top" | "bottom"
  shadow: "contact", // "none" | "contact" | "drop"
  reflection: true, // needs room below the subject: a fill under 1
  backgroundImage: "studio.jpg", // an image behind the subject, scaled to cover
});
staged.subjectFound; // false: no subject was found and the photo comes back as it was

// The photo's own background, blurred (1 to 100):
const soft = await photos.removeBackground("portrait.jpg", { blur: 40 });
```

Give at most one of `background`, `backgroundImage` and `blur`. `subjectFound`
is `undefined` when the API does not say; that is not the same as `false`.

### Resize, convert, compress

```ts
const small = await photos.resize("shoe.jpg", {
  width: 1200,
  height: 1200,
  fit: "contain", // "contain" | "cover" | "fill"
  enlarge: false, // allow scaling up with "contain"
  format: "jpg",
  quality: 85,
  maxBytes: 300_000, // lower the quality until the file fits
  background: "white", // flatten transparency onto this colour
  trim: true, // cut away an even border first
  trimTolerance: 10, // how far a pixel may differ from the border's colour, 0-255
  dpi: 300, // print resolution to write into a JPEG or PNG
});
```

### Upscale

```ts
const big = await photos.upscale("thumbnail.jpg", { scale: 2 }); // 1 to 4, default 4
```

### Erase objects

Give the areas as rectangles, as a mask image the size of the photo (white =
remove), or both:

```ts
const clean = await photos.erase("room.jpg", {
  rects: [
    [40, 60, 200, 120], // x, y, width, height
    { x: 500, y: 300, width: 80, height: 80 },
  ],
});

const cleaner = await photos.erase("room.jpg", { mask: "mask.png" });
```

### Remove text

Removes watermarks, captions, prices. Text printed on the product itself stays
unless you ask for `region: "all"`.

```ts
const result = await photos.removeText("listing.jpg", {
  region: "background", // or "all"
  matching: "sale|€|www\\.", // only lines matching this regular expression
});
console.log(result.removed, result.kept); // lines of text removed and left
await result.save("clean.jpg");
```

### Enhance

Without settings, `enhance` stretches the tones to the full range and takes
out a colour cast. With any setting, only what you give is applied.

```ts
const better = await photos.enhance("shoe.jpg");

const tuned = await photos.enhance("shoe.jpg", {
  auto: true, // keep the automatic part (or `levels`, `whiteBalance` for half of it)
  brightness: 10, // -100 to 100, as are contrast, saturation and temperature
  contrast: 5,
  saturation: -20, // -100 is black and white
  temperature: 15, // below zero is cooler, above is warmer
  sharpen: 30, // 0 to 100
});
```

### Crop to a shape

Finds the subject and crops the photo to a shape around it. The background
stays.

```ts
const cropped = await photos.crop("shoe.jpg", {
  aspect: "4:5", // or a number: 1.5
  zoom: true, // the smallest crop that holds the subject, not the largest of the shape
  padding: 0.1, // room around the subject with zoom, as a fraction of its longest side
});
cropped.subjectFound; // false: no subject was found and the crop is centred

// An avatar: built around the faces, and scaled to 400 x 400.
const avatar = await photos.crop("team.jpg", {
  width: 400,
  height: 400,
  focus: "face", // "subject" by default
  zoom: true,
  padding: 0.6,
});
```

### Watermark

Give `text`, or a logo as `watermark` (an image; a PNG with transparency works
best), not both. Text is drawn in Latin, Greek and Cyrillic letters.

```ts
const marked = await photos.watermark("shoe.jpg", {
  text: "© Example Shop",
  color: "white",
  position: "bottom-right", // "top-left", "top", "top-right", "left", "center", ...
  scale: 25, // the mark's width as a percentage of the photo's width
  opacity: 50, // 1 to 100
  margin: 3, // distance from the edges, as a percentage of the shorter side
});

const tiled = await photos.watermark("shoe.jpg", { watermark: "logo.png", tile: true });
```

### Expand the canvas

Adds room around the photo: to a shape, or by pixels on each side. The new
area continues the photo, which suits plain and softly textured backgrounds.
It does not invent content: a subject cut off at the edge stays cut off.

```ts
const square = await photos.expand("shoe.jpg", { aspect: "1:1" });

const wider = await photos.expand("shoe.jpg", {
  left: 200, // pixels; also right, top, bottom
  right: 200,
  fill: "white", // a colour instead of continuing the photo ("inpaint", the default)
});
```

### Vectorize

For logos, icons and flat drawings: each area of one colour becomes a path. A
photograph traces into thousands of paths and a large file.

```ts
const svg = await photos.vectorize("logo.png", {
  mode: "color", // or "mono": one black shape
  curves: "spline", // "spline" | "polygon" | "pixel"
  detail: 8, // 1 to 8; lower merges similar shades
  speckle: 4, // areas smaller than this many pixels across are dropped
});
svg.contentType; // "image/svg+xml"
svg.paths; // how many paths the SVG has
svg.text(); // the SVG as a string
await svg.save("logo.svg");
```

### Hide faces

```ts
const hidden = await photos.blurFaces("street.jpg", {
  mode: "blur", // "blur" | "pixelate" | "fill" (with `color`)
  strength: 50, // 1 to 100
  padding: 0.15, // how far past the face's box, as a fraction of the box
  minScore: 0.6, // how sure the model must be that something is a face
});
hidden.faces; // how many faces were found and hidden
```

Blur and pixelation stop a person from recognising the face; only
`mode: "fill"` leaves nothing of it. Check `faces` before relying on the
result: a small, turned or covered face may not be found.

### Identity photos

`idPhoto` frames a portrait the way an identity document asks: the head level,
at the document's size and place, on a photo of the document's size.

```ts
const documents = await photos.idPhotos(); // [{ name: "us-passport", title, width_mm, notes, ... }]

const passport = await photos.idPhoto("portrait.jpg", { document: "us-passport" });
passport.passed; // boolean: is `findings` empty?
passport.findings; // codes of what looks wrong, e.g. ["head_tilted", "background_not_plain"]
passport.headMm; // the head's height in the result, chin to crown, in millimetres
await passport.save("passport.jpg");

// Any other document, by its sizes in millimetres:
const badge = await photos.idPhoto("portrait.jpg", {
  widthMm: 35,
  heightMm: 45,
  headMinMm: 32,
  headMaxMm: 36,
  dpi: 300, // the default
  background: "white", // "keep" (the default), "document", or a colour
});
```

`idPhoto` keeps the photo's own background by default, because passport
authorities do not accept edited photos. `passed` is not an approval: the tool
cannot judge expression, glasses, shadows, focus or likeness. A photo with no
face, or more than one, throws an `UnprocessableError`.

### Denoise

Removes sensor noise and the blocks of heavy JPEG compression.

```ts
const clean = await photos.denoise("night.jpg", {
  strength: 100, // 1 to 100; lower keeps more of the original
});
```

`denoise` is slow without a GPU and takes photos up to 12 megapixels.

### Colorize

```ts
const coloured = await photos.colorize("grandparents.jpg", { strength: 100 }); // lower is paler
```

`colorize` guesses colours: skin, sky and grass come out believable, but the
colour of clothes, cars or walls cannot be known and is invented.

### Select an object

Where `removeBackground` decides what the subject is, `select` is told: give
points on the object, points to keep out of it, or a box around it, in the
photo's pixels.

```ts
const object = await photos.select("desk.jpg", {
  points: [[420, 310]], // [x, y] or { x, y }; more points add to the selection
  exclude: [[600, 120]], // points that must stay outside it
  pick: "auto", // or "smallest" (the part clicked), "largest" (the whole it belongs to)
});
object.score; // how well the model thinks the mask fits the object, 0 to 1

const boxed = await photos.select("desk.jpg", {
  box: [380, 250, 200, 160], // x, y, width, height
  crop: true,
});

// The object's mask is what `erase` takes to remove it:
const mask = await photos.select("desk.jpg", { points: [[420, 310]], mask: true });
const without = await photos.erase("desk.jpg", { mask: mask.bytes });
```

### Restore faces

Redraws each face in an old, blurred or noisy photo; the rest of the photo is
not touched.

```ts
const restored = await photos.restoreFaces("old-photo.jpg", { strength: 100 });
restored.faces; // faces restored
restored.facesSkipped; // faces left alone: already large and detailed
```

`restoreFaces` invents detail and must not be used where the face has to be
exactly the person's, such as an identity document or evidence.

### Run a preset or a recipe

```ts
const listing = await photos.run("shoe.jpg", { preset: "marketplace" });

const recipe = `
[remove_background]

[output]
format = "webp"
max_side = 1600
`;
const custom = await photos.run("shoe.jpg", { recipe });

const presets = await photos.presets(); // [{ name, description }, ...]
```

## Check and fix

```ts
const report = await photos.check("shoe.jpg", {
  marketplace: "amazon", // amazon, ebay, etsy, shopify, google, allegro, zalando
  subject: true, // also find the product: framing and background checks
  text: true, // also read the text in the photo
});
report.metrics.sharpness;
for (const finding of report.findings) {
  console.log(finding.severity, finding.code, finding.message);
}
if (report.marketplace && !report.marketplace.passed) {
  console.log(report.marketplace.findings);
}

const fixed = await photos.fix("shoe.jpg", { marketplace: "amazon" });
fixed.passed; // boolean: does the fixed image pass?
fixed.findings; // codes of what is still wrong, e.g. ["too_small"]
await fixed.save("shoe-amazon.jpg");

const rules = await photos.marketplaces(); // every marketplace's rules
```

## Read

```ts
const { barcodes } = await photos.readBarcodes("box.jpg", { allFormats: true });
for (const barcode of barcodes) console.log(barcode.format, barcode.value, barcode.gs1);

const { lines } = await photos.readText("label.jpg");
for (const line of lines) console.log(line.text, line.score, line.box);

// One to eight photos of one product:
const { label } = await photos.readLabel(["front.jpg", "back.jpg"]);
console.log(label.gtin, label.net_quantity, label.allergens);

// One to eight photos of one product, matched against your organisation's
// catalogue (uploaded in the console; only for organisations it is turned on for):
const { candidates } = await photos.identify(["front.jpg", "back.jpg"], { top: 3 });

// The main colours, the most common first (5 by default, up to 16):
const { colors } = await photos.palette("shoe.jpg", { colors: 5 });
for (const color of colors) console.log(color.hex, color.rgb, color.share);

// Where the faces are, the surest first:
const { faces } = await photos.findFaces("team.jpg", { minScore: 0.6 });
for (const face of faces) console.log(face.box, face.landmarks.nose, face.score, face.roll);

// A description in words: "short" (one sentence), "detailed" or "paragraph".
const { caption } = await photos.caption("shoe.jpg", { detail: "short" });
```

`findFaces` finds faces; it does not recognise who anyone is. `caption` can be
wrong and is English only, so read it before you publish it.

JSON results keep the API's field names (`net_quantity`, `on_product`) and are
returned as the API sent them, so fields added to the API later are there even
before the types know them.

## Account and service

```ts
const account = await photos.account(); // { account, key, credits, prices } or { account, unlimited: true }
const status = await photos.health(); // "ok" | "loading" | "failed"
```

`health` returns `loading` and `failed` rather than throwing, although the API
answers those with a 503.

## Batch jobs

A job runs one operation on many photos in the background. Give photos as
uploads, as URLs the API fetches, or both:

```ts
const job = await photos.jobs.create({
  operation: "remove-background",
  params: { format: "png", crop: true }, // the options of the matching method
  images: ["1.jpg", "2.jpg"],
  urls: ["https://example.com/photos/3.jpg"],
  webhookUrl: "https://example.com/hooks/photos", // optional
});

const done = await photos.jobs.wait(job.id, {
  pollInterval: 2000, // the default
  timeout: 600_000, // the default; then a TimeoutError (the job carries on)
});
console.log(done.counts); // { total: 3, done: 3, failed: 0, pending: 0 }

for (const [n, item] of done.items.entries()) {
  if (item.status !== "done") {
    console.log(item.input, item.error?.code, item.error?.message);
    continue;
  }
  const result = await photos.jobs.result(job.id, n);
  await result.image().save(`out-${n}.png`);
}

await photos.jobs.delete(job.id);
```

- Operations: `run`, `remove-background`, `resize`, `upscale`, `ocr`,
  `barcodes`, `check`, `fix`, `remove-text`, `label`, `enhance`, `crop`,
  `palette`, `watermark`, `expand`, `vectorize`, `faces`, `blur-faces`,
  `id-photo`, `denoise`, `colorize`, `select`, `restore-faces`, `caption`. For
  `run`, pass `params: { preset: "..." }` or `recipe` (TOML).
- A job item is one image, so a `watermark` job takes `text` only, and a
  `remove-background` job no `backgroundImage`.
- Items are numbered from 0: the images in order, then the URLs.
- `completed` means every item was attempted; look at `counts.failed`.
- `jobs.result` returns a `JobItemResult` with `bytes`, `contentType`,
  `headers`, `isImage`, `isJson`, and `image()` (an `ImageResult`), `json()`
  and `text()`:

```ts
import type { CheckResult } from "@photos-sh/photos";

const checks = await photos.jobs.create({
  operation: "check",
  params: { marketplace: "ebay" },
  urls: ["https://example.com/1.jpg"],
});
await photos.jobs.wait(checks.id);
const result = await photos.jobs.result(checks.id, 0);
console.log(result.json<CheckResult>().marketplace?.passed);
```

- For `remove-text` and `fix` jobs, `removeText()` and `fix()` give the same
  results as the methods of those names, with the counts and the verdict:

```ts
const fixes = await photos.jobs.create({
  operation: "fix",
  params: { marketplace: "etsy" },
  images: ["1.jpg", "2.jpg"],
});
await photos.jobs.wait(fixes.id);
const fixed = (await photos.jobs.result(fixes.id, 0)).fix();
console.log(fixed.passed, fixed.findings, fixed.width, fixed.height);

// and for a "remove-text" job:
// const cleaned = (await photos.jobs.result(id, 0)).removeText(); cleaned.removed, cleaned.kept
```

  Both throw a `PhotosError` rather than return zeros when the result does not
  carry those headers: the item ran another operation, or the server is an
  older one that does not keep them on job results. The same values are in the
  job itself, as `job.items[n].headers` (`x-text-removed`,
  `x-marketplace-passed`, ...).

- `crop()`, `vectorize()`, `blurFaces()`, `idPhoto()`, `select()` and
  `restoreFaces()` do the same for jobs of those operations, and throw in the
  same way. `removeBackground()` gives `subjectFound`.

- `photos.jobs.get(id)` returns the job with its items, and
  `photos.jobs.list()` your recent jobs, newest first, without items.

## Webhooks

A job with a `webhookUrl` gets a `job.completed` event posted to it, signed
with your webhook secret in the `Photos-Signature` header. `verifyWebhook`
checks the signature and the age of the delivery (5 minutes by default) and
returns the event. It needs no client, and it must be given the body exactly
as received:

```ts
import { verifyWebhook, WebhookError } from "@photos-sh/photos";

const secret = process.env.PHOTOS_WEBHOOK_SECRET!; // (await photos.webhookSecret()).secret

// Any fetch-style handler: Cloudflare Workers, Deno, Bun, Next.js route handlers, Hono...
export async function POST(request: Request): Promise<Response> {
  try {
    const event = await verifyWebhook(
      await request.text(),
      request.headers.get("photos-signature"),
      secret,
    );
    if (event.type === "job.completed") {
      console.log(event.job.id, event.job.counts);
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof WebhookError) return new Response("bad signature", { status: 400 });
    throw error;
  }
}
```

With Express, read the raw body (`express.raw({ type: "application/json" })`)
and pass `req.body` (a `Buffer`) and `req.get("photos-signature")`.

`verifyWebhook(body, signature, secret, { tolerance: 600 })` changes the
allowed age in seconds; `now` (Unix seconds, a `Date`, or a function) sets the
clock for tests. The same function is available as `Photos.verifyWebhook`.

## Errors

Everything the library throws extends `PhotosError`, except an abort through
your own `AbortSignal`, which rejects with the signal's reason.

| Class | When |
|---|---|
| `ApiError` | The API answered with an error. Has `status`, `code`, `message`, `retryAfter` (seconds, when given), `headers`, `body`. |
| `ConnectionError` | No response: DNS, refused or dropped connection. `cause` has the original error. |
| `TimeoutError` | A request ran past `timeout`, or `jobs.wait` past its own. |
| `WebhookError` | A webhook delivery did not verify. |

`ApiError` has a subclass per API error code:

| Class | Status | `code` |
|---|---|---|
| `BadRequestError` | 400 | `bad_request` |
| `UnauthorizedError` | 401 | `unauthorized` |
| `PaymentRequiredError` | 402 | `payment_required` (out of credits) |
| `AccountSuspendedError` | 403 | `account_suspended` |
| `NotFoundError` | 404 | `not_found` (no such job or item) |
| `PayloadTooLargeError` | 413 | `payload_too_large` |
| `UnsupportedFormatError` | 415 | `unsupported_format` |
| `UnprocessableError` | 422 | `unprocessable` |
| `InternalServerError` | 500 | `internal` |
| `BusyError` | 503 | `busy` (after the retries) |
| `ModelUnavailableError` | 503 | `model_unavailable` (not retried) |

An error with a code this version does not know is a plain `ApiError` with
that `code`; an error body that is not the API's JSON gives `code: "unknown"`
and the start of the body as the message.

```ts
import { ApiError, BusyError, PaymentRequiredError, Photos } from "@photos-sh/photos";

const photos = new Photos();
try {
  await photos.upscale("thumbnail.jpg");
} catch (error) {
  if (error instanceof PaymentRequiredError) {
    console.log("Out of credits");
  } else if (error instanceof BusyError) {
    console.log(`Busy; try again in ${error.retryAfter ?? 5} s`);
  } else if (error instanceof ApiError) {
    console.log(error.status, error.code, error.message);
  } else {
    throw error;
  }
}
```

## In the browser

The library works in browsers, with two things to know. An API key in a page
is visible to everyone who opens it, so call the API from your server unless
the key is meant to be public. And file paths and `save()` need `node:fs`: use
`File`/`Blob` in and `result.blob()` out.

```ts
const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
const result = await photos.removeBackground(input.files![0]!);
document.querySelector("img")!.src = URL.createObjectURL(result.blob());
```

## Development

```sh
npm install
npm run build        # tsc -> dist/
npm test             # unit tests, against an in-process HTTP server
npm run typecheck
npm run lint         # Biome
```

The integration tests run against a real engine and are skipped unless both
variables are set:

```sh
PHOTOS_TEST_BASE_URL=http://127.0.0.1:8098/api PHOTOS_TEST_API_KEY=... npm run test:integration
```

The photos they send are generated and have no face in them. Set
`PHOTOS_TEST_PORTRAIT` to the path of a photo of one face to also run the face
tools on it.

A release is a tag: set the version in `package.json` and `src/version.ts`,
merge to `main`, and push the tag `v<version>`.
`.github/workflows/release.yml` checks it, builds the package and publishes it
to npm.

## License

MIT. Copyright (c) 2026 Vallic.
