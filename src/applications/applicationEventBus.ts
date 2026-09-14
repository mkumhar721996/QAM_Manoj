import { EventEmitter } from "node:events";
import type { Application } from "./applicationModel.ts";

export class ApplicationEventBus {
  private emitter = new EventEmitter();

  subscribe(providerId: string, listener: (application: Application) => void): () => void {
    this.emitter.on(providerId, listener);
    return () => {
      this.emitter.off(providerId, listener);
    };
  }

  publish(providerId: string, application: Application): void {
    this.emitter.emit(providerId, application);
  }
}
