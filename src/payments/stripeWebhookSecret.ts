export class StripeWebhookSecretMissingError extends Error {}

export function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new StripeWebhookSecretMissingError("STRIPE_WEBHOOK_SECRET environment variable must be set");
  }
  return secret;
}
