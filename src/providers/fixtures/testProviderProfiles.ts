import type { ProviderProfile } from "../providerProfileModel.ts";

export const testProviderProfiles: ProviderProfile[] = [
  {
    providerId: "user-provider-1",
    status: "approved",
    businessName: "Provider One Services",
    description: "Reliable home services from Provider One.",
    contactEmail: "contact@providerone.example",
    contactPhone: "+15551234567",
    updatedAt: Date.now(),
  },
  {
    providerId: "user-provider-2",
    status: "approved",
    businessName: "Provider Two Services",
    description: "Trusted services from Provider Two.",
    contactEmail: "contact@providertwo.example",
    contactPhone: "+15557654321",
    updatedAt: Date.now(),
  },
  {
    providerId: "user-provider-3",
    status: "pending",
    businessName: "Provider Three Services",
    description: "Application under review.",
    contactEmail: "contact@providerthree.example",
    contactPhone: "+15559876543",
    updatedAt: Date.now(),
  },
  {
    providerId: "user-provider-4",
    status: "rejected",
    businessName: "Provider Four Services",
    description: "Application was rejected.",
    contactEmail: "contact@providerfour.example",
    contactPhone: "+15551239876",
    updatedAt: Date.now(),
  },
];
