# Foresttrip 예약 모니터

`foresttrip` 사이트에서 지역과 체크인/체크아웃 날짜로 예약을 조회하고, 예약 가능 항목이 감지되면 텔레그램으로 알림을 보내는 Playwright 기반 모니터입니다.

## 준비

```powershell
npm install
Copy-Item .env.example .env
```

`.env` 파일에 최소한 아래 값을 입력합니다.

```dotenv
FORESTTRIP_BASE_URL=https://www.foresttrip.go.kr/main.do?hmpgId=FRIP
REGION_NAME=강원
RESERVATION_TYPE=camping
CHECK_IN_DATE=2026-05-01
CHECK_OUT_DATE=2026-05-02
CHECK_INTERVAL_MINUTES=5

TELEGRAM_BOT_TOKEN=123456:telegram-bot-token
TELEGRAM_CHAT_ID=123456789
```

## 텔레그램 테스트

```powershell
npm run telegram:test
```

테스트 메시지가 오면 텔레그램 설정이 정상입니다.

## 모니터 실행

```powershell
npm run monitor
```

한 번만 조회해 동작을 확인하려면 다음처럼 실행합니다.

```powershell
npm run monitor -- --once
```

반복 주기는 `.env`의 `CHECK_INTERVAL_MINUTES` 값으로 분 단위 조정합니다. 같은 예약 가능 결과가 계속 보일 때는 `ALERT_COOLDOWN_MINUTES` 동안 중복 알림을 줄입니다.

## 프론트엔드 화면

지역, 예약 유형, 체크인/체크아웃 날짜, 반복 주기를 웹 화면에서 입력하려면 로컬 UI를 실행합니다.

```powershell
npm run ui
```

브라우저에서 `http://localhost:3000`을 열면 입력 화면이 표시됩니다. 화면에서 설정을 저장하면 `.env`의 조회 조건이 갱신되고, `저장 후 시작` 버튼으로 모니터를 실행할 수 있습니다.

## 안드로이드 설치

이 프로젝트는 모바일 브라우저에서 설치 가능한 PWA를 제공합니다.

1. PC와 안드로이드폰을 같은 Wi-Fi에 연결합니다.
2. PC에서 UI를 실행합니다.

```powershell
npm run ui
```

3. PC의 로컬 IP를 확인합니다.

```powershell
ipconfig
```

4. 안드로이드 Chrome에서 아래 주소를 엽니다.

```text
http://PC_IP주소:3000
```

5. Chrome 메뉴에서 `홈 화면에 추가`를 선택하거나, 화면에 `앱 설치` 버튼이 보이면 눌러 설치합니다.

모니터 실행 자체는 PC에서 동작합니다. 안드로이드 앱은 모바일 브라우저에서 PC의 모니터 UI를 제어하는 설치형 화면입니다. Chrome의 정식 PWA 설치 버튼은 HTTPS 또는 localhost에서만 표시될 수 있으므로, 같은 Wi-Fi의 `http://PC_IP주소:3000`에서는 `홈 화면에 추가` 메뉴를 사용하세요.

## 독립형 Android APK 소스

PC 없이 안드로이드폰에서 직접 실행하는 앱 소스는 [android-app](android-app)에 있습니다.

Android Studio에서 `android-app` 폴더를 열고 `Build > Build Bundle(s) / APK(s) > Build APK(s)`를 실행하면 디버그 APK를 만들 수 있습니다.

## 사이트 DOM 보정

기본값은 사용자가 제공한 DOM을 기준으로 합니다.

```dotenv
REGION_SELECTOR=a.yeyakSearchName
DATE_INPUT_SELECTOR=#calPicker
SEARCH_BUTTON_SELECTOR=button[title="조회하기"]
FACILITY_FILTER_SELECTOR=#filter2
```

사이트 화면 구조가 달라져 지역 선택이나 조회 버튼을 못 찾으면 `.env`에서 selector를 보정합니다.

```dotenv
REGION_OPTION_SELECTOR=a:has-text("강원")
REGION_CONFIRM_SELECTOR=button:has-text("확인")
SEARCH_BUTTON_SELECTOR=button:has-text("조회")
```

날짜 입력 형식이 사이트와 맞지 않으면 `DATE_INPUT_VALUE`를 직접 지정할 수 있습니다.

```dotenv
DATE_INPUT_VALUE=2026-05-01 ~ 2026-05-02
```

예약 가능 판단 문구도 조정할 수 있습니다.

```dotenv
AVAILABILITY_KEYWORDS=예약가능,예약하기,선택가능,가능
UNAVAILABLE_KEYWORDS=예약불가,마감,대기,완료
```

## 검증

```powershell
npm run typecheck
npm test
```

실제 사이트는 로그인 방식이나 DOM이 바뀔 수 있으므로, 첫 실행은 `HEADLESS=false` 상태에서 화면을 보며 selector를 보정하는 것을 권장합니다.
