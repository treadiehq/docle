import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2025-01-01",
  future: { compatibilityVersion: 4 },
  devtools: { enabled: false },

  css: ["~/assets/css/main.css"],

  app: {
    head: {
      title: 'Docle - Check if you can actually send to an email address without it bouncing or failing',
      meta: [
        { name: 'description', content: 'Check if you can actually send to an email address without it bouncing or failing. No signup, no data stored.' },
        { name: 'keywords', content: 'email verification, email validation, email pre-check, email address verification, email address validation, email address pre-check, email address verification, email address validation, email address pre-check' },
        { name: 'author', content: 'Docle' },
        { name: 'robots', content: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1' },
        { property: 'og:url', content: 'https://docle.co' },
        { property: 'og:image', content: 'https://docle.co/img/docle.png' },
        { property: 'og:title', content: 'Docle - Check if you can actually send to an email address without it bouncing or failing' },
        { property: 'og:type', content: 'website' },
        { property: 'og:description', content: 'Check if you can actually send to an email address without it bouncing or failing. No signup, no data stored.' },
        { property: 'og:site_name', content: 'Docle' },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: 'Docle - Check if you can actually send to an email address without it bouncing or failing' },
        { name: 'twitter:description', content: 'Check if you can actually send to an email address without it bouncing or failing. No signup, no data stored.' },
        { name: 'twitter:image', content: 'https://docle.co/img/docle.png' },
        { name: 'twitter:site', content: '@treadieinc' },
        { name: 'application-name', content: 'Docle' },
        { name: 'apple-mobile-web-app-title', content: 'Docle' },
        { name: "theme-color", content: "#09090b" },
      ],
      script: [
        { src: "https://cdn.seline.com/seline.js", async: true, "data-token": "5e87d8a491f281c" },
      ],
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicon.png' },
        { rel: 'canonical', href: 'https://docle.co' },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "anonymous" },
        { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" },
      ],
    },
  },

  vite: {
    plugins: [tailwindcss() as any],
  },

  runtimeConfig: {
    maxEmailsPerRequest: 500,
    dnsCacheTtlMs: 10 * 60 * 1000,
    dnsTimeoutMs: 5_000,
    dnsConcurrency: 20,
    smtpTimeoutMs: 10_000,
    smtpHeloDomain: "verify.docle.co",
    smtpMailFrom: "probe@verify.docle.co",
    hibpApiKey: "",
    rateLimitRequestsPerMinute: 10,
    rateLimitDailyEmailCap: 500,
    rateLimitMaxConcurrent: 2,
    rateLimitGlobalDailyCap: 50_000,
    rateLimitAgentRequestsPerMinute: 60,
    rateLimitAgentDailyEmailCap: 5_000,
    rateLimitAgentMaxConcurrent: 5,
  },
});
