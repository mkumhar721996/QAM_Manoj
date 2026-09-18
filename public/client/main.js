import { Router } from "./router.js";
import { renderHome } from "./views/home.js";
import { renderLogin } from "./views/login.js";
import { renderRegister } from "./views/register.js";
import { renderForgotPassword } from "./views/forgotPassword.js";

const router = new Router({
  window,
  container: document.getElementById("app"),
  views: {
    home: renderHome,
    login: renderLogin,
    register: renderRegister,
    "forgot-password": renderForgotPassword,
  },
});
router.renderForCurrentPath();
