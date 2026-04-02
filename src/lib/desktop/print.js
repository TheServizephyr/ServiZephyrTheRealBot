import { isDesktopApp } from './runtime';
import { silentPrintDesktopHtml } from './offlineStore';
function toPrintableError(error, fallbackMessage) {
  if (error instanceof Error) return error;
  const message = typeof error === 'string' && error ? error : fallbackMessage;
  return new Error(message);
}

function safeReadStylesheet(stylesheet) {
  try {
    if (!stylesheet?.cssRules) return '';
    return Array.from(stylesheet.cssRules).map((rule) => rule.cssText).join('\n');
  } catch {
    return '';
  }
}

function collectDocumentStyles() {
  if (typeof document === 'undefined') return '';

  const inlineStyles = Array.from(document.querySelectorAll('style'))
    .map((styleTag) => styleTag.textContent || '')
    .join('\n');

  const stylesheetRules = Array.from(document.styleSheets || [])
    .map(safeReadStylesheet)
    .filter(Boolean)
    .join('\n');

  return [inlineStyles, stylesheetRules].filter(Boolean).join('\n');
}

function buildPrintableHtml(markup, { title = 'ServiZephyr Receipt' } = {}) {
  const styles = collectDocumentStyles();
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
      }
      .no-print {
        display: none !important;
      }
    </style>
    <style>${styles}</style>
  </head>
  <body>
    ${markup}
  </body>
</html>`;
}

export async function silentPrintElement(element, {
  documentTitle = 'ServiZephyr Receipt',
  printerName = '',
} = {}) {
  if (!isDesktopApp()) {
    throw new Error('desktop_runtime_unavailable');
  }

  if (!element?.outerHTML) {
    throw new Error('printable_element_missing');
  }

  const html = buildPrintableHtml(element.outerHTML, { title: documentTitle });
  const result = await silentPrintDesktopHtml({
    html,
    documentTitle,
    printerName,
  });

  if (result?.ok === false) {
    throw toPrintableError(result?.error, 'desktop_print_failed');
  }

  return result;
}
