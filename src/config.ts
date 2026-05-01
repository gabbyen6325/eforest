import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';

dotenv.config();

export type RunMode = 'auth' | 'monitor' | 'telegram';

export interface AppConfig {
  baseUrl: string;
  loginUrl: string;
  authStatePath: string;
  headless: boolean;
  slowMoMs: number;
  userId?: string;
  password?: string;
  loginIdSelector: string;
  loginPasswordSelector: string;
  loginSubmitSelector: string;
  loggedInSelector: string;
  loggedOutSelector: string;
  regionName: string;
  checkInDate: string;
  checkOutDate: string;
  dateInputValue: string;
  checkIntervalMinutes: number;
  runOnce: boolean;
  alertCooldownMinutes: number;
  reservationType: 'camping' | 'lodging';
  facilityFilterSelector: string;
  regionSelector: string;
  regionOptionSelector?: string;
  regionConfirmSelector?: string;
  dateInputSelector: string;
  checkInSelector?: string;
  checkOutSelector?: string;
  searchButtonSelector: string;
  availabilityKeywords: string[];
  unavailableKeywords: string[];
  telegramBotToken: string;
  telegramChatId: string;
}

function getEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function boolEnv(name: string, defaultValue: boolean): boolean {
  const value = getEnv(name);
  if (!value) {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'y', 'on'].includes(value.toLowerCase());
}

function numberEnv(name: string, defaultValue: number, minValue = 0): number {
  const value = getEnv(name);
  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minValue) {
    throw new Error(`${name} must be a number greater than or equal to ${minValue}.`);
  }

  return parsed;
}

function listEnv(name: string, defaultValue: string[]): string[] {
  const value = getEnv(name);
  if (!value) {
    return defaultValue;
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function reservationTypeEnv(): 'camping' | 'lodging' {
  const value = (getEnv('RESERVATION_TYPE') ?? 'camping').toLowerCase();
  if (['camping', 'camp', '야영'].includes(value)) {
    return 'camping';
  }

  if (['lodging', 'room', 'house', '숙박'].includes(value)) {
    return 'lodging';
  }

  throw new Error('RESERVATION_TYPE must be either camping or lodging.');
}

function requireValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function defaultDateInputValue(checkInDate: string, checkOutDate: string): string {
  if (!checkInDate || !checkOutDate) {
    return '';
  }

  return `${checkInDate.replaceAll('-', '.')} ~ ${checkOutDate.replaceAll('-', '.')}`;
}

export function loadConfig(mode: RunMode): AppConfig {
  const rawBaseUrl = getEnv('FORESTTRIP_BASE_URL') ?? 'https://www.foresttrip.go.kr/main.do?hmpgId=FRIP';
  const baseUrl =
    rawBaseUrl === 'https://www.foresttrip.go.kr/' || rawBaseUrl === 'https://www.foresttrip.go.kr'
      ? 'https://www.foresttrip.go.kr/main.do?hmpgId=FRIP'
      : rawBaseUrl;
  const checkInDate = getEnv('CHECK_IN_DATE') ?? '';
  const checkOutDate = getEnv('CHECK_OUT_DATE') ?? '';
  const config: AppConfig = {
    baseUrl,
    loginUrl:
      getEnv('FORESTTRIP_LOGIN_URL') ??
      'https://www.foresttrip.go.kr/com/login.do?targetUrl=/main.do?hmpgId=FRIP',
    authStatePath: path.resolve(getEnv('AUTH_STATE_PATH') ?? 'playwright/.auth/foresttrip.json'),
    headless: boolEnv('HEADLESS', false),
    slowMoMs: numberEnv('SLOW_MO_MS', 0),
    userId: getEnv('FORESTTRIP_USER_ID'),
    password: getEnv('FORESTTRIP_PASSWORD'),
    loginIdSelector:
      getEnv('LOGIN_ID_SELECTOR') ??
      'input[name="userId"], input#userId, input[name="loginId"], input#loginId, input[name="id"], input#id, input[type="text"]',
    loginPasswordSelector: getEnv('LOGIN_PASSWORD_SELECTOR') ?? 'input[type="password"]',
    loginSubmitSelector:
      getEnv('LOGIN_SUBMIT_SELECTOR') ??
      'button[type="submit"], input[type="submit"], button:has-text("로그인"), a:has-text("로그인")',
    loggedInSelector: getEnv('LOGGED_IN_SELECTOR') ?? 'text=로그아웃',
    loggedOutSelector: getEnv('LOGGED_OUT_SELECTOR') ?? 'text=로그인',
    regionName: getEnv('REGION_NAME') ?? '',
    checkInDate,
    checkOutDate,
    dateInputValue: getEnv('DATE_INPUT_VALUE') ?? defaultDateInputValue(checkInDate, checkOutDate),
    checkIntervalMinutes: numberEnv('CHECK_INTERVAL_MINUTES', 5, 1),
    runOnce: boolEnv('RUN_ONCE', false),
    alertCooldownMinutes: numberEnv('ALERT_COOLDOWN_MINUTES', 30, 0),
    reservationType: reservationTypeEnv(),
    facilityFilterSelector: getEnv('FACILITY_FILTER_SELECTOR') ?? '#filter2',
    regionSelector: getEnv('REGION_SELECTOR') ?? 'a.yeyakSearchName',
    regionOptionSelector: getEnv('REGION_OPTION_SELECTOR'),
    regionConfirmSelector: getEnv('REGION_CONFIRM_SELECTOR'),
    dateInputSelector: getEnv('DATE_INPUT_SELECTOR') ?? '#calPicker',
    checkInSelector: getEnv('CHECK_IN_SELECTOR'),
    checkOutSelector: getEnv('CHECK_OUT_SELECTOR'),
    searchButtonSelector:
      getEnv('SEARCH_BUTTON_SELECTOR') ??
      '#srch_frm button[title="조회하기"], #srch_frm button:has-text("입력한 내용으로 예약 조회"), #srch_frm button[type="submit"], #srch_frm input[type="submit"]',
    availabilityKeywords: listEnv('AVAILABILITY_KEYWORDS', ['예약가능', '예약하기', '선택가능', '가능']),
    unavailableKeywords: listEnv('UNAVAILABLE_KEYWORDS', ['예약불가', '마감', '대기', '완료']),
    telegramBotToken: getEnv('TELEGRAM_BOT_TOKEN') ?? '',
    telegramChatId: getEnv('TELEGRAM_CHAT_ID') ?? '',
  };

  if (mode === 'monitor') {
    requireValue('REGION_NAME', config.regionName);
    requireValue('CHECK_IN_DATE', config.checkInDate);
    requireValue('CHECK_OUT_DATE', config.checkOutDate);
    requireValue('TELEGRAM_BOT_TOKEN', config.telegramBotToken);
    requireValue('TELEGRAM_CHAT_ID', config.telegramChatId);
  }

  if (mode === 'telegram') {
    requireValue('TELEGRAM_BOT_TOKEN', config.telegramBotToken);
    requireValue('TELEGRAM_CHAT_ID', config.telegramChatId);
  }

  return config;
}

export function hasCredentials(config: AppConfig): boolean {
  return Boolean(config.userId && config.password);
}
