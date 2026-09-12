// Swagger UI served from Cloudflare's CDN rather than swagger-ui-express's
// bundled static assets — smaller cold starts, and it keeps working on
// serverless hosts (Vercel) where the packaged asset files aren't shipped.
//
// Pinned to the newest build cdnjs carries, with SRI hashes so a tampered or
// swapped CDN file is rejected by the browser instead of executed.
const SWAGGER_UI_VERSION = '5.29.1';
const CDN = `https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/${SWAGGER_UI_VERSION}`;

const ASSETS = {
  css: {
    url: `${CDN}/swagger-ui.min.css`,
    sri: 'sha512-QIJpSy6rqOKoEjIR+Pp7r5lTkNPJPJCRejWzG4jb12bCT1EeL/vcjZtk4NNKeEuVRXY+d34d/t9y1CHzZbgeJQ==',
  },
  bundle: {
    url: `${CDN}/swagger-ui-bundle.min.js`,
    sri: 'sha512-yfAKqi7F3JSDZA7V/XTql3caj2o8A81yg2EWIBykt2BJjLjNYnsd4CVAKvrFp/nYl9HQX7R06Z6e5KBn5aoj6g==',
  },
  preset: {
    url: `${CDN}/swagger-ui-standalone-preset.min.js`,
    sri: 'sha512-Bhhnbk6zKqcSKnX/IONDmlcxgboSRfYsuIiOaxTs1x4vBrQwVWBN7KLwrOMiPnwKe/w815FZATtpJIYK8Psqxg==',
  },
};

/**
 * Build the /docs page. The spec is fetched from `specUrl` at runtime rather
 * than inlined, so editing a JSDoc block only needs a server restart + refresh.
 */
export function docsHtml({ title = 'API Docs', specUrl = '/openapi.json' } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="preconnect" href="https://cdnjs.cloudflare.com" crossorigin>
  <link rel="stylesheet" href="${ASSETS.css.url}"
        integrity="${ASSETS.css.sri}" crossorigin="anonymous" referrerpolicy="no-referrer">
  <style>
    body { margin: 0; background: #fafafa; }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${ASSETS.bundle.url}"
          integrity="${ASSETS.bundle.sri}" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
  <script src="${ASSETS.preset.url}"
          integrity="${ASSETS.preset.sri}" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '${specUrl}',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      plugins: [SwaggerUIBundle.plugins.DownloadUrl],
      layout: 'StandaloneLayout',
      tryItOutEnabled: true,
      displayRequestDuration: true,
      persistAuthorization: true,
    });
  </script>
</body>
</html>`;
}

export { SWAGGER_UI_VERSION };
