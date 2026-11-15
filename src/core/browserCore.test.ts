import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPastedLink, pastedMediaCandidate } from './pastedLink';
import { resolveAddressBarInput, extractFirstSharedUrl } from './addressBarResolver';
import { isBlockedAdHost, hostOfUrl } from './adBlockRules';
import { formatBitrateKbps, parseHlsPlaylist, sanitizeFilename, scanHtmlForMedia } from './mediaResolver';
import { selectMainCandidate, rankAndClassifyCandidates } from './mainContentSelector';
import { snapFloatingPosition } from './floatingSnap';
import { unsupportedReasonFor } from './mediaOfferability';
import { LockoutPolicy } from './security';

test('classifyPastedLink distinguishes media files from social/web pages and invalid text', () => {
  assert.equal(classifyPastedLink('https://cdn.example.com/videos/clip.mp4'), 'MEDIA_FILE');
  assert.equal(classifyPastedLink('https://stream.example.com/live/master.m3u8'), 'MEDIA_FILE');
  assert.equal(classifyPastedLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'WEB_PAGE');
  assert.equal(classifyPastedLink('https://instagram.com/reel/abc.mp4'), 'WEB_PAGE');
  assert.equal(classifyPastedLink('not a url'), null);

  const candidate = pastedMediaCandidate('https://cdn.example.com/movie.mp4?token=123');
  assert.ok(candidate);
  assert.equal(candidate?.extension, 'mp4');
  assert.equal(candidate?.mimeType, 'video/mp4');
});

test('resolveAddressBarInput resolves hosts, explicit schemes, and search queries', () => {
  assert.equal(resolveAddressBarInput('example.com', 'Google'), 'https://example.com');
  assert.equal(resolveAddressBarInput('http://localhost:8080', 'Google'), 'http://localhost:8080');
  assert.equal(
    resolveAddressBarInput('salvia browxer', 'DuckDuckGo'),
    'https://duckduckgo.com/?q=salvia%20browxer'
  );
  assert.equal(
    extractFirstSharedUrl('Check this out: https://example.org/watch?v=1!'),
    'https://example.org/watch?v=1'
  );
});

test('adBlockRules blocks known tracker hosts while exempting local and media URLs', () => {
  assert.equal(hostOfUrl('https://sub.doubleclick.net/pixel.js'), 'sub.doubleclick.net');
  assert.equal(isBlockedAdHost('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'), true);
  assert.equal(isBlockedAdHost('https://doubleclick.net/video/promo.mp4'), false);
  assert.equal(isBlockedAdHost('http://127.0.0.1:3000/script.js'), false);
});

test('parseHlsPlaylist extracts variants, audio tracks, and flags live or DRM streams', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="English",URI="audio_en.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1920x1080,AUDIO="aac"',
    '1080p.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480,AUDIO="aac"',
    '480p.m3u8',
  ].join('\n');

  const parsed = parseHlsPlaylist(master, 'https://cdn.example.com/hls/master.m3u8', 'Sample');
  assert.equal(parsed.unsupported, null);
  assert.equal(parsed.formats.length, 2);
  assert.equal(parsed.formats[0].height, 1080);
  assert.equal(parsed.formats[0].audioTrackUrl, 'https://cdn.example.com/hls/audio_en.m3u8');
  assert.equal(parsed.audioFormats?.length, 1);
  assert.equal(parsed.audioFormats?.[0]?.url, 'https://cdn.example.com/hls/audio_en.m3u8');
  assert.equal(parsed.audioFormats?.[0]?.extension, 'm4a');

  const live = [
    '#EXTM3U',
    '#EXT-X-TARGETDURATION:6',
    '#EXT-X-PLAYLIST-TYPE:EVENT',
    '#EXTINF:4.0,',
    'seg1.ts',
  ].join('\n');
  assert.equal(parseHlsPlaylist(live, 'https://cdn.example.com/live.m3u8', 'Live').unsupported, 'LIVE');

  const drm = ['#EXTM3U', '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key"', '#EXT-X-ENDLIST'].join('\n');
  assert.equal(parseHlsPlaylist(drm, 'https://cdn.example.com/drm.m3u8', 'DRM').unsupported, 'DRM');
});

test('mediaOfferability and mainContentSelector prioritize visible media and enforce refusals', () => {
  assert.equal(
    unsupportedReasonFor({ url: 'blob:https://site.test/uuid', isMediaSource: true }),
    'BLOB_STREAM'
  );
  assert.equal(unsupportedReasonFor({ url: 'https://cdn.test/live.m3u8', isLive: true }), 'LIVE');
  assert.equal(
    unsupportedReasonFor({ url: 'https://cdn.test/video.mp4', mimeType: 'video/mp4' }),
    null
  );

  const selected = selectMainCandidate(
    [
      {
        id: '1',
        pageUrl: 'https://site.test',
        mediaUrl: 'https://site.test/ad.mp4',
        extension: 'mp4',
        mimeType: 'video/mp4',
        source: 'DOM',
        confidence: 0.9,
      },
      {
        id: '2',
        pageUrl: 'https://site.test',
        mediaUrl: 'https://site.test/main.mp4',
        extension: 'mp4',
        mimeType: 'video/mp4',
        source: 'DOM',
        confidence: 0.7,
      },
    ],
    'https://site.test/main.mp4',
    'https://site.test'
  );
  assert.equal(selected?.mediaUrl, 'https://site.test/main.mp4');
  assert.equal(sanitizeFilename('Bad/File:Name*?.mp4'), 'Bad File Name .mp4');
});

test('LockoutPolicy applies escalating cooldown after repeated failures and resets on success', () => {
  const policy = new LockoutPolicy(3, 2000, 60000);
  const base = 1_000_000;
  policy.onFailure(base);
  policy.onFailure(base + 10);
  assert.equal(policy.isLockedOut(base + 50), false);
  const delay = policy.onFailure(base + 100);
  assert.equal(delay, 2000);
  assert.equal(policy.isLockedOut(base + 200), true);
  assert.equal(policy.remainingMillis(base + 200), 1900);
  policy.onSuccess();
  assert.equal(policy.isLockedOut(base + 200), false);
});

test('rankAndClassifyCandidates isolates 5s pre-roll video ads and suggested clips from main video', () => {
  const preRoll5s = {
    id: 'ad-5s',
    pageUrl: 'https://video.example.com/watch/1',
    mediaUrl: 'https://cdn.example.com/intro_promo_clip.mp4',
    extension: 'mp4',
    mimeType: 'video/mp4',
    source: 'DOM' as const,
    confidence: 0.94,
    duration: 5000,
    muted: true,
    hasControls: false,
  };
  const suggestedSidebar = {
    id: 'sug-1',
    pageUrl: 'https://video.example.com/watch/1',
    mediaUrl: 'https://cdn.example.com/related/next_episode.mp4',
    extension: 'mp4',
    mimeType: 'video/mp4',
    source: 'DOM' as const,
    confidence: 0.85,
    duration: 95000,
    width: 210,
    height: 118,
    isSuggested: true,
  };
  const mainMovie = {
    id: 'main-1',
    pageUrl: 'https://video.example.com/watch/1',
    mediaUrl: 'https://cdn.example.com/movies/feature_1080p.m3u8',
    extension: 'm3u8',
    mimeType: 'application/vnd.apple.mpegurl',
    source: 'FETCH' as const,
    confidence: 0.9,
    duration: 360000,
    width: 854,
    height: 480,
    hasControls: true,
  };

  // Even when the 5s pre-roll ad is playing first as the visible element, mainMovie wins
  const result = rankAndClassifyCandidates(
    [preRoll5s, suggestedSidebar, mainMovie],
    preRoll5s.mediaUrl,
    'https://video.example.com/watch/1'
  );
  assert.equal(result.main?.id, 'main-1');
  assert.equal(result.ranked[0].role, 'MAIN');
  assert.equal(result.ranked[0].candidate.id, 'main-1');
  assert.equal(result.ranked.find((r) => r.candidate.id === 'sug-1')?.role, 'SUGGESTED');
  assert.equal(result.ranked.find((r) => r.candidate.id === 'ad-5s')?.role, 'AD');
});

test('snapFloatingPosition snaps magnetically to nearest horizontal edge and clamps Y', () => {
  const leftSnap = snapFloatingPosition(120, 200, 400, 800, 56, 14);
  assert.deepEqual(leftSnap, { x: 14, y: 200 });

  const rightSnap = snapFloatingPosition(240, 200, 400, 800, 56, 14);
  assert.deepEqual(rightSnap, { x: 330, y: 200 });

  const clampedY = snapFloatingPosition(10, 950, 400, 800, 56, 14);
  assert.deepEqual(clampedY, { x: 14, y: 730 });
});

test('formatBitrateKbps handles normalized kbps values without double division and converts large raw bps', () => {
  assert.equal(formatBitrateKbps(1200), '1200 kbps');
  assert.equal(formatBitrateKbps(2500), '2500 kbps');
  assert.equal(formatBitrateKbps(1500000), '1500 kbps');
  assert.equal(formatBitrateKbps(0), null);
  assert.equal(formatBitrateKbps(null), null);
  assert.equal(formatBitrateKbps(undefined), null);
});

test('scanHtmlForMedia extracts expanded player JSON keys while rejecting YouTube URLs', () => {
  const html = `
    <script>
      window.__PLAYER_DATA__ = {
        "video_hls_url": "https:\\u002F\\u002Fcdn.example.net\\u002Fhls\\u002Fmaster.m3u8",
        "hdUrl": "https://cdn.example.net/video/hd_clip.mp4",
        "contentUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
      };
    </script>
  `;
  const results = scanHtmlForMedia(html, 'https://example.net/watch/1');
  assert.ok(results.some((c) => c.mediaUrl === 'https://cdn.example.net/hls/master.m3u8'));
  assert.ok(results.some((c) => c.mediaUrl === 'https://cdn.example.net/video/hd_clip.mp4'));
  assert.equal(results.some((c) => c.mediaUrl.includes('youtube.com')), false);
});
