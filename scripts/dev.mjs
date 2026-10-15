import { spawn } from 'node:child_process';

console.log('[FeeCore] Starting backend API (http://localhost:4000) and frontend web (http://localhost:5180)...');

const api = spawn('npm', ['run', 'dev:api'], { stdio: 'inherit', shell: true });
const web = spawn('npm', ['run', 'dev:web'], { stdio: 'inherit', shell: true });

function shutdown() {
  console.log('\n[FeeCore] Shutting down development servers...');
  try { api.kill(); } catch {}
  try { web.kill(); } catch {}
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

api.on('exit', (code) => {
  if (code && code !== 0) {
    console.error(`[FeeCore API] exited with code ${code}`);
  }
});

web.on('exit', (code) => {
  if (code && code !== 0) {
    console.error(`[FeeCore Web] exited with code ${code}`);
  }
});
