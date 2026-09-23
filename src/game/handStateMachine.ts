import type { Card } from "./card.ts";
import { handTotal } from "./card.ts";

export type HandState = "new" | "player-turn" | "bust" | "dealer-turn" | "outcome" | "complete";
export type PlayerAction = "hit" | "stand" | "double-down";

export interface DealtCard extends Card {
  faceUp: boolean;
}

export interface CardSource {
  draw(): Card;
}

export class IllegalActionError extends Error {}

export class HandStateMachine {
  private state: HandState = "new";
  private playerCards: DealtCard[] = [];
  private dealerCards: DealtCard[] = [];
  private readonly cardSource: CardSource;

  constructor(cardSource: CardSource) {
    this.cardSource = cardSource;
  }

  getState(): HandState {
    return this.state;
  }

  getPlayerCards(): readonly DealtCard[] {
    return this.playerCards;
  }

  getDealerCards(): readonly DealtCard[] {
    return this.dealerCards;
  }

  deal(): void {
    this.playerCards = [this.draw(true), this.draw(true)];
    this.dealerCards = [this.draw(true), this.draw(false)];
    this.state = "player-turn";
  }

  hit(): void {
    this.assertPlayerTurn("hit");
    this.playerCards.push(this.draw(true));
    if (handTotal(this.playerCards) > 21) {
      this.state = "bust";
    }
  }

  stand(): void {
    this.assertPlayerTurn("stand");
    this.state = "dealer-turn";
  }

  doubleDown(): void {
    this.assertPlayerTurn("double-down");
    this.playerCards.push(this.draw(true));
    this.state = "dealer-turn";
  }

  completeDealerTurn(): void {
    if (this.state !== "dealer-turn") {
      throw new IllegalActionError(`cannot complete dealer turn while in state "${this.state}"`);
    }
    this.state = "outcome";
  }

  resolveOutcome(): void {
    if (this.state !== "outcome") {
      throw new IllegalActionError(`cannot resolve outcome while in state "${this.state}"`);
    }
    this.state = "complete";
  }

  private draw(faceUp: boolean): DealtCard {
    return { ...this.cardSource.draw(), faceUp };
  }

  private assertPlayerTurn(action: PlayerAction): void {
    if (this.state !== "player-turn") {
      throw new IllegalActionError(`cannot ${action} while in state "${this.state}"`);
    }
  }
}
