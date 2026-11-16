import type { MediaCandidate } from '../types/models';

export interface CachedTabPageLike {
  url: string;
  title: string;
  html: string | null;
  isLoading: boolean;
  progress: number;
  error: string | null;
  isDemoShowcase: boolean;
}

/**
 * Strips heavy cached HTML strings from inactive background tabs while keeping
 * URL, title, and status intact, preventing mobile WebView heap growth during
 * multi-tab browsing.
 */
export function pruneTabPagesCache<T extends CachedTabPageLike>(
  pages: Record<string, T>,
  activeTabId: string,
  maxRetainedHtmlTabs = 2
): Record<string, T> {
  const withHtmlIds = Object.keys(pages).filter((id) => Boolean(pages[id]?.html));
  if (withHtmlIds.length <= maxRetainedHtmlTabs) {
    return pages;
  }

  const keepIds = new Set<string>();
  if (pages[activeTabId]?.html) {
    keepIds.add(activeTabId);
  }
  for (let i = withHtmlIds.length - 1; i >= 0 && keepIds.size < maxRetainedHtmlTabs; i--) {
    keepIds.add(withHtmlIds[i]);
  }

  let changed = false;
  const next: Record<string, T> = {};
  for (const [id, page] of Object.entries(pages)) {
    if (page.html && !keepIds.has(id)) {
      next[id] = { ...page, html: null };
      changed = true;
    } else {
      next[id] = page;
    }
  }
  return changed ? next : pages;
}

/**
 * Deduplicates and bounds per-tab detected media candidates so long scrolling
 * social feeds cannot grow JS memory unboundedly.
 */
export function capMediaCandidates(
  candidates: MediaCandidate[],
  maxCount = 60
): MediaCandidate[] {
  if (candidates.length <= maxCount) return candidates;
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  return sorted.slice(0, maxCount);
}
