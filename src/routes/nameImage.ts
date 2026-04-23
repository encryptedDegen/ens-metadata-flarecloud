import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../env";
import { resolveDomain, tokenIdToHex } from "../services/domain";
import { getGenerated, putGenerated } from "../storage/r2Cache";
import {
  AddressParam,
  ErrorSchema,
  NetworkParam,
  TokenIdParam,
} from "../schemas";

export const nameImageRoutes = new OpenAPIHono<{ Bindings: Env }>();

// Bump whenever the SVG template or rendering semantics change so cached
// objects don't serve stale output.
const CACHE_VERSION = "svg-v1";
const ACTIVE_MAX_AGE = 60 * 60 * 24 * 365;
const FALLBACK_MAX_AGE = 60 * 60;
const SVG_CONTENT_TYPE = "image/svg+xml";

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
      description: "SVG image",
      content: { "image/svg+xml": { schema: z.string() } },
    },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

function isExpired(expiryDateSeconds: string | null | undefined): boolean {
  if (!expiryDateSeconds) return false;
  const expiryMs = Number(expiryDateSeconds) * 1000;
  return Number.isFinite(expiryMs) && expiryMs < Date.now();
}

function respond(
  body: ArrayBuffer | string,
  contentType: string,
  expired: boolean,
): Response {
  const maxAge = expired ? FALLBACK_MAX_AGE : ACTIVE_MAX_AGE;
  return new Response(body, {
    headers: {
      "content-type": contentType,
      "cache-control": `public, max-age=${maxAge}`,
    },
  });
}

nameImageRoutes.openapi(route, async (c) => {
  const { network: networkName, contract, tokenId } = c.req.valid("param");

  const cacheKey = {
    network: networkName,
    contract,
    tokenHex: tokenIdToHex(tokenId),
    version: CACHE_VERSION,
  };
  const hit = await getGenerated(c.env, cacheKey);

  if (hit) {
    return respond(hit.bytes, hit.contentType, hit.expired ?? false) as never;
  }

  const rendererPromise = import("../services/nameImage");
  const resolved = await resolveDomain(c.env, networkName, contract, tokenId);

  const name =
    resolved.record.name
    ?? (resolved.record.labelName ? `${resolved.record.labelName}.eth` : null);

  if (!name) {
    return c.json({ error: "not_found", message: "name not available" }, 404) as never;
  }

  const expired = isExpired(resolved.record.registration?.expiryDate);

  const { renderNameImage } = await rendererPromise;
  const svg = await renderNameImage({
    env: c.env,
    ctx: c.executionCtx,
    networkName,
    name,
    tokenHex: resolved.tokenHex,
    expired,
  });

  const encoded = new TextEncoder().encode(svg);
  const bytes = encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;
  c.executionCtx.waitUntil(
    putGenerated(c.env, cacheKey, bytes, SVG_CONTENT_TYPE, { expired }),
  );

  return respond(svg, SVG_CONTENT_TYPE, expired) as never;
});
