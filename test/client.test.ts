import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ApiError,
  BlurFacesResult,
  CropResult,
  FixResult,
  IdPhotoResult,
  ImageResult,
  NotFoundError,
  Photos,
  PhotosError,
  RemoveBackgroundResult,
  RemoveTextResult,
  RestoreFacesResult,
  SelectResult,
  VERSION,
  VectorizeResult,
} from "../src/index.js";
import { fixture, IMAGE, imageReply, only } from "./helpers.js";

/** Runs `fn` with environment variables set (undefined = unset), then restores them. */
async function withEnv(vars: Record<string, string | undefined>, fn: () => unknown) {
  const before = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]));
  const apply = (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  apply(vars);
  try {
    await fn();
  } finally {
    apply(before);
  }
}

describe("constructor", () => {
  it("needs an API key", async () => {
    await withEnv({ PHOTOS_API_KEY: undefined }, () => {
      assert.throws(() => new Photos(), PhotosError);
      assert.throws(() => new Photos({ apiKey: "" }), /PHOTOS_API_KEY/);
    });
  });

  it("defaults to https://api.photos.sh", async () => {
    await withEnv({ PHOTOS_BASE_URL: undefined }, () => {
      assert.equal(new Photos({ apiKey: "k" }).baseUrl, "https://api.photos.sh");
    });
  });

  it("reads the key and base URL from the environment", async (t) => {
    const { server } = await fixture(t, () => ({ body: { account: "a" } }));
    await withEnv({ PHOTOS_API_KEY: "env-key", PHOTOS_BASE_URL: `${server.url}/` }, async () => {
      const photos = new Photos();
      assert.equal(photos.baseUrl, server.url);
      await photos.account();
    });
    assert.equal(only(server).headers.authorization, "Bearer env-key");
  });

  it("prefers arguments to the environment and tolerates a trailing slash", async (t) => {
    const { server } = await fixture(t, () => ({ body: {} }));
    await withEnv({ PHOTOS_API_KEY: "env-key", PHOTOS_BASE_URL: "http://127.0.0.1:1" }, () =>
      new Photos({ apiKey: "arg-key", baseUrl: `${server.url}//` }).account(),
    );
    const request = only(server);
    assert.equal(request.path, "/v1/account");
    assert.equal(request.headers.authorization, "Bearer arg-key");
  });

  it("sends the library's User-Agent, which matches package.json", async (t) => {
    const { photos, server } = await fixture(t, () => ({ body: {} }));
    await photos.account();
    assert.equal(only(server).headers["user-agent"], `photos-sh-js/${VERSION}`);
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    assert.equal(VERSION, manifest.version);
  });

  it("uses an injected fetch", async () => {
    const calls: string[] = [];
    const photos = new Photos({
      apiKey: "k",
      baseUrl: "http://example.invalid/api/",
      fetch: async (input, init) => {
        calls.push(`${init?.method} ${String(input)}`);
        return new Response('[{"name":"web","description":"d"}]');
      },
    });
    assert.deepEqual(await photos.presets(), [{ name: "web", description: "d" }]);
    assert.deepEqual(calls, ["GET http://example.invalid/api/v1/presets"]);
  });
});

describe("image methods", () => {
  it("removeBackground sends the image as multipart and options as snake_case query", async (t) => {
    const { photos, server } = await fixture(t, () => imageReply());
    const result = await photos.removeBackground(IMAGE, {
      format: "png",
      background: "#ffffff",
      crop: true,
      padding: 12,
      mask: false,
      quality: undefined,
    });
    const request = only(server);
    assert.equal(request.method, "POST");
    assert.equal(request.path, "/v1/remove-background");
    assert.equal(
      request.query.toString(),
      "format=png&background=%23ffffff&crop=true&padding=12&mask=false",
    );
    assert.match(request.headers["content-type"] ?? "", /^multipart\/form-data; boundary=/);
    assert.equal(request.parts.length, 1);
    assert.equal(request.parts[0]?.name, "image");
    assert.equal(request.parts[0]?.filename, "image");
    assert.deepEqual(new Uint8Array(request.parts[0]?.data ?? []), IMAGE);

    assert.ok(result instanceof ImageResult);
    assert.deepEqual(result.bytes, new Uint8Array([9, 8, 7]));
    assert.equal(result.contentType, "image/png");
    assert.equal(result.width, 640);
    assert.equal(result.height, 480);
    assert.equal(result.quality, undefined);
    assert.equal(result.serverTiming, "decode;dur=1.0, encode;dur=2.5");
    assert.equal(result.headers.get("x-image-width"), "640");
  });

  it("resize maps maxBytes to max_bytes and reads the quality", async (t) => {
    const { photos, server } = await fixture(t, () =>
      imageReply({ "content-type": "image/jpeg", "x-image-quality": "72" }),
    );
    const result = await photos.resize(IMAGE, {
      width: 800,
      height: 600,
      fit: "cover",
      enlarge: true,
      format: "jpg",
      quality: 80,
      maxBytes: 200_000,
      background: "white",
      timeout: 5000,
    });
    assert.equal(only(server).path, "/v1/resize");
    assert.equal(
      only(server).query.toString(),
      "width=800&height=600&fit=cover&enlarge=true&format=jpg&quality=80&max_bytes=200000&background=white",
    );
    assert.equal(result.quality, 72);
    assert.equal(result.contentType, "image/jpeg");
    const blob = result.blob();
    assert.equal(blob.type, "image/jpeg");
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), result.bytes);
  });

  it("sends no query string when no option is set", async (t) => {
    const { photos, server } = await fixture(t, () => imageReply());
    await photos.resize(IMAGE);
    assert.equal(only(server).query.toString(), "");
  });

  it("save writes the image to a file", async (t) => {
    const { photos } = await fixture(t, () => imageReply());
    const result = await photos.upscale(IMAGE);
    const path = join(await mkdtemp(join(tmpdir(), "photos-js-")), "out.png");
    await result.save(path);
    assert.deepEqual(new Uint8Array(await readFile(path)), result.bytes);
  });

  it("upscale", async (t) => {
    const { photos, server } = await fixture(t, () => imageReply());
    await photos.upscale(IMAGE, { scale: 2, format: "webp", quality: 90 });
    assert.equal(only(server).path, "/v1/upscale");
    assert.equal(only(server).query.toString(), "scale=2&format=webp&quality=90");
  });

  it("erase repeats rect and sends the mask part", async (t) => {
    const { photos, server } = await fixture(t, () => imageReply());
    const mask = new Uint8Array([1, 1, 2, 3]);
    await photos.erase(IMAGE, {
      rects: [[1, 2, 30, 40], { x: 5, y: 6, width: 70, height: 80 }],
      mask,
      format: "png",
    });
    const request = only(server);
    assert.equal(request.path, "/v1/erase");
    assert.deepEqual(request.query.getAll("rect"), ["1,2,30,40", "5,6,70,80"]);
    assert.equal(request.query.get("format"), "png");
    assert.deepEqual([...request.query.keys()], ["rect", "rect", "format"]);
    assert.deepEqual(
      request.parts.map((part) => [part.name, part.filename]),
      [
        ["image", "image"],
        ["mask", "mask"],
      ],
    );
    assert.deepEqual(new Uint8Array(request.parts[1]?.data ?? []), mask);
  });

  it("removeText returns the removed and kept counts", async (t) => {
    const { photos, server } = await fixture(t, () =>
      imageReply({ "x-text-removed": "3", "x-text-kept": "1" }),
    );
    const result = await photos.removeText(IMAGE, { region: "all", matching: "sale|€" });
    assert.equal(only(server).path, "/v1/remove-text");
    assert.equal(only(server).query.get("region"), "all");
    assert.equal(only(server).query.get("matching"), "sale|€");
    assert.ok(result instanceof RemoveTextResult);
    assert.equal(result.removed, 3);
    assert.equal(result.kept, 1);
    assert.equal(result.width, 640);
  });

  it("run with a preset", async (t) => {
    const { photos, server } = await fixture(t, () => imageReply());
    await photos.run(IMAGE, { preset: "marketplace" });
    const request = only(server);
    assert.equal(request.path, "/v1/run");
    assert.equal(request.query.toString(), "preset=marketplace");
    assert.deepEqual(
      request.parts.map((part) => part.name),
      ["image"],
    );
  });

  it("run with a recipe sends it as a part", async (t) => {
    const { photos, server } = await fixture(t, () => imageReply());
    const recipe = '[[step]]\nop = "resize"\nwidth = 100\n';
    await photos.run(IMAGE, { recipe });
    const request = only(server);
    assert.equal(request.query.toString(), "");
    assert.deepEqual(
      request.parts.map((part) => part.name),
      ["image", "recipe"],
    );
    assert.equal(request.parts[1]?.data.toString("utf8"), recipe);
  });

  it("run reads what a recipe's [barcodes] and [text] steps found", async (t) => {
    const barcodes = [
      { format: "EAN-13", value: "3850104010017", gs1: "3850104010017" },
      { format: "QR", value: "https://example.com", gs1: null },
    ];
    const { photos } = await fixture(t, () =>
      imageReply({
        "x-barcodes": JSON.stringify(barcodes),
        // As the engine sends it: every non-ASCII character escaped.
        "x-text": '["Pr\\u0161ut","500 g","\\ud83d\\udce6"]',
        "x-text-truncated": "true",
      }),
    );
    const result = await photos.run(IMAGE, { recipe: "[barcodes]\n\n[text]\n" });
    assert.deepEqual(result.barcodes, barcodes);
    assert.deepEqual(result.textLines, ["Pršut", "500 g", "\u{1F4E6}"]);
    assert.equal(result.textTruncated, true);
    assert.equal(result.width, 640);
  });

  it("run gives null for a reading step not in the recipe, and [] for one that found nothing", async (t) => {
    const { photos } = await fixture(t, (_request, n) =>
      n === 1 ? imageReply() : imageReply({ "x-barcodes": "[]", "x-text": "[]" }),
    );
    const none = await photos.run(IMAGE, { preset: "marketplace" });
    assert.deepEqual([none.barcodes, none.textLines, none.textTruncated], [null, null, false]);
    const empty = await photos.run(IMAGE, { recipe: "[barcodes]\nall_formats = true\n\n[text]\n" });
    assert.deepEqual([empty.barcodes, empty.textLines, empty.textTruncated], [[], [], false]);
  });

  it("run treats an X-Barcodes or X-Text that is not the expected JSON as missing", async (t) => {
    const replies = [
      { "x-barcodes": "not json", "x-text": '["unclosed' },
      { "x-barcodes": '{"format":"EAN-13"}', "x-text": '"one line"' },
      { "x-barcodes": '[{"format":"EAN-13"}]', "x-text": '["a",1]' },
      { "x-barcodes": '[{"format":"EAN-13","value":"1","gs1":5}]', "x-text": "null" },
    ];
    const { photos } = await fixture(t, (_request, n) => imageReply(replies[n - 1]));
    for (const _ of replies) {
      const result = await photos.run(IMAGE, { preset: "marketplace" });
      assert.deepEqual([result.barcodes, result.textLines], [null, null]);
    }
  });

  it("other image methods read the headers too", async (t) => {
    const { photos } = await fixture(t, () =>
      imageReply({ "x-barcodes": '[{"format":"EAN-8","value":"96385074"}]', "x-text": '["A"]' }),
    );
    const result = await photos.removeBackground(IMAGE);
    assert.deepEqual(result.barcodes, [{ format: "EAN-8", value: "96385074" }]);
    assert.deepEqual(result.textLines, ["A"]);
  });

  it("fix returns the verdict", async (t) => {
    const { photos, server } = await fixture(t, () =>
      imageReply({
        "x-marketplace-passed": "false",
        "x-marketplace-findings": "too_small,background_not_white",
      }),
    );
    const result = await photos.fix(IMAGE, { marketplace: "amazon" });
    assert.equal(only(server).path, "/v1/fix");
    assert.equal(only(server).query.toString(), "marketplace=amazon");
    assert.ok(result instanceof FixResult);
    assert.equal(result.passed, false);
    assert.deepEqual(result.findings, ["too_small", "background_not_white"]);
  });

  it("fix with an empty findings header gives an empty list", async (t) => {
    const { photos } = await fixture(t, () =>
      imageReply({ "x-marketplace-passed": "true", "x-marketplace-findings": "" }),
    );
    const result = await photos.fix(IMAGE, { marketplace: "ebay" });
    assert.equal(result.passed, true);
    assert.deepEqual(result.findings, []);
  });

  it("removeBackground stages the cutout and sends backgroundImage as the background part", async (t) => {
    const { photos, server } = await fixture(t, () => imageReply());
    const backdrop = new Uint8Array([7, 7, 7]);
    const result = await photos.removeBackground(IMAGE, {
      width: 800,
      height: 600,
      fill: 0.8,
      align: "bottom",
      shadow: "contact",
      reflection: true,
      backgroundImage: backdrop,
    });
    const request = only(server);
    assert.equal(request.path, "/v1/remove-background");
    assert.equal(
      request.query.toString(),
      "width=800&height=600&fill=0.8&align=bottom&shadow=contact&reflection=true",
    );
    assert.deepEqual(
      request.parts.map((part) => [part.name, part.filename]),
      [
        ["image", "image"],
        ["background", "background"],
      ],
    );
    assert.deepEqual(new Uint8Array(request.parts[1]?.data ?? []), backdrop);
    assert.ok(result instanceof RemoveBackgroundResult);
    // No X-Subject-Found: unknown, not false.
    assert.equal(result.subjectFound, undefined);
  });

  it("removeBackground sends blur and reads X-Subject-Found", async (t) => {
    const { photos, server } = await fixture(t, (_request, n) =>
      imageReply({ "x-subject-found": n === 1 ? "false" : "true" }),
    );
    const empty = await photos.removeBackground(IMAGE, { blur: 40, width: 500, height: 500 });
    assert.equal(server.requests[0]?.query.toString(), "blur=40&width=500&height=500");
    assert.deepEqual(
      server.requests[0]?.parts.map((part) => part.name),
      ["image"],
    );
    assert.equal(empty.subjectFound, false);
    assert.equal((await photos.removeBackground(IMAGE)).subjectFound, true);
  });

  it("removeBackground sends studio, and leaves it out when not set", async (t) => {
    const { photos, server } = await fixture(t, () => imageReply());
    await photos.removeBackground(IMAGE, { studio: true, crop: true });
    await photos.removeBackground(IMAGE, { studio: undefined });
    assert.equal(server.requests[0]?.query.toString(), "studio=true&crop=true");
    assert.equal(server.requests[1]?.query.toString(), "");
  });

  it("resize maps trimTolerance to trim_tolerance and sends dpi", async (t) => {
    const { photos, server } = await fixture(t, () => imageReply());
    await photos.resize(IMAGE, { trim: true, trimTolerance: 20, dpi: 300 });
    assert.equal(only(server).path, "/v1/resize");
    assert.equal(only(server).query.toString(), "trim=true&trim_tolerance=20&dpi=300");
  });

  it("enhance maps whiteBalance to white_balance", async (t) => {
    const { photos, server } = await fixture(t, () => imageReply());
    const result = await photos.enhance(IMAGE, {
      auto: true,
      levels: false,
      whiteBalance: true,
      brightness: 10,
      contrast: -5,
      saturation: 20,
      temperature: -10,
      sharpen: 30,
      format: "jpg",
      quality: 90,
    });
    const request = only(server);
    assert.equal(request.method, "POST");
    assert.equal(request.path, "/v1/enhance");
    assert.equal(
      request.query.toString(),
      "auto=true&levels=false&white_balance=true&brightness=10&contrast=-5&saturation=20&temperature=-10&sharpen=30&format=jpg&quality=90",
    );
    assert.deepEqual(
      request.parts.map((part) => [part.name, part.filename]),
      [["image", "image"]],
    );
    assert.ok(result instanceof ImageResult);
    assert.equal(result.width, 640);
  });

  it("enhance without options sends no query string", async (t) => {
    const { photos, server } = await fixture(t, () => imageReply());
    await photos.enhance(IMAGE);
    assert.equal(only(server).query.toString(), "");
  });

  it("crop sends the shape and reads X-Subject-Found", async (t) => {
    const { photos, server } = await fixture(t, (_request, n) =>
      imageReply(n === 3 ? {} : { "x-subject-found": n === 1 ? "true" : "false" }),
    );
    const found = await photos.crop(IMAGE, {
      aspect: "4:5",
      width: 800,
      height: 1000,
      zoom: true,
      padding: 0.6,
      focus: "face",
      format: "webp",
      quality: 80,
    });
    const first = server.requests[0];
    assert.equal(first?.path, "/v1/crop");
    assert.equal(
      first?.query.toString(),
      "aspect=4%3A5&width=800&height=1000&zoom=true&padding=0.6&focus=face&format=webp&quality=80",
    );
    assert.deepEqual(
      first?.parts.map((part) => part.name),
      ["image"],
    );
    assert.ok(found instanceof CropResult);
    assert.equal(found.subjectFound, true);
    assert.equal(found.height, 480);

    const centred = await photos.crop(IMAGE, { aspect: 1.5 });
    assert.equal(server.requests[1]?.query.toString(), "aspect=1.5");
    assert.equal(centred.subjectFound, false);
    // Without the header: unknown, not false.
    assert.equal((await photos.crop(IMAGE, { aspect: "1:1" })).subjectFound, undefined);
  });

  it("watermark with text sends only the image part", async (t) => {
    const { photos, server } = await fixture(t, () => imageReply());
    const result = await photos.watermark(IMAGE, {
      text: "© Shop & Co",
      color: "#ffffff",
      position: "bottom-right",
      scale: 30,
      opacity: 40,
      margin: 5,
      tile: false,
      format: "jpg",
      quality: 85,
    });
    const request = only(server);
    assert.equal(request.path, "/v1/watermark");
    assert.equal(request.query.get("text"), "© Shop & Co");
    assert.deepEqual(
      [...request.query.keys()],
      ["text", "color", "position", "scale", "opacity", "margin", "tile", "format", "quality"],
    );
    assert.equal(
      request.query.toString().replace(/^text=[^&]*&/, ""),
      "color=%23ffffff&position=bottom-right&scale=30&opacity=40&margin=5&tile=false&format=jpg&quality=85",
    );
    assert.deepEqual(
      request.parts.map((part) => part.name),
      ["image"],
    );
    assert.ok(result instanceof ImageResult);
  });

  it("watermark sends a logo as the watermark part", async (t) => {
    const { photos, server } = await fixture(t, () => imageReply());
    const logo = new File([new Uint8Array([4, 5, 6, 7, 8])], "logo.png");
    await photos.watermark(IMAGE, { watermark: logo, tile: true, opacity: 20 });
    const request = only(server);
    assert.equal(request.query.toString(), "tile=true&opacity=20");
    assert.deepEqual(
      request.parts.map((part) => [part.name, part.filename, part.data.length]),
      [
        ["image", "image", IMAGE.length],
        ["watermark", "logo.png", 5],
      ],
    );
    assert.deepEqual([...(request.parts[1]?.data ?? [])], [4, 5, 6, 7, 8]);
  });

  it("expand to a shape, or by pixels on each side", async (t) => {
    const { photos, server } = await fixture(t, () => imageReply());
    await photos.expand(IMAGE, { aspect: "16:9", fill: "inpaint", format: "png" });
    await photos.expand(IMAGE, { left: 10, right: 20, top: 0, bottom: 5, fill: "#f0f0f0" });
    assert.equal(server.requests[0]?.path, "/v1/expand");
    assert.equal(server.requests[0]?.query.toString(), "aspect=16%3A9&fill=inpaint&format=png");
    assert.equal(
      server.requests[1]?.query.toString(),
      "left=10&right=20&top=0&bottom=5&fill=%23f0f0f0",
    );
    assert.deepEqual(
      server.requests[1]?.parts.map((part) => part.name),
      ["image"],
    );
  });

  it("vectorize returns the SVG with its paths", async (t) => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M0 0"/></svg>';
    const { photos, server } = await fixture(t, (_request, n) => ({
      headers: {
        "content-type": "image/svg+xml",
        "x-image-width": "64",
        "x-image-height": "64",
        ...(n === 1 ? { "x-paths": "23" } : {}),
      },
      body: svg,
    }));
    const result = await photos.vectorize(IMAGE, {
      mode: "mono",
      curves: "polygon",
      detail: 6,
      speckle: 8,
    });
    const request = server.requests[0];
    assert.equal(request?.path, "/v1/vectorize");
    assert.equal(request?.query.toString(), "mode=mono&curves=polygon&detail=6&speckle=8");
    assert.deepEqual(
      request?.parts.map((part) => part.name),
      ["image"],
    );
    assert.ok(result instanceof VectorizeResult);
    assert.ok(result instanceof ImageResult);
    assert.equal(result.contentType, "image/svg+xml");
    assert.equal(result.paths, 23);
    assert.equal(result.text(), svg);
    assert.deepEqual([result.width, result.height, result.quality], [64, 64, undefined]);
    assert.equal(result.blob().type, "image/svg+xml");
    const path = join(await mkdtemp(join(tmpdir(), "photos-js-")), "logo.svg");
    await result.save(path);
    assert.equal(await readFile(path, "utf8"), svg);

    const bare = await photos.vectorize(IMAGE);
    assert.equal(server.requests[1]?.query.toString(), "");
    assert.equal(bare.paths, 0);
  });

  it("blurFaces maps minScore to min_score and returns the count", async (t) => {
    const { photos, server } = await fixture(t, (_request, n) =>
      imageReply(n === 1 ? { "x-faces": "2" } : {}),
    );
    const result = await photos.blurFaces(IMAGE, {
      mode: "fill",
      strength: 80,
      padding: 0.2,
      color: "black",
      minScore: 0.5,
      format: "jpg",
    });
    const request = server.requests[0];
    assert.equal(request?.path, "/v1/blur-faces");
    assert.equal(
      request?.query.toString(),
      "mode=fill&strength=80&padding=0.2&color=black&min_score=0.5&format=jpg",
    );
    assert.deepEqual(
      request?.parts.map((part) => part.name),
      ["image"],
    );
    assert.ok(result instanceof BlurFacesResult);
    assert.equal(result.faces, 2);
    assert.equal((await photos.blurFaces(IMAGE)).faces, 0);
    assert.equal(server.requests[1]?.query.toString(), "");
  });

  it("idPhoto with a document returns the findings and the head's size", async (t) => {
    const { photos, server } = await fixture(t, () =>
      imageReply({
        "content-type": "image/jpeg",
        "x-id-photo-passed": "false",
        "x-id-photo-findings": "low_resolution,background_not_plain",
        "x-id-photo-head-mm": "34.1",
      }),
    );
    const result = await photos.idPhoto(IMAGE, {
      document: "us-passport",
      dpi: 600,
      background: "document",
      format: "jpg",
      quality: 95,
    });
    const request = only(server);
    assert.equal(request.path, "/v1/id-photo");
    assert.equal(
      request.query.toString(),
      "document=us-passport&dpi=600&background=document&format=jpg&quality=95",
    );
    assert.deepEqual(
      request.parts.map((part) => part.name),
      ["image"],
    );
    assert.ok(result instanceof IdPhotoResult);
    assert.equal(result.passed, false);
    assert.deepEqual(result.findings, ["low_resolution", "background_not_plain"]);
    assert.equal(result.headMm, 34.1);
    assert.equal(result.contentType, "image/jpeg");
  });

  it("idPhoto sends the sizes in snake_case, and an empty findings header is an empty list", async (t) => {
    const { photos, server } = await fixture(t, () =>
      imageReply({
        "x-id-photo-passed": "true",
        "x-id-photo-findings": "",
        "x-id-photo-head-mm": "33.0",
      }),
    );
    const result = await photos.idPhoto(IMAGE, {
      widthMm: 35,
      heightMm: 45,
      headMinMm: 32,
      headMaxMm: 36,
      eyesMinMm: 28.5,
      eyesMaxMm: 34,
    });
    assert.equal(
      only(server).query.toString(),
      "width_mm=35&height_mm=45&head_min_mm=32&head_max_mm=36&eyes_min_mm=28.5&eyes_max_mm=34",
    );
    assert.equal(result.passed, true);
    assert.deepEqual(result.findings, []);
    assert.equal(result.headMm, 33);
  });

  it("idPhoto without its headers does not pass and has no head size", async (t) => {
    const { photos } = await fixture(t, () => imageReply());
    const result = await photos.idPhoto(IMAGE, { document: "uk-passport" });
    assert.equal(result.passed, false);
    assert.deepEqual(result.findings, []);
    assert.equal(result.headMm, undefined);
  });

  it("denoise and colorize", async (t) => {
    const { photos, server } = await fixture(t, () => imageReply());
    await photos.denoise(IMAGE, { strength: 50, format: "png" });
    await photos.colorize(IMAGE, { strength: 80, format: "jpg", quality: 90 });
    await photos.denoise(IMAGE);
    await photos.colorize(IMAGE);
    assert.deepEqual(
      server.requests.map((request) => `${request.method} ${request.path}?${request.query}`),
      [
        "POST /v1/denoise?strength=50&format=png",
        "POST /v1/colorize?strength=80&format=jpg&quality=90",
        "POST /v1/denoise?",
        "POST /v1/colorize?",
      ],
    );
    for (const request of server.requests) {
      assert.deepEqual(
        request.parts.map((part) => part.name),
        ["image"],
      );
    }
  });

  it("select repeats point and exclude, and sends the box as x,y,width,height", async (t) => {
    const { photos, server } = await fixture(t, (_request, n) =>
      imageReply(n === 1 ? { "x-select-score": "0.953" } : {}),
    );
    const result = await photos.select(IMAGE, {
      points: [[120, 80], { x: 140.5, y: 90 }],
      exclude: [[300, 40], { x: 310, y: 45 }],
      box: { x: 100, y: 60, width: 200, height: 150 },
      pick: "largest",
      mask: false,
      crop: true,
      padding: 8,
      background: "white",
      format: "png",
    });
    const request = server.requests[0];
    assert.equal(request?.path, "/v1/select");
    assert.deepEqual(request?.query.getAll("point"), ["120,80", "140.5,90"]);
    assert.deepEqual(request?.query.getAll("exclude"), ["300,40", "310,45"]);
    assert.deepEqual(request?.query.getAll("box"), ["100,60,200,150"]);
    assert.equal(
      request?.query.toString(),
      "point=120%2C80&point=140.5%2C90&exclude=300%2C40&exclude=310%2C45&box=100%2C60%2C200%2C150&pick=largest&mask=false&crop=true&padding=8&background=white&format=png",
    );
    assert.deepEqual(
      request?.parts.map((part) => part.name),
      ["image"],
    );
    assert.ok(result instanceof SelectResult);
    assert.equal(result.score, 0.953);

    const boxed = await photos.select(IMAGE, { box: [10, 20, 30, 40], mask: true });
    assert.equal(server.requests[1]?.query.toString(), "box=10%2C20%2C30%2C40&mask=true");
    assert.equal(boxed.score, undefined);
  });

  it("restoreFaces returns the faces restored and skipped", async (t) => {
    const { photos, server } = await fixture(t, (_request, n) =>
      imageReply(n === 1 ? { "x-faces": "2", "x-faces-skipped": "1" } : {}),
    );
    const result = await photos.restoreFaces(IMAGE, { strength: 70, minScore: 0.5, quality: 92 });
    assert.equal(server.requests[0]?.path, "/v1/restore-faces");
    assert.equal(server.requests[0]?.query.toString(), "strength=70&min_score=0.5&quality=92");
    assert.deepEqual(
      server.requests[0]?.parts.map((part) => part.name),
      ["image"],
    );
    assert.ok(result instanceof RestoreFacesResult);
    assert.deepEqual([result.faces, result.facesSkipped], [2, 1]);
    const bare = await photos.restoreFaces(IMAGE);
    assert.deepEqual([bare.faces, bare.facesSkipped], [0, 0]);
  });
});

describe("JSON methods", () => {
  it("check", async (t) => {
    const body = {
      metrics: { width: 10, height: 20, sharpness: 0.9 },
      findings: [{ code: "too_small", severity: "error", message: "m" }],
      marketplace: { marketplace: "amazon", passed: false, findings: [], not_checked: [] },
      added_later: 1,
    };
    const { photos, server } = await fixture(t, () => ({ body }));
    const result = await photos.check(IMAGE, { marketplace: "amazon", subject: true, text: false });
    assert.equal(only(server).path, "/v1/check");
    assert.equal(only(server).query.toString(), "marketplace=amazon&subject=true&text=false");
    assert.equal(only(server).parts[0]?.name, "image");
    assert.equal(result.findings[0]?.code, "too_small");
    assert.equal(result.marketplace?.passed, false);
    // Fields this version does not know are kept.
    assert.deepEqual(result, body);
  });

  it("readBarcodes maps allFormats to all_formats", async (t) => {
    const body = { barcodes: [{ format: "EAN-13", value: "4006381333931", gs1: "4006381333931" }] };
    const { photos, server } = await fixture(t, () => ({ body: { ...body, variant: "plain" } }));
    const result = await photos.readBarcodes(IMAGE, { allFormats: true, engine: "zbar" });
    assert.equal(only(server).path, "/v1/barcodes");
    assert.equal(only(server).query.toString(), "all_formats=true&engine=zbar");
    assert.equal(result.barcodes[0]?.value, "4006381333931");
    assert.equal(result.variant, "plain");
  });

  it("readText", async (t) => {
    const line = {
      text: "HELLO",
      score: 0.98,
      box: [
        [0, 0],
        [9, 0],
        [9, 9],
        [0, 9],
      ],
    };
    const { photos, server } = await fixture(t, () => ({ body: { lines: [line] } }));
    const result = await photos.readText(IMAGE);
    assert.equal(only(server).path, "/v1/ocr");
    assert.equal(only(server).query.toString(), "");
    assert.equal(result.lines[0]?.text, "HELLO");
  });

  it("readLabel sends every image as an image part", async (t) => {
    const { photos, server } = await fixture(t, () => ({
      body: { label: { gtin: "4006381333931" }, barcodes: [], text: ["a"] },
    }));
    const second = new Uint8Array([5, 5, 5]);
    const result = await photos.readLabel([IMAGE, second]);
    const request = only(server);
    assert.equal(request.path, "/v1/label");
    assert.deepEqual(
      request.parts.map((part) => [part.name, part.filename, part.data.length]),
      [
        ["image", "image-1", IMAGE.length],
        ["image", "image-2", 3],
      ],
    );
    assert.equal(result.label.gtin, "4006381333931");
  });

  it("readLabel and identify take a single image too", async (t) => {
    const { photos, server } = await fixture(t, () => ({
      body: { catalogue: "whisky", candidates: [], label: {}, barcodes: [] },
    }));
    const result = await photos.identify(IMAGE, { catalogue: "whisky", top: 3 });
    const request = only(server);
    assert.equal(request.path, "/v1/identify");
    assert.equal(request.query.toString(), "catalogue=whisky&top=3");
    assert.equal(request.parts.length, 1);
    assert.equal(result.catalogue, "whisky");
    await assert.rejects(photos.readLabel([]), PhotosError);
  });

  it("palette", async (t) => {
    const body = {
      width: 96,
      height: 64,
      colors: [
        { hex: "#c81018", rgb: [200, 16, 24], share: 0.62 },
        { hex: "#ffffff", rgb: [255, 255, 255], share: 0.38 },
      ],
      added_later: true,
    };
    const { photos, server } = await fixture(t, () => ({ body }));
    const result = await photos.palette(IMAGE, { colors: 2 });
    const request = only(server);
    assert.equal(request.method, "POST");
    assert.equal(request.path, "/v1/palette");
    assert.equal(request.query.toString(), "colors=2");
    assert.deepEqual(
      request.parts.map((part) => part.name),
      ["image"],
    );
    assert.equal(result.colors[0]?.hex, "#c81018");
    assert.deepEqual(result.colors[1]?.rgb, [255, 255, 255]);
    // Fields this version does not know are kept.
    assert.deepEqual(result, body);
  });

  it("findFaces maps minScore to min_score", async (t) => {
    const face = {
      box: { x: 180.5, y: 60, width: 150, height: 200 },
      landmarks: {
        right_eye: [220, 140],
        left_eye: [290, 138],
        nose: [256, 180],
        mouth_right: [228, 215],
        mouth_left: [284, 214],
      },
      score: 0.93,
      roll: -1.6,
    };
    const { photos, server } = await fixture(t, () => ({
      body: { width: 512, height: 512, faces: [face] },
    }));
    const result = await photos.findFaces(IMAGE, { minScore: 0.8 });
    assert.equal(only(server).path, "/v1/faces");
    assert.equal(only(server).query.toString(), "min_score=0.8");
    assert.equal(only(server).parts[0]?.name, "image");
    assert.equal(result.faces.length, 1);
    assert.deepEqual(result.faces[0]?.landmarks.right_eye, [220, 140]);
    assert.equal(result.faces[0]?.box.width, 150);
    assert.equal(result.faces[0]?.roll, -1.6);
    assert.equal(result.width, 512);
  });

  it("caption", async (t) => {
    const body = {
      caption: "A blue shoe on a white table.",
      detail: "detailed",
      width: 96,
      height: 64,
    };
    const { photos, server } = await fixture(t, () => ({ body }));
    const result = await photos.caption(IMAGE, { detail: "detailed" });
    assert.equal(only(server).path, "/v1/caption");
    assert.equal(only(server).query.toString(), "detail=detailed");
    assert.equal(only(server).parts[0]?.name, "image");
    assert.equal(result.caption, "A blue shoe on a white table.");
    assert.equal(result.detail, "detailed");
    assert.deepEqual(result, body);
  });

  it("idPhotos lists the built-in documents", async (t) => {
    const document = {
      name: "us-passport",
      title: "United States passport",
      checked: "2026-11-12",
      sources: ["https://travel.state.gov/"],
      notes: ["No glasses."],
      width_mm: 51,
      height_mm: 51,
      head_min_mm: 25,
      head_max_mm: 35,
      eyes_from_bottom_mm: [28, 35],
      background: "#ffffff",
      alteration: "Submit the original, unedited photo.",
    };
    const { photos, server } = await fixture(t, () => ({ body: [document] }));
    const documents = await photos.idPhotos();
    const request = only(server);
    assert.equal(request.method, "GET");
    assert.equal(request.path, "/v1/id-photos");
    assert.equal(request.query.toString(), "");
    assert.equal(request.body.length, 0);
    assert.equal(documents[0]?.name, "us-passport");
    assert.deepEqual(documents[0]?.eyes_from_bottom_mm, [28, 35]);
    assert.deepEqual(documents, [document]);
  });

  it("account, presets, marketplaces and webhookSecret are GETs", async (t) => {
    const { photos, server } = await fixture(t, (request) => ({
      body: request.path === "/v1/account" ? { account: "sdk", unlimited: true } : [],
    }));
    assert.deepEqual(await photos.account(), { account: "sdk", unlimited: true });
    await photos.presets();
    await photos.marketplaces();
    await photos.webhookSecret();
    assert.deepEqual(
      server.requests.map((request) => `${request.method} ${request.path} ${request.body.length}`),
      [
        "GET /v1/account 0",
        "GET /v1/presets 0",
        "GET /v1/marketplaces 0",
        "GET /v1/webhook-secret 0",
      ],
    );
  });
});

describe("preset", () => {
  it("GETs the preset's recipe and returns the TOML as text", async (t) => {
    const toml = '# Marketplace\n[remove_background]\nfill = "#ffffff"\n';
    const { photos, server } = await fixture(t, () => ({
      headers: { "content-type": "application/toml; charset=utf-8" },
      body: toml,
    }));
    assert.equal(await photos.preset("marketplace"), toml);
    const request = only(server);
    assert.equal(
      `${request.method} ${request.path} ${request.body.length}`,
      "GET /v1/presets/marketplace 0",
    );
    assert.equal(request.headers.authorization, "Bearer test-key");
  });

  it("encodes the name as one path segment", async (t) => {
    const { photos, server } = await fixture(t, () => ({ body: "" }));
    await photos.preset("a/b c?d");
    assert.equal(only(server).path, "/v1/presets/a%2Fb%20c%3Fd");
  });

  it("an unknown name is a NotFoundError", async (t) => {
    const { photos } = await fixture(t, () => ({
      status: 404,
      body: { error: { code: "not_found", message: "No preset named nope" } },
    }));
    await assert.rejects(photos.preset("nope"), (error: unknown) => {
      assert.ok(error instanceof NotFoundError);
      assert.equal(error.code, "not_found");
      assert.equal(error.message, "No preset named nope");
      return true;
    });
  });
});

describe("health", () => {
  it("returns ok", async (t) => {
    const { photos, server } = await fixture(t, () => ({ body: { status: "ok" } }));
    assert.equal(await photos.health(), "ok");
    assert.equal(only(server).path, "/health");
  });

  it("returns loading or failed from a 503 without retrying", async (t) => {
    const { photos, server, sleeps } = await fixture(t, (_request, n) => ({
      status: 503,
      body: { status: n === 1 ? "loading" : "failed" },
    }));
    assert.equal(await photos.health(), "loading");
    assert.equal(await photos.health(), "failed");
    assert.equal(server.requests.length, 2);
    assert.deepEqual(sleeps, []);
  });

  it("throws on an error that is not a health answer", async (t) => {
    const { photos } = await fixture(t, () => ({ status: 502, body: "<html>Bad Gateway</html>" }));
    await assert.rejects(photos.health(), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 502);
      return true;
    });
  });
});

describe("image arguments", () => {
  it("accepts a Blob, File, ArrayBuffer, typed array view and stream", async (t) => {
    const { photos, server } = await fixture(t, () => ({ body: { lines: [] } }));
    const padded = new Uint8Array([0, 0, ...IMAGE, 0]);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(IMAGE.slice(0, 3));
        controller.enqueue(IMAGE.slice(3));
        controller.close();
      },
    });
    await photos.readText(new Blob([IMAGE]));
    await photos.readText(new File([IMAGE], "shoe.jpg", { type: "image/jpeg" }));
    await photos.readText(IMAGE.slice().buffer);
    await photos.readText(padded.subarray(2, 2 + IMAGE.length));
    await photos.readText(stream);
    assert.deepEqual(
      server.requests.map((request) => request.parts[0]?.filename),
      ["image", "shoe.jpg", "image", "image", "image"],
    );
    for (const request of server.requests) {
      assert.deepEqual(new Uint8Array(request.parts[0]?.data ?? []), IMAGE);
    }
  });

  it("reads a string as a file path and names the part after the file", async (t) => {
    const { photos, server } = await fixture(t, () => ({ body: { lines: [] } }));
    const path = join(await mkdtemp(join(tmpdir(), "photos-js-")), "bottle.jpg");
    await writeFile(path, IMAGE);
    await photos.readText(path);
    assert.equal(only(server).parts[0]?.filename, "bottle.jpg");
    assert.deepEqual(new Uint8Array(only(server).parts[0]?.data ?? []), IMAGE);
  });

  it("fails on a missing file without calling the API", async (t) => {
    const { photos, server } = await fixture(t, () => ({ body: {} }));
    await assert.rejects(photos.readText("/nonexistent/photos-js/nope.jpg"), /ENOENT/);
    assert.equal(server.requests.length, 0);
  });

  it("rejects anything else", async (t) => {
    const { photos, server } = await fixture(t, () => ({ body: {} }));
    await assert.rejects(photos.readText(42 as never), TypeError);
    assert.equal(server.requests.length, 0);
  });
});
