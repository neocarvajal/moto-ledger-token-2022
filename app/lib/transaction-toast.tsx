"use client";

import { toast } from "sonner";

export function notifyTransactionSuccess(message: string, signature: string) {
  const explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  let toastId: string | number = "";

  toastId = toast.success(message, {
    duration: Infinity,
    closeButton: true,
    description: (
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => toast.dismiss(toastId)}
        className="font-medium underline underline-offset-2"
      >
        Ver transacción en Solana Explorer ↗
      </a>
    ),
  });
}
