"use client";

import { useAction } from "@solana/react";
import { toast } from "sonner";
import { notifyTransactionSuccess } from "../transaction-toast";
import { parseTransactionError } from "../errors";

type TxResult = { context: { signature: string } };
type ErrorMessageResolver = (error: unknown) => string | undefined;

export function useSend() {
  const { dispatchAsync, isRunning } = useAction(
    async (
      _signal: AbortSignal,
      action: () => Promise<TxResult>,
      successMessage: string,
      getErrorMessage?: ErrorMessageResolver
    ) => {
      try {
        const result = await action();
        const signature = result.context.signature;
        notifyTransactionSuccess(successMessage, signature);
        return signature;
      } catch (err) {
        console.error(err);
        toast.error(getErrorMessage?.(err) ?? parseTransactionError(err));
        return undefined;
      }
    }
  );

  return { run: dispatchAsync, isSending: isRunning };
}
