import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { deflateSync } from "node:zlib";
import { Photos, type PhotosOptions } from "../src/index.js";

export interface FormPart {
  name: string;
  filename: string | undefined;
  data: Buffer;
}

/** A request the fake server received. */
export interface Recorded {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  body: Buffer;
  /** The parts of a multipart body (empty otherwise). */
  parts: FormPart[];
}

export interface Reply {
  status?: number;
  headers?: Record<string, string>;
  /** Objects are sent as JSON. */
  body?: string | Uint8Array | object;
  /** Milliseconds to wait before answering. */
  delay?: number;
  /** Drop the connection without answering. */
  destroy?: boolean;
}

export interface FakeServer {
  url: string;
  requests: Recorded[];
  close(): Promise<void>;
}

function parseMultipart(body: Buffer, contentType: string): FormPart[] {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!boundary) return [];
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const parts: FormPart[] = [];
  let at = body.indexOf(delimiter);
  while (at >= 0) {
    const next = body.indexOf(delimiter, at + delimiter.length);
    if (next < 0) break;
    // Skip the CRLF after the delimiter; drop the CRLF before the next one.
    const part = body.subarray(at + delimiter.length + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    const head = part.subarray(0, split).toString("utf8");
    parts.push({
      name: /\bname="([^"]*)"/.exec(head)?.[1] ?? "",
      filename: /\bfilename="([^"]*)"/.exec(head)?.[1],
      data: part.subarray(split + 4),
    });
    at = next;
  }
  return parts;
}

/** Starts an HTTP server on a free local port that answers with `handler`. */
export async function startServer(
  handler: (request: Recorded, n: number) => Reply | Promise<Reply>,
): Promise<FakeServer> {
  const requests: Recorded[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const body = Buffer.concat(chunks);
        const recorded: Recorded = {
          method: req.method ?? "",
          path: url.pathname,
          query: url.searchParams,
          headers: req.headers,
          body,
          parts: parseMultipart(body, req.headers["content-type"] ?? ""),
        };
        requests.push(recorded);
        const reply = await handler(recorded, requests.length);
        if (reply.delay) await new Promise((resolve) => setTimeout(resolve, reply.delay));
        if (reply.destroy) {
          req.socket.destroy();
          return;
        }
        const headers = { ...reply.headers };
        let payload: string | Uint8Array = "";
        if (typeof reply.body === "string" || reply.body instanceof Uint8Array) {
          payload = reply.body;
        } else if (reply.body !== undefined) {
          payload = JSON.stringify(reply.body);
          headers["content-type"] ??= "application/json";
        }
        res.writeHead(reply.status ?? 200, headers);
        res.end(payload);
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

export interface Fixture {
  photos: Photos;
  server: FakeServer;
  /** The waits the client asked for, in milliseconds (none really happen). */
  sleeps: number[];
}

/** A fake server and a client pointed at it, with instant retry waits. */
export async function fixture(
  t: { after(fn: () => Promise<void>): void },
  handler: (request: Recorded, n: number) => Reply | Promise<Reply>,
  options: PhotosOptions = {},
): Promise<Fixture> {
  const server = await startServer(handler);
  t.after(() => server.close());
  const sleeps: number[] = [];
  const photos = new Photos({
    apiKey: "test-key",
    baseUrl: server.url,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...options,
  });
  return { photos, server, sleeps };
}

/** The only request made so far. */
export function only(server: FakeServer): Recorded {
  if (server.requests.length !== 1) {
    throw new Error(`expected one request, got ${server.requests.length}`);
  }
  return server.requests[0] as Recorded;
}

export const IMAGE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

export function imageReply(extra: Record<string, string> = {}): Reply {
  return {
    headers: {
      "content-type": "image/png",
      "x-image-width": "640",
      "x-image-height": "480",
      "server-timing": "decode;dur=1.0, encode;dur=2.5",
      ...extra,
    },
    body: new Uint8Array([9, 8, 7]),
  };
}

function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** An RGB PNG: `paint` gives the colour of each pixel. */
export function png(
  width: number,
  height: number,
  paint: (x: number, y: number) => readonly [number, number, number],
): Uint8Array<ArrayBuffer> {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      raw.set(paint(x, y), y * (width * 3 + 1) + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", new Uint8Array(0)),
    ]),
  );
}
