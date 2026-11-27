import { ServiceRedemptionClient } from "./service-redemption-client";

export const dynamic = "force-dynamic";

export default async function ServiceRedemptionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ServiceRedemptionClient token={token} />;
}
