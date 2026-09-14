export interface EmailService {
  send(to: string, subject: string, body: string): Promise<void>;
}

export interface SentMessage {
  to: string;
  subject: string;
  body: string;
}

export class InMemoryEmailService implements EmailService {
  sentMessages: SentMessage[] = [];

  async send(to: string, subject: string, body: string): Promise<void> {
    this.sentMessages.push({ to, subject, body });
  }
}

export class ConsoleEmailService implements EmailService {
  async send(to: string, subject: string, body: string): Promise<void> {
    console.log(`email to=${to} subject=${subject} body=${body}`);
  }
}
