"use client";

import { useEffect } from "react";

let registration: Promise<void> | null = null;

function ensureMobileWalletAdapterRegistered() {
  if (typeof window === "undefined" || registration) return;

  registration = import("@solana-mobile/wallet-standard-mobile")
    .then(
      ({
        createDefaultAuthorizationCache,
        createDefaultChainSelector,
        createDefaultWalletNotFoundHandler,
        registerMwa,
      }) => {
        registerMwa({
          appIdentity: {
            name: "MotoLedger",
            uri: window.location.origin,
            icon: "icon.svg",
          },
          authorizationCache: createDefaultAuthorizationCache(),
          chains: [
            "solana:devnet",
            "solana:testnet",
            "solana:mainnet",
          ] as const,
          chainSelector: createDefaultChainSelector(),
          onWalletNotFound: createDefaultWalletNotFoundHandler(),
        });
      },
    )
    .catch((error: unknown) => {
      registration = null;
      console.warn("No se pudo registrar Mobile Wallet Adapter:", error);
    });
}

export function MobileWalletAdapterRegistration() {
  useEffect(() => {
    ensureMobileWalletAdapterRegistered();
  }, []);

  return null;
}
