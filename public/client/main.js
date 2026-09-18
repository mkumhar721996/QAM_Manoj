import { Router } from "./router.js";
import { requireElement } from "./dom.js";
import { renderHome } from "./views/home.js";
import { renderLogin } from "./views/login.js";
import { renderRegister } from "./views/register.js";
import { renderForgotPassword } from "./views/forgotPassword.js";

const router = new Router({
  window,
  container: requireElement(document.getElementById("app"), "App container #app"),
  views: {
    home: renderHome,
    login: renderLogin,
    register: renderRegister,
    "forgot-password": renderForgotPassword,
  },
});
router.renderForCurrentPath();
