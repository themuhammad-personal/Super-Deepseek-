export const SEARCH_PROVIDERS = [
  { id: "ddg-lite", name: "DuckDuckGo Lite" },
  { id: "ddg-html", name: "DuckDuckGo HTML" },
  { id: "bing", name: "Bing" },
] as const;

export type SearchProviderId = (typeof SEARCH_PROVIDERS)[number]["id"];
