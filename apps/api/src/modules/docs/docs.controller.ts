import { Controller, Get, Header } from '@nestjs/common';

import { buildOpenApiDocument } from './openapi.js';

// Swagger UI from a CDN: docs are dev-only, so no UI dependency is shipped with the API.
const SWAGGER_UI_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FIXO API docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({ url: '/v1/docs/openapi.json', dom_id: '#swagger-ui' });
  </script>
</body>
</html>`;

/** Interactive API docs. Registered only outside production (see AppModule). */
@Controller('docs')
export class DocsController {
  private readonly document = buildOpenApiDocument();

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  ui(): string {
    return SWAGGER_UI_HTML;
  }

  @Get('openapi.json')
  spec(): Record<string, unknown> {
    return this.document;
  }
}
