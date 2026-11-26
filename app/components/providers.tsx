"use client";

import { Toaster } from "sonner";
import { PropsWithChildren } from "react";
import { ClusterProvider } from "./cluster-context";
import { MobileWalletAdapterRegistration } from "./mobile-wallet-adapter";
import { AppClientProvider } from "../lib/client-provider";

export function Providers({ children }: PropsWithChildren) {
  return (
    <ClusterProvider>
      <MobileWalletAdapterRegistration />
      <AppClientProvider>{children}</AppClientProvider>
      <Toaster position="bottom-right" richColors />
    </ClusterProvider>
  );
}
