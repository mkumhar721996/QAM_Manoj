export interface RegistrationErrors {
  name?: string;
  email?: string;
  password?: string;
}

export function validateRegistrationInput(input: { name: unknown; email: unknown; password: unknown }): RegistrationErrors {
  const errors: RegistrationErrors = {};

  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    errors.name = "Name is required";
  }

  if (typeof input.email !== "string" || input.email.trim().length === 0) {
    errors.email = "Email is required";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    errors.email = "Enter a valid email address";
  }

  if (typeof input.password !== "string" || input.password.length === 0) {
    errors.password = "Password is required";
  } else if (input.password.length < 8) {
    errors.password = "Password must be at least 8 characters";
  }

  return errors;
}
