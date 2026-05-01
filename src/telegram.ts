import process from 'node:process';
import { type AppConfig, loadConfig } from './config';

export interface TelegramMessage {
  text: string;
  disableWebPagePreview?: boolean;
}

export async function sendTelegramMessage(
  config: Pick<AppConfig, 'telegramBotToken' | 'telegramChatId'>,
  message: TelegramMessage,
): Promise<void> {
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.telegramChatId,
      text: message.text,
      disable_web_page_preview: message.disableWebPagePreview ?? true,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Telegram sendMessage failed: ${response.status} ${body}`);
  }
}

async function runTelegramTest(): Promise<void> {
  const config = loadConfig('telegram');
  await sendTelegramMessage(config, {
    text: `[foresttrip] 텔레그램 알림 테스트\n${new Date().toLocaleString('ko-KR')}`,
  });
  console.log('텔레그램 테스트 메시지를 전송했습니다.');
}

if (require.main === module) {
  runTelegramTest().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
