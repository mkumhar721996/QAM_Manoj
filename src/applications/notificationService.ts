import type { Application, ApplicationState } from "./applicationModel.ts";

export const NOTIFICATION_MAX_ATTEMPTS = 3;

export interface EmailSender {
  send(to: string, subject: string, body: string): Promise<void>;
}

export interface AdminAlert {
  applicationId: string;
  providerId: string;
  state: ApplicationState;
  error: string;
}

export interface AdminAlertSender {
  raise(alert: AdminAlert): Promise<void>;
}

export class ConsoleEmailSender implements EmailSender {
  async send(to: string, subject: string, body: string): Promise<void> {
    console.log(`email to=${to} subject="${subject}" body="${body}"`);
  }
}

export class ConsoleAdminAlertSender implements AdminAlertSender {
  async raise(alert: AdminAlert): Promise<void> {
    console.error(`admin alert: notification delivery failed`, alert);
  }
}

export class NotificationService {
  private emailSender: EmailSender;
  private adminAlertSender: AdminAlertSender;
  private maxAttempts: number;

  constructor(
    emailSender: EmailSender,
    adminAlertSender: AdminAlertSender,
    maxAttempts: number = NOTIFICATION_MAX_ATTEMPTS,
  ) {
    this.emailSender = emailSender;
    this.adminAlertSender = adminAlertSender;
    this.maxAttempts = maxAttempts;
  }

  async notifyStateChange(application: Application, providerEmail: string): Promise<void> {
    const subject = `Your application status has changed to ${application.state}`;
    const body =
      application.state === "rejected"
        ? `Your application was rejected. Reason: ${application.rejectionReason}`
        : `Your application status is now: ${application.state}`;

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        await this.emailSender.send(providerEmail, subject, body);
        return;
      } catch (err) {
        lastError = err;
      }
    }

    await this.adminAlertSender.raise({
      applicationId: application.id,
      providerId: application.providerId,
      state: application.state,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    });
  }
}
