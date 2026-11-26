import { WalletLinkClient } from "./wallet-link-client";

export default async function WalletLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <WalletLinkClient token={token} />;
}
