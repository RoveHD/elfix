"use strict";

// Response evidence only. This module never reads, generates or submits a
// challenge answer. Cookie values and signed query parameters are not logged.
function header(headers, name) {
  if (typeof headers?.get === "function") return String(headers.get(name) || "");
  const key = Object.keys(headers || {}).find(k => k.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : "";
  return Array.isArray(value) ? value.join(", ") : String(value || "");
}

function klassifizieren({ status = 0, headers = {}, body = "", expected = "" } = {}) {
  const contentType = header(headers, "content-type").toLowerCase();
  const sample = String(body || "").slice(0, 65536);
  const html = /(?:text\/html|application\/xhtml)/.test(contentType)
    || /^\s*(?:<!doctype html|<html|<head|<body)/i.test(sample);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(sample)?.[1] || "";
  const waiting = /just a moment|attention required|checking your browser|verify you are human|einen augenblick|sicherheitsabfrage/i.test(title);
  const gate = /(?:id\s*=\s*["'](?:challenge-form|challenge-running|cf-please-wait)|\bcf-chl-[\w-]+|\b_cf_chl_opt\b)/i.test(sample);
  const widget = /(?:<iframe\b[^>]*\bsrc\s*=\s*["'][^"']*challenges\.cloudflare\.com|class\s*=\s*["'][^"']*\bcf-turnstile\b)/i.test(sample);
  const platform = /\/cdn-cgi\/challenge-platform\//i.test(sample);
  const cloudflare = Boolean(header(headers, "cf-ray")) || /cloudflare/i.test(header(headers, "server"));
  // A JSD script, cf-ray, HTTP 403 or HTML on its own is not a challenge.
  const challenge = header(headers, "cf-mitigated").trim().toLowerCase() === "challenge"
    || (html && ((gate && (waiting || platform || widget || status === 403 || status === 503))
      || (waiting && (platform || widget))
      || (widget && cloudflare && [403, 429, 503].includes(Number(status)))));
  let type = "Other";
  if (challenge) type = "Challenge";
  else if (html) type = "HTML";
  else if (/mpegurl/.test(contentType) || /^\s*#EXTM3U/.test(sample)) type = "HLS";
  else if (/dash\+xml/.test(contentType) || /^\s*(?:<\?xml[^>]*>\s*)?<MPD\b/i.test(sample)) type = "DASH";
  else if (/\b(?:video|audio)\/mp4\b/.test(contentType)) type = "MP4";
  else if (/\bjson\b/.test(contentType) || /^\s*[\[{]/.test(sample)) type = "JSON";
  return { type, challenge, unexpectedHtml: html && /^(?:stream|json|hls|dash|mp4)$/i.test(expected) };
}

function safeUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    if (!/^https?:$/.test(url.protocol)) return "[non-http]";
    // Long path segments can themselves be bearer tokens. Query values and
    // fragments are never useful for session diagnostics.
    const path = url.pathname.split("/").map(p => p.length > 48 ? "[redacted]" : p).join("/");
    return url.origin + path + (url.search ? "?[redacted]" : "");
  } catch { return "[invalid-url]"; }
}

function cookieNames(value) {
  const names = Array.isArray(value) ? value.map(v => typeof v === "string" ? v.split("=")[0] : v?.name)
    : String(value || "").split(";").map(v => v.trim().split("=")[0]);
  return [...new Set(names.filter(n => typeof n === "string" && /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(n)))].sort();
}

function diagnose(event, details = {}) {
  const headers = details.headers || {};
  const requestHeaders = details.requestHeaders || {};
  const state = klassifizieren(details);
  const info = {
    url: safeUrl(details.url), status: Number(details.status) || 0,
    finalUrl: safeUrl(details.finalUrl || details.url),
    contentType: header(headers, "content-type").replace(/[\r\n]/g, "").slice(0, 120),
    redirect: safeUrl(details.redirect || header(headers, "location")),
    cookieNames: cookieNames(details.cookieNames || header(requestHeaders, "cookie")),
    userAgent: String(details.userAgent || header(requestHeaders, "user-agent")).replace(/[\r\n]/g, "").slice(0, 240),
    referer: safeUrl(details.referer || header(requestHeaders, "referer")),
    origin: safeUrl(details.origin || header(requestHeaders, "origin")),
    responseType: state.type, unexpectedHtml: state.unexpectedHtml
  };
  const events = new Set(["challenge detected", "opening verification view", "verification passed",
    "session persisted", "retrying original request", "stream request succeeded", "stream request still challenged",
    "response", "verification cancelled", "verification timeout", "session persistence failed"]);
  return `[CF] ${events.has(event) ? event : "response"} ${JSON.stringify(info)}`;
}

module.exports = { header, klassifizieren, safeUrl, cookieNames, diagnose };
