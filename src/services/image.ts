import type { Env } from "../env";
import { getNetwork } from "../lib/networks";
import { badRequest, HttpError, unsupported, upstream } from "../lib/errors";
import {
  classifyUri,
  decodeDataUri,
  resolveRecord,
  type AvatarKind,
} from "./avatarResolver";
import { fetchIpfs, parseIpfs } from "./ipfs";
import { sanitizeSvg, sanitizeSvgStream } from "./sanitize";
import { deleteResolved, getResolved, putResolved } from "../storage/kvCache";
import { getHttps, getIpfs, headHttps, putHttps, putIpfs } from "../storage/r2Cache";
import { isSvgMime, sniffMime, SVG_MIME } from "../lib/mime";
import { HTTPS_IMAGE_TIMEOUT_MS, MAX_IMAGE_BYTES } from "../constants";

export type ImageResult = {
  body: ReadableStream<Uint8Array> | ArrayBuffer;
  contentType: string;
  etag?: string;
};

function ipfsEtag(ref: { cid: string; path: string }): string {
  return `"ipfs:${ref.cid}${ref.path}"`;
}

export function assertUnderSizeLimit(
  byteLength: number,
  max: number = MAX_IMAGE_BYTES,
): void {
  if (byteLength > max) {
    throw upstream(`image exceeds size limit: ${byteLength} > ${max} bytes`);
  }
}

function advertisedLengthExceeds(headers: Headers, max: number): boolean {
  const raw = headers.get("content-length");
  if (!raw) return false;
  const n = Number(raw);
  return Number.isFinite(n) && n > max;
}

function sizeLimitedStream(
  src: ReadableStream<Uint8Array>,
  max: number,
): ReadableStream<Uint8Array> {
  let seen = 0;
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > max) {
        controller.error(upstream(`image exceeds size limit: >${max} bytes`));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  return src.pipeThrough(transform);
}

async function sanitizeIfSvg(
  bytes: ArrayBuffer,
  contentType: string,
): Promise<ImageResult> {
  if (!isSvgMime(contentType)) return { body: bytes, contentType };
  const text = new TextDecoder().decode(bytes);
  const clean = await sanitizeSvg(text);
  return {
    body: new TextEncoder().encode(clean).buffer as ArrayBuffer,
    contentType: SVG_MIME,
  };
}

export async function resolveUriCached(
  env: Env,
  kind: AvatarKind,
  networkName: string,
  name: string,
  ctx: ExecutionContext,
): Promise<string> {
  const cached = await getResolved(env, kind, networkName, name);
  if (cached?.fresh) return cached.uri;

  const network = getNetwork(env, networkName);
  if (!network) throw badRequest(`unknown network: ${networkName}`);

  if (cached) {
    ctx.waitUntil(
      (async () => {
        try {
          const uri = await resolveRecord(network, kind, name);
          await putResolved(env, kind, networkName, name, uri);
        } catch (err) {
          if (err instanceof HttpError && err.status === 404) {
            await deleteResolved(env, kind, networkName, name);
            return;
          }
          console.error(
            `stale revalidation failed for ${kind}:${networkName}:${name}:`,
            err,
          );
        }
      })(),
    );
    return cached.uri;
  }

  const uri = await resolveRecord(network, kind, name);
  ctx.waitUntil(putResolved(env, kind, networkName, name, uri));
  return uri;
}

export async function fetchImageBytes(
  env: Env,
  uri: string,
  ctx: ExecutionContext,
): Promise<ImageResult> {
  const classified = classifyUri(uri);

  switch (classified.kind) {
    case "data": {
      const { bytes, mime } = decodeDataUri(uri);
      return sanitizeIfSvg(bytes.buffer as ArrayBuffer, mime);
    }

    case "ipfs": {
      const ref = parseIpfs(uri);
      if (!ref) throw badRequest(`invalid ipfs URI: ${uri}`);
      const etag = ipfsEtag(ref);
      const hit = await getIpfs(env, ref);
      if (hit && hit.bytes.byteLength <= MAX_IMAGE_BYTES) {
        if (hit.sanitized || !isSvgMime(hit.contentType)) {
          return { body: hit.bytes, contentType: hit.contentType, etag };
        }
        const sanitized = await sanitizeIfSvg(hit.bytes, hit.contentType);
        return { ...sanitized, etag };
      }
      const res = await fetchIpfs(env, ref);
      if (advertisedLengthExceeds(res.headers, MAX_IMAGE_BYTES)) {
        throw upstream(
          `image too large: content-length ${res.headers.get("content-length")} > ${MAX_IMAGE_BYTES}`,
        );
      }
      const headerType = res.headers.get("content-type");
      const hasDeclaredLength = res.headers.get("content-length") !== null;
      if (!headerType || !hasDeclaredLength) {
        const rawBytes = await res.arrayBuffer();
        assertUnderSizeLimit(rawBytes.byteLength);
        const rawType = headerType ?? sniffMime(new Uint8Array(rawBytes));
        const image = await sanitizeIfSvg(rawBytes, rawType);
        const stored = image.body as ArrayBuffer;
        ctx.waitUntil(
          putIpfs(env, ref, stored, image.contentType, isSvgMime(image.contentType)),
        );
        return { ...image, etag };
      }
      if (!res.body) throw upstream("ipfs response has no body");
      const limited = sizeLimitedStream(res.body, MAX_IMAGE_BYTES);
      const isSvg = isSvgMime(headerType);
      const outStream = isSvg ? sanitizeSvgStream(limited) : limited;
      const outType = isSvg ? SVG_MIME : headerType;
      const [toClient, toR2] = outStream.tee();
      ctx.waitUntil(putIpfs(env, ref, toR2, outType, isSvg));
      return { body: toClient, contentType: outType, etag };
    }

    case "https": {
      const validators = await headHttps(env, classified.url);
      const headers: HeadersInit = {};
      if (validators?.etag) headers["If-None-Match"] = validators.etag;
      if (validators?.lastModified) headers["If-Modified-Since"] = validators.lastModified;
      const ctrl = new AbortController();
      const headerTimeout = setTimeout(
        () => ctrl.abort(),
        HTTPS_IMAGE_TIMEOUT_MS,
      );
      let res: Response;
      try {
        res = await fetch(classified.url, {
          headers,
          cf: { cacheTtl: 3600, cacheEverything: true },
          signal: ctrl.signal,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw upstream(`image fetch failed: ${msg}`, err);
      } finally {
        clearTimeout(headerTimeout);
      }
      if (res.status === 304 && validators) {
        const hit = await getHttps(env, classified.url);
        if (hit) {
          assertUnderSizeLimit(hit.bytes.byteLength);
          if (hit.sanitized || !isSvgMime(hit.contentType)) {
            return { body: hit.bytes, contentType: hit.contentType, etag: hit.etag };
          }
          const sanitized = await sanitizeIfSvg(hit.bytes, hit.contentType);
          return { ...sanitized, etag: hit.etag };
        }
        throw upstream("cached image disappeared between head and get");
      }
      if (!res.ok) throw upstream(`image fetch failed: ${res.status}`);
      if (advertisedLengthExceeds(res.headers, MAX_IMAGE_BYTES)) {
        throw upstream(
          `image too large: content-length ${res.headers.get("content-length")} > ${MAX_IMAGE_BYTES}`,
        );
      }
      const headerType = res.headers.get("content-type");
      const etag = res.headers.get("etag") ?? undefined;
      const lastModified = res.headers.get("last-modified") ?? undefined;
      const hasDeclaredLength = res.headers.get("content-length") !== null;
      if (!headerType || !hasDeclaredLength) {
        const rawBytes = await res.arrayBuffer();
        assertUnderSizeLimit(rawBytes.byteLength);
        const rawType = headerType ?? sniffMime(new Uint8Array(rawBytes));
        const image = await sanitizeIfSvg(rawBytes, rawType);
        const stored = image.body as ArrayBuffer;
        ctx.waitUntil(
          putHttps(
            env,
            classified.url,
            stored,
            image.contentType,
            etag,
            lastModified,
            isSvgMime(image.contentType),
          ),
        );
        return { ...image, etag };
      }
      if (!res.body) throw upstream("https response has no body");
      const limited = sizeLimitedStream(res.body, MAX_IMAGE_BYTES);
      const isSvg = isSvgMime(headerType);
      const outStream = isSvg ? sanitizeSvgStream(limited) : limited;
      const outType = isSvg ? SVG_MIME : headerType;
      const [toClient, toR2] = outStream.tee();
      ctx.waitUntil(
        putHttps(env, classified.url, toR2, outType, etag, lastModified, isSvg),
      );
      return { body: toClient, contentType: outType, etag };
    }

    case "eip155":
      throw unsupported("eip155 avatar resolution is not supported");
  }
}
