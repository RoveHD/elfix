const cryptoApi = globalThis.crypto || require("crypto").webcrypto;

function createId() {
  return cryptoApi.randomUUID();
}

function defaultProviders() {
  return [
    {
      id: createId(),
      name: "Aniworld",
      startUrl: "https://aniworld.to/",
      searchUrl: "https://aniworld.to/search?q={query}",
      logo: "AN",
      enabled: true,
      adblockEnabled: true,
      sortOrder: 0,
      lastUrl: ""
    },
    {
      id: createId(),
      name: "S.to",
      startUrl: "http://186.2.175.5/",
      searchUrl: "http://186.2.175.5/suche?term={query}",
      logo: "S.",
      enabled: true,
      adblockEnabled: true,
      sortOrder: 1,
      lastUrl: ""
    },
    {
      id: createId(),
      name: "Filmo",
      startUrl: "https://filmo.to/",
      searchUrl: "https://filmo.to/search?q={query}",
      logo: "FI",
      enabled: true,
      adblockEnabled: true,
      sortOrder: 2,
      lastUrl: ""
    },
    {
      id: createId(),
      name: "YouTube",
      startUrl: "https://www.youtube.com/",
      // Der Weg, den YouTube selbst benutzt. "/search?q=" tut es auch, landet
      // aber ueber eine Weiterleitung hier - nachgesehen: 301 auf genau diese
      // Adresse.
      searchUrl: "https://www.youtube.com/results?search_query={query}",
      logo: "YT",
      enabled: true,
      adblockEnabled: true,
      sortOrder: 3,
      lastUrl: ""
    }
  ];
}

function normalizeProviders(rawProviders) {
  if (!Array.isArray(rawProviders)) return [];
  return rawProviders.map((raw, index) => {
    const startUrl = normalizeUrl(raw.startUrl || raw.homeUrl || raw.HomeUrl || raw.website || "");
    const template = raw.searchUrl || raw.searchTemplate || raw.Template || raw.template || "";
    const provider = {
      id: raw.id || raw.Id || createId(),
      name: String(raw.name || raw.Name || hostFromUrl(startUrl) || "Provider").trim(),
      startUrl,
      searchUrl: normalizeSearchUrl(template, startUrl),
      logo: String(raw.logo || raw.Logo || "").trim(),
      enabled: raw.enabled ?? raw.IsEnabled ?? true,
      adblockEnabled: raw.adblockEnabled ?? true,
      sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : index,
      lastUrl: isHttpUrl(raw.lastUrl) ? raw.lastUrl : ""
    };
    if (!provider.startUrl) {
      provider.startUrl = extractHome(provider.searchUrl);
    }
    if (!provider.logo) {
      provider.logo = provider.name.slice(0, 2).toUpperCase();
    }
    return provider;
  }).filter(isValidProvider).sort((a, b) => a.sortOrder - b.sortOrder);
}

function isValidProvider(provider) {
  return Boolean(
    provider
    && provider.name
    && isHttpUrl(provider.startUrl)
    && isHttpUrl(provider.searchUrl.replace("{query}", "test"))
    && provider.searchUrl.includes("{query}")
  );
}

function normalizeSearchUrl(template, startUrl) {
  if (!template) return buildProviderSearchTemplate(startUrl);
  const normalized = normalizeUrl(template);
  if (isGoogleSiteSearchTemplate(normalized)) return buildProviderSearchTemplate(startUrl || providerUrlFromGoogleSiteSearch(normalized));
  const literalTemplate = promoteLiteralQueryPlaceholder(normalized);
  if (literalTemplate.includes("{query}")) return literalTemplate;
  if (!normalized.includes("{query}")) return buildProviderSearchTemplate(startUrl || normalized);
  return normalized;
}

function buildSearchUrl(provider, query) {
  return provider.searchUrl.replace("{query}", encodeURIComponent(String(query || "").trim()));
}

function normalizeUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (trimmed.includes("{query}")) {
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
    return `https://${trimmed}`;
  }
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(value) || String(value).includes(".");
}

function hostFromUrl(value) {
  try {
    return new URL(normalizeUrl(value)).host;
  } catch {
    return "";
  }
}

function extractHome(template) {
  try {
    const preview = String(template || "").replace("{query}", "test");
    const url = new URL(preview);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

function buildProviderSearchTemplate(url) {
  try {
    const parsed = new URL(normalizeUrl(url));
    return `${parsed.origin}${usesTermSearch(parsed.hostname) ? "/suche?term={query}" : "/search?q={query}"}`;
  } catch {
    return "";
  }
}

function isGoogleSiteSearchTemplate(value) {
  try {
    const parsed = new URL(value.replace("{query}", "test"));
    return parsed.hostname.endsWith("google.com") && String(parsed.searchParams.get("q") || "").startsWith("site:");
  } catch {
    return false;
  }
}

function providerUrlFromGoogleSiteSearch(value) {
  try {
    const parsed = new URL(value.replace("{query}", "test"));
    const query = String(parsed.searchParams.get("q") || "");
    const host = query.replace(/^site:/i, "").split(/\s|\+/)[0].trim();
    return host ? `https://${host}` : "";
  } catch {
    return "";
  }
}

function promoteLiteralQueryPlaceholder(value) {
  return String(value).replace(/([?&][^=&#]+=)(test|dragonball)(?=(&|#|$))/i, "$1{query}");
}

function usesTermSearch(hostname) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname === "s.to" || hostname.endsWith(".s.to");
}

module.exports = {
  buildSearchUrl,
  buildProviderSearchTemplate,
  defaultProviders,
  hostFromUrl,
  isHttpUrl,
  looksLikeUrl,
  normalizeProviders,
  normalizeSearchUrl,
  normalizeUrl
};
