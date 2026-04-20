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

const CACHE_VERSION = "v28";
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

function isExpired(expiryDateSeconds: string | null | undefined): boolean {
  if (!expiryDateSeconds) return false;
  const expiryMs = Number(expiryDateSeconds) * 1000;
  return Number.isFinite(expiryMs) && expiryMs < Date.now();
}

function respond(
  bytes: ArrayBuffer,
  contentType: string,
  expired: boolean,
): Response {
  const maxAge = expired ? FALLBACK_MAX_AGE : ACTIVE_MAX_AGE;
  return new Response(bytes, {
    headers: {
      "content-type": contentType,
      "cache-control": `public, max-age=${maxAge}`,
    },
  });
}

nameImageRoutes.openapi(route, async (c) => {
  const { network: networkName, contract, tokenId } = c.req.valid("param");

  // Cache check runs before any external call. On a hit we skip the subgraph
  // lookup, the workers-og load, and the renderer entirely.
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

  // Miss: kick off the wasm-heavy renderer import in parallel with the
  // subgraph fetch so the cold path overlaps module load with network IO.
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
  const png = await renderNameImage({
    env: c.env,
    networkName,
    name,
    expired,
  });

  c.executionCtx.waitUntil(
    putGenerated(c.env, cacheKey, png, PNG_CONTENT_TYPE, { expired }),
  );

  return respond(png, PNG_CONTENT_TYPE, expired) as never;
});
