import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyUrlByPattern,
  canonicalizeUrlForPattern,
  isYouTubeUrl,
} from './linkPatternEngine';
import { analyzePastedLink, classifyPastedLink, isYouTubeExcludedUrl } from './pastedLink';
import {
  collectUrlsFromHtml,
  unescapeEmbeddedText,
  extractMediaWithPatterns,
  type ExtractedMediaItem,
} from '../../server/mediaExtractor';

test('explicitly excludes all YouTube and googlevideo domains', () => {
  const youtubeSamples = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?si=tracking123',
    'https://m.youtube.com/shorts/abc123XYZ',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    'https://rr3---sn-4g5e6nls.googlevideo.com/videoplayback?mime=video%2Fmp4',
  ];

  for (const sample of youtubeSamples) {
    assert.equal(isYouTubeUrl(sample), true, `Expected YouTube detection for ${sample}`);
    assert.equal(isYouTubeExcludedUrl(sample), true);
    const match = classifyUrlByPattern(sample);
    assert.equal(match?.category, 'YOUTUBE_EXCLUDED');
    const analysis = analyzePastedLink(sample);
    assert.equal(analysis?.category, 'YOUTUBE_EXCLUDED');
    // Backward-compatible classifier returns WEB_PAGE for non-direct non-invalid links
    assert.equal(classifyPastedLink(sample), 'WEB_PAGE');
  }
});

test('extracts X/Twitter status IDs and strips share tracking parameters', () => {
  const xUrl = 'https://x.com/NASA/status/1847382910293847?s=20&t=shareToken&utm_source=ig';
  const match = classifyUrlByPattern(xUrl);
  assert.ok(match);
  assert.equal(match.category, 'PLATFORM_PAGE');
  assert.equal(match.platform, 'x_twitter');
  assert.equal(match.mediaId, '1847382910293847');
  assert.equal(match.canonicalUrl, 'https://x.com/NASA/status/1847382910293847');

  const twitterUrl = 'https://mobile.twitter.com/i/web/status/19001122334455';
  const twMatch = classifyUrlByPattern(twitterUrl);
  assert.equal(twMatch?.platform, 'x_twitter');
  assert.equal(twMatch?.mediaId, '19001122334455');

  const fxUrl = 'https://fxtwitter.com/user/status/9988776655';
  assert.equal(classifyUrlByPattern(fxUrl)?.platform, 'x_twitter');
  assert.equal(classifyUrlByPattern(fxUrl)?.mediaId, '9988776655');
});

test('unwraps Instagram/Facebook redirectors and parses Instagram reels/posts/tv', () => {
  const wrappedIg =
    'https://l.instagram.com/?u=https%3A%2F%2Fwww.instagram.com%2Freel%2FC8xAbCd1234%2F%3Figsh%3DMzRlODBiNWFlZA%253D%253D';
  const match = classifyUrlByPattern(wrappedIg);
  assert.ok(match);
  assert.equal(match.category, 'PLATFORM_PAGE');
  assert.equal(match.platform, 'instagram');
  assert.equal(match.mediaId, 'C8xAbCd1234');
  assert.equal(match.mediaSubKind, 'reel');
  assert.equal(match.canonicalUrl, 'https://www.instagram.com/reel/C8xAbCd1234/');

  const postMatch = classifyUrlByPattern('https://instagram.com/p/DB12345_ab/');
  assert.equal(postMatch?.platform, 'instagram');
  assert.equal(postMatch?.mediaId, 'DB12345_ab');
  assert.equal(postMatch?.mediaSubKind, 'p');

  const wrappedFb = 'https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.facebook.com%2Freel%2F1234567890&h=AT0';
  const fbMatch = classifyUrlByPattern(wrappedFb);
  assert.equal(fbMatch?.platform, 'facebook');
  assert.equal(fbMatch?.mediaId, '1234567890');
});

test('recognizes TikTok, Reddit, Vimeo, Dailymotion, Pinterest, Streamable, Threads, Twitch, and SoundCloud', () => {
  assert.equal(classifyUrlByPattern('https://www.tiktok.com/@creator/video/73991122334455')?.platform, 'tiktok');
  assert.equal(classifyUrlByPattern('https://www.tiktok.com/@creator/video/73991122334455')?.mediaId, '73991122334455');
  assert.equal(classifyUrlByPattern('https://vm.tiktok.com/ZM6abcDEF/')?.platform, 'tiktok');

  const reddit = classifyUrlByPattern('https://www.reddit.com/r/videos/comments/1abcde/cool_clip/');
  assert.equal(reddit?.platform, 'reddit');
  assert.equal(reddit?.mediaId, '1abcde');

  const vimeo = classifyUrlByPattern('https://vimeo.com/987654321');
  assert.equal(vimeo?.platform, 'vimeo');
  assert.equal(vimeo?.mediaId, '987654321');

  const dm = classifyUrlByPattern('https://www.dailymotion.com/video/x8abcde');
  assert.equal(dm?.platform, 'dailymotion');
  assert.equal(dm?.mediaId, 'x8abcde');

  assert.equal(classifyUrlByPattern('https://www.pinterest.com/pin/112233445566/')?.platform, 'pinterest');
  assert.equal(classifyUrlByPattern('https://streamable.com/ab12cd')?.platform, 'streamable');
  assert.equal(classifyUrlByPattern('https://www.threads.net/@user/post/C9xyz123')?.platform, 'threads');
  assert.equal(classifyUrlByPattern('https://www.twitch.tv/videos/2233445566')?.platform, 'twitch');
  assert.equal(classifyUrlByPattern('https://soundcloud.com/artist/track-name')?.platform, 'soundcloud');
});

test('detects extensionless CDN streams and query mime hints as DIRECT_MEDIA', () => {
  const twCdn = classifyUrlByPattern('https://video.twimg.com/ext_tw_video/18473/pu/vid/720x1280/abc?tag=12');
  assert.equal(twCdn?.category, 'DIRECT_MEDIA');
  assert.equal(twCdn?.inferredMime, 'video/mp4');
  assert.equal(twCdn?.isCdnDirect, true);

  const igCdn = classifyUrlByPattern('https://scontent.cdninstagram.com/v/t50.2886-16/12345?efg=xyz');
  assert.equal(igCdn?.category, 'DIRECT_MEDIA');
  assert.equal(igCdn?.inferredMime, 'video/mp4');

  const queryMime = classifyUrlByPattern('https://cdn.example.net/stream?token=1&mime=video%2Fmp4');
  assert.equal(queryMime?.category, 'DIRECT_MEDIA');
  assert.equal(queryMime?.inferredExtension, 'mp4');

  const redditDash = classifyUrlByPattern('https://v.redd.it/abcdef12345/DASH_720.mp4');
  assert.equal(redditDash?.category, 'DIRECT_MEDIA');
  // Bare v.redd.it link without DASH_/HLSPlaylist is treated as a platform page
  const redditPage = classifyUrlByPattern('https://v.redd.it/abcdef12345');
  assert.equal(redditPage?.category, 'PLATFORM_PAGE');
  assert.equal(redditPage?.platform, 'reddit');
});

test('canonicalizeUrlForPattern rejects non-http(s) and credentialed URLs', () => {
  assert.equal(canonicalizeUrlForPattern('javascript:alert(1)'), null);
  assert.equal(canonicalizeUrlForPattern('https://user:pass@example.com/v.mp4'), null);
  assert.equal(canonicalizeUrlForPattern('   '), null);
});

test('collectUrlsFromHtml unescapes Instagram/Meta JSON strings and excludes YouTube URLs', () => {
  const escapedSnippet = `
    <script type="application/json">
      {
        "video_versions": [
          {"width": 1080, "height": 1920, "url": "https:\\u002F\\u002Fscontent.cdninstagram.com\\u002Fv\\u002Ft50\\u002Fclip.mp4?oh=abc\\u0026oe=123"}
        ],
        "playable_url_quality_hd": "https:\\/\\/video.xx.fbcdn.net\\/v\\/t42.1790-2\\/hd.mp4?efg=1&amp;_nc_ht=scontent",
        "ignored_yt": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
      }
    </script>
  `;

  assert.equal(
    unescapeEmbeddedText('https:\\u002F\\u002Fcdn.test\\u002Fv.mp4\\u003Fa\\u003D1\\u0026b\\u003D2'),
    'https://cdn.test/v.mp4?a=1&b=2'
  );

  const found = new Map<string, ExtractedMediaItem>();
  collectUrlsFromHtml(escapedSnippet, 'https://www.instagram.com/reel/abc/', found);
  const urls = Array.from(found.keys());

  assert.ok(urls.some((u) => u === 'https://scontent.cdninstagram.com/v/t50/clip.mp4?oh=abc&oe=123'));
  assert.ok(urls.some((u) => u.startsWith('https://video.xx.fbcdn.net/v/t42.1790-2/hd.mp4?efg=1&_nc_ht=scontent')));
  assert.equal(urls.some((u) => u.includes('youtube.com')), false);
});

test('extractMediaWithPatterns rejects YouTube immediately without network calls', async () => {
  const res = await extractMediaWithPatterns('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(res.ok, false);
  assert.equal(res.youtubeExcluded, true);
  assert.equal(res.error, 'YOUTUBE_EXCLUDED');
  assert.equal(res.items.length, 0);
});
