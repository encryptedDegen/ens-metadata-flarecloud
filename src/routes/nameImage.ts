import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
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

// Bump per format whenever the template or rendering semantics change so
// cached objects don't serve stale output.
const SVG_CACHE_VERSION = "svg-v3";
const PNG_CACHE_VERSION = "png-v3";
const ACTIVE_MAX_AGE = 60 * 60 * 24 * 365;
const FALLBACK_MAX_AGE = 60 * 60;
const SVG_CONTENT_TYPE = "image/svg+xml";
const PNG_CONTENT_TYPE = "image/png";

const PathParams = z.object({
  network: NetworkParam,
  contract: AddressParam,
  tokenId: TokenIdParam,
});

const svgRoute = createRoute({
  method: "get",
  path: "/{network}/{contract}/{tokenId}/image",
  tags: ["metadata"],
  summary: "Get the rendered ENS name image as SVG",
  request: { params: PathParams },
  responses: {
    200: {
      description: "SVG image",
      content: { "image/svg+xml": { schema: z.string() } },
    },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

const pngRoute = createRoute({
  method: "get",
  path: "/{network}/{contract}/{tokenId}/image/png",
  tags: ["metadata"],
  summary: "Get the rendered ENS name image as PNG",
  request: { params: PathParams },
  responses: {
    200: {
      description: "PNG image",
      content: { "image/png": { schema: z.string() } },
    },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

// Post-expiry timeline for .eth: 90-day grace where the original owner can
// still renew, then a 21-day temporary premium (Dutch auction) before the
// name returns to base price.
const GRACE_PERIOD_MS = 90 * 24 * 60 * 60 * 1000;
const PREMIUM_PERIOD_MS = 21 * 24 * 60 * 60 * 1000;

type RegistrationState = "active" | "grace" | "premium" | "expired";

function getRegistrationState(
  expiryDateSeconds: string | null | undefined,
): RegistrationState {
  if (!expiryDateSeconds) return "active";
  const expiryMs = Number(expiryDateSeconds) * 1000;
  if (!Number.isFinite(expiryMs)) return "active";
  const now = Date.now();
  if (now < expiryMs) return "active";
  if (now < expiryMs + GRACE_PERIOD_MS) return "grace";
  if (now < expiryMs + GRACE_PERIOD_MS + PREMIUM_PERIOD_MS) return "premium";
  return "expired";
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

type RenderResult =
  | { kind: "svg"; svg: string; expired: boolean }
  | { kind: "response"; response: Response };

async function renderSvgFromParams(
  c: Context<{ Bindings: Env }>,
  networkName: string,
  contract: string,
  tokenId: string,
): Promise<RenderResult> {
  const resolved = await resolveDomain(c.env, networkName, contract, tokenId);
  const name =
    resolved.record.name
    ?? (resolved.record.labelName ? `${resolved.record.labelName}.eth` : null);
  if (!name) {
    return {
      kind: "response",
      response: c.json({ error: "not_found", message: "name not available" }, 404),
    };
  }
  const state = getRegistrationState(resolved.record.registration?.expiryDate);
  const expired = state !== "active";
  const { renderNameImage } = await import("../services/nameImage");
  const svg = await renderNameImage({
    env: c.env,
    ctx: c.executionCtx,
    networkName,
    name,
    tokenHex: resolved.tokenHex,
    state,
  });
  return { kind: "svg", svg, expired };
}

function utf8Bytes(s: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(s);
  return encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;
}

function uint8Bytes(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

nameImageRoutes.openapi(svgRoute, async (c) => {
  const { network: networkName, contract, tokenId } = c.req.valid("param");
  const cacheKey = {
    network: networkName,
    contract,
    tokenHex: tokenIdToHex(tokenId),
    version: SVG_CACHE_VERSION,
  };
  const hit = await getGenerated(c.env, cacheKey);
  if (hit) return respond(hit.bytes, hit.contentType, hit.expired ?? false) as never;

  const result = await renderSvgFromParams(c, networkName, contract, tokenId);
  if (result.kind === "response") return result.response as never;

  const { embedSatoshiFont } = await import("../services/nameImage");
  const selfContained = embedSatoshiFont(result.svg);
  const bytes = utf8Bytes(selfContained);
  c.executionCtx.waitUntil(
    putGenerated(c.env, cacheKey, bytes, SVG_CONTENT_TYPE, { expired: result.expired }),
  );
  return respond(selfContained, SVG_CONTENT_TYPE, result.expired) as never;
});

nameImageRoutes.openapi(pngRoute, async (c) => {
  const { network: networkName, contract, tokenId } = c.req.valid("param");
  const cacheKey = {
    network: networkName,
    contract,
    tokenHex: tokenIdToHex(tokenId),
    version: PNG_CACHE_VERSION,
  };
  const hit = await getGenerated(c.env, cacheKey);
  if (hit) return respond(hit.bytes, hit.contentType, hit.expired ?? false) as never;

  const rasterizerPromise = import("../services/rasterize");
  const result = await renderSvgFromParams(c, networkName, contract, tokenId);
  if (result.kind === "response") return result.response as never;

  const { rasterizeNameImageSvg } = await rasterizerPromise;
  const png = await rasterizeNameImageSvg(result.svg);
  const bytes = uint8Bytes(png);
  c.executionCtx.waitUntil(
    putGenerated(c.env, cacheKey, bytes, PNG_CONTENT_TYPE, { expired: result.expired }),
  );
  return respond(bytes, PNG_CONTENT_TYPE, result.expired) as never;
});
