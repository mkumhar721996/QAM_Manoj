import crypto from "node:crypto";

export type RandomIntFn = (maxExclusive: number) => number;

export const secureRandomInt: RandomIntFn = (maxExclusive) => crypto.randomInt(maxExclusive);

export function fisherYatesShuffle<T>(items: T[], randomInt: RandomIntFn = secureRandomInt): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
