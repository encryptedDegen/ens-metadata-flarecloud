import { GraphQLClient, gql } from "graphql-request";
import type { NetworkConfig } from "../lib/networks";
import type { Env } from "../env";
import { ETH_NAMEHASH } from "../constants";

export type DomainRecord = {
  id: string;
  name: string | null;
  labelName: string | null;
  labelhash: string;
  createdAt: string;
  registration: {
    registrationDate: string;
    expiryDate: string;
  } | null;
  owner: { id: string } | null;
};

const DOMAIN_BY_LABELHASH = gql`
  query DomainByLabelhash($labelhash: String!) {
    domains(where: { labelhash: $labelhash, parent: "${ETH_NAMEHASH}" }, first: 1) {
      id
      name
      labelName
      labelhash
      createdAt
      registration { registrationDate expiryDate }
      owner { id }
    }
  }
`;

const DOMAIN_BY_NAMEHASH = gql`
  query DomainByNamehash($id: ID!) {
    domain(id: $id) {
      id
      name
      labelName
      labelhash
      createdAt
      registration { registrationDate expiryDate }
      owner { id }
    }
  }
`;

function client(network: NetworkConfig, env: Env): GraphQLClient {
  const headers: Record<string, string> = {};
  if (env.THE_GRAPH_API_KEY) {
    headers.Authorization = `Bearer ${env.THE_GRAPH_API_KEY}`;
  }
  return new GraphQLClient(network.subgraphUrl, { headers });
}

export async function queryDomainByLabelhash(
  network: NetworkConfig,
  env: Env,
  labelhash: `0x${string}`,
): Promise<DomainRecord | null> {
  const c = client(network, env);
  const data = await c.request<{ domains: DomainRecord[] }>(DOMAIN_BY_LABELHASH, { labelhash });
  return data.domains[0] ?? null;
}

export async function queryDomainByNamehash(
  network: NetworkConfig,
  env: Env,
  namehash: `0x${string}`,
): Promise<DomainRecord | null> {
  const c = client(network, env);
  const data = await c.request<{ domain: DomainRecord | null }>(DOMAIN_BY_NAMEHASH, {
    id: namehash,
  });
  return data.domain;
}
