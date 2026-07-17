import { defineConfig, type Plugin } from 'vite';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// [BLINK-TEST] dev-эндпоинт для тэггера точек глаз: GET/POST /__eyes читает и
// пишет src/assets/eyes.json. Работает только в dev (vite serve), в прод-сборку
// не попадает. Убрать вместе с фичей моргания.
const EYES_FILE = fileURLToPath(new URL('./src/assets/eyes.json', import.meta.url));
function eyesTagger(): Plugin {
  return {
    name: 'eyes-tagger',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__eyes', (req, res) => {
        if (req.method === 'GET') {
          const json = existsSync(EYES_FILE) ? readFileSync(EYES_FILE, 'utf8') : '{}';
          res.setHeader('Content-Type', 'application/json');
          res.end(json);
          return;
        }
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (c) => { body += c; });
          req.on('end', () => {
            try {
              const obj = JSON.parse(body);           // валидируем перед записью
              writeFileSync(EYES_FILE, JSON.stringify(obj, null, 2) + '\n');
              res.statusCode = 200; res.end('ok');
            } catch (e) {
              res.statusCode = 400; res.end(String(e));
            }
          });
          return;
        }
        res.statusCode = 405; res.end();
      });
    },
  };
}

export default defineConfig({
  base: './', // относительные пути — нужно для запаковки под Яндекс Игры
  plugins: [eyesTagger()], // [BLINK-TEST]
  server: {
    // [BLINK-TEST] запись разметки глаз не должна дёргать HMR/full-reload — иначе
    // тэггер на /eyes.html перезагружается на каждый клик и список прыгает в начало.
    // Игра подхватит новую разметку при ручной перезагрузке вкладки.
    watch: { ignored: ['**/src/assets/eyes.json'] },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
