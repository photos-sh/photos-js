import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BlurFacesResult,
  BusyError,
  ConnectionError,
  CropResult,
  FixResult,
  IdPhotoResult,
  ImageResult,
  type Job,
  JobItemResult,
  NotFoundError,
  PhotosError,
  RemoveBackgroundResult,
  RemoveTextResult,
  RestoreFacesResult,
  SelectResult,
  TimeoutError,
  VectorizeResult,
} from "../src/index.js";
import { fixture, IMAGE, imageReply, only } from "./helpers.js";

function job(status: Job["status"], extra: Partial<Job> = {}): Job {
  return {
    id: "job_1",
    operation: "resize",
    params: "width=800",
    status,
    created_at: 1_794_304_756,
    counts: { total: 1, done: status === "completed" ? 1 : 0, failed: 0, pending: 0 },
    items: [{ input: "a.jpg", status: status === "completed" ? "done" : "pending" }],
    ...extra,
  };
}

describe("jobs.create", () => {
  it("sends URLs as JSON, with params as an object in snake_case", async (t) => {
    const { photos, server } = await fixture(t, () => ({ status: 202, body: job("queued") }));
    const created = await photos.jobs.create({
      operation: "resize",
      params: { width: 800, maxBytes: 200_000, enlarge: true, format: undefined },
      urls: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
      webhookUrl: "https://example.com/hook",
    });
    const request = only(server);
    assert.equal(request.method, "POST");
    assert.equal(request.path, "/v1/jobs");
    assert.equal(request.query.toString(), "");
    assert.equal(request.headers["content-type"], "application/json");
    assert.equal(request.headers.authorization, "Bearer test-key");
    assert.deepEqual(JSON.parse(request.body.toString("utf8")), {
      operation: "resize",
      params: { width: "800", max_bytes: "200000", enlarge: "true" },
      inputs: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
      webhook_url: "https://example.com/hook",
    });
    assert.equal(created.id, "job_1");
    assert.equal(created.status, "queued");
  });

  it("leaves out what was not given, and passes a params string through", async (t) => {
    const { photos, server } = await fixture(t, () => ({ status: 202, body: job("queued") }));
    await photos.jobs.create({
      operation: "run",
      params: "preset=marketplace",
      urls: ["https://example.com/1.jpg"],
    });
    await photos.jobs.create({
      operation: "run",
      recipe: "[[step]]",
      urls: ["https://example.com/1.jpg"],
    });
    assert.deepEqual(JSON.parse(server.requests[0]?.body.toString("utf8") ?? ""), {
      operation: "run",
      params: "preset=marketplace",
      inputs: ["https://example.com/1.jpg"],
    });
    assert.deepEqual(JSON.parse(server.requests[1]?.body.toString("utf8") ?? ""), {
      operation: "run",
      recipe: "[[step]]",
      inputs: ["https://example.com/1.jpg"],
    });
  });

  it("uploads images as multipart, with params as a query string and URLs as url parts", async (t) => {
    const { photos, server } = await fixture(t, () => ({ status: 202, body: job("queued") }));
    await photos.jobs.create({
      operation: "remove-background",
      params: { format: "png", maxBytes: 5, model: "lumen" },
      images: [new File([IMAGE], "one.jpg"), IMAGE],
      urls: ["https://example.com/3.jpg"],
      recipe: "toml",
      webhookUrl: "https://example.com/hook",
    });
    const request = only(server);
    assert.match(request.headers["content-type"] ?? "", /^multipart\/form-data; boundary=/);
    assert.deepEqual(
      request.parts.map((part) => [
        part.name,
        part.filename,
        part.filename === undefined ? part.data.toString("utf8") : part.data.length,
      ]),
      [
        ["operation", undefined, "remove-background"],
        ["params", undefined, "format=png&max_bytes=5&model=lumen"],
        ["recipe", "recipe.toml", 4],
        ["webhook_url", undefined, "https://example.com/hook"],
        ["image", "one.jpg", IMAGE.length],
        ["image", "image-2", IMAGE.length],
        ["url", undefined, "https://example.com/3.jpg"],
      ],
    );
  });

  it("takes the newer operations, with params in snake_case", async (t) => {
    const { photos, server } = await fixture(t, () => ({ status: 202, body: job("queued") }));
    await photos.jobs.create({
      operation: "id-photo",
      params: { widthMm: 35, heightMm: 45, headMinMm: 32, headMaxMm: 36, background: "keep" },
      urls: ["https://example.com/1.jpg"],
    });
    await photos.jobs.create({
      operation: "watermark",
      params: { text: "© Shop", tile: true },
      images: [IMAGE],
    });
    assert.deepEqual(JSON.parse(server.requests[0]?.body.toString("utf8") ?? ""), {
      operation: "id-photo",
      params: {
        width_mm: "35",
        height_mm: "45",
        head_min_mm: "32",
        head_max_mm: "36",
        background: "keep",
      },
      inputs: ["https://example.com/1.jpg"],
    });
    assert.deepEqual(
      server.requests[1]?.parts.map((part) => [
        part.name,
        part.filename === undefined ? part.data.toString("utf8") : part.filename,
      ]),
      [
        ["operation", "watermark"],
        ["params", "text=%C2%A9+Shop&tile=true"],
        ["image", "image-1"],
      ],
    );
  });

  it("sends a select job's points and box as the method does", async (t) => {
    const { photos, server } = await fixture(t, () => ({ status: 202, body: job("queued") }));
    const params = {
      points: [[120, 80], { x: 140, y: 90 }],
      exclude: [[300, 40]],
      box: [10, 20, 200, 150],
      pick: "largest",
    };
    const urls = ["https://example.com/1.jpg"];
    await photos.jobs.create({ operation: "select", params, urls });
    await photos.jobs.create({ operation: "select", params, images: [IMAGE] });
    await photos.jobs.create({
      operation: "select",
      params: { points: [[120, 80]], mask: true },
      urls,
    });
    const query =
      "point=120%2C80&point=140%2C90&exclude=300%2C40&box=10%2C20%2C200%2C150&pick=largest";
    // A JSON object cannot repeat `point`, so the params go as a query string.
    assert.deepEqual(JSON.parse(server.requests[0]?.body.toString("utf8") ?? ""), {
      operation: "select",
      params: query,
      inputs: urls,
    });
    assert.equal(
      server.requests[1]?.parts.find((part) => part.name === "params")?.data.toString("utf8"),
      query,
    );
    // Nothing repeats: an object, as for every other operation.
    assert.deepEqual(JSON.parse(server.requests[2]?.body.toString("utf8") ?? "").params, {
      point: "120,80",
      mask: "true",
    });
  });

  it("needs an input", async (t) => {
    const { photos, server } = await fixture(t, () => ({ status: 202, body: job("queued") }));
    await assert.rejects(photos.jobs.create({ operation: "resize" }), PhotosError);
    assert.equal(server.requests.length, 0);
  });

  it("is retried on 503", async (t) => {
    const { photos, server, sleeps } = await fixture(t, (_request, n) =>
      n < 3
        ? { status: 503, headers: { "retry-after": "5" }, body: { error: { code: "busy" } } }
        : { status: 202, body: job("queued") },
    );
    const created = await photos.jobs.create({ operation: "ocr", urls: ["https://e.com/a.jpg"] });
    assert.equal(created.id, "job_1");
    assert.equal(server.requests.length, 3);
    assert.deepEqual(sleeps, [5000, 5000]);
  });

  it("throws BusyError once the retries are used up", async (t) => {
    const { photos, server } = await fixture(t, () => ({
      status: 503,
      body: { error: { code: "busy", message: "busy" } },
    }));
    await assert.rejects(photos.jobs.create({ operation: "ocr", images: [IMAGE] }), BusyError);
    assert.equal(server.requests.length, 3);
  });

  it("is not retried when the connection fails", async (t) => {
    const { photos, server, sleeps } = await fixture(t, () => ({ destroy: true }));
    await assert.rejects(
      photos.jobs.create({ operation: "ocr", urls: ["https://e.com/a.jpg"] }),
      ConnectionError,
    );
    assert.equal(server.requests.length, 1);
    assert.deepEqual(sleeps, []);
  });
});

describe("jobs", () => {
  it("get", async (t) => {
    const { photos, server } = await fixture(t, () => ({ body: job("running") }));
    const got = await photos.jobs.get("job_1");
    assert.equal(only(server).method, "GET");
    assert.equal(only(server).path, "/v1/jobs/job_1");
    assert.equal(got.status, "running");
    assert.equal(got.items[0]?.input, "a.jpg");
  });

  it("escapes the id", async (t) => {
    const { photos, server } = await fixture(t, () => ({
      status: 404,
      body: { error: { code: "not_found", message: "no such job" } },
    }));
    await assert.rejects(photos.jobs.get("../account?x"), NotFoundError);
    assert.equal(only(server).path, "/v1/jobs/..%2Faccount%3Fx");
  });

  it("list", async (t) => {
    const summary = {
      id: "job_1",
      operation: "resize",
      status: "completed",
      created_at: 1,
      finished_at: null,
      counts: { total: 1, done: 1, failed: 0, pending: 0 },
    };
    const { photos, server } = await fixture(t, () => ({ body: [summary] }));
    assert.deepEqual(await photos.jobs.list(), [summary]);
    assert.equal(only(server).method, "GET");
    assert.equal(only(server).path, "/v1/jobs");
  });

  it("delete", async (t) => {
    const { photos, server } = await fixture(t, () => ({ status: 204 }));
    assert.equal(await photos.jobs.delete("job_1"), undefined);
    assert.equal(only(server).method, "DELETE");
    assert.equal(only(server).path, "/v1/jobs/job_1");
  });

  it("result gives an image its accessors", async (t) => {
    const { photos, server } = await fixture(t, () => imageReply());
    const result = await photos.jobs.result("job_1", 2);
    assert.equal(only(server).path, "/v1/jobs/job_1/items/2");
    assert.ok(result instanceof JobItemResult);
    assert.equal(result.isImage, true);
    assert.equal(result.isJson, false);
    assert.equal(result.contentType, "image/png");
    assert.deepEqual(result.bytes, new Uint8Array([9, 8, 7]));
    assert.equal(result.headers.get("server-timing"), "decode;dur=1.0, encode;dur=2.5");
    const image = result.image();
    assert.ok(image instanceof ImageResult);
    assert.equal(image.width, 640);
    assert.equal(image.height, 480);
    assert.deepEqual(image.bytes, result.bytes);
    assert.throws(() => result.json(), PhotosError);
  });

  it("result gives a remove-text item its counts", async (t) => {
    const { photos } = await fixture(t, () =>
      imageReply({ "x-text-removed": "2", "x-text-kept": "1" }),
    );
    const result = await photos.jobs.result("job_1", 0);
    const cleaned = result.removeText();
    assert.ok(cleaned instanceof RemoveTextResult);
    assert.deepEqual([cleaned.removed, cleaned.kept, cleaned.width], [2, 1, 640]);
    assert.deepEqual(cleaned.bytes, result.bytes);
    assert.throws(
      () => result.fix(),
      (error) => {
        assert.ok(error instanceof PhotosError);
        assert.match(error.message, /x-marketplace-passed/);
        return true;
      },
    );
  });

  it("result gives a fix item its verdict", async (t) => {
    const { photos } = await fixture(t, (_request, n) =>
      imageReply({
        "x-marketplace-passed": n === 1 ? "false" : "true",
        "x-marketplace-findings": n === 1 ? "too_small,text_overlay" : "",
      }),
    );
    const result = await photos.jobs.result("job_1", 0);
    const fixed = result.fix();
    assert.ok(fixed instanceof FixResult);
    assert.equal(fixed.passed, false);
    assert.deepEqual(fixed.findings, ["too_small", "text_overlay"]);
    assert.equal(fixed.height, 480);
    assert.throws(() => result.removeText(), /x-text-removed/);
    const passed = (await photos.jobs.result("job_1", 1)).fix();
    assert.deepEqual([passed.passed, passed.findings], [true, []]);
  });

  it("removeText and fix throw on results without their headers", async (t) => {
    const { photos } = await fixture(t, (_request, n) =>
      n === 1 ? imageReply() : { body: { lines: [] } },
    );
    const image = await photos.jobs.result("job_1", 0);
    assert.throws(() => image.removeText(), PhotosError);
    assert.throws(() => image.fix(), PhotosError);
    const json = await photos.jobs.result("job_1", 1);
    assert.throws(() => json.removeText(), /not an image/);
    assert.throws(() => json.fix(), /not an image/);
  });

  it("result gives the items of the newer operations what their headers say", async (t) => {
    const replies = [
      imageReply({ "x-subject-found": "false" }),
      {
        headers: {
          "content-type": "image/svg+xml",
          "x-image-width": "64",
          "x-image-height": "48",
          "x-paths": "23",
        },
        body: "<svg/>",
      },
      imageReply({ "x-faces": "3" }),
      imageReply({
        "x-id-photo-passed": "false",
        "x-id-photo-findings": "head_tilted,low_resolution",
        "x-id-photo-head-mm": "33.5",
      }),
      imageReply({ "x-select-score": "0.912" }),
      imageReply({ "x-faces": "1", "x-faces-skipped": "2" }),
    ];
    const { photos } = await fixture(t, (_request, n) => replies[n - 1] ?? imageReply());
    const item = (n: number) => photos.jobs.result("job_1", n);

    const cropped = (await item(0)).crop();
    assert.ok(cropped instanceof CropResult);
    assert.deepEqual([cropped.subjectFound, cropped.width], [false, 640]);

    const traced = await item(1);
    assert.equal(traced.isImage, true);
    const svg = traced.vectorize();
    assert.ok(svg instanceof VectorizeResult);
    assert.deepEqual([svg.paths, svg.text(), svg.width, svg.height], [23, "<svg/>", 64, 48]);
    assert.throws(() => traced.crop(), /x-subject-found/);

    const blurred = await item(2);
    assert.ok(blurred.blurFaces() instanceof BlurFacesResult);
    assert.equal(blurred.blurFaces().faces, 3);
    // A blur-faces result is not a restore-faces one.
    assert.throws(() => blurred.restoreFaces(), /x-faces-skipped/);

    const framed = (await item(3)).idPhoto();
    assert.ok(framed instanceof IdPhotoResult);
    assert.equal(framed.passed, false);
    assert.deepEqual(framed.findings, ["head_tilted", "low_resolution"]);
    assert.equal(framed.headMm, 33.5);

    const selected = (await item(4)).select();
    assert.ok(selected instanceof SelectResult);
    assert.equal(selected.score, 0.912);

    const restored = (await item(5)).restoreFaces();
    assert.ok(restored instanceof RestoreFacesResult);
    assert.deepEqual([restored.faces, restored.facesSkipped], [1, 2]);
  });

  it("result gives a remove-background item subjectFound, unknown without the header", async (t) => {
    const { photos } = await fixture(t, (_request, n) =>
      n === 1
        ? imageReply()
        : n === 2
          ? imageReply({ "x-subject-found": "false" })
          : { body: { lines: [] } },
    );
    const plain = (await photos.jobs.result("job_1", 0)).removeBackground();
    assert.ok(plain instanceof RemoveBackgroundResult);
    assert.deepEqual([plain.subjectFound, plain.width], [undefined, 640]);
    assert.equal((await photos.jobs.result("job_1", 1)).removeBackground().subjectFound, false);
    const json = await photos.jobs.result("job_1", 2);
    assert.throws(() => json.removeBackground(), /not an image/);
  });

  it("an item's image result has the barcodes and text a run recipe read", async (t) => {
    const { photos } = await fixture(t, () =>
      imageReply({
        "x-barcodes": '[{"format":"EAN-13","value":"3850104010017","gs1":"3850104010017"}]',
        "x-text": '["Pr\\u0161ut"]',
        "x-text-truncated": "true",
      }),
    );
    const image = (await photos.jobs.result("job_1", 0)).image();
    assert.deepEqual(image.barcodes, [
      { format: "EAN-13", value: "3850104010017", gs1: "3850104010017" },
    ]);
    assert.deepEqual([image.textLines, image.textTruncated], [["Pršut"], true]);
  });

  it("the newer accessors throw on results without their headers", async (t) => {
    const { photos } = await fixture(t, (_request, n) =>
      n === 1 ? imageReply() : { body: { faces: [] } },
    );
    const image = await photos.jobs.result("job_1", 0);
    const json = await photos.jobs.result("job_1", 1);
    const accessors = [
      "crop",
      "vectorize",
      "blurFaces",
      "idPhoto",
      "select",
      "restoreFaces",
    ] as const;
    for (const name of accessors) {
      assert.throws(() => image[name](), PhotosError, name);
      assert.throws(() => json[name](), /not an image/, name);
    }
  });

  it("result gives JSON its accessor", async (t) => {
    const { photos } = await fixture(t, () => ({ body: { lines: [{ text: "HI" }] } }));
    const result = await photos.jobs.result("job_1", 0);
    assert.equal(result.isJson, true);
    assert.equal(result.isImage, false);
    assert.deepEqual(result.json<{ lines: Array<{ text: string }> }>().lines[0]?.text, "HI");
    assert.equal(result.text(), '{"lines":[{"text":"HI"}]}');
    assert.throws(() => result.image(), PhotosError);
  });
});

describe("jobs.wait", () => {
  it("polls until the job is completed", async (t) => {
    const { photos, server, sleeps } = await fixture(t, (_request, n) => ({
      body: job(n === 1 ? "queued" : n === 2 ? "running" : "completed"),
    }));
    const done = await photos.jobs.wait("job_1", { pollInterval: 7 });
    assert.equal(done.status, "completed");
    assert.equal(done.counts.done, 1);
    assert.equal(server.requests.length, 3);
    assert.deepEqual(sleeps, [7, 7]);
  });

  it("polls every 2 s by default", async (t) => {
    const { photos, sleeps } = await fixture(t, (_request, n) => ({
      body: job(n === 1 ? "running" : "completed"),
    }));
    await photos.jobs.wait("job_1");
    assert.deepEqual(sleeps, [2000]);
  });

  it("returns at once when the job is already completed", async (t) => {
    const { photos, server, sleeps } = await fixture(t, () => ({ body: job("completed") }));
    await photos.jobs.wait("job_1", { timeout: 0 });
    assert.equal(server.requests.length, 1);
    assert.deepEqual(sleeps, []);
  });

  it("throws a TimeoutError when the time runs out", async (t) => {
    const { photos, server } = await fixture(t, () => ({ body: job("running") }), {
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    await assert.rejects(photos.jobs.wait("job_1", { pollInterval: 10, timeout: 45 }), (error) => {
      assert.ok(error instanceof TimeoutError);
      assert.match(error.message, /job_1/);
      return true;
    });
    assert.ok(server.requests.length >= 2 && server.requests.length <= 5);
  });

  it("passes API errors on", async (t) => {
    const { photos } = await fixture(t, () => ({
      status: 404,
      body: { error: { code: "not_found", message: "no such job" } },
    }));
    await assert.rejects(photos.jobs.wait("job_x"), NotFoundError);
  });

  it("can be aborted", async (t) => {
    const { photos } = await fixture(t, () => ({ body: job("running") }), {
      sleep: undefined,
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    await assert.rejects(
      photos.jobs.wait("job_1", { signal: controller.signal }),
      (error: unknown) => (error as Error).name === "AbortError",
    );
  });
});
