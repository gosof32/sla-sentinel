import { createAccount, createClient, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

export const CONTRACT_ADDRESS = (import.meta.env.VITE_CONTRACT_ADDRESS ||
  "0xa87340B3519D73428c21c8eA1Fb9D0Cd752f668e") as `0x${string}`;
export const RPC_URL = studionet.rpcUrls.default.http[0];
export const EXPLORER = "https://explorer-studio.genlayer.com";
export const GEN = 10n ** 18n;

const KEY_STORAGE = "sla-sentinel:burner-key";

export type Wallet =
  | { kind: "burner"; address: `0x${string}`; account: ReturnType<typeof createAccount> }
  | { kind: "injected"; address: `0x${string}` };

export function loadBurner(): Wallet {
  let key = localStorage.getItem(KEY_STORAGE) as `0x${string}` | null;
  if (!key) {
    key = generatePrivateKey();
    localStorage.setItem(KEY_STORAGE, key);
  }
  const account = createAccount(key);
  return { kind: "burner", address: account.address, account };
}

export function resetBurner(): Wallet {
  localStorage.removeItem(KEY_STORAGE);
  return loadBurner();
}

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<any> };
const eth = () => (window as unknown as { ethereum?: Eip1193 }).ethereum;
export const hasInjected = () => !!eth();

export async function connectInjected(): Promise<Wallet> {
  const provider = eth();
  if (!provider) throw new Error("No browser wallet found");
  const [address] = await provider.request({ method: "eth_requestAccounts" });
  const chainId = "0x" + studionet.id.toString(16);
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId, chainName: "GenLayer Studionet", nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 }, rpcUrls: [RPC_URL] }],
    });
  }
  return { kind: "injected", address };
}

export const reader = createClient({ chain: studionet });

export function writerFor(wallet: Wallet) {
  if (wallet.kind === "burner") return createClient({ chain: studionet, account: wallet.account });
  return createClient({ chain: studionet, account: wallet.address, provider: eth() as any });
}

export async function read<T>(functionName: string, args: unknown[] = []): Promise<T> {
  const raw = await reader.readContract({ address: CONTRACT_ADDRESS, functionName, args: args as any });
  return normalize(raw) as T;
}

export function normalize(v: any): any {
  if (typeof v === "bigint") return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
  if (v instanceof Map) return Object.fromEntries([...v.entries()].map(([k, x]) => [k, normalize(x)]));
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)]));
  return v;
}

export async function getBalance(address: string): Promise<bigint> {
  const res = await rpc("eth_getBalance", [address, "latest"]);
  return BigInt(res);
}

export async function faucet(address: string) {
  await rpc("sim_fundAccount", [address, 100 * 1e18]);
}

async function rpc(method: string, params: unknown[]) {
  const r = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result;
}

export function formatGen(wei: number | string | bigint, digits = 2) {
  const b = BigInt(wei);
  const whole = b / GEN;
  const frac = Number(b % GEN) / 1e18;
  return (Number(whole) + frac).toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function parseGen(v: string): bigint {
  const [w, f = ""] = v.trim().split(".");
  if (!/^\d+$/.test(w || "0") || !/^\d*$/.test(f)) throw new Error("Invalid GEN amount");
  return BigInt(w || "0") * GEN + BigInt((f + "0".repeat(18)).slice(0, 18));
}
