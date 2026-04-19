import type { Env } from "../env";
import { getNetwork } from "../lib/networks";
import { badRequest, unsupported, upstream } from "../lib/errors";
import {
  classifyUri,
  decodeDataUri,
  resolveRecord,
  type AvatarKind,
} from "./avatarResolver";
import { fetchIpfs, parseIpfs } from "./ipfs";
import { sanitizeSvg } from "./sanitize";
import { getResolved, putResolved } from "../storage/kvCache";
import { getHttps, getIpfs, putHttps, putIpfs } from "../storage/r2Cache";
import { isSvgMime, sniffMime, SVG_MIME } from "../lib/mime";
import { MAX_IMAGE_BYTES } from "../constants";

export type ImageBytes = { bytes: ArrayBuffer; contentType: string };

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

export async function resolveUriCached(
  env: Env,
  kind: AvatarKind,
  networkName: string,
  name: string,
): Promise<string> {
  const cached = await getResolved(env, kind, networkName, name);
  if (cached) return cached;
  const network = getNetwork(env, networkName);
  if (!network) throw badRequest(`unknown network: ${networkName}`);
  const uri = await resolveRecord(network, kind, name);
  await putResolved(env, kind, networkName, name, uri);
  return uri;
}

export async function fetchImageBytes(env: Env, uri: string): Promise<ImageBytes> {
  const classified = classifyUri(uri);

  switch (classified.kind) {
    case "data": {
      const { bytes, mime } = decodeDataUri(uri);
      return { bytes: bytes.buffer as ArrayBuffer, contentType: mime };
    }

    case "ipfs": {
      const ref = parseIpfs(uri);
      if (!ref) throw badRequest(`invalid ipfs URI: ${uri}`);
      const hit = await getIpfs(env, ref);
      if (hit && hit.bytes.byteLength <= MAX_IMAGE_BYTES) {
        return { bytes: hit.bytes, contentType: hit.contentType };
      }
      const res = await fetchIpfs(env, ref);
      if (advertisedLengthExceeds(res.headers, MAX_IMAGE_BYTES)) {
        throw upstream(
          `image too large: content-length ${res.headers.get("content-length")} > ${MAX_IMAGE_BYTES}`,
        );
      }
      const bytes = await res.arrayBuffer();
      assertUnderSizeLimit(bytes.byteLength);
      const contentType =
        res.headers.get("content-type") ?? sniffMime(new Uint8Array(bytes));
      await putIpfs(env, ref, bytes, contentType);
      return { bytes, contentType };
    }

    case "https": {
      const hit = await getHttps(env, classified.url);
      const headers: HeadersInit = {};
      if (hit?.etag) headers["If-None-Match"] = hit.etag;
      if (hit?.lastModified) headers["If-Modified-Since"] = hit.lastModified;
      const res = await fetch(classified.url, {
        headers,
        cf: { cacheTtl: 3600, cacheEverything: true },
      });
      if (res.status === 304 && hit) {
        assertUnderSizeLimit(hit.bytes.byteLength);
        return { bytes: hit.bytes, contentType: hit.contentType };
      }
      if (!res.ok) throw upstream(`image fetch failed: ${res.status}`);
      if (advertisedLengthExceeds(res.headers, MAX_IMAGE_BYTES)) {
        throw upstream(
          `image too large: content-length ${res.headers.get("content-length")} > ${MAX_IMAGE_BYTES}`,
        );
      }
      const bytes = await res.arrayBuffer();
      assertUnderSizeLimit(bytes.byteLength);
      const contentType =
        res.headers.get("content-type") ?? sniffMime(new Uint8Array(bytes));
      await putHttps(
        env,
        classified.url,
        bytes,
        contentType,
        res.headers.get("etag") ?? undefined,
        res.headers.get("last-modified") ?? undefined,
      );
      return { bytes, contentType };
    }

    case "eip155":
      throw unsupported("eip155 avatar resolution is not supported");
  }
}

export async function maybeSanitizeSvg(image: ImageBytes): Promise<ImageBytes> {
  if (!isSvgMime(image.contentType)) return image;
  const text = new TextDecoder().decode(image.bytes);
  const clean = await sanitizeSvg(text);
  return {
    bytes: new TextEncoder().encode(clean).buffer as ArrayBuffer,
    contentType: SVG_MIME,
  };
}
