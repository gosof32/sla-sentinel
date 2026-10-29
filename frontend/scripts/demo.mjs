// Seeds the live demo on Studionet: one GitHub SLA, funded pool, two customers,
// four real September 2026 GitHub incidents adjudicated, September settled.
// Usage: CONTRACT=0x... DEPLOYER_PRIVATE_KEY=0x... CUSTOMER_PRIVATE_KEY=0x... node scripts/demo.mjs
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const address = process.env.CONTRACT;
const vendor = createAccount(process.env.DEPLOYER_PRIVATE_KEY);
const customer = createAccount(process.env.CUSTOMER_PRIVATE_KEY);
const GEN = 10n ** 18n;

async function fund(addr) {
  await fetch(studionet.rpcUrls.default.http[0], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sim_fundAccount", params: [addr, Number(1000n * GEN)] }),
  });
}

async function send(account, functionName, args, value = 0n) {
  const client = createClient({ chain: studionet, account });
  const hash = await client.writeContract({ address, functionName, args, value });
  const tx = await client.waitForTransactionReceipt({ hash, status: "ACCEPTED", interval: 4000, retries: 150 });
  const lr = tx.consensus_data?.leader_receipt?.[0];
  console.log(functionName, args.join(" "), "->", tx.statusName ?? tx.status, tx.result_name, lr?.execution_result, JSON.stringify(lr?.result)?.slice(0, 200), hash);
  return tx;
}

await fund(vendor.address);
await fund(customer.address);
const reader = createClient({ chain: studionet });
const before = Number(await reader.readContract({ address, functionName: "get_sla_count", args: [] }));
await send(vendor, "create_sla", [
  "GitHub Core Developer Platform",
  "www.githubstatus.com",
  "Git Operations, API Requests, Pull Requests, Actions, Webhooks",
  "Scheduled maintenance announced in advance. Outages of third-party AI model providers used by Copilot.",
  "9990:10,9950:25,9900:50",
  50,
  "2026-09",
], 50n * GEN);
const slaId = before + 1;
await send(vendor, "fund_pool", [slaId], 10n * GEN);
await send(vendor, "enroll_customer", [slaId, customer.address, 40n * GEN]);
await send(vendor, "enroll_customer", [slaId, "0x000000000000000000000000000000000000dEaD", 20n * GEN]);
for (const id of (process.env.INCIDENTS || "0rn90wk115q9,f6yrxnz5f7bs,nlxnbqnkdzdl,jk2dy5h9yp3m").split(",")) {
  await send(customer, "file_incident", [slaId, id]);
}
await send(customer, "close_month", [slaId, "2026-09"]);
console.log(JSON.stringify(await reader.readContract({ address, functionName: "get_months", args: [slaId] }), (k, v) => typeof v === "bigint" ? v.toString() : v));
console.log(JSON.stringify(await reader.readContract({ address, functionName: "get_customers", args: [slaId] }), (k, v) => typeof v === "bigint" ? v.toString() : v));
await send(customer, "withdraw_credit", [slaId]);
