// Runs against a real engine. Skipped unless both PHOTOS_TEST_BASE_URL and
// PHOTOS_TEST_API_KEY are set. Images are tiny and model calls few.
// PHOTOS_TEST_PORTRAIT, the path of a photo of one face, adds a test of the
// face tools on a real face (the generated photos have none).

import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ApiError,
  BadRequestError,
  type CheckResult,
  NotFoundError,
  Photos,
  PhotosError,
  UnauthorizedError,
  UnprocessableError,
  verifyWebhook,
} from "../../src/index.js";
import { png, startServer } from "../helpers.js";

const baseUrl = process.env.PHOTOS_TEST_BASE_URL;
const apiKey = process.env.PHOTOS_TEST_API_KEY;
const skip = !baseUrl || !apiKey ? "set PHOTOS_TEST_BASE_URL and PHOTOS_TEST_API_KEY" : false;
const portrait = process.env.PHOTOS_TEST_PORTRAIT;

/** A dark product-like blob on white. */
function photo(width: number, height: number): Uint8Array<ArrayBuffer> {
  return png(width, height, (x, y) => {
    const dx = (x - width / 2) / (width * 0.3);
    const dy = (y - height / 2) / (height * 0.35);
    return dx * dx + dy * dy < 1 ? [40, 70, 160] : [255, 255, 255];
  });
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

describe("against a real engine", { skip }, () => {
  // The engine is shared and has one model worker: allow for `busy`.
  const photos = new Photos({ apiKey: apiKey ?? "-", baseUrl, maxRetries: 6 });
  const small = photo(96, 64);

  it("health", async () => {
    assert.equal(await photos.health(), "ok");
  });

  it("account, presets, marketplaces, webhookSecret", async () => {
    const account = await photos.account();
    assert.ok(account.unlimited === true || typeof account.credits === "number");
    const presets = await photos.presets();
    assert.ok(presets.some((preset) => preset.name === "marketplace" && preset.description));
    const marketplaces = await photos.marketplaces();
    const amazon = marketplaces.find((profile) => profile.name === "amazon");
    assert.ok(amazon?.title && Array.isArray(amazon.rules) && typeof amazon.fix === "object");
    const secret = await photos.webhookSecret();
    assert.match(secret.secret, /^whsec_/);
    assert.equal(secret.header, "Photos-Signature");
  });

  it("resize", async () => {
    const result = await photos.resize(small, {
      width: 48,
      format: "jpg",
      quality: 80,
      maxBytes: 50_000,
    });
    assert.equal(result.contentType, "image/jpeg");
    assert.equal(result.width, 48);
    assert.equal(result.height, 32);
    assert.equal(typeof result.quality, "number");
    assert.match(result.serverTiming ?? "", /dur=/);
    assert.deepEqual([...result.bytes.subarray(0, 2)], [0xff, 0xd8]);
    assert.ok(result.bytes.length <= 50_000);

    const path = join(await mkdtemp(join(tmpdir(), "photos-js-it-")), "small.jpg");
    await result.save(path);
    // A file path in, and options that need both sides.
    const cover = await photos.resize(path, { width: 20, height: 20, fit: "cover", format: "png" });
    assert.deepEqual([cover.width, cover.height, cover.quality], [20, 20, undefined]);
    assert.deepEqual([...(await readFile(path)).subarray(0, 2)], [0xff, 0xd8]);
  });

  it("resize with trim and dpi", async () => {
    const result = await photos.resize(small, {
      trim: true,
      trimTolerance: 20,
      dpi: 300,
      format: "png",
    });
    // The white border around the blob is cut away.
    assert.ok(result.width < 96 && result.height < 64, `${result.width} x ${result.height}`);
    assert.deepEqual([...result.bytes.subarray(0, 4)], PNG_MAGIC);
  });

  it("enhance", async () => {
    const result = await photos.enhance(small, { brightness: 10, whiteBalance: true, sharpen: 20 });
    assert.deepEqual([result.width, result.height], [96, 64]);
    assert.equal(result.contentType, "image/png");
  });

  it("watermark with text and with a logo", async () => {
    const text = await photos.watermark(small, { text: "Shop", position: "center", scale: 50 });
    assert.deepEqual([text.width, text.height], [96, 64]);
    const logo = png(16, 8, () => [200, 30, 30]);
    const marked = await photos.watermark(small, { watermark: logo, tile: true, opacity: 30 });
    assert.deepEqual([marked.width, marked.height], [96, 64]);
    await assert.rejects(photos.watermark(small, {}), BadRequestError);
  });

  it("expand with a colour", async () => {
    const result = await photos.expand(small, { left: 8, right: 8, fill: "white" });
    assert.deepEqual([result.width, result.height], [112, 64]);
  });

  it("vectorize", async () => {
    const result = await photos.vectorize(small, { mode: "color", speckle: 2 });
    assert.equal(result.contentType, "image/svg+xml");
    assert.match(result.text(), /<svg[\s>]/);
    assert.equal(result.headers.has("x-paths"), true);
    assert.ok(Number.isInteger(result.paths) && result.paths >= 1);
    assert.deepEqual([result.width, result.height], [96, 64]);
  });

  it("palette", async () => {
    const result = await photos.palette(small, { colors: 3 });
    assert.deepEqual([result.width, result.height], [96, 64]);
    assert.ok(result.colors.length >= 1 && result.colors.length <= 3);
    for (const color of result.colors) {
      assert.match(color.hex, /^#[0-9a-f]{6}$/i);
      assert.equal(color.rgb.length, 3);
      assert.ok(color.share > 0 && color.share <= 1);
    }
  });

  it("idPhotos", async () => {
    const documents = await photos.idPhotos();
    const passport = documents.find((document) => document.name === "us-passport");
    assert.ok(passport?.title && passport.width_mm > 0 && passport.head_max_mm > 0);
    assert.ok(Array.isArray(passport.sources) && Array.isArray(passport.notes));
    assert.equal(typeof passport.background, "string");
  });

  it("run with a recipe and with a preset", async () => {
    const recipe = '[output]\nformat = "png"\nmax_side = 32\n';
    const result = await photos.run(small, { recipe });
    assert.equal(result.contentType, "image/png");
    assert.equal(result.width, 32);
    const web = await photos.run(new Blob([small]), { preset: "web" });
    assert.equal(web.contentType, "image/webp");
    assert.equal(web.width, 96);
  });

  it("check and readBarcodes", async () => {
    const result = await photos.check(small);
    assert.equal(result.metrics.width, 96);
    assert.equal(result.metrics.height, 64);
    assert.ok(Array.isArray(result.findings));
    assert.equal(result.marketplace, undefined);
    const scan = await photos.readBarcodes(small, { allFormats: true, engine: "auto" });
    assert.deepEqual(scan.barcodes, []);
    assert.equal(typeof scan.variant, "string");
  });

  it("errors", async () => {
    const wrongKey = new Photos({ apiKey: "wrong-key", baseUrl });
    await assert.rejects(wrongKey.account(), (error) => {
      assert.ok(error instanceof UnauthorizedError);
      assert.equal(error.status, 401);
      assert.equal(error.code, "unauthorized");
      return true;
    });
    await assert.rejects(photos.resize(small, { fit: "sideways" }), BadRequestError);
    await assert.rejects(photos.resize(new Uint8Array([1, 2, 3, 4])), (error) => {
      assert.ok(error instanceof ApiError);
      assert.ok(error.status >= 400 && error.status < 500);
      return true;
    });
    // The rect reaches the engine intact (and is refused: no area).
    await assert.rejects(photos.erase(small, { rects: [[1, 2, 0, 0]] }), (error) => {
      assert.ok(error instanceof BadRequestError);
      assert.match(error.message, /1,2,0,0/);
      return true;
    });
    await assert.rejects(photos.jobs.get("job_00000000000000000000000000000000"), NotFoundError);
    // No catalogue on the test engine: an API error, whichever it is.
    const once = new Photos({ apiKey: apiKey ?? "-", baseUrl, maxRetries: 0 });
    await assert.rejects(once.identify(small), ApiError);
  });

  it("jobs: uploads, wait, results, a signed webhook, delete", async (t) => {
    const deliveries: Array<{ body: Buffer; signature: string | undefined; event: unknown }> = [];
    const hook = await startServer((request) => {
      deliveries.push({
        body: request.body,
        signature: request.headers["photos-signature"] as string | undefined,
        event: request.headers["photos-event"],
      });
      return { status: 204 };
    });
    t.after(() => hook.close());

    const created = await photos.jobs.create({
      operation: "resize",
      params: { width: 16, format: "png" },
      images: [new File([small], "first.png"), photo(64, 64)],
      webhookUrl: `${hook.url}/hook`,
    });
    t.after(() => photos.jobs.delete(created.id).catch(() => undefined));
    assert.match(created.id, /^job_/);
    assert.equal(created.operation, "resize");
    assert.equal(created.params, "width=16&format=png");
    assert.equal(created.counts.total, 2);
    assert.equal(created.items[0]?.input, "first.png");

    const done = await photos.jobs.wait(created.id, { pollInterval: 200, timeout: 60_000 });
    assert.equal(done.status, "completed");
    assert.deepEqual(done.counts, { total: 2, done: 2, failed: 0, pending: 0 });
    assert.equal(done.items[0]?.content_type, "image/png");

    const item = await photos.jobs.result(created.id, 1);
    assert.equal(item.isImage, true);
    const image = item.image();
    assert.deepEqual([image.width, image.height], [16, 16]);
    assert.deepEqual([...image.bytes.subarray(0, 4)], PNG_MAGIC);
    await assert.rejects(photos.jobs.result(created.id, 7), NotFoundError);

    const listed = await photos.jobs.list();
    assert.ok(listed.some((summary) => summary.id === created.id));

    for (let i = 0; deliveries.length === 0 && i < 100; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const delivery = deliveries[0];
    assert.ok(delivery, "the webhook was delivered");
    const { secret } = await photos.webhookSecret();
    const event = await verifyWebhook(delivery.body, delivery.signature, secret);
    assert.equal(event.type, "job.completed");
    assert.equal(event.job.id, created.id);
    assert.equal(event.job.status, "completed");
    await assert.rejects(verifyWebhook(delivery.body, delivery.signature, `${secret}x`));

    await photos.jobs.delete(created.id);
    await assert.rejects(photos.jobs.get(created.id), NotFoundError);
  });

  it("jobs: URLs, params as an object, JSON results", async (t) => {
    const files = await startServer(() => ({
      headers: { "content-type": "image/png" },
      body: small,
    }));
    t.after(() => files.close());
    const created = await photos.jobs.create({
      operation: "check",
      params: { subject: false },
      urls: [`${files.url}/a.png`],
    });
    t.after(() => photos.jobs.delete(created.id).catch(() => undefined));
    assert.equal(created.params, "subject=false");
    const done = await photos.jobs.wait(created.id, { pollInterval: 200, timeout: 60_000 });
    assert.equal(done.counts.done, 1, JSON.stringify(done.items));
    const item = await photos.jobs.result(created.id, 0);
    assert.equal(item.isJson, true);
    assert.equal(item.json<CheckResult>().metrics.width, 96);
  });

  it("jobs: fix and remove-text results carry the verdict and the counts", async (t) => {
    const fixJob = await photos.jobs.create({
      operation: "fix",
      params: { marketplace: "etsy" },
      images: [small],
    });
    t.after(() => photos.jobs.delete(fixJob.id).catch(() => undefined));
    const textJob = await photos.jobs.create({
      operation: "remove-text",
      params: { region: "all" },
      images: [small],
    });
    t.after(() => photos.jobs.delete(textJob.id).catch(() => undefined));

    const fixDone = await photos.jobs.wait(fixJob.id, { pollInterval: 500, timeout: 300_000 });
    assert.equal(fixDone.counts.done, 1, JSON.stringify(fixDone.items));
    const fixItem = await photos.jobs.result(fixJob.id, 0);
    if (!fixItem.headers.has("x-marketplace-passed")) {
      assert.throws(() => fixItem.fix(), PhotosError);
      t.skip("this engine does not keep x-marketplace-* and x-text-* on job results");
      return;
    }
    const fixed = fixItem.fix();
    assert.equal(typeof fixed.passed, "boolean");
    for (const code of fixed.findings) assert.match(code, /^[a-z_]+$/);
    assert.ok(fixed.width > 0 && fixed.height > 0);
    assert.equal(fixDone.items[0]?.headers?.["x-marketplace-passed"], String(fixed.passed));
    assert.equal(
      fixDone.items[0]?.headers?.["x-marketplace-findings"] ?? "",
      fixed.findings.join(","),
    );
    assert.throws(() => fixItem.removeText(), PhotosError);

    const textDone = await photos.jobs.wait(textJob.id, { pollInterval: 500, timeout: 300_000 });
    assert.equal(textDone.counts.done, 1, JSON.stringify(textDone.items));
    const cleaned = (await photos.jobs.result(textJob.id, 0)).removeText();
    assert.ok(Number.isInteger(cleaned.removed) && cleaned.removed >= 0);
    assert.ok(Number.isInteger(cleaned.kept) && cleaned.kept >= 0);
    assert.deepEqual([cleaned.width, cleaned.height], [96, 64]);
    assert.equal(textDone.items[0]?.headers?.["x-text-removed"], String(cleaned.removed));
  });

  it("jobs: a vectorize result carries its paths", async (t) => {
    const created = await photos.jobs.create({
      operation: "vectorize",
      params: { mode: "mono" },
      images: [small],
    });
    t.after(() => photos.jobs.delete(created.id).catch(() => undefined));
    const done = await photos.jobs.wait(created.id, { pollInterval: 200, timeout: 60_000 });
    assert.equal(done.counts.done, 1, JSON.stringify(done.items));
    assert.equal(done.items[0]?.content_type, "image/svg+xml");
    const svg = (await photos.jobs.result(created.id, 0)).vectorize();
    assert.match(svg.text(), /<svg[\s>]/);
    assert.ok(svg.paths >= 1);
    assert.equal(done.items[0]?.headers?.["x-paths"], String(svg.paths));
  });

  it("jobs: a select job takes several points, from URLs too", async (t) => {
    const files = await startServer(() => ({
      headers: { "content-type": "image/png" },
      body: small,
    }));
    t.after(() => files.close());
    // Two points repeat `point`, which goes as a query string in the JSON body.
    const created = await photos.jobs.create({
      operation: "select",
      params: {
        points: [
          [48, 32],
          [52, 30],
        ],
        exclude: [[2, 2]],
      },
      urls: [`${files.url}/a.png`],
    });
    t.after(() => photos.jobs.delete(created.id).catch(() => undefined));
    assert.equal(created.params, "point=48%2C32&point=52%2C30&exclude=2%2C2");
    const done = await photos.jobs.wait(created.id, { pollInterval: 500, timeout: 300_000 });
    assert.equal(done.counts.done, 1, JSON.stringify(done.items));
    const selected = (await photos.jobs.result(created.id, 0)).select();
    assert.deepEqual([selected.width, selected.height], [96, 64]);
    assert.equal(typeof selected.score, "number");
  });

  // --- the calls below use the model worker: one tiny image each -------------

  it("removeBackground", async () => {
    const result = await photos.removeBackground(small, { crop: false });
    assert.equal(result.contentType, "image/png");
    assert.deepEqual([result.width, result.height], [96, 64]);
    assert.deepEqual([...result.bytes.subarray(0, 4)], PNG_MAGIC);
    assert.equal(result.blob().type, "image/png");
  });

  it("removeBackground staged on a canvas, with an image behind", async () => {
    const result = await photos.removeBackground(small, {
      width: 80,
      height: 60,
      fill: 0.8,
      align: "bottom",
      shadow: "contact",
      backgroundImage: png(8, 8, () => [200, 220, 240]),
      format: "png",
    });
    assert.deepEqual([result.width, result.height], [80, 60]);
    // The header is only sent when there is something to say.
    const header = result.headers.get("x-subject-found");
    assert.equal(result.subjectFound, header === null ? undefined : header === "true");
  });

  it("upscale", async () => {
    const result = await photos.upscale(photo(24, 16), { scale: 2, format: "png" });
    assert.deepEqual([result.width, result.height], [48, 32]);
  });

  it("erase with a mask and a rect", async () => {
    const mask = png(96, 64, (x, y) => (x < 8 && y < 8 ? [255, 255, 255] : [0, 0, 0]));
    const result = await photos.erase(small, {
      mask,
      rects: [{ x: 80, y: 50, width: 8, height: 8 }],
    });
    assert.deepEqual([result.width, result.height], [96, 64]);
    assert.equal(result.contentType, "image/png");
  });

  it("removeText", async () => {
    const result = await photos.removeText(small, { region: "all" });
    assert.deepEqual([result.width, result.height], [96, 64]);
    assert.equal(result.headers.has("x-text-removed"), true);
    assert.ok(Number.isInteger(result.removed) && result.removed >= 0);
    assert.ok(Number.isInteger(result.kept) && result.kept >= 0);
  });

  it("fix", async () => {
    const result = await photos.fix(small, { marketplace: "ebay" });
    assert.ok(result.width > 0 && result.height > 0);
    assert.equal(result.headers.has("x-marketplace-passed"), true);
    assert.equal(typeof result.passed, "boolean");
    assert.ok(Array.isArray(result.findings));
    for (const code of result.findings) assert.match(code, /^[a-z_]+$/);
    assert.match(result.contentType, /^image\//);
  });

  it("crop", async () => {
    const result = await photos.crop(small, { aspect: "1:1" });
    assert.deepEqual([result.width, result.height], [64, 64]);
    assert.equal(result.headers.has("x-subject-found"), true);
    assert.equal(typeof result.subjectFound, "boolean");
  });

  it("findFaces and blurFaces", async () => {
    const found = await photos.findFaces(small, { minScore: 0.6 });
    assert.deepEqual([found.width, found.height], [96, 64]);
    assert.ok(Array.isArray(found.faces));
    const result = await photos.blurFaces(small, { mode: "fill", color: "black" });
    assert.deepEqual([result.width, result.height], [96, 64]);
    assert.equal(result.headers.has("x-faces"), true);
    assert.equal(result.faces, found.faces.length);
  });

  it("idPhoto refuses a photo without a face", async () => {
    await assert.rejects(photos.idPhoto(small, { document: "us-passport" }), (error) => {
      assert.ok(error instanceof UnprocessableError);
      assert.equal(error.status, 422);
      return true;
    });
  });

  it("denoise", async () => {
    const result = await photos.denoise(small, { strength: 50 });
    assert.deepEqual([result.width, result.height], [96, 64]);
  });

  it("colorize", async () => {
    const result = await photos.colorize(small, { strength: 80 });
    assert.deepEqual([result.width, result.height], [96, 64]);
  });

  it("select", async () => {
    const result = await photos.select(small, { points: [[48, 32]], exclude: [[2, 2]] });
    assert.equal(result.contentType, "image/png");
    assert.deepEqual([result.width, result.height], [96, 64]);
    assert.equal(result.headers.has("x-select-score"), true);
    assert.ok(result.score !== undefined && result.score >= 0 && result.score <= 1);
  });

  it("restoreFaces", async () => {
    const result = await photos.restoreFaces(small);
    assert.deepEqual([result.width, result.height], [96, 64]);
    assert.equal(result.headers.has("x-faces"), true);
    assert.equal(result.headers.has("x-faces-skipped"), true);
    assert.ok(Number.isInteger(result.faces) && Number.isInteger(result.facesSkipped));
  });

  it("caption", async () => {
    const result = await photos.caption(small, { detail: "short" });
    assert.ok(result.caption.length > 0);
    assert.equal(result.detail, "short");
    assert.deepEqual([result.width, result.height], [96, 64]);
  });

  it("the face tools on a portrait", {
    skip: portrait ? false : "set PHOTOS_TEST_PORTRAIT to a photo of one face",
  }, async () => {
    const image = await readFile(portrait ?? "");
    const { faces } = await photos.findFaces(image);
    assert.equal(faces.length, 1);
    const face = faces[0];
    assert.ok(face && face.score >= 0.6 && face.box.width > 0);
    // The person's right eye is on the left of the photo.
    assert.ok(face.landmarks.right_eye[0] < face.landmarks.left_eye[0]);

    const blurred = await photos.blurFaces(image, { mode: "pixelate" });
    assert.equal(blurred.faces, 1);

    const framed = await photos.idPhoto(image, {
      widthMm: 35,
      heightMm: 45,
      headMinMm: 32,
      headMaxMm: 36,
    });
    assert.equal(framed.headers.has("x-id-photo-passed"), true);
    assert.equal(framed.passed, framed.findings.length === 0);
    for (const code of framed.findings) assert.match(code, /^[a-z_]+$/);
    assert.ok(framed.headMm !== undefined && framed.headMm >= 32 && framed.headMm <= 36);
    // 35 x 45 mm at 300 pixels per inch.
    assert.ok(Math.abs(framed.width - 413) <= 1 && Math.abs(framed.height - 531) <= 1);

    const restored = await photos.restoreFaces(image);
    assert.equal(restored.faces + restored.facesSkipped, 1);
  });

  it("readText and readLabel", async () => {
    const text = await photos.readText(small);
    assert.ok(Array.isArray(text.lines));
    const label = await photos.readLabel([small, photo(64, 64)]);
    assert.equal(typeof label.label, "object");
    assert.ok(Array.isArray(label.barcodes));
    assert.ok(Array.isArray(label.text));
  });
});
