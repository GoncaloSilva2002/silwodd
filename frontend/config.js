(() => {
  const meta = document.querySelector('meta[name="api-base-url"]');
  const configuredBase = window.SILWOOD_API_URL || meta?.content || "";
  const base = String(configuredBase).trim().replace(/\/+$/, "");

  window.apiUrl = (path) => {
    const normalizedPath = String(path || "").startsWith("/") ? String(path) : `/${path}`;
    return `${base}${normalizedPath}`;
  };
})();
