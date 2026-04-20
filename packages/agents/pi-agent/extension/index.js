"use strict";

module.exports = function register(pi) {
  const url = (process.env.RITS_URL || "").trim().replace(/\/+$/, "");
  const model = (process.env.RITS_MODEL || "").trim();
  if (!url || !model) return;

  const baseUrl = /\/v\d+$/.test(url) ? url : `${url}/v1`;

  pi.registerProvider("rits", {
    baseUrl,
    api: "openai-completions",
    apiKey: "RITS_API_KEY",
    authHeader: true,
    headers: {
      RITS_API_KEY: "RITS_API_KEY",
    },
    models: [{ id: model, name: model }],
  });
};

function toInt(value, fallback) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
