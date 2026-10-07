const form = document.getElementById("login-form");
const errorEl = document.getElementById("login-error");
const rememberInput = document.getElementById("remember-me");

function storedAuthValue(key) {
  return sessionStorage.getItem(key) || localStorage.getItem(key);
}

if (storedAuthValue("token")) {
  window.location.href = "/app.html";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.classList.add("hidden");

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const remember = Boolean(rememberInput?.checked);

  try {
    const res = await fetch(window.apiUrl("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, remember })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Falha no login.");
    }

    localStorage.removeItem("token");
    localStorage.removeItem("user");
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("user");
    const storage = remember ? localStorage : sessionStorage;
    storage.setItem("token", data.token);
    storage.setItem("user", JSON.stringify(data.user));
    window.location.href = "/app.html";
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.classList.remove("hidden");
  }
});
