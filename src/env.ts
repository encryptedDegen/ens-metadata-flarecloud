export type Env = {
  IPFS_CACHE: R2Bucket;
  RESOLVER_CACHE: KVNamespace;

  ETH_RPC_URL: string;
  SEPOLIA_RPC_URL: string;
  HOLESKY_RPC_URL: string;
  IPFS_GATEWAYS: string;
  SUBGRAPH_URL_MAINNET: string;
  SUBGRAPH_URL_SEPOLIA: string;
  SUBGRAPH_URL_HOLESKY: string;

  THE_GRAPH_API_KEY?: string;
  RPC_API_KEY?: string;
  PINATA_GATEWAY_TOKEN?: string;
};
