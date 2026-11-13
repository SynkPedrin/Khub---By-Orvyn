// A free web instance runs both processes. If either fails, restart the unit.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../apps/api/', import.meta.url));
const children = [];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  const timer = setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  }, 10000);
  timer.unref();
}
for (const entry of ['dist/main.js', 'dist/worker.js']) {
  const child = spawn(process.execPath, [entry], { cwd, env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=160' }, stdio: 'inherit' });
  children.push(child);
  child.on('error', () => { process.stderr.write(`Unable to start ${entry}\n`); stop(1); });
  child.on('exit', () => { if (!stopping) stop(1); });
}
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
