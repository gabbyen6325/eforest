import process from 'node:process';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';
import { type AppConfig, loadConfig } from './config';
import { sendTelegramMessage } from './telegram';

interface AvailabilityResult {
  available: boolean;
  snippets: string[];
  facilityNames: string[];
  availableItems: AvailableItem[];
  url: string;
}

interface AvailableItem {
  facilityName: string;
  availableCount: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForLoad(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
}

async function closeForesttripPopups(page: Page): Promise<void> {
  const closeCandidates = [
    page.locator('[id^="enterPopup"] a').filter({ hasText: '시간 동안 닫기' }),
    page.locator('[id^="enterPopup"] a').filter({ hasText: '닫기' }),
    page.locator('a.day_close'),
  ];

  for (const candidate of closeCandidates) {
    const count = await candidate.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const item = candidate.nth(index);
      if (await item.isVisible().catch(() => false)) {
        await item.click().catch(() => undefined);
      }
    }
  }
}

async function clickLocatorIfVisible(locator: Locator): Promise<boolean> {
  const count = await locator.count().catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible().catch(() => false)) {
      await item.click();
      return true;
    }
  }

  return false;
}

async function clickFirstVisible(page: Page, selector: string): Promise<boolean> {
  return clickLocatorIfVisible(page.locator(selector));
}

async function waitAndClickFirstVisible(page: Page, selector: string, timeoutMs = 10_000): Promise<boolean> {
  const locator = page.locator(selector).first();
  try {
    await locator.waitFor({ state: 'visible', timeout: timeoutMs });
    await locator.click();
    return true;
  } catch {
    return false;
  }
}

async function clickByExactText(page: Page, text: string): Promise<boolean> {
  const candidates = [
    page.getByRole('link', { name: text, exact: true }),
    page.getByRole('button', { name: text, exact: true }),
    page.getByText(text, { exact: true }),
  ];

  for (const candidate of candidates) {
    if (await clickLocatorIfVisible(candidate)) {
      return true;
    }
  }

  return false;
}

async function clickByExactTextWithin(page: Page, selector: string, text: string): Promise<boolean> {
  const locator = page.locator(selector).getByText(text, { exact: true });
  return clickLocatorIfVisible(locator);
}

async function setElementValue(page: Page, selector: string, value: string): Promise<void> {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'attached', timeout: 10_000 });
  await locator.evaluate((element, nextValue) => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      throw new Error('Target element is not an input or textarea.');
    }

    element.removeAttribute('readonly');
    element.value = nextValue;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function setOptionalElementValue(page: Page, selector: string, value: string): Promise<boolean> {
  if ((await page.locator(selector).count().catch(() => 0)) === 0) {
    return false;
  }

  await setElementValue(page, selector, value);
  return true;
}

function compactDate(date: string): string {
  return date.replaceAll('-', '');
}

async function selectRegionByScript(page: Page, regionName: string): Promise<boolean> {
  return page.evaluate((name) => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('#srch_frm a'));
    const link = links.find((element) => element.textContent?.trim() === name);
    const onclick = link?.getAttribute('onclick') ?? '';
    const code = onclick.match(/fn_setRegion\('([^']+)'/)?.[1];
    const windowWithRegion = window as typeof window & { fn_setRegion?: (code: string, name: string) => void };

    if (code && typeof windowWithRegion.fn_setRegion === 'function') {
      windowWithRegion.fn_setRegion(code, ` ${name}`);
      return true;
    }

    if (link) {
      link.click();
      return true;
    }

    return false;
  }, regionName);
}

async function setSearchMode(page: Page, config: AppConfig): Promise<void> {
  const houseCampSctin = config.reservationType === 'camping' ? '02' : '01';
  await setOptionalElementValue(page, '#houseCampSctin', houseCampSctin);
}

async function selectRegion(page: Page, config: AppConfig): Promise<void> {
  if (!(await clickFirstVisible(page, config.regionSelector))) {
    throw new Error(`지역 선택 요소를 찾지 못했습니다: ${config.regionSelector}`);
  }

  await page.waitForTimeout(500);

  const selected =
    (await selectRegionByScript(page, config.regionName)) ||
    (config.regionOptionSelector ? await clickFirstVisible(page, config.regionOptionSelector) : false);

  if (!selected) {
    throw new Error(
      `지역 옵션을 찾지 못했습니다: ${config.regionName}. REGION_OPTION_SELECTOR 값을 .env에서 지정해 주세요.`,
    );
  }

  if (config.regionConfirmSelector) {
    await clickFirstVisible(page, config.regionConfirmSelector);
  }

  await page.waitForFunction(() => {
    const region = document.querySelector<HTMLInputElement>('#srchInsttArcd');
    const forest = document.querySelector<HTMLInputElement>('#srchInsttId');
    return Boolean(region?.value || forest?.value);
  }, null, { timeout: 5_000 });
}

async function setDates(page: Page, config: AppConfig): Promise<void> {
  await setElementValue(page, config.dateInputSelector, config.dateInputValue);
  await setOptionalElementValue(page, '#rsrvtBgDt', compactDate(config.checkInDate));
  await setOptionalElementValue(page, '#rsrvtEdDt', compactDate(config.checkOutDate));
  await setOptionalElementValue(page, '#srchUseDt', config.dateInputValue);

  if (config.checkInSelector) {
    await setElementValue(page, config.checkInSelector, config.checkInDate);
  }

  if (config.checkOutSelector) {
    await setElementValue(page, config.checkOutSelector, config.checkOutDate);
  }
}

async function submitSearch(page: Page, config: AppConfig): Promise<void> {
  await setSearchMode(page, config);
  const previousUrl = page.url();
  const clicked = await clickFirstVisible(page, config.searchButtonSelector);
  if (!clicked) {
    throw new Error(`조회 버튼을 찾지 못했습니다: ${config.searchButtonSelector}`);
  }

  await page.waitForURL((url) => url.toString() !== previousUrl, { timeout: 20_000 }).catch(() => undefined);
  await waitForLoad(page);

  if (page.url().includes('/rep/or/sssn/monthRsrvtStatus.do')) {
    throw new Error(
      [
        '월별현황조회 페이지로 이동했습니다. 메인 예약 조회 버튼이 아닌 월별현황조회 링크가 클릭된 상태입니다.',
        `현재 SEARCH_BUTTON_SELECTOR: ${config.searchButtonSelector}`,
        'SEARCH_BUTTON_SELECTOR를 #srch_frm 내부 버튼으로 지정해 주세요.',
      ].join('\n'),
    );
  }
}

async function selectFacilityType(page: Page, config: AppConfig): Promise<void> {
  if (config.reservationType !== 'camping') {
    return;
  }

  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await closeForesttripPopups(page);
  await page.waitForSelector(`${config.facilityFilterSelector}, text=야영`, { timeout: 20_000 }).catch(() => undefined);

  const clicked =
    (await clickLocatorIfVisible(page.getByRole('link', { name: '야영', exact: true }))) ||
    (await waitAndClickFirstVisible(page, config.facilityFilterSelector, 3_000));
  if (!clicked) {
    const switchedByScript = await page.evaluate((selector) => {
      const filter = document.querySelector<HTMLElement>(selector);
      if (filter) {
        filter.click();
        return true;
      }

      const switchFilter = (window as typeof window & { fn_switchFilter?: (value: string) => void }).fn_switchFilter;
      if (typeof switchFilter === 'function') {
        switchFilter('2');
        return true;
      }

      return false;
    }, config.facilityFilterSelector);

    if (!switchedByScript) {
      const pageInfo = await page.evaluate(() => ({
        url: window.location.href,
        title: document.title,
        hasCampingText: document.body.innerText.includes('야영'),
        bodyText: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300),
      }));
      throw new Error(
        [
          `야영 필터를 찾거나 클릭하지 못했습니다: ${config.facilityFilterSelector}`,
          `현재 URL: ${pageInfo.url}`,
          `페이지 제목: ${pageInfo.title}`,
          `야영 문구 포함: ${pageInfo.hasCampingText ? '예' : '아니오'}`,
          `본문 일부: ${pageInfo.bodyText}`,
        ].join('\n'),
      );
    }
  }

  await page.waitForFunction(
    (selector) => {
      const element = document.querySelector(selector);
      return Boolean(
        element?.classList.contains('on') ||
          element?.classList.contains('active') ||
          element?.classList.contains('select') ||
          element?.classList.contains('ov') ||
          element?.getAttribute('aria-selected') === 'true',
      );
    },
    config.facilityFilterSelector,
    { timeout: 5_000 },
  ).catch(() => undefined);
  await waitForLoad(page);
  await page.waitForSelector('#searchResultMap .rc_item', { timeout: 15_000 }).catch(() => undefined);
}

function containsKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function normalizeSnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function filterAvailabilitySnippets(texts: string[], config: AppConfig): string[] {
  const snippets: string[] = [];

  for (const text of texts) {
    const snippet = normalizeSnippet(text);
    if (!snippet || snippet.length < 2) {
      continue;
    }

    if (
      containsKeyword(snippet, config.availabilityKeywords) &&
      !containsKeyword(snippet, config.unavailableKeywords)
    ) {
      snippets.push(snippet.slice(0, 180));
    }
  }

  return Array.from(new Set(snippets)).slice(0, 5);
}

function looksLikeFacilityName(text: string): boolean {
  return /자연휴양림|숲체험장|캠핑장|야영장/.test(text);
}

function extractFacilityNamesFromText(text: string): string[] {
  const normalized = normalizeSnippet(text);
  const facilityPattern =
    /(?:\[[^\]]+\]\s*)?(?:\([^)]+\)\s*)?[가-힣A-Za-z0-9·\-\s]+?(?:자연휴양림|숲체험장|캠핑장|야영장)/g;
  const matches = normalized.match(facilityPattern) ?? [];

  return matches
    .map((match) => normalizeSnippet(match))
    .map((match) => match.replace(/^(예약가능|예약하기|선택가능|가능|예|대|완)\s*/, ''))
    .filter(looksLikeFacilityName);
}

async function detectAvailability(page: Page, config: AppConfig): Promise<AvailabilityResult> {
  const bodyText = await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
  const bodyLines = bodyText.split(/\r?\n/);
  const interactiveTexts = await page
    .locator('a, button, input[type="button"], input[type="submit"]')
    .evaluateAll((elements) =>
      elements.map((element) => {
        if (element instanceof HTMLInputElement) {
          return element.value;
        }

        return element.textContent ?? '';
      }),
    )
    .catch(() => []);

  const snippets = filterAvailabilitySnippets([...interactiveTexts, ...bodyLines], config);
  const facilityNamesFromElements = await page
    .locator('b, strong, dt, .title, .tit, .name')
    .evaluateAll((elements) =>
      elements
        .map((element) => element.textContent?.replace(/\s+/g, ' ').trim() ?? '')
        .filter((name) => /자연휴양림|숲체험장|캠핑장|야영장/.test(name)),
    )
    .catch(() => []);
  const facilityNames = [
    ...facilityNamesFromElements,
    ...snippets.flatMap(extractFacilityNamesFromText),
    ...extractFacilityNamesFromText(bodyText),
  ];
  const availableItems = await page
    .locator('#searchResultMap .rc_item')
    .evaluateAll((items) =>
      items
        .map((item) => {
          const facilityName = item.querySelector('.rc_ti b')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
          const availableCount = item
            .querySelector('.rc_util .ut_roomcount')
            ?.textContent?.replace(/\s+/g, ' ')
            .trim() ?? '';

          return { facilityName, availableCount };
        })
        .filter(({ facilityName, availableCount }) => {
          const count = Number(availableCount.match(/\d+/)?.[0] ?? 0);
          return facilityName && /^예약가능\s*객실\s*수\s*:\s*\d+/.test(availableCount) && count > 0;
        }),
    )
    .catch(() => []);

  return {
    available: availableItems.length > 0,
    snippets,
    facilityNames: Array.from(new Set(facilityNames.filter(looksLikeFacilityName))).slice(0, 10),
    availableItems,
    url: page.url(),
  };
}

async function runSingleCheck(page: Page, config: AppConfig): Promise<AvailabilityResult> {
  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded' });
  await waitForLoad(page);
  await closeForesttripPopups(page);
  await selectRegion(page, config);
  await setDates(page, config);
  await submitSearch(page, config);
  await selectFacilityType(page, config);
  return detectAvailability(page, config);
}

async function runSingleCheckInFreshContext(browser: Browser, config: AppConfig): Promise<AvailabilityResult> {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    return await runSingleCheck(page, config);
  } finally {
    await context.close().catch(() => undefined);
  }
}

function buildAlertText(config: AppConfig, result: AvailabilityResult): string {
  const availableItems = result.availableItems
    .map((item) => `- ${item.facilityName} / ${item.availableCount}`)
    .join('\n');

  return [
    '[foresttrip] 예약가능 시설',
    `지역: ${config.regionName}`,
    `예약 유형: ${config.reservationType === 'camping' ? '야영' : '숙박'}`,
    `체크인: ${config.checkInDate}`,
    `체크아웃: ${config.checkOutDate}`,
    `확인 시각: ${new Date().toLocaleString('ko-KR')}`,
    '',
    availableItems || '- 예약가능 시설명/객실 수를 추출하지 못했습니다.',
  ].join('\n');
}

function buildResultKey(config: AppConfig, result: AvailabilityResult): string {
  return [
    config.regionName,
    config.reservationType,
    config.checkInDate,
    config.checkOutDate,
    result.availableItems.map((item) => `${item.facilityName}:${item.availableCount}`).join('|'),
  ].join('::');
}

async function runMonitor(): Promise<void> {
  const config = loadConfig('monitor');
  const runOnce = config.runOnce || process.argv.includes('--once');
  const browser = await chromium.launch({ headless: config.headless, slowMo: config.slowMoMs });
  let lastAlertKey = '';
  let lastAlertAt = 0;

  console.log(
    `foresttrip 모니터 시작: ${config.regionName}, ${config.reservationType === 'camping' ? '야영' : '숙박'}, ${config.checkInDate} ~ ${config.checkOutDate}, ${config.checkIntervalMinutes}분 주기`,
  );

  try {
    while (true) {
      const startedAt = new Date();

      try {
        const result = await runSingleCheckInFreshContext(browser, config);
        const resultKey = buildResultKey(config, result);
        const cooldownMs = config.alertCooldownMinutes * 60 * 1_000;
        const cooldownPassed = cooldownMs === 0 || Date.now() - lastAlertAt >= cooldownMs;

        if (result.available && (resultKey !== lastAlertKey || cooldownPassed)) {
          await sendTelegramMessage(config, { text: buildAlertText(config, result) });
          lastAlertKey = resultKey;
          lastAlertAt = Date.now();
          console.log(`[${startedAt.toLocaleString('ko-KR')}] 예약 가능 항목 발견, 텔레그램 알림 전송`);
        } else if (result.available) {
          console.log(`[${startedAt.toLocaleString('ko-KR')}] 예약 가능 항목 유지 중, 중복 알림 생략`);
        } else {
          console.log(`[${startedAt.toLocaleString('ko-KR')}] 예약 가능 항목 없음`);
        }
      } catch (error: unknown) {
        console.error(`[${startedAt.toLocaleString('ko-KR')}] 조회 실패`);
        console.error(error instanceof Error ? error.message : error);
      }

      if (runOnce) {
        break;
      }

      await sleep(config.checkIntervalMinutes * 60 * 1_000);
    }
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  runMonitor().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
