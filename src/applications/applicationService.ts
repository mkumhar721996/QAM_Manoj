import type { Application, ApplicationState } from "./applicationModel.ts";
import { NOTIFIED_TRANSITIONS, VALID_TRANSITIONS } from "./applicationModel.ts";
import { ApplicationRepository } from "./applicationRepository.ts";
import { CredentialDocumentRepository } from "./credentialDocumentRepository.ts";
import { ApplicationEventBus } from "./applicationEventBus.ts";
import { NotificationService } from "./notificationService.ts";
import { UserRepository } from "../users/userRepository.ts";

export const NO_CREDENTIAL_DOCUMENT_MESSAGE =
  "At least one credential document is required before you can submit your application.";
export const SUBMISSION_CONFIRMATION_MESSAGE = "Your application has been submitted successfully.";
export const REJECTED_CTA_MESSAGE = "Please correct the issues noted above and resubmit your application.";

export class ApplicationNotFoundError extends Error {
  constructor() {
    super("Application not found");
  }
}

export class NoCredentialDocumentError extends Error {
  constructor() {
    super(NO_CREDENTIAL_DOCUMENT_MESSAGE);
  }
}

export class InvalidTransitionError extends Error {
  constructor(from: ApplicationState, to: ApplicationState) {
    super(`Cannot transition application from ${from} to ${to}`);
  }
}

export class MissingRejectionReasonError extends Error {
  constructor() {
    super("A rejection reason is required when rejecting an application");
  }
}

export class ApplicationService {
  private applicationRepository: ApplicationRepository;
  private credentialDocumentRepository: CredentialDocumentRepository;
  private notificationService: NotificationService;
  private eventBus: ApplicationEventBus;
  private userRepository: UserRepository;

  constructor(
    applicationRepository: ApplicationRepository,
    credentialDocumentRepository: CredentialDocumentRepository,
    notificationService: NotificationService,
    eventBus: ApplicationEventBus,
    userRepository: UserRepository,
  ) {
    this.applicationRepository = applicationRepository;
    this.credentialDocumentRepository = credentialDocumentRepository;
    this.notificationService = notificationService;
    this.eventBus = eventBus;
    this.userRepository = userRepository;
  }

  submit(applicationId: string, now: number = Date.now()): Application {
    const application = this.applicationRepository.findById(applicationId);
    if (!application) {
      throw new ApplicationNotFoundError();
    }
    if (!VALID_TRANSITIONS[application.state].includes("submitted")) {
      throw new InvalidTransitionError(application.state, "submitted");
    }
    if (this.credentialDocumentRepository.countByApplicationId(applicationId) === 0) {
      throw new NoCredentialDocumentError();
    }

    application.state = "submitted";
    application.rejectionReason = undefined;
    application.submittedAt = now;
    application.updatedAt = now;

    this.eventBus.publish(application.providerId, application);
    return application;
  }

  async transitionState(
    applicationId: string,
    newState: ApplicationState,
    options: { rejectionReason?: string } = {},
    now: number = Date.now(),
  ): Promise<Application> {
    const application = this.applicationRepository.findById(applicationId);
    if (!application) {
      throw new ApplicationNotFoundError();
    }
    if (!VALID_TRANSITIONS[application.state].includes(newState)) {
      throw new InvalidTransitionError(application.state, newState);
    }
    if (newState === "rejected" && !options.rejectionReason) {
      throw new MissingRejectionReasonError();
    }

    const previousState = application.state;
    application.state = newState;
    application.rejectionReason = newState === "rejected" ? options.rejectionReason : undefined;
    application.updatedAt = now;

    if (NOTIFIED_TRANSITIONS.has(`${previousState}->${newState}`)) {
      const provider = this.userRepository.findById(application.providerId);
      await this.notificationService.notifyStateChange(application, provider?.email);
    }

    this.eventBus.publish(application.providerId, application);
    return application;
  }

  getStatus(applicationId: string): Application | undefined {
    return this.applicationRepository.findById(applicationId);
  }
}
