import type { MediaCandidate } from '../types/models';
import { DEFAULT_BLOCKED_HOSTS, hostOfUrl, matchesDomain } from './adBlockRules';
import { kindOfMedia, unsupportedReasonFor } from './mediaOfferability';

export const MINIMUM_MAIN_SCORE = 10;

export type CandidateRole = 'MAIN' | 'SUGGESTED' | 'AD';

export interface ClassifiedCandidate {
  candidate: MediaCandidate;
  role: CandidateRole;
  score: number;
}

const SHORT_CONTENT_MS = 16_000;
const LONG_CONTENT_MS = 45_000;
const SUBSTANTIAL_BYTES = 5 * 1024 * 1024;

const AD_PATH_MARKERS = [
  '/ads/',
  '/ad/',
  'adserver',
  'advertis',
  'preroll',
  'pre-roll',
  'midroll',
  'mid-roll',
  '/vast',
  'vmap',
  'doubleclick',
  'imasdk',
  'companion',
  '/banners/',
  'sponsor',
  'bumper',
  '/promo/',
  'promo_ad',
  'ad_break',
];

const SUGGESTED_PATH_MARKERS = [
  'suggest',
  'recommend',
  'related',
  'upnext',
  'up-next',
  'sidebar',
  'thumb_video',
  'preview_clip',
  'hover_preview',
];

const RESOLUTION_REGEX = /(\d{3,4})p\b/;

function isOfferableMain(candidate: MediaCandidate): boolean {
  if (candidate.isLive) return false;
  if (kindOfMedia(candidate.mimeType, candidate.extension) === null) return false;
  return (
    unsupportedReasonFor({
      url: candidate.mediaUrl,
      mimeType: candidate.mimeType,
      extension: candidate.extension,
      isLive: candidate.isLive,
      isMediaSource: candidate.isMediaSource,
      isBlobFile: candidate.isBlobFile,
      dashIsSupported: true,
    }) === null
  );
}

export function looksLikeAdCandidate(candidate: MediaCandidate): boolean {
  if (candidate.isAd) return true;
  const host = hostOfUrl(candidate.mediaUrl);
  if (host) {
    for (const domain of DEFAULT_BLOCKED_HOSTS) {
      if (matchesDomain(host, domain)) return true;
    }
  }
  const lowered = candidate.mediaUrl.toLowerCase();
  if (AD_PATH_MARKERS.some((marker) => lowered.includes(marker))) return true;
  if (
    candidate.duration != null &&
    candidate.duration > 0 &&
    candidate.duration <= 12_000 &&
    candidate.muted === true &&
    candidate.hasControls === false
  ) {
    return true;
  }
  return false;
}

export function looksLikeSuggestedCandidate(candidate: MediaCandidate): boolean {
  if (candidate.isSuggested) return true;
  const lowered = candidate.mediaUrl.toLowerCase();
  if (SUGGESTED_PATH_MARKERS.some((marker) => lowered.includes(marker))) return true;
  if (
    candidate.width != null &&
    candidate.width > 0 &&
    candidate.width < 250 &&
    candidate.height != null &&
    candidate.height > 0 &&
    candidate.height < 150
  ) {
    return true;
  }
  return false;
}

export function scoreMainCandidate(
  candidate: MediaCandidate,
  visibleUrl: string | null,
  pageUrl: string | null
): number {
  let score = 0;

  const isAd = looksLikeAdCandidate(candidate);
  const isSuggested = looksLikeSuggestedCandidate(candidate);
  const isShortClip =
    candidate.duration != null && candidate.duration > 0 && candidate.duration < SHORT_CONTENT_MS;

  if (isAd) {
    const host = hostOfUrl(candidate.mediaUrl);
    if (host) {
      for (const domain of DEFAULT_BLOCKED_HOSTS) {
        if (matchesDomain(host, domain)) return Number.MIN_SAFE_INTEGER;
      }
    }
    score -= 60;
  }

  if (isSuggested) {
    score -= 30;
  }

  // Only award visible-playback bonus if the currently playing element isn't a 5-15s pre-roll ad or sidebar preview
  if (visibleUrl && candidate.mediaUrl === visibleUrl && !isAd && !isSuggested && !isShortClip) {
    score += 50;
  }
  if (pageUrl && candidate.pageUrl === pageUrl) score += 8;

  const kind = kindOfMedia(candidate.mimeType, candidate.extension);
  if (kind === 'VIDEO') score += 24;
  else if (kind === 'PLAYLIST') score += 20;
  else if (kind === 'AUDIO') score += 6;
  else return Number.MIN_SAFE_INTEGER;

  if (candidate.width && candidate.height) {
    const area = candidate.width * candidate.height;
    if (area >= 480 * 270) score += 14;
    else if (area < 260 * 160) score -= 14;
  }

  if (candidate.hasControls === true) score += 6;

  if (candidate.duration && candidate.duration > 0) {
    if (isShortClip) score -= 42;
    else if (candidate.duration >= LONG_CONTENT_MS) score += 16;
    else score += 6;
  }

  if (candidate.estimatedSize && candidate.estimatedSize >= SUBSTANTIAL_BYTES) {
    score += 8;
  }

  const lowered = candidate.mediaUrl.toLowerCase();
  const resMatch = lowered.match(RESOLUTION_REGEX);
  if (resMatch) {
    const height = Number(resMatch[1]);
    if (height >= 2160) score += 7;
    else if (height >= 1080) score += 5;
    else if (height >= 720) score += 3;
    else score += 1;
  }

  score += Math.floor(Math.max(0, Math.min(1, candidate.confidence)) * 8);
  return score;
}

export function selectMainCandidate(
  candidates: MediaCandidate[],
  visibleUrl: string | null,
  pageUrl: string | null
): MediaCandidate | null {
  let best: { candidate: MediaCandidate; score: number } | null = null;
  for (const c of candidates) {
    if (!isOfferableMain(c)) continue;
    const s = scoreMainCandidate(c, visibleUrl, pageUrl);
    if (s < MINIMUM_MAIN_SCORE) continue;
    if (
      !best ||
      s > best.score ||
      (s === best.score && c.confidence > best.candidate.confidence)
    ) {
      best = { candidate: c, score: s };
    }
  }
  return best?.candidate ?? null;
}

export function rankAndClassifyCandidates(
  candidates: MediaCandidate[],
  visibleUrl: string | null,
  pageUrl: string | null
): { main: MediaCandidate | null; ranked: ClassifiedCandidate[] } {
  const main = selectMainCandidate(candidates, visibleUrl, pageUrl);
  const hasLongerNonAd = candidates.some(
    (c) =>
      c.mediaUrl !== main?.mediaUrl
        ? !looksLikeAdCandidate(c) && (c.duration == null || c.duration >= SHORT_CONTENT_MS)
        : true
  ) && main !== null;

  const ranked: ClassifiedCandidate[] = candidates.map((candidate) => {
    const score = scoreMainCandidate(candidate, visibleUrl, pageUrl);
    let role: CandidateRole = 'SUGGESTED';

    if (main && candidate.mediaUrl === main.mediaUrl) {
      role = 'MAIN';
    } else if (
      looksLikeAdCandidate(candidate) ||
      (hasLongerNonAd &&
        candidate.duration != null &&
        candidate.duration > 0 &&
        candidate.duration < SHORT_CONTENT_MS &&
        score < MINIMUM_MAIN_SCORE)
    ) {
      role = 'AD';
    } else if (looksLikeSuggestedCandidate(candidate)) {
      role = 'SUGGESTED';
    }

    return { candidate, role, score };
  });

  const roleWeight: Record<CandidateRole, number> = {
    MAIN: 3,
    SUGGESTED: 2,
    AD: 1,
  };

  ranked.sort((a, b) => {
    if (roleWeight[a.role] !== roleWeight[b.role]) {
      return roleWeight[b.role] - roleWeight[a.role];
    }
    if (a.score !== b.score) return b.score - a.score;
    return b.candidate.confidence - a.candidate.confidence;
  });

  return { main, ranked };
}
