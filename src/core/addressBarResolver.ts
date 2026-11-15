import { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINES } from './constants';
import type { SearchEngineKey } from '../types/models';

const EXPLICIT_SCHEME_PREFIXES = [
  'http://',
  'https://',
  'file://',
  'ftp://',
  'about:',
  'data:',
  'javascript:',
  'ws://',
  'wss://',
];

export function hasExplicitScheme(input: string): boolean {
  const lower = input.trim().toLowerCase();
  return EXPLICIT_SCHEME_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export function looksLikeHost(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed || trimmed.includes(' ') || trimmed.includes('"') || trimmed.includes('<')) {
    return false;
  }
  if (trimmed.includes(':') && !trimmed.includes('.') && !trimmed.startsWith('localhost')) {
    return false;
  }
  return trimmed.includes('.') || trimmed.startsWith('localhost') || trimmed.includes(':');
}

export function buildSearchUrl(
  query: string,
  searchEngine: SearchEngineKey = DEFAULT_SEARCH_ENGINE
): string {
  const template = SEARCH_ENGINES[searchEngine] ?? SEARCH_ENGINES[DEFAULT_SEARCH_ENGINE];
  return template.replace('%s', encodeURIComponent(query.trim()));
}

export function resolveAddressBarInput(
  input: string,
  searchEngine: SearchEngineKey = DEFAULT_SEARCH_ENGINE
): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (hasExplicitScheme(trimmed)) return trimmed;
  return looksLikeHost(trimmed) ? `https://${trimmed}` : buildSearchUrl(trimmed, searchEngine);
}

const URL_REGEX = /https?:\/\/[^\s"'<>]+/i;

export function extractFirstSharedUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(URL_REGEX);
  if (!match) return null;
  const cleaned = match[0].replace(/[.,;:!?)\]\}»"'،]+$/, '');
  return cleaned.length > 'https://'.length ? cleaned : null;
}

export function normalizeLinkInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const extracted = extractFirstSharedUrl(trimmed);
  if (extracted) return extracted;
  if (looksLikeHost(trimmed)) return `https://${trimmed}`;
  return null;
}
