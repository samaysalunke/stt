import { YAML, fs, CONTENT_BASE, SITE_SETTINGS_FILE, ensureDir } from './_contentBase';

export function readSiteSettings(): Record<string, any> {
  if (!fs.existsSync(SITE_SETTINGS_FILE)) return {};
  const raw = fs.readFileSync(SITE_SETTINGS_FILE, 'utf-8');
  return YAML.parse(raw) ?? {};
}

export function writeSettings(data: Record<string, any>): void {
  ensureDir(CONTENT_BASE);
  fs.writeFileSync(SITE_SETTINGS_FILE, YAML.stringify(data), 'utf-8');
}
