import type { Metadata } from "next";
import { WalletLinkClient } from "./wallet-link-client";

export const metadata: Metadata = {
  title: "Vinculación de wallet | MotoLedger",
  robots: { index: false, follow: false },
};

export default async function WalletLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <WalletLinkClient token={token} />;
}
