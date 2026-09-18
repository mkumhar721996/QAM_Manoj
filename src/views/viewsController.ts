import type { ControllerResponse } from "../auth/authController.ts";

export function handleGetLoginView(): ControllerResponse {
  return {
    status: 200,
    body: {
      view: "login",
      links: { register: "/register", forgot_password: "/forgot-password" },
    },
  };
}

export function handleGetRegisterView(): ControllerResponse {
  return { status: 200, body: { view: "register" } };
}

export function handleGetForgotPasswordView(): ControllerResponse {
  return { status: 200, body: { view: "forgot-password" } };
}
