import type { Env } from "../env";
import type { IpfsRef } from "../services/ipfs";

export type CachedImage = {
  bytes: ArrayBuffer;
  contentType: string;
  etag?: string;
  lastModified?: string;
  fetchedAt: number;
  sanitized: boolean;
  expired?: boolean;
};

function ipfsKey(ref: IpfsRef): string {
  return `ipfs/${ref.cid}${ref.path}`;
}

async function httpsKey(url: string): Promise<string> {
  const bytes = new TextEncoder().encode(url);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `https/${hex}`;
}

async function readObject(obj: R2ObjectBody | null): Promise<CachedImage | null> {
  if (!obj) return null;
  const meta = obj.customMetadata ?? {};
  return {
    bytes: await obj.arrayBuffer(),
    contentType: obj.httpMetadata?.contentType ?? "application/octet-stream",
    etag: meta.etag,
    lastModified: meta.lastModified,
    fetchedAt: Number(meta.fetchedAt ?? "0"),
    sanitized: meta.sanitized === "1",
    expired: meta.expired === "1",
  };
}

export async function getIpfs(env: Env, ref: IpfsRef): Promise<CachedImage | null> {
  return readObject(await env.IPFS_CACHE.get(ipfsKey(ref)));
}

export async function putIpfs(
  env: Env,
  ref: IpfsRef,
  body: ArrayBuffer | ReadableStream<Uint8Array>,
  contentType: string,
  sanitized = false,
): Promise<void> {
  const custom: Record<string, string> = { fetchedAt: String(Date.now()) };
  if (sanitized) custom.sanitized = "1";
  await env.IPFS_CACHE.put(ipfsKey(ref), body, {
    httpMetadata: { contentType },
    customMetadata: custom,
  });
}

export async function getHttps(env: Env, url: string): Promise<CachedImage | null> {
  return readObject(await env.IPFS_CACHE.get(await httpsKey(url)));
}

export type HttpsValidators = {
  etag?: string;
  lastModified?: string;
};

export async function headHttps(env: Env, url: string): Promise<HttpsValidators | null> {
  const obj = await env.IPFS_CACHE.head(await httpsKey(url));
  if (!obj) return null;
  const meta = obj.customMetadata ?? {};
  return { etag: meta.etag, lastModified: meta.lastModified };
}

export async function putHttps(
  env: Env,
  url: string,
  body: ArrayBuffer | ReadableStream<Uint8Array>,
  contentType: string,
  etag?: string,
  lastModified?: string,
  sanitized = false,
): Promise<void> {
  const custom: Record<string, string> = { fetchedAt: String(Date.now()) };
  if (etag) custom.etag = etag;
  if (lastModified) custom.lastModified = lastModified;
  if (sanitized) custom.sanitized = "1";
  await env.IPFS_CACHE.put(await httpsKey(url), body, {
    httpMetadata: { contentType },
    customMetadata: custom,
  });
}

export type GeneratedImageKey = {
  network: string;
  contract: string;
  tokenHex: string;
  version: string;
};

function generatedKey(k: GeneratedImageKey): string {
  return `generated/${k.network}/${k.contract.toLowerCase()}/${k.tokenHex}/${k.version}.png`;
}

export async function getGenerated(
  env: Env,
  k: GeneratedImageKey,
): Promise<CachedImage | null> {
  return readObject(await env.IPFS_CACHE.get(generatedKey(k)));
}

export async function putGenerated(
  env: Env,
  k: GeneratedImageKey,
  bytes: ArrayBuffer,
  contentType: string,
  opts: { expired?: boolean } = {},
): Promise<void> {
  await env.IPFS_CACHE.put(generatedKey(k), bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      fetchedAt: String(Date.now()),
      expired: opts.expired ? "1" : "0",
    },
  });
}
