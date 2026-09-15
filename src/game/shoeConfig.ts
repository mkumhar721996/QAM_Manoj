export interface ShoeConfig {
  numberOfDecks: number;
  penetrationThreshold: number;
}

export const DEFAULT_NUMBER_OF_DECKS = 6;
export const DEFAULT_PENETRATION_THRESHOLD = 260;

export function loadShoeConfig(env: NodeJS.ProcessEnv = process.env): ShoeConfig {
  const numberOfDecks = env.SHOE_NUMBER_OF_DECKS ? Number(env.SHOE_NUMBER_OF_DECKS) : DEFAULT_NUMBER_OF_DECKS;
  const penetrationThreshold = env.SHOE_PENETRATION_THRESHOLD
    ? Number(env.SHOE_PENETRATION_THRESHOLD)
    : DEFAULT_PENETRATION_THRESHOLD;
  return { numberOfDecks, penetrationThreshold };
}
