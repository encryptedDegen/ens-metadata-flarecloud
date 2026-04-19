import type { Env } from "../env";
import { upstream } from "../lib/errors";

export type IpfsRef = {
  cid: string;
  path: string;
};

const CID_RE = /^(?:ipfs:\/\/)?(?:ipfs\/)?((?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[A-Za-z2-7]{58,}))(\/.+)?$/;

export function parseIpfs(uri: string): IpfsRef | null {
  const m = uri.match(CID_RE);
  if (!m) return null;
  return { cid: m[1]!, path: m[2] ?? "" };
}

function gateways(env: Env): string[] {
  return env.IPFS_GATEWAYS.split(",")
    .map((g) => g.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export async function fetchIpfs(env: Env, ref: IpfsRef): Promise<Response> {
  const list = gateways(env);
  if (list.length === 0) throw upstream("no IPFS gateways configured");

  let lastErr: unknown = null;
  for (const gw of list) {
    const url = `${gw}/ipfs/${ref.cid}${ref.path}`;
    try {
      const res = await fetch(url, {
        cf: { cacheTtl: 3600, cacheEverything: true },
      });
      if (res.ok) return res;
      lastErr = new Error(`${gw} → ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw upstream(`all IPFS gateways failed: ${detail}`, lastErr);
}
