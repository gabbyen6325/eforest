import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { parse } from 'dotenv';

const PORT = Number(process.env.UI_PORT ?? 3000);
/** 모든 네트워크 인터페이스(Tailscale 포함)에서 수신. 미지정 시 일부 OS에서 원격 접속 불가 */
const UI_HOST = process.env.UI_HOST ?? '0.0.0.0';
const ROOT_DIR = process.cwd();
const ENV_PATH = path.join(ROOT_DIR, '.env');
const ENV_EXAMPLE_PATH = path.join(ROOT_DIR, '.env.example');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const MAX_LOG_LINES = 200;

type EnvMap = Record<string, string>;

interface UiConfig {
  regionName: string;
  reservationType: 'camping' | 'lodging';
  checkInDate: string;
  checkOutDate: string;
  checkIntervalMinutes: string;
  runOnce: boolean;
  alertCooldownMinutes: string;
  headless: boolean;
}

let monitorProcess: ChildProcessWithoutNullStreams | undefined;
let monitorStartedAt: string | undefined;
let monitorLogs: string[] = [];

function appendLog(chunk: Buffer | string): void {
  const lines = chunk
    .toString()
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  monitorLogs.push(...lines);
  if (monitorLogs.length > MAX_LOG_LINES) {
    monitorLogs = monitorLogs.slice(-MAX_LOG_LINES);
  }
}

async function ensureEnvFile(): Promise<void> {
  try {
    await fs.access(ENV_PATH);
  } catch {
    await fs.copyFile(ENV_EXAMPLE_PATH, ENV_PATH);
  }
}

async function readEnvText(): Promise<string> {
  await ensureEnvFile();
  return fs.readFile(ENV_PATH, 'utf8');
}

async function readEnv(): Promise<EnvMap> {
  return parse(await readEnvText());
}

function toUiConfig(env: EnvMap): UiConfig {
  return {
    regionName: env.REGION_NAME ?? '',
    reservationType: env.RESERVATION_TYPE === 'lodging' ? 'lodging' : 'camping',
    checkInDate: env.CHECK_IN_DATE ?? '',
    checkOutDate: env.CHECK_OUT_DATE ?? '',
    checkIntervalMinutes: env.CHECK_INTERVAL_MINUTES ?? '5',
    runOnce: (env.RUN_ONCE ?? 'false').toLowerCase() === 'true',
    alertCooldownMinutes: env.ALERT_COOLDOWN_MINUTES ?? '30',
    headless: (env.HEADLESS ?? 'false').toLowerCase() === 'true',
  };
}

function validateConfig(input: Partial<UiConfig>): UiConfig {
  const regionName = input.regionName?.trim() ?? '';
  const reservationType = input.reservationType === 'lodging' ? 'lodging' : 'camping';
  const checkInDate = input.checkInDate?.trim() ?? '';
  const checkOutDate = input.checkOutDate?.trim() ?? '';
  const checkIntervalMinutes = String(input.checkIntervalMinutes ?? '').trim();
  const alertCooldownMinutes = String(input.alertCooldownMinutes ?? '').trim();

  if (!regionName) {
    throw new Error('지역을 입력해 주세요.');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkInDate) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOutDate)) {
    throw new Error('날짜는 YYYY-MM-DD 형식이어야 합니다.');
  }

  if (checkInDate > checkOutDate) {
    throw new Error('체크아웃 날짜는 체크인 날짜보다 빠를 수 없습니다.');
  }

  if (!Number.isFinite(Number(checkIntervalMinutes)) || Number(checkIntervalMinutes) < 1) {
    throw new Error('반복 주기는 1분 이상이어야 합니다.');
  }

  if (!Number.isFinite(Number(alertCooldownMinutes)) || Number(alertCooldownMinutes) < 0) {
    throw new Error('알림 재전송 제한은 0분 이상이어야 합니다.');
  }

  return {
    regionName,
    reservationType,
    checkInDate,
    checkOutDate,
    checkIntervalMinutes,
    runOnce: Boolean(input.runOnce),
    alertCooldownMinutes,
    headless: Boolean(input.headless),
  };
}

async function updateEnv(updates: Record<string, string>): Promise<void> {
  const text = await readEnvText();
  const lines = text.split(/\r?\n/);
  const updatedKeys = new Set<string>();
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match) {
      return line;
    }

    const key = match[1];
    if (!(key in updates)) {
      return line;
    }

    updatedKeys.add(key);
    return `${key}=${updates[key]}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      nextLines.push(`${key}=${value}`);
    }
  }

  await fs.writeFile(ENV_PATH, `${nextLines.join('\n').replace(/\n*$/, '')}\n`, 'utf8');
}

function json(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T;
}

function getStatus(): object {
  return {
    running: Boolean(monitorProcess && !monitorProcess.killed),
    pid: monitorProcess?.pid,
    startedAt: monitorStartedAt,
    logs: monitorLogs.slice(-80),
  };
}

function startMonitor(): void {
  if (monitorProcess && !monitorProcess.killed) {
    throw new Error('모니터가 이미 실행 중입니다.');
  }

  monitorLogs = [];
  monitorStartedAt = new Date().toISOString();
  monitorProcess = spawn('npm', ['run', 'monitor'], {
    cwd: ROOT_DIR,
    shell: true,
    env: { ...process.env },
  });

  appendLog(`모니터 시작: ${monitorStartedAt}`);
  monitorProcess.stdout.on('data', appendLog);
  monitorProcess.stderr.on('data', appendLog);
  monitorProcess.on('exit', (code) => {
    appendLog(`모니터 종료: exit code ${code ?? 'unknown'}`);
    monitorStartedAt = undefined;
    monitorProcess = undefined;
  });
}

function stopMonitor(): void {
  if (!monitorProcess || monitorProcess.killed) {
    return;
  }

  const pid = monitorProcess.pid;
  if (process.platform === 'win32' && pid) {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: false }).on('exit', () => {
      monitorProcess = undefined;
      monitorStartedAt = undefined;
    });
  } else {
    monitorProcess.kill('SIGTERM');
  }

  appendLog('모니터 중지 요청');
}

async function serveStatic(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const contentType = getContentType(filePath);
    response.writeHead(200, { 'content-type': contentType });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}

function getContentType(filePath: string): string {
  if (filePath.endsWith('.html')) {
    return 'text/html; charset=utf-8';
  }

  if (filePath.endsWith('.webmanifest')) {
    return 'application/manifest+json; charset=utf-8';
  }

  if (filePath.endsWith('.js')) {
    return 'text/javascript; charset=utf-8';
  }

  if (filePath.endsWith('.svg')) {
    return 'image/svg+xml';
  }

  return 'text/plain; charset=utf-8';
}

async function handleApi(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'GET' && url.pathname === '/api/config') {
    json(response, 200, { config: toUiConfig(await readEnv()) });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/config') {
    const config = validateConfig(await readJsonBody<Partial<UiConfig>>(request));
    await updateEnv({
      REGION_NAME: config.regionName,
      RESERVATION_TYPE: config.reservationType,
      CHECK_IN_DATE: config.checkInDate,
      CHECK_OUT_DATE: config.checkOutDate,
      CHECK_INTERVAL_MINUTES: config.checkIntervalMinutes,
      RUN_ONCE: String(config.runOnce),
      ALERT_COOLDOWN_MINUTES: config.alertCooldownMinutes,
      HEADLESS: String(config.headless),
      DATE_INPUT_VALUE: '',
    });
    json(response, 200, { config });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/status') {
    json(response, 200, getStatus());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/start') {
    startMonitor();
    json(response, 200, getStatus());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/stop') {
    stopMonitor();
    json(response, 200, getStatus());
    return true;
  }

  return false;
}

const server = http.createServer((request, response) => {
  void (async () => {
    try {
      if (await handleApi(request, response)) {
        return;
      }

      await serveStatic(request, response);
    } catch (error: unknown) {
      json(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  })();
});

server.listen(PORT, UI_HOST, () => {
  console.log(`Foresttrip UI: http://localhost:${PORT} (로컬)`);
  console.log(`원격(같은 Tailscale): http://<이 PC Tailscale IP>:${PORT}`);
});
