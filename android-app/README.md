# Foresttrip Monitor Android

Android 단독 실행용 최소 앱입니다. 앱 안의 WebView가 숲나들e 페이지를 열고, 지역/날짜/야영 조건을 입력해 조회한 뒤 예약 가능 시설과 객실 수를 텔레그램으로 전송합니다.

## 기능

- 지역, 체크인, 체크아웃, 반복 주기 입력
- 텔레그램 봇 토큰과 채팅 ID 저장
- 숲나들e 야영 예약 가능 시설 조회
- 예약 가능 시설명과 객실 수 텔레그램 발송

## APK 빌드

현재 PC에는 Android SDK/Gradle이 설치되어 있지 않아 여기서 APK 파일을 직접 만들지는 않았습니다. 아래 순서로 Android Studio에서 빌드하세요.

1. Android Studio 설치
2. Android Studio에서 `android-app` 폴더 열기
3. Gradle Sync 완료 대기
4. 상단 메뉴 `Build > Build Bundle(s) / APK(s) > Build APK(s)` 선택
5. 생성 위치:

```text
android-app/app/build/outputs/apk/debug/app-debug.apk
```

## 사용 방법

1. APK를 안드로이드폰에 설치합니다.
2. 앱을 실행합니다.
3. 지역, 체크인/체크아웃, 반복 주기를 입력합니다.
4. 텔레그램 봇 토큰과 채팅 ID를 입력합니다.
5. `모니터 시작`을 누릅니다.

## 주의사항

- 가장 단순한 독립형 구현이라 앱이 실행 중일 때 모니터링합니다.
- Android가 배터리 절약을 위해 백그라운드 앱을 중지할 수 있습니다.
- 장시간 안정 실행이 필요하면 배터리 최적화 제외 설정을 권장합니다.
- 숲나들e 페이지 DOM이 바뀌면 WebView 자동화 스크립트 수정이 필요할 수 있습니다.
