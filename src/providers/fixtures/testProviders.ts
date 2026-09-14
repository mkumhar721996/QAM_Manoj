import type { Provider } from "../providerModel.ts";

export const testProviders: Provider[] = [
  { id: "provider-approved-1", name: "Approved Provider", approved: true },
  { id: "provider-pending-1", name: "Pending Provider", approved: false },
];
