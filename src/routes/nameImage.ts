import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../env";
import { resolveDomain } from "../services/domain";
import { fetchImageBytes, maybeSanitizeSvg, resolveUriCached } from "../services/image";
import type { NameImageInput } from "../services/nameImage";
import { getGenerated, putGenerated } from "../storage/r2Cache";
import { HttpError } from "../lib/errors";
import {
  AddressParam,
  ErrorSchema,
  NetworkParam,
  TokenIdParam,
} from "../schemas";

export const nameImageRoutes = new OpenAPIHono<{ Bindings: Env }>();

const CACHE_VERSION = "v26";
const ACTIVE_MAX_AGE = 60 * 60 * 24 * 365;
const FALLBACK_MAX_AGE = 60 * 60;
const PNG_CONTENT_TYPE = "image/png";

const route = createRoute({
  method: "get",
  path: "/{network}/{contract}/{tokenId}/image",
  tags: ["metadata"],
  summary: "Get the rendered ENS name image",
  request: {
    params: z.object({
      network: NetworkParam,
      contract: AddressParam,
      tokenId: TokenIdParam,
    }),
  },
  responses: {
    200: {
      description: "PNG image bytes",
      content: { "image/png": { schema: z.string().openapi({ format: "binary" }) } },
    },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function resolveAvatarIfAny(
  env: Env,
  networkName: string,
  name: string,
): Promise<{ uri: string; input: NameImageInput["avatar"] } | null> {
  let uri: string;
  try {
    uri = await resolveUriCached(env, "avatar", networkName, name);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    return null;
  }
  try {
    const image = await maybeSanitizeSvg(await fetchImageBytes(env, uri));
    return {
      uri,
      input: { contentType: image.contentType, bytes: image.bytes },
    };
  } catch {
    return { uri, input: null };
  }
}

function isExpired(expiryDateSeconds: string | null | undefined): boolean {
  if (!expiryDateSeconds) return false;
  const expiryMs = Number(expiryDateSeconds) * 1000;
  return Number.isFinite(expiryMs) && expiryMs < Date.now();
}

nameImageRoutes.openapi(route, async (c) => {
  const { network: networkName, contract, tokenId } = c.req.valid("param");
  const resolved = await resolveDomain(c.env, networkName, contract, tokenId);

  const name = resolved.record.name
    ?? (resolved.record.labelName ? `${resolved.record.labelName}.eth` : null);

  if (!name) {
    return c.json({ error: "not_found", message: "name not available" }, 404) as never;
  }

  const expired = isExpired(resolved.record.registration?.expiryDate);
  const avatar = await resolveAvatarIfAny(c.env, networkName, name);
  const avatarHash = avatar ? await sha256Hex(avatar.uri) : null;

  const cacheKey = {
    network: networkName,
    contract,
    tokenHex: resolved.tokenHex,
    avatarHash,
    version: CACHE_VERSION,
  };

  const hit = await getGenerated(c.env, cacheKey);
  const maxAge = expired ? FALLBACK_MAX_AGE : ACTIVE_MAX_AGE;

  if (hit) {
    return new Response(hit.bytes, {
      headers: {
        "content-type": hit.contentType,
        "cache-control": `public, max-age=${maxAge}`,
      },
    }) as never;
  }

  const { renderNameImage } = await import("../services/nameImage");
  const png = await renderNameImage({
    name,
    expired,
    avatar: avatar?.input ?? null,
  });

  c.executionCtx.waitUntil(putGenerated(c.env, cacheKey, png, PNG_CONTENT_TYPE));

  return new Response(png, {
    headers: {
      "content-type": PNG_CONTENT_TYPE,
      "cache-control": `public, max-age=${maxAge}`,
    },
  }) as never;
});
