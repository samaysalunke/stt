/* GLightbox, stylesheet and all, behind one dynamic import.
 *
 * Both call sites already loaded the library lazily, but they also carried a
 * top-level `import 'glightbox/dist/css/glightbox.css'`, and that is enough to
 * put the stylesheet in the page's render-blocking <link> — Astro collects page
 * CSS by walking the whole module graph, so moving the import behind the
 * dynamic boundary does not help either. Measured usage of those 13.6 KiB on a
 * trip page, before the visitor opens a gallery, is 0%.
 *
 * `?url` is the way out: Vite emits the stylesheet as a hashed asset and hands
 * back its URL instead of registering it as CSS the page depends on, so the
 * <link> is ours to append when the lightbox actually loads. It keeps the
 * immutable /_astro caching a `public/` copy would lose.
 *
 * Import this as `import('../lib/lightbox')`.
 */
// @ts-expect-error — Vite's ?url suffix resolves to the emitted asset URL.
import styleUrl from 'glightbox/dist/css/glightbox.css?url';
import GLightbox from 'glightbox';

const STYLE_ID = 'glightbox-css';

/** The stylesheet, appended once, awaited until it has actually applied —
 *  binding against unstyled markup would flash the gallery at full size. */
function loadStyles(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (document.getElementById(STYLE_ID)) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = styleUrl;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

/**
 * Builds a lightbox with its styles guaranteed present.
 *
 * GLightbox binds listeners to whatever the selector matched and leaves no
 * trace in the DOM, so "is it ready yet" was previously unanswerable from the
 * outside — until the import resolved, a gallery anchor was a plain link that
 * navigated away on click. `data-lightbox-ready` is that missing signal, and
 * `tests/e2e/photo-vault-lightbox.spec.ts` waits on it.
 */
export default async function createLightbox(options: Record<string, unknown>) {
  await loadStyles();
  const instance = GLightbox(options as any);
  document.documentElement.dataset.lightboxReady = '1';
  return instance;
}
