export interface ShoeConfig {
  numberOfDecks: number;
  penetrationThreshold: number;
}

export const DEFAULT_NUMBER_OF_DECKS = 6;
export const DEFAULT_PENETRATION_THRESHOLD = 260;

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, received "${value}"`);
  }
  return parsed;
}

export function loadShoeConfig(env: NodeJS.ProcessEnv = process.env): ShoeConfig {
  const numberOfDecks = env.SHOE_NUMBER_OF_DECKS
    ? parsePositiveInteger(env.SHOE_NUMBER_OF_DECKS, "SHOE_NUMBER_OF_DECKS")
    : DEFAULT_NUMBER_OF_DECKS;
  const penetrationThreshold = env.SHOE_PENETRATION_THRESHOLD
    ? parsePositiveInteger(env.SHOE_PENETRATION_THRESHOLD, "SHOE_PENETRATION_THRESHOLD")
    : DEFAULT_PENETRATION_THRESHOLD;
  return { numberOfDecks, penetrationThreshold };
}
