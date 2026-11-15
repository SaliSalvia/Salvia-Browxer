import {
  DASH_EXTENSION,
  MEDIA_EXTENSIONS,
  SEGMENT_EXTENSIONS,
  isPlaylistUrl,
  pathExtension,
} from './mediaUrlRules';

export const DEFAULT_BLOCKED_HOSTS = new Set([
  'doubleclick.net',
  'googleadservices.com',
  'googlesyndication.com',
  'googletagmanager.com',
  'google-analytics.com',
  'adservice.google.com',
  'pagead2.googlesyndication.com',
  'adnxs.com',
  'adsrvr.org',
  'amazon-adsystem.com',
  'casalemedia.com',
  'criteo.com',
  'criteo.net',
  'dotomi.com',
  'openx.net',
  'pubmatic.com',
  'rubiconproject.com',
  'smartadserver.com',
  'sovrn.com',
  'yieldmo.com',
  '33across.com',
  'adform.net',
  'bidswitch.net',
  'districtm.io',
  'mediageneral.com',
  'sharethrough.com',
  'teads.tv',
  'gumgum.com',
  'improvedigital.com',
  'inmobi.com',
  'ironsrc.com',
  'lifestreet.com',
  'mopub.com',
  'smaato.net',
  'startappservice.com',
  'supersonicads.com',
  'unityads.unity3d.com',
  'vungle.com',
  'chartboost.com',
  'applovin.com',
  'adcolony.com',
  'taboola.com',
  'outbrain.com',
  'revcontent.com',
  'mgid.com',
  'zergnet.com',
  'aniview.com',
  'spotxchange.com',
  'springserve.com',
  'tremorhub.com',
  'scorecardresearch.com',
  'quantserve.com',
  'imrworldwide.com',
  'moatads.com',
  'admaster.com.cn',
  'hotjar.com',
  'mixpanel.com',
  'amplitude.com',
  'segment.com',
  'segment.io',
  'branch.io',
  'adjust.com',
  'appsflyer.com',
  'newrelic.com',
  'bugsnag.com',
  'sentry.io',
]);

const NEVER_BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

export function hostOfUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = url.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
    return host || null;
  } catch {
    return null;
  }
}

export function matchesDomain(host: string, domain: string): boolean {
  const target = domain.toLowerCase().trim().replace(/\.+$/, '');
  if (!target) return false;
  return host === target || host.endsWith(`.${target}`);
}

export function isUnblockableHost(host: string): boolean {
  if (NEVER_BLOCKED_HOSTS.has(host)) return true;
  if (host.startsWith('192.168.') || host.startsWith('10.') || host.startsWith('169.254.')) {
    return true;
  }
  if (host.startsWith('172.')) {
    const second = Number(host.split('.')[1]);
    if (Number.isFinite(second) && second >= 16 && second <= 31) return true;
  }
  return false;
}

export function isMediaRequestUrl(url: string): boolean {
  const path = url.split('#')[0].split('?')[0];
  const ext = pathExtension(path);
  if (
    ext &&
    (MEDIA_EXTENSIONS.has(ext) || SEGMENT_EXTENSIONS.has(ext) || ext === DASH_EXTENSION)
  ) {
    return true;
  }
  return isPlaylistUrl(url, null);
}

export function isBlockedAdHost(url: string): boolean {
  const host = hostOfUrl(url);
  if (!host || isUnblockableHost(host) || isMediaRequestUrl(url)) return false;
  for (const blocked of DEFAULT_BLOCKED_HOSTS) {
    if (matchesDomain(host, blocked)) return true;
  }
  return false;
}
