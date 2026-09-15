import type { EmailMessage, EmailService } from "../src/notifications/emailService.ts";

export class RecordingEmailService implements EmailService {
  sentMessages: EmailMessage[] = [];

  send(message: EmailMessage): void {
    this.sentMessages.push(message);
  }
}
