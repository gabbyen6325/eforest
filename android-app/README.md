# Foresttrip Monitor Android

Android 단독 실행용 최소 앱입니다. 앱 안의 WebView가 숲나들e 페이지를 열고, 지역/날짜/야영 조건을 입력해 조회한 뒤 예약 가능 시설과 객실 수를 텔레그램으로 전송합니다.

## 기능

- 지역(숲나들e와 동일한 목록), 예약 유형(야영/숙박), 체크인·체크아웃, 반복 주기 입력
- 텔레그램 봇 토큰과 채팅 ID 저장(SharedPreferences)
- PC용 Playwright 모니터와 맞춘 WebView 자동화: `fn_setRegion` 지역 선택, `#houseCampSctin` 야영/숙박, 야영 시 필터
- 예약 가능 시설명과 객실 수 텔레그램 발송

## APK 빌드

### Android Studio

1. Android Studio에서 `android-app` 폴더 열기
2. Gradle Sync 완료 대기
3. `Build > Build Bundle(s) / APK(s) > Build APK(s)`
4. 생성 위치:

```text
android-app/app/build/outputs/apk/debug/app-debug.apk
```

### 명령줄(Windows, Android Studio 기본 JDK 사용)

시스템 `java`가 8이어도, Android Studio에 포함된 **JBR**을 `JAVA_HOME`으로 지정하면 됩니다.

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
cd android-app
.\gradlew.bat assembleDebug
```

설치 파일(로컬 빌드): `android-app\app\build\outputs\apk\debug\app-debug.apk`

저장소에 포함된 디버그 APK(버전이 파일명에 포함됨): `android-app/releases/foresttrip-monitor-<versionName>-debug.apk`  
예: `foresttrip-monitor-1.0.5-debug.apk`  
(버전 올린 뒤 `assembleDebug`로 빌드하고 `releases`에 같은 이름으로 복사해 커밋하면 됩니다.)

## 사용 방법

1. APK를 안드로이드폰에 설치합니다.
2. 앱을 실행합니다.
3. 지역·예약 유형·체크인/체크아웃·반복 주기를 입력합니다.
4. 텔레그램 봇 토큰과 채팅 ID를 입력합니다.
5. `모니터 시작`을 누릅니다.

## 주의사항

- 가장 단순한 독립형 구현이라 앱이 실행 중일 때 모니터링합니다.
- Android가 배터리 절약을 위해 백그라운드 앱을 중지할 수 있습니다.
- 장시간 안정 실행이 필요하면 배터리 최적화 제외 설정을 권장합니다.
- 숲나들e 페이지 DOM이 바뀌면 WebView 자동화 스크립트 수정이 필요할 수 있습니다.
