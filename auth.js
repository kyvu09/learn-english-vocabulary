import {
  auth,
  googleProvider,
  firebaseReady,
  ensureUserProfile,
  APP_PAGE
} from "./firebase-config.js";
import {
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const refs = {
  authStateText: document.getElementById("authStateText"),
  authTabs: document.querySelectorAll(".auth-tab"),
  authMessage: document.getElementById("authMessage"),
  loginPanel: document.getElementById("loginPanel"),
  registerPanel: document.getElementById("registerPanel"),
  loginForm: document.getElementById("loginForm"),
  registerForm: document.getElementById("registerForm"),
  googleLoginBtn: document.getElementById("googleLoginBtn"),
  googleRegisterBtn: document.getElementById("googleRegisterBtn")
};

const state = {
  activeTab: "login"
};

function showStatus(element, type, message) {
  if (!element) return;
  if (!message) {
    element.className = "status";
    element.textContent = "";
    return;
  }
  element.className = `status show ${type}`;
  element.textContent = message;
}

function getFriendlyFirebaseError(error) {
  const code = error?.code || "";
  const map = {
    "auth/invalid-credential": "Email hoặc mật khẩu không đúng.",
    "auth/invalid-email": "Email không hợp lệ.",
    "auth/user-not-found": "Không tìm thấy tài khoản.",
    "auth/wrong-password": "Mật khẩu không đúng.",
    "auth/email-already-in-use": "Email này đã được sử dụng.",
    "auth/weak-password": "Mật khẩu quá yếu. Hãy dùng ít nhất 6 ký tự.",
    "auth/popup-closed-by-user": "Bạn đã đóng cửa sổ đăng nhập Google.",
    "auth/network-request-failed": "Không thể kết nối mạng. Hãy thử lại.",
    "auth/unauthorized-domain": "Domain hiện tại chưa được thêm vào Firebase Authentication.",
    "auth/operation-not-allowed": "Bạn chưa bật provider này trong Firebase Authentication."
  };
  return map[code] || error?.message || "Có lỗi xảy ra.";
}

function setAuthTab(tab) {
  state.activeTab = tab;
  refs.authTabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.authTab === tab);
  });
  refs.loginPanel?.classList.toggle("active", tab === "login");
  refs.registerPanel?.classList.toggle("active", tab === "register");
  showStatus(refs.authMessage, "", "");
}

function setFormsDisabled(disabled) {
  [refs.loginForm, refs.registerForm].forEach((form) => {
    if (!form) return;
    Array.from(form.elements).forEach((element) => {
      element.disabled = disabled;
    });
  });
  if (refs.googleLoginBtn) refs.googleLoginBtn.disabled = disabled;
  if (refs.googleRegisterBtn) refs.googleRegisterBtn.disabled = disabled;
}

function redirectToApp() {
  window.location.replace(APP_PAGE);
}

function bindEvents() {
  refs.authTabs.forEach((button) => {
    button.addEventListener("click", () => setAuthTab(button.dataset.authTab));
  });

  refs.loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!firebaseReady || !auth) return;

    const email = document.getElementById("loginEmail")?.value.trim();
    const password = document.getElementById("loginPassword")?.value || "";

    try {
      setFormsDisabled(true);
      await signInWithEmailAndPassword(auth, email, password);
      showStatus(refs.authMessage, "success", "Đăng nhập thành công. Đang chuyển vào ứng dụng...");
      refs.loginForm.reset();
    } catch (error) {
      showStatus(refs.authMessage, "error", getFriendlyFirebaseError(error));
    } finally {
      setFormsDisabled(false);
    }
  });

  refs.registerForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!firebaseReady || !auth) return;

    const name = document.getElementById("registerName")?.value.trim() || "";
    const email = document.getElementById("registerEmail")?.value.trim();
    const password = document.getElementById("registerPassword")?.value || "";

    try {
      setFormsDisabled(true);
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      if (name) {
        await updateProfile(credential.user, { displayName: name });
      }
      await ensureUserProfile({
        ...credential.user,
        displayName: name || credential.user.displayName || ""
      });
      showStatus(refs.authMessage, "success", "Tạo tài khoản thành công. Đang chuyển vào ứng dụng...");
      refs.registerForm.reset();
    } catch (error) {
      showStatus(refs.authMessage, "error", getFriendlyFirebaseError(error));
    } finally {
      setFormsDisabled(false);
    }
  });

  const googleHandler = async () => {
    if (!firebaseReady || !auth || !googleProvider) return;
    try {
      setFormsDisabled(true);
      const credential = await signInWithPopup(auth, googleProvider);
      await ensureUserProfile(credential.user);
      showStatus(refs.authMessage, "success", "Đăng nhập Google thành công. Đang chuyển vào ứng dụng...");
    } catch (error) {
      showStatus(refs.authMessage, "error", getFriendlyFirebaseError(error));
    } finally {
      setFormsDisabled(false);
    }
  };

  refs.googleLoginBtn?.addEventListener("click", googleHandler);
  refs.googleRegisterBtn?.addEventListener("click", googleHandler);
}

function init() {
  setAuthTab("login");

  if (!firebaseReady || !auth) {
    refs.authStateText.textContent = "Chưa cấu hình Firebase";
    showStatus(refs.authMessage, "warning", "Thiếu firebaseConfig hợp lệ. Hãy kiểm tra firebase-config.js.");
    setFormsDisabled(true);
    return;
  }

  bindEvents();

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      refs.authStateText.textContent = user.displayName || user.email || "Đã đăng nhập";
      try {
        await ensureUserProfile(user);
      } catch (error) {
        console.error(error);
      }
      redirectToApp();
      return;
    }

    refs.authStateText.textContent = "Chưa đăng nhập";
  });
}

init();