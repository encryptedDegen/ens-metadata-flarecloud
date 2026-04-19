import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { isAddress, keccak256, namehash, toHex } from "viem";
import type { Env } from "../env";
import { getNetwork } from "../lib/networks";
import { badRequest, notFound } from "../lib/errors";
import {
  queryDomainByLabelhash,
  queryDomainByNamehash,
} from "../services/subgraph";
import {
  BASE_REGISTRAR_V1,
  NAME_WRAPPER_V2,
  CACHE_API_MAX_AGE,
} from "../constants";
import {
  AddressParam,
  ErrorSchema,
  NFTMetadataSchema,
  NetworkParam,
  TokenIdParam,
  type MetadataAttribute,
} from "../schemas";

export const metadataRoutes = new OpenAPIHono<{ Bindings: Env }>();

const route = createRoute({
  method: "get",
  path: "/{network}/{contract}/{tokenId}",
  tags: ["metadata"],
  summary: "Get ENS NFT metadata JSON",
  request: {
    params: z.object({
      network: NetworkParam,
      contract: AddressParam,
      tokenId: TokenIdParam,
    }),
  },
  responses: {
    200: {
      description: "NFT metadata",
      content: { "application/json": { schema: NFTMetadataSchema } },
    },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

function tokenIdToHex(tokenId: string): `0x${string}` {
  if (tokenId.startsWith("0x")) return tokenId as `0x${string}`;
  try {
    return toHex(BigInt(tokenId), { size: 32 });
  } catch {
    throw badRequest(`invalid tokenId: ${tokenId}`);
  }
}

function contractKind(contract: string): "v1" | "v2" | null {
  const c = contract.toLowerCase();
  if (c === BASE_REGISTRAR_V1.toLowerCase()) return "v1";
  if (c === NAME_WRAPPER_V2.toLowerCase()) return "v2";
  return null;
}

metadataRoutes.openapi(route, async (c) => {
  const { network: networkName, contract, tokenId: tokenIdRaw } = c.req.valid("param");

  const network = getNetwork(c.env, networkName);
  if (!network) throw badRequest(`unknown network: ${networkName}`);
  if (!isAddress(contract)) throw badRequest("invalid contract address");

  const kind = contractKind(contract);
  if (!kind) throw badRequest(`unsupported contract: ${contract}`);

  const tokenHex = tokenIdToHex(tokenIdRaw);
  const record =
    kind === "v1"
      ? await queryDomainByLabelhash(network, c.env, tokenHex)
      : await queryDomainByNamehash(network, c.env, tokenHex);

  if (!record) throw notFound(`domain not found for token ${tokenIdRaw}`);

  const name = record.name ?? (record.labelName ? `${record.labelName}.eth` : null);
  const registration = record.registration;
  const attributes: MetadataAttribute[] = [];

  if (record.createdAt) {
    attributes.push({
      trait_type: "Created Date",
      display_type: "date",
      value: Number(record.createdAt) * 1000,
    });
  }
  if (record.labelName) {
    attributes.push({ trait_type: "Length", value: record.labelName.length });
  }
  if (registration?.registrationDate) {
    attributes.push({
      trait_type: "Registration Date",
      display_type: "date",
      value: Number(registration.registrationDate) * 1000,
    });
  }
  if (registration?.expiryDate) {
    attributes.push({
      trait_type: "Expiration Date",
      display_type: "date",
      value: Number(registration.expiryDate) * 1000,
    });
  }

  const tokenHash =
    kind === "v1" && record.labelName
      ? keccak256(new TextEncoder().encode(record.labelName))
      : name
        ? namehash(name)
        : tokenHex;

  c.header("cache-control", `public, max-age=${CACHE_API_MAX_AGE}`);
  return c.json(
    {
      is_normalized: !!name,
      name: name ?? "unknown.eth",
      description: name
        ? `${name}, an ENS name.`
        : "This domain name could not be resolved.",
      attributes,
      name_length: record.labelName?.length ?? null,
      url: name ? `https://app.ens.domains/name/${name}` : null,
      version: kind === "v1" ? 1 : 2,
      background_image: null,
      image: null,
      image_url: null,
      token_hash: tokenHash,
    },
    200,
  );
});
