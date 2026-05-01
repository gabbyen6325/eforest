import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  const userId = process.env.FORESTTRIP_USER_ID ?? '';
  const password = process.env.FORESTTRIP_PASSWORD ?? '';

  await page.goto('https://www.foresttrip.go.kr/index.jsp');
  await page.getByRole('link', { name: '로그인 로그인' }).click();
  await page.getByRole('textbox', { name: '아이디' }).click();
  await page.getByRole('textbox', { name: '아이디' }).fill(userId);
  await page.getByRole('textbox', { name: '아이디' }).press('Tab');
  await page.getByRole('textbox', { name: '비밀번호' }).fill(password);
  await page.getByRole('button', { name: '로그인' }).click();
  const page1Promise = page.waitForEvent('popup');
  await page.getByRole('link', { name: '바로가기' }).first().click();
  const page1 = await page1Promise;
  await page1.locator('#enterPopup11708').getByRole('link', { name: '시간 동안 닫기' }).click();
  await page1.locator('#enterPopup11800').getByRole('link', { name: '시간 동안 닫기' }).click();
  await page1.locator('#enterPopup11800 > .popup_wrap').click();
  await page1.getByRole('textbox', { name: '날짜선택날짜선택' }).click();
  await page1.getByText('날짜선택').click();
  await page1.getByRole('link', { name: '23' }).nth(2).click();
  await page1.getByRole('link', { name: '24' }).nth(2).click();
  await page1.getByRole('link', { name: '확인' }).click();
  await page1.getByRole('button', { name: '입력한 내용으로 예약 조회' }).click();
  await page1.getByRole('link', { name: '야영', exact: true }).click();
  await page1.locator('label > span').first().click();
  await page1.getByRole('link', { name: '국립' }).click();
  await page1.getByRole('link', { name: '공립' }).click();
});