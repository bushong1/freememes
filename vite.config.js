import { defineConfig } from 'vite';
import { createImportMiddleware } from './server/import-media.js';
const imports = () => ({
  name: 'freememes-imports',
  configureServer(server) { server.middlewares.use(createImportMiddleware()); },
  configurePreviewServer(server) { server.middlewares.use(createImportMiddleware()); },
});
export default defineConfig({ esbuild: { jsx: 'automatic' }, plugins: [imports()] });
