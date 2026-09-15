import { buildDeck } from "./cardModel.ts";
import type { Card } from "./cardModel.ts";
import { fisherYatesShuffle, secureRandomInt } from "./random.ts";
import type { RandomIntFn } from "./random.ts";
import { loadShoeConfig } from "./shoeConfig.ts";
import type { ShoeConfig } from "./shoeConfig.ts";

export class Shoe {
  private config: ShoeConfig;
  private randomInt: RandomIntFn;
  private cards: Card[] = [];
  private dealtCount = 0;

  constructor(config: ShoeConfig = loadShoeConfig(), randomInt: RandomIntFn = secureRandomInt) {
    this.config = config;
    this.randomInt = randomInt;
    this.shuffleNewShoe();
  }

  private shuffleNewShoe(): void {
    const freshCards: Card[] = [];
    for (let i = 0; i < this.config.numberOfDecks; i++) {
      freshCards.push(...buildDeck());
    }
    this.cards = fisherYatesShuffle(freshCards, this.randomInt);
    this.dealtCount = 0;
  }

  remainingCards(): readonly Card[] {
    return this.cards;
  }

  size(): number {
    return this.cards.length;
  }

  needsReshuffle(): boolean {
    return this.dealtCount >= this.config.penetrationThreshold;
  }

  prepareForNextHand(): void {
    if (this.needsReshuffle()) {
      this.shuffleNewShoe();
    }
  }

  deal(): Card {
    const card = this.cards.pop();
    if (!card) {
      throw new Error("shoe is empty");
    }
    this.dealtCount++;
    return card;
  }
}
