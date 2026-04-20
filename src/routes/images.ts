import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../env";
import type { AvatarKind } from "../services/avatarResolver";
import {
  fetchImageBytes,
  maybeSanitizeSvg,
  resolveUriCached,
} from "../services/image";
import { HttpError } from "../lib/errors";
import { SVG_MIME } from "../lib/mime";
import defaultAvatarSvg from "../assets/default-avatar.svg";
import defaultHeaderSvg from "../assets/default-header.svg";
import {
  AvatarMetaSchema,
  ErrorSchema,
  NameParam,
  NetworkParam,
} from "../schemas";
import { CACHE_API_MAX_AGE } from "../constants";

const DEFAULT_IMAGES: Record<AvatarKind, string> = {
  avatar: defaultAvatarSvg,
  header: defaultHeaderSvg,
};

function defaultImageResponse(kind: AvatarKind): Response {
  return new Response(DEFAULT_IMAGES[kind], {
    headers: {
      "content-type": SVG_MIME,
      "cache-control": `public, max-age=${CACHE_API_MAX_AGE}`,
    },
  });
}

function imageRoute(kind: AvatarKind) {
  return createRoute({
    method: "get",
    path: `/{network}/${kind}/{name}`,
    tags: [kind],
    summary: `Get resolved ${kind} image bytes for an ENS name`,
    request: {
      params: z.object({ network: NetworkParam, name: NameParam }),
    },
    responses: {
      200: {
        description: "Image bytes",
        content: { "image/*": { schema: z.string().openapi({ format: "binary" }) } },
      },
      404: { description: "Record not set", content: { "application/json": { schema: ErrorSchema } } },
      502: { description: "Upstream fetch failed", content: { "application/json": { schema: ErrorSchema } } },
    },
  });
}

function metaRoute(kind: AvatarKind) {
  return createRoute({
    method: "get",
    path: `/{network}/${kind}/{name}/meta`,
    tags: [kind],
    summary: `Get the resolved ${kind} URI without fetching the image`,
    request: {
      params: z.object({ network: NetworkParam, name: NameParam }),
    },
    responses: {
      200: {
        description: "Resolved URI metadata",
        content: { "application/json": { schema: AvatarMetaSchema } },
      },
      404: { description: "Record not set", content: { "application/json": { schema: ErrorSchema } } },
    },
  });
}

function buildImageRoutes(kind: AvatarKind): OpenAPIHono<{ Bindings: Env }> {
  const app = new OpenAPIHono<{ Bindings: Env }>();

  app.openapi(imageRoute(kind), async (c) => {
    const { network, name } = c.req.valid("param");
    try {
      const uri = await resolveUriCached(c.env, kind, network, name);
      const image = await maybeSanitizeSvg(await fetchImageBytes(c.env, uri));

      return new Response(image.bytes, {
        headers: {
          "content-type": image.contentType,
          "cache-control": `public, max-age=${CACHE_API_MAX_AGE}`,
        },
      }) as never;
    } catch (err) {
      // 404 = record not set; 502 = record set but upstream fetch failed.
      // Both are "no usable image available" from the caller's perspective,
      // so serve the default. 415 (unsupported URI scheme, e.g. eip155:...)
      // stays a real error since it signals a server limitation.
      if (err instanceof HttpError && (err.status === 404 || err.status === 502)) {
        return defaultImageResponse(kind) as never;
      }
      throw err;
    }
  });

  app.openapi(metaRoute(kind), async (c) => {
    const { network, name } = c.req.valid("param");
    const uri = await resolveUriCached(c.env, kind, network, name);
    return c.json({ name, network, uri, kind }, 200);
  });

  return app;
}

export const avatarRoutes = buildImageRoutes("avatar");
export const headerRoutes = buildImageRoutes("header");
