import { Dashboard } from "@/components/dashboard";
import { publicConfiguration } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function Page() {
  const initialConfig = publicConfiguration();
  return <Dashboard initialConfig={initialConfig} />;
}
