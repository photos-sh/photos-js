import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { Photos, PhotosError, verifyWebhook, WebhookError } from "../src/index.js";

const SECRET = "whsec_test";
const NOW = 1_794_304_756;
const BODY = JSON.stringify({
  type: "job.completed",
  job: { id: "job_1", operation: "resize", status: "completed", note: "č€ ✓" },
});

function sign(body: string, t = NOW, secret = SECRET): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

describe("verifyWebhook", () => {
  it("returns the event of a valid delivery", async () => {
    const event = await verifyWebhook(BODY, sign(BODY), SECRET, { now: NOW });
    assert.equal(event.type, "job.completed");
    assert.equal(event.job.id, "job_1");
    assert.equal(event.job.status, "completed");
  });

  it("takes the body as bytes", async () => {
    const bytes = new TextEncoder().encode(BODY);
    const padded = new Uint8Array([1, 2, ...bytes, 3]);
    for (const body of [bytes, bytes.buffer, Buffer.from(BODY), padded.subarray(2, -1)]) {
      const event = await verifyWebhook(body, sign(BODY), SECRET, { now: NOW });
      assert.equal(event.job.id, "job_1");
    }
  });

  it("is on the client class too", async () => {
    assert.equal(Photos.verifyWebhook, verifyWebhook);
    const event = await Photos.verifyWebhook(BODY, sign(BODY), SECRET, { now: NOW });
    assert.equal(event.type, "job.completed");
  });

  it("uses the current time by default", async () => {
    const t = Math.floor(Date.now() / 1000);
    await verifyWebhook(BODY, sign(BODY, t), SECRET);
    await assert.rejects(verifyWebhook(BODY, sign(BODY, t - 301), SECRET), WebhookError);
  });

  it("takes now as a Date or a function", async () => {
    await verifyWebhook(BODY, sign(BODY), SECRET, { now: new Date(NOW * 1000) });
    await verifyWebhook(BODY, sign(BODY), SECRET, { now: () => NOW + 10 });
    await verifyWebhook(BODY, sign(BODY), SECRET, { now: () => new Date(NOW * 1000) });
  });

  it("rejects a tampered body", async () => {
    const tampered = BODY.replace("job_1", "job_2");
    await assert.rejects(verifyWebhook(tampered, sign(BODY), SECRET, { now: NOW }), (error) => {
      assert.ok(error instanceof WebhookError);
      assert.ok(error instanceof PhotosError);
      assert.equal(error.name, "WebhookError");
      assert.match(error.message, /signature does not match/);
      return true;
    });
  });

  it("rejects a tampered timestamp", async () => {
    const header = sign(BODY).replace(`t=${NOW}`, `t=${NOW + 1}`);
    await assert.rejects(verifyWebhook(BODY, header, SECRET, { now: NOW }), WebhookError);
  });

  it("rejects the wrong secret", async () => {
    await assert.rejects(
      verifyWebhook(BODY, sign(BODY, NOW, "whsec_other"), SECRET, { now: NOW }),
      /signature does not match/,
    );
  });

  it("rejects timestamps outside the tolerance", async () => {
    const options = { now: NOW };
    await verifyWebhook(BODY, sign(BODY, NOW - 300), SECRET, options);
    await verifyWebhook(BODY, sign(BODY, NOW + 300), SECRET, options);
    await assert.rejects(verifyWebhook(BODY, sign(BODY, NOW - 301), SECRET, options), /tolerance/);
    await assert.rejects(verifyWebhook(BODY, sign(BODY, NOW + 301), SECRET, options), /tolerance/);
  });

  it("takes a tolerance", async () => {
    const header = sign(BODY, NOW - 1000);
    await verifyWebhook(BODY, header, SECRET, { now: NOW, tolerance: 1000 });
    await assert.rejects(
      verifyWebhook(BODY, header, SECRET, { now: NOW, tolerance: 999 }),
      WebhookError,
    );
    await assert.rejects(
      verifyWebhook(BODY, sign(BODY, NOW - 1), SECRET, { now: NOW, tolerance: 0 }),
      WebhookError,
    );
  });

  it("rejects a missing or malformed header", async () => {
    const v1 = sign(BODY).split("v1=")[1] ?? "";
    const headers = [
      undefined,
      null,
      "",
      "garbage",
      `t=${NOW}`,
      `v1=${v1}`,
      `t=abc,v1=${v1}`,
      `t=,v1=${v1}`,
      `t=${NOW},v1=`,
      `t=${NOW},v1=zz${v1.slice(2)}`,
      `t=${NOW},v1=${v1.slice(1)}`,
      `t=${NOW};v1=${v1}`,
    ];
    for (const header of headers) {
      await assert.rejects(
        verifyWebhook(BODY, header, SECRET, { now: NOW }),
        WebhookError,
        `header ${String(header)}`,
      );
    }
  });

  it("rejects a truncated signature", async () => {
    const header = sign(BODY).slice(0, -2);
    await assert.rejects(verifyWebhook(BODY, header, SECRET, { now: NOW }), /does not match/);
  });

  it("needs a secret", async () => {
    await assert.rejects(verifyWebhook(BODY, sign(BODY), "", { now: NOW }), WebhookError);
  });

  it("accepts spaces and several v1 values", async () => {
    const good = sign(BODY).split("v1=")[1] ?? "";
    const header = `t=${NOW}, v1=${"0".repeat(64)}, v1=${good}`;
    const event = await verifyWebhook(BODY, header, SECRET, { now: NOW });
    assert.equal(event.type, "job.completed");
  });

  it("rejects a signed body that is not an event", async () => {
    for (const body of ["not json", "[1,2]", "null", '{"job":{}}']) {
      await assert.rejects(
        verifyWebhook(body, sign(body), SECRET, { now: NOW }),
        WebhookError,
        body,
      );
    }
  });
});
