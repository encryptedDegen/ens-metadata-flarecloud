import type { Env } from "../env";
import type { AvatarKind } from "../services/avatarResolver";
import { RESOLVER_TTL_SECONDS } from "../constants";

function key(kind: AvatarKind, network: string, name: string): string {
  return `${kind}:${network}:${name.toLowerCase()}`;
}

export async function getResolved(
  env: Env,
  kind: AvatarKind,
  network: string,
  name: string,
): Promise<string | null> {
  return env.RESOLVER_CACHE.get(key(kind, network, name));
}

export async function putResolved(
  env: Env,
  kind: AvatarKind,
  network: string,
  name: string,
  uri: string,
): Promise<void> {
  await env.RESOLVER_CACHE.put(key(kind, network, name), uri, {
    expirationTtl: RESOLVER_TTL_SECONDS,
  });
}
