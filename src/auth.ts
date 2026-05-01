import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { type AppConfig, hasCredentials, loadConfig } from './config';

const DEFAULT_TIMEOUT_MS = 7_000;

async function waitForLoad(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
}

async function isSelectorVisible(page: Page, selector: string, timeoutMs = 1_500): Promise<boolean> {
  try {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function clickFirstVisible(page: Page, selector: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
  const locator = page.locator(selector);
  const count = await locator.count().catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible().catch(() => false)) {
      await item.click({ timeout: timeoutMs });
      return true;
    }
  }

  return false;
}

async function fillFirstVisible(page: Page, selector: string, value: string): Promise<boolean> {
  const locator = page.locator(selector);
  const count = await locator.count().catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible().catch(() => false)) {
      await item.fill(value, { timeout: DEFAULT_TIMEOUT_MS });
      return true;
    }
  }

  return false;
}

async function ensureAuthDirectory(config: AppConfig): Promise<void> {
  await fs.mkdir(path.dirname(config.authStatePath), { recursive: true });
}

export async function saveStorageState(context: BrowserContext, config: AppConfig): Promise<void> {
  await ensureAuthDirectory(config);
  await context.storageState({ path: config.authStatePath });
}

export async function hasSavedStorageState(config: AppConfig): Promise<boolean> {
  try {
    await fs.access(config.authStatePath);
    return true;
  } catch {
    return false;
  }
}

export async function isLoggedIn(page: Page, config: AppConfig): Promise<boolean> {
  if (await isSelectorVisible(page, config.loggedInSelector, 5_000)) {
    return true;
  }

  const bodyText = await page.locator('body').innerText({ timeout: 3_000 }).catch(() => '');
  if (bodyText.includes('로그아웃')) {
    return true;
  }

  if (await isSelectorVisible(page, config.loggedOutSelector)) {
    return false;
  }

  return false;
}

export async function tryAutoLogin(page: Page, config: AppConfig): Promise<boolean> {
  if (!hasCredentials(config)) {
    return false;
  }

  await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' });
  await waitForLoad(page);

  if (await isLoggedIn(page, config)) {
    return true;
  }

  if (!(await isSelectorVisible(page, config.loginPasswordSelector))) {
    await clickFirstVisible(page, config.loggedOutSelector);
    await waitForLoad(page);
  }

  const filledId = await fillFirstVisible(page, config.loginIdSelector, config.userId ?? '');
  const filledPassword = await fillFirstVisible(page, config.loginPasswordSelector, config.password ?? '');

  if (!filledId || !filledPassword) {
    console.warn('로그인 입력창을 찾지 못했습니다. LOGIN_*_SELECTOR 값을 .env에서 보정해 주세요.');
    return false;
  }

  const clickedSubmit = await clickFirstVisible(page, config.loginSubmitSelector);
  if (!clickedSubmit) {
    console.warn('로그인 버튼을 찾지 못했습니다. LOGIN_SUBMIT_SELECTOR 값을 .env에서 보정해 주세요.');
    return false;
  }

  await waitForLoad(page);
  return isLoggedIn(page, config);
}

export async function ensureLoggedIn(page: Page, config: AppConfig): Promise<void> {
  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded' });
  await waitForLoad(page);

  if (await isLoggedIn(page, config)) {
    return;
  }

  if (await tryAutoLogin(page, config)) {
    await saveStorageState(page.context(), config);
    return;
  }

  throw new Error(
    [
      'foresttrip 로그인에 실패했습니다.',
      '1. FORESTTRIP_USER_ID/FORESTTRIP_PASSWORD 값을 확인하거나',
      '2. npm run auth 명령으로 수동 로그인 세션을 저장해 주세요.',
    ].join('\n'),
  );
}

async function runManualAuth(): Promise<void> {
  const config = loadConfig('auth');
  const browser = await chromium.launch({ headless: false, slowMo: config.slowMoMs });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' });
  await waitForLoad(page);

  console.log('브라우저에서 foresttrip 로그인을 완료한 뒤 이 터미널에서 Enter를 누르세요.');
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  await readline.question('로그인 완료 후 Enter: ');
  readline.close();

  await saveStorageState(context, config);
  console.log(`로그인 세션을 저장했습니다: ${config.authStatePath}`);
  await browser.close();
}

if (require.main === module) {
  runManualAuth().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
