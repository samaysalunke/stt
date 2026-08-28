import MarkdownIt from 'markdown-it';

/** Render admin-authored Markdown without permitting inline HTML. */
export function renderSafeMarkdown(content: string): string {
  const markdown = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
  });

  const defaultLinkOpen = markdown.renderer.rules.link_open
    ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));

  markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const href = token.attrGet('href') ?? '';

    if (/^https?:\/\//i.test(href)) {
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener noreferrer');
    }

    return defaultLinkOpen(tokens, index, options, env, self);
  };

  return markdown.render(String(content ?? ''));
}
