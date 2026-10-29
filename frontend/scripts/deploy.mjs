// Deploys contracts/sla_sentinel.py to GenLayer Studionet.
// Usage: DEPLOYER_PRIVATE_KEY=0x... node scripts/deploy.mjs
import { readFileSync } from "node:fs";
import { createAccount, createClient, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const key = process.env.DEPLOYER_PRIVATE_KEY || generatePrivateKey();
const account = createAccount(key);
const client = createClient({ chain: studionet, account });
const code = readFileSync(new URL("../../contracts/sla_sentinel.py", import.meta.url), "utf8");

console.log("deployer", account.address);
const hash = await client.deployContract({ code, args: [] });
console.log("tx", hash);
const tx = await client.waitForTransactionReceipt({ hash, status: "ACCEPTED", interval: 3000, retries: 100 });
const address = tx.txDataDecoded?.contractAddress || tx.data?.contract_address || tx.recipient;
const lr = tx.consensus_data?.leader_receipt?.[0];
console.log("status", tx.statusName ?? tx.status, "consensus", tx.result_name, "execution", lr?.execution_result);
console.log("contract", address);
