import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2025-01-01",
  future: { compatibilityVersion: 4 },
  devtools: { enabled: false },

  css: ["~/assets/css/main.css"],

  app: {
    head: {
      title: "Docle",
      meta: [
        { name: "description", content: "Check if you can actually send to an email address without it bouncing or failing. No signup, no data stored." },
        { name: "theme-color", content: "#09090b" },
      ],
      link: [
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "anonymous" },
        { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" },
      ],
    },
  },

  vite: {
    plugins: [tailwindcss()],
  },

  runtimeConfig: {
    maxEmailsPerRequest: 10_000,
    dnsCacheTtlMs: 10 * 60 * 1000,
    dnsTimeoutMs: 5_000,
    dnsConcurrency: 20,
    rateLimitWindowMs: 60_000,
    rateLimitMaxRequests: 30,
    smtpTimeoutMs: 10_000,
  },
});
