import { useCallback, useEffect, useRef, useState } from "react";
import { CONTRACT_ADDRESS, reader, writerFor, type Wallet } from "./genlayer";

export type Phase = "signing" | "submitted" | "pending" | "accepted" | "finalized" | "failed" | "rejected";

export type TrackedTx = {
  id: string;
  label: string;
  hash?: string;
  phase: Phase;
  status?: string;
  execution?: string;
  error?: string;
  result?: unknown;
  createdAt: number;
};

const STORAGE = "sla-sentinel:txs";
const TERMINAL: Phase[] = ["finalized", "failed", "rejected"];
const FAILED_STATUSES = ["UNDETERMINED", "CANCELED", "LEADER_TIMEOUT", "VALIDATORS_TIMEOUT"];

function load(): TrackedTx[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) || "[]");
  } catch {
    return [];
  }
}

export function receiptOutcome(tx: any) {
  const status: string = tx?.statusName || String(tx?.status ?? "");
  const lr = tx?.consensus_data?.leader_receipt?.[0];
  const execution: string | undefined = lr?.execution_result;
  const result = lr?.result;
  const errorText = execution && execution !== "SUCCESS" ? decodeError(result) : undefined;
  return { status, execution, result, errorText };
}

function decodeError(result: any): string {
  const payload = result?.payload ?? result;
  if (typeof payload === "string") return payload;
  if (payload?.readable) return String(payload.readable);
  if (payload?.message) return String(payload.message);
  return JSON.stringify(payload ?? "Execution failed").slice(0, 300);
}

export function useTransactions(onSettled: () => void) {
  const [txs, setTxs] = useState<TrackedTx[]>(load);
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  useEffect(() => {
    localStorage.setItem(STORAGE, JSON.stringify(txs.slice(0, 30)));
  }, [txs]);

  const patch = useCallback((id: string, p: Partial<TrackedTx>) => {
    setTxs((all) => all.map((t) => (t.id === id ? { ...t, ...p } : t)));
  }, []);

  const poll = useCallback(
    async (id: string, hash: string) => {
      for (let i = 0; i < 400; i++) {
        try {
          const tx = await reader.getTransaction({ hash: hash as any });
          const { status, execution, result, errorText } = receiptOutcome(tx);
          if (FAILED_STATUSES.includes(status)) {
            patch(id, { phase: "failed", status, execution, error: `Consensus ended as ${status}` });
            settledRef.current();
            return;
          }
          if (status === "ACCEPTED" || status === "FINALIZED") {
            if (execution && execution !== "SUCCESS") {
              patch(id, { phase: "failed", status, execution, error: errorText });
            } else {
              patch(id, { phase: status === "FINALIZED" ? "finalized" : "accepted", status, execution, result });
            }
            settledRef.current();
            if (status === "FINALIZED" || (execution && execution !== "SUCCESS")) return;
          } else {
            patch(id, { phase: "pending", status });
          }
        } catch {
          // transient RPC errors: keep polling the same hash, never resubmit
        }
        await new Promise((r) => setTimeout(r, 4000));
      }
    },
    [patch],
  );

  useEffect(() => {
    for (const t of load()) if (t.hash && !TERMINAL.includes(t.phase)) poll(t.id, t.hash);
  }, [poll]);

  const send = useCallback(
    async (wallet: Wallet, label: string, functionName: string, args: unknown[], value: bigint = 0n) => {
      const id = crypto.randomUUID();
      setTxs((all) => [{ id, label, phase: "signing", createdAt: Date.now() }, ...all]);
      let hash: string;
      try {
        hash = await writerFor(wallet).writeContract({ address: CONTRACT_ADDRESS, functionName, args: args as any, value });
      } catch (e: any) {
        patch(id, { phase: "rejected", error: e?.shortMessage || e?.message || String(e) });
        return;
      }
      patch(id, { hash, phase: "submitted" });
      poll(id, hash);
    },
    [patch, poll],
  );

  const track = useCallback(
    (hash: string) => {
      const id = crypto.randomUUID();
      setTxs((all) => [{ id, label: "Resumed transaction", hash, phase: "submitted", createdAt: Date.now() }, ...all]);
      poll(id, hash);
    },
    [poll],
  );

  const clear = useCallback(() => setTxs((all) => all.filter((t) => !TERMINAL.includes(t.phase))), []);

  return { txs, send, track, clear };
}
