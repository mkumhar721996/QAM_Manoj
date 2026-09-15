import type { EmailMessage, EmailSender } from "../src/notifications/emailSender.ts";

export class FakeEmailSender implements EmailSender {
  sentMessages: EmailMessage[] = [];
  attemptCount = 0;
  private failTimes: number;

  constructor(options: { failTimes?: number } = {}) {
    this.failTimes = options.failTimes ?? 0;
  }

  async send(message: EmailMessage): Promise<void> {
    this.attemptCount += 1;
    if (this.attemptCount <= this.failTimes) {
      throw new Error("simulated delivery failure");
    }
    this.sentMessages.push(message);
  }
}
