"use client";

import { useEffect } from "react";

let registration: Promise<void> | null = null;

function ensureMobileWalletAdapterRegistered() {
  if (typeof window === "undefined" || registration) return;

  registration = import("@solana-mobile/wallet-standard-mobile")
    .then(
      async ({
        createDefaultAuthorizationCache,
        createDefaultChainSelector,
        createDefaultWalletNotFoundHandler,
        registerMwa,
      }) => {
        const authorizationCache = createDefaultAuthorizationCache();

        // A wallet-link QR must start with an explicit wallet authorization.
        // Clear the persisted MWA auth token before registering the wallet so
        // a previous approval cannot silently reconnect the old account.
        if (window.location.pathname.startsWith("/vincular-wallet/")) {
          await authorizationCache.clear();
        }

        registerMwa({
          appIdentity: {
            name: "MotoLedger",
            uri: window.location.origin,
            icon: "icon.svg",
          },
          authorizationCache,
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
