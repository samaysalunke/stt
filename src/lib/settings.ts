import { YAML, fs, CONTENT_BASE, SITE_SETTINGS_FILE, ensureDir } from './_contentBase';
import { cachedRead, bumpContentVersion } from './contentCache';

/**
 * Cached: this is the single hottest content read on the site — BaseLayout,
 * Footer, and most pages each call it, so it ran 2-3x per render (plus twice
 * per POST /api/register). The returned object is shared and read-only.
 */
export function readSiteSettings(): Record<string, any> {
  return cachedRead('settings', () => {
    if (!fs.existsSync(SITE_SETTINGS_FILE)) return {};
    const raw = fs.readFileSync(SITE_SETTINGS_FILE, 'utf-8');
    return YAML.parse(raw) ?? {};
  });
}

export function writeSettings(data: Record<string, any>): void {
  ensureDir(CONTENT_BASE);
  fs.writeFileSync(SITE_SETTINGS_FILE, YAML.stringify(data), 'utf-8');
  bumpContentVersion();
}
