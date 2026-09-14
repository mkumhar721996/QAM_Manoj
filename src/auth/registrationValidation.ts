export interface RegistrationErrors {
  name?: string;
  email?: string;
  password?: string;
}

function validateName(name: unknown): string | undefined {
  if (typeof name !== "string" || name.trim().length === 0) {
    return "Name is required";
  }
  return undefined;
}

function validateEmail(email: unknown): string | undefined {
  if (typeof email !== "string" || email.trim().length === 0) {
    return "Email is required";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return "Enter a valid email address";
  }
  return undefined;
}

function validateNewCredential(credential: unknown): string | undefined {
  if (typeof credential !== "string" || credential.length === 0) {
    return "Password is required";
  }
  if (credential.length < 8) {
    return "Password must be at least 8 characters";
  }
  return undefined;
}

export function validateRegistrationInput(input: { name: unknown; email: unknown; password: unknown }): RegistrationErrors {
  const errors: RegistrationErrors = {};

  const nameMessage = validateName(input.name);
  const emailMessage = validateEmail(input.email);
  const credentialMessage = validateNewCredential(input.password);

  if (nameMessage) {
    errors.name = nameMessage;
  }
  if (emailMessage) {
    errors.email = emailMessage;
  }
  if (credentialMessage) {
    errors.password = credentialMessage;
  }

  return errors;
}
