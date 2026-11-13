import { PhotosError } from "./errors.js";
import type { ImageInput, Point, Rect, SelectOptions } from "./types.js";

type Fs = typeof import("node:fs/promises");

/**
 * `node:fs/promises`, loaded only when a file path is used. The specifier is
 * not a literal so that bundlers for browsers leave it alone.
 * @internal
 */
export async function nodeFs(): Promise<Fs> {
  const specifier = ["node", "fs/promises"].join(":");
  try {
    return (await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier)) as Fs;
  } catch (cause) {
    throw new PhotosError(
      "File paths need a runtime with node:fs (Node.js, Deno, Bun); pass a Blob or bytes instead",
      { cause },
    );
  }
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || "image";
}

/** @internal A multipart file part. */
export interface Part {
  blob: Blob;
  filename: string;
}

/** @internal Reads an image argument into a multipart part. */
export async function toPart(input: ImageInput, fallbackName: string): Promise<Part> {
  if (typeof input === "string") {
    const fs = await nodeFs();
    const bytes = await fs.readFile(input);
    return { blob: new Blob([bytes as BlobPart]), filename: baseName(input) };
  }
  if (input instanceof Blob) {
    const name = (input as { name?: unknown }).name;
    return { blob: input, filename: typeof name === "string" && name ? name : fallbackName };
  }
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    return { blob: new Blob([input as BlobPart]), filename: fallbackName };
  }
  if (typeof ReadableStream !== "undefined" && input instanceof ReadableStream) {
    return { blob: await new Response(input).blob(), filename: fallbackName };
  }
  throw new TypeError(
    "An image must be a Blob, File, ArrayBuffer, Uint8Array, ReadableStream or a file path",
  );
}

/** `maxBytes` -> `max_bytes`. Names already in snake_case stay as they are. */
function snakeCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * @internal
 * Turns an options object into query pairs: names in snake_case, unset
 * options left out, booleans as `true`/`false`, arrays repeated.
 */
export function toQuery(options: object | undefined, skip: readonly string[] = []): string[][] {
  const pairs: string[][] = [];
  for (const [key, value] of Object.entries(options ?? {})) {
    if (key === "signal" || key === "timeout" || skip.includes(key)) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === null) continue;
      pairs.push([snakeCase(key), String(item)]);
    }
  }
  return pairs;
}

/**
 * @internal
 * A point or a rectangle as the API takes it: `x,y` or `x,y,width,height`.
 */
export function coordinates(value: Point | Rect): string {
  // Job params are not typed: a value that is already a string is passed on.
  if (typeof value !== "object") return String(value);
  if (!("x" in value)) return value.join(",");
  return "width" in value
    ? `${value.x},${value.y},${value.width},${value.height}`
    : `${value.x},${value.y}`;
}

/**
 * @internal
 * The query of `select`: `points` repeat as `point`, `exclude` repeats, and
 * `box` is `x,y,width,height`.
 */
export function selectQuery(options: SelectOptions): string[][] {
  const { points, exclude, box, ...rest } = options;
  const pairs = [
    ...(points ?? []).map((point) => ["point", coordinates(point)]),
    ...(exclude ?? []).map((point) => ["exclude", coordinates(point)]),
  ];
  if (box !== undefined) pairs.push(["box", coordinates(box)]);
  return [...pairs, ...toQuery(rest)];
}
