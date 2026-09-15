export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface EmailService {
  send(message: EmailMessage): void;
}

export class ConsoleEmailService implements EmailService {
  send(message: EmailMessage): void {
    console.log(`email to=${message.to} subject="${message.subject}"`);
  }
}
