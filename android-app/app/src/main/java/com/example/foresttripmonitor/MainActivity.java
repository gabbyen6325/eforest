package com.example.foresttripmonitor;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.lang.ref.WeakReference;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final String FORESTTRIP_URL = "https://www.foresttrip.go.kr/main.do?hmpgId=FRIP";

    /** PC 웹 UI(`public/index.html`)과 동일한 지역 목록 */
    private static final String[] REGION_OPTIONS = {
            "서울/인천/경기",
            "강원",
            "충북",
            "대전/충남",
            "전북",
            "광주/전남",
            "대구/경북",
            "부산/경남",
            "제주",
    };

    private static final String[] RESERVATION_LABELS = {"야영", "숙박"};

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Spinner regionSpinner;
    private Spinner reservationSpinner;
    private EditText checkInInput;
    private EditText checkOutInput;
    private EditText intervalInput;
    private EditText botTokenInput;
    private EditText chatIdInput;
    private Button startButton;
    private Button stopButton;
    private TextView statusView;
    private TextView logView;
    private WebView webView;
    private boolean running = false;
    private String lastAlertKey = "";

    /** async 조회 스크립트가 끝날 때까지 ValueCallback으로는 결과를 받을 수 없어 브리지로 전달 */
    private String pendingRegion = "";
    private String pendingCheckIn = "";
    private String pendingCheckOut = "";
    private boolean pendingCamping = true;

    /** onPageFinished 가 여러 번 호출될 때 스크립트 중복 주입 방지 */
    private boolean scriptInjectedThisLoad = false;

    private Runnable pendingInjectRunnable;

    private final Runnable monitorRunnable =
            new Runnable() {
                @Override
                public void run() {
                    if (!running) {
                        return;
                    }

                    runCheck();
                }
            };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildUi();
        setupWebView();
        loadPreferences();
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        webView.addJavascriptInterface(new ForestTripBridge(this), "ForestTripAndroid");
        webView.setWebChromeClient(
                new WebChromeClient() {
                    @Override
                    public boolean onConsoleMessage(ConsoleMessage message) {
                        if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR
                                || message.messageLevel() == ConsoleMessage.MessageLevel.WARNING) {
                            appendLog("WebView " + message.messageLevel() + ": " + message.message());
                        }
                        return true;
                    }
                });
        webView.setWebViewClient(new WebViewClient());
    }

    /** static + WeakReference: WebView이 Activity를 잡아 메모리 누수 나지 않게 */
    private static final class ForestTripBridge {
        private final WeakReference<MainActivity> hostRef;

        ForestTripBridge(MainActivity activity) {
            hostRef = new WeakReference<>(activity);
        }

        @JavascriptInterface
        public void postSearchResult(String json) {
            MainActivity host = hostRef.get();
            if (host == null) {
                return;
            }
            final String payload = json != null ? json : "{}";
            host.handler.post(() -> host.handleSearchResultFromJson(payload));
        }
    }

    private void buildUi() {
        ScrollView scrollView = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(28, 28, 28, 28);
        scrollView.addView(root);

        TextView title = new TextView(this);
        title.setText("Foresttrip 예약 모니터  v" + BuildConfig.VERSION_NAME);
        title.setTextSize(22);
        title.setTextColor(Color.rgb(31, 122, 77));
        root.addView(title);

        TextView versionLine = new TextView(this);
        versionLine.setTextSize(15);
        versionLine.setTextColor(Color.rgb(50, 90, 70));
        versionLine.setPadding(0, 6, 0, 10);
        versionLine.setText(
                "빌드 "
                        + BuildConfig.VERSION_CODE
                        + " · Git 릴리스: foresttrip-monitor-"
                        + BuildConfig.VERSION_NAME
                        + "-debug.apk");
        root.addView(versionLine);

        regionSpinner = addLabeledSpinner(root, "지역", REGION_OPTIONS);
        reservationSpinner = addLabeledSpinner(root, "예약 유형", RESERVATION_LABELS);

        checkInInput = addInput(root, "체크인(YYYY-MM-DD)", "2026-05-19");
        checkOutInput = addInput(root, "체크아웃(YYYY-MM-DD)", "2026-05-20");
        intervalInput = addInput(root, "반복 주기(분)", "5");
        botTokenInput = addInput(root, "텔레그램 봇 토큰", "");
        chatIdInput = addInput(root, "텔레그램 채팅 ID", "");

        startButton = new Button(this);
        startButton.setText("모니터 시작");
        startButton.setOnClickListener(view -> startMonitoring());
        root.addView(startButton);

        stopButton = new Button(this);
        stopButton.setText("중지");
        stopButton.setOnClickListener(view -> stopMonitoring());
        root.addView(stopButton);

        statusView = new TextView(this);
        statusView.setText("중지됨");
        statusView.setPadding(0, 16, 0, 8);
        root.addView(statusView);

        logView = new TextView(this);
        logView.setTextSize(13);
        root.addView(logView);

        webView = new WebView(this);
        webView.setVisibility(View.GONE);
        // 높이 0에 가까우면 일부 기기에서 로드/레이아웃이 생략될 수 있어 최소 픽셀 확보
        root.addView(webView, new LinearLayout.LayoutParams(1, 512));

        setContentView(scrollView);
    }

    private Spinner addLabeledSpinner(LinearLayout root, String label, String[] options) {
        TextView labelView = new TextView(this);
        labelView.setText(label);
        labelView.setPadding(0, 16, 0, 4);
        root.addView(labelView);

        Spinner spinner = new Spinner(this);
        ArrayAdapter<String> adapter =
                new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, options);
        spinner.setAdapter(adapter);
        root.addView(spinner);
        return spinner;
    }

    private EditText addInput(LinearLayout root, String label, String hint) {
        TextView labelView = new TextView(this);
        labelView.setText(label);
        labelView.setPadding(0, 16, 0, 4);
        root.addView(labelView);

        EditText editText = new EditText(this);
        editText.setSingleLine(true);
        editText.setHint(hint);
        root.addView(editText);
        return editText;
    }

    private int indexOfRegion(String region) {
        for (int i = 0; i < REGION_OPTIONS.length; i++) {
            if (REGION_OPTIONS[i].equals(region)) {
                return i;
            }
        }
        return 1;
    }

    private void loadPreferences() {
        SharedPreferences prefs = getSharedPreferences("foresttrip", MODE_PRIVATE);
        regionSpinner.setSelection(indexOfRegion(prefs.getString("region", "강원")));
        boolean lodging = "lodging".equals(prefs.getString("reservationType", "camping"));
        reservationSpinner.setSelection(lodging ? 1 : 0);
        checkInInput.setText(prefs.getString("checkIn", "2026-05-19"));
        checkOutInput.setText(prefs.getString("checkOut", "2026-05-20"));
        intervalInput.setText(prefs.getString("interval", "5"));
        botTokenInput.setText(prefs.getString("botToken", ""));
        chatIdInput.setText(prefs.getString("chatId", ""));
    }

    private void savePreferences() {
        boolean lodging = reservationSpinner.getSelectedItemPosition() == 1;
        getSharedPreferences("foresttrip", MODE_PRIVATE)
                .edit()
                .putString("region", selectedRegion())
                .putString("reservationType", lodging ? "lodging" : "camping")
                .putString("checkIn", checkInInput.getText().toString().trim())
                .putString("checkOut", checkOutInput.getText().toString().trim())
                .putString("interval", intervalInput.getText().toString().trim())
                .putString("botToken", botTokenInput.getText().toString().trim())
                .putString("chatId", chatIdInput.getText().toString().trim())
                .apply();
    }

    private String selectedRegion() {
        Object item = regionSpinner.getSelectedItem();
        return item != null ? item.toString() : "강원";
    }

    private boolean isCamping() {
        return reservationSpinner.getSelectedItemPosition() == 0;
    }

    private void startMonitoring() {
        savePreferences();
        running = true;
        lastAlertKey = "";
        statusView.setText("실행 중");
        appendLog("모니터 시작");
        runCheck();
    }

    private void stopMonitoring() {
        running = false;
        handler.removeCallbacks(monitorRunnable);
        if (pendingInjectRunnable != null) {
            handler.removeCallbacks(pendingInjectRunnable);
            pendingInjectRunnable = null;
        }
        statusView.setText("중지됨");
        appendLog("모니터 중지");
    }

    private void runCheck() {
        final String region = selectedRegion();
        final String checkIn = checkInInput.getText().toString().trim();
        final String checkOut = checkOutInput.getText().toString().trim();
        final boolean camping = isCamping();

        appendLog("조회 시작: " + region + ", " + (camping ? "야영" : "숙박") + ", " + checkIn + " ~ " + checkOut);
        scriptInjectedThisLoad = false;
        if (pendingInjectRunnable != null) {
            handler.removeCallbacks(pendingInjectRunnable);
            pendingInjectRunnable = null;
        }
        webView.setWebViewClient(
                new WebViewClient() {
                    @Override
                    public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                        appendLog("페이지 로드 시작: " + (url != null ? url : "(null)"));
                    }

                    @Override
                    public void onPageFinished(WebView view, String url) {
                        appendLog("페이지 로드 완료: " + (url != null ? url : "(null)"));
                        if (scriptInjectedThisLoad) {
                            return;
                        }
                        if (url == null || !url.contains("foresttrip.go.kr")) {
                            appendLog("숲나들e URL이 아니어서 조회 스크립트를 건너뜁니다.");
                            return;
                        }
                        scriptInjectedThisLoad = true;
                        pendingInjectRunnable =
                                () -> {
                                    pendingInjectRunnable = null;
                                    appendLog("조회 스크립트 주입…");
                                    injectSearchScript(region, checkIn, checkOut, camping);
                                };
                        handler.postDelayed(pendingInjectRunnable, 1600);
                    }

                    @Override
                    public void onReceivedError(
                            WebView view, WebResourceRequest request, WebResourceError error) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && request.isForMainFrame()) {
                            appendLog(
                                    "페이지 로드 오류: "
                                            + error.getDescription()
                                            + " ("
                                            + error.getErrorCode()
                                            + ")");
                        }
                    }

                    @SuppressWarnings("deprecation")
                    @Override
                    public void onReceivedError(
                            WebView view, int errorCode, String description, String failingUrl) {
                        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                            appendLog("페이지 로드 오류: " + description + " (" + errorCode + ")");
                        }
                    }
                });
        webView.stopLoading();
        webView.loadUrl(FORESTTRIP_URL);
    }

    private void scheduleNext() {
        if (!running) {
            return;
        }

        int minutes = parsePositiveInt(intervalInput.getText().toString(), 5);
        handler.postDelayed(monitorRunnable, minutes * 60L * 1000L);
    }

    private int parsePositiveInt(String value, int fallback) {
        try {
            int parsed = Integer.parseInt(value.trim());
            return Math.max(parsed, 1);
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private void injectSearchScript(String region, String checkIn, String checkOut, boolean camping) {
        pendingRegion = region;
        pendingCheckIn = checkIn;
        pendingCheckOut = checkOut;
        pendingCamping = camping;

        String houseMode = camping ? "02" : "01";
        String script =
                "(function(){"
                        + "var run=async function(){"
                        + "try{"
                        + "const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));"
                        + "const region="
                        + JSONObject.quote(region)
                        + ";"
                        + "const checkIn="
                        + JSONObject.quote(checkIn)
                        + ";"
                        + "const checkOut="
                        + JSONObject.quote(checkOut)
                        + ";"
                        + "const isCamping="
                        + (camping ? "true" : "false")
                        + ";"
                        + "const houseMode='"
                        + houseMode
                        + "';"
                        + "const compact=s=>String(s).replace(/-/g,'');"
                        + "const display=checkIn.replace(/-/g,'.')+' ~ '+checkOut.replace(/-/g,'.');"
                        + "document.querySelectorAll('a.day_close,[id^=enterPopup] a').forEach(a=>{if((a.innerText||'').includes('닫기'))a.click();});"
                        + "const regionButton=document.querySelector('#srch_frm a.yeyakSearchName');"
                        + "if(regionButton) regionButton.click();"
                        + "await sleep(500);"
                        + "const links=[...document.querySelectorAll('#srch_frm a')];"
                        + "const link=links.find(a=>(a.innerText||'').trim()===region);"
                        + "const onclick=link?link.getAttribute('onclick')||'':'';"
                        + "const code=(onclick.match(/fn_setRegion\\('([^']+)'/)||[])[1];"
                        + "if(code&&typeof window.fn_setRegion==='function'){window.fn_setRegion(code,' '+region);}"
                        + "else if(link){link.click();}"
                        + "await sleep(400);"
                        + "for(let w=0;w<40;w++){"
                        + "var arEl=document.querySelector('#srchInsttArcd');"
                        + "var fidEl=document.querySelector('#srchInsttId');"
                        + "var ar=arEl?arEl.value:'';"
                        + "var fid=fidEl?fidEl.value:'';"
                        + "if(ar||fid)break;"
                        + "await sleep(125);"
                        + "}"
                        + "const cal=document.querySelector('#calPicker');"
                        + "if(cal){cal.removeAttribute('readonly');cal.value=display;"
                        + "cal.dispatchEvent(new Event('input',{bubbles:true}));"
                        + "cal.dispatchEvent(new Event('change',{bubbles:true}));}"
                        + "const bg=document.querySelector('#rsrvtBgDt'); if(bg) bg.value=compact(checkIn);"
                        + "const ed=document.querySelector('#rsrvtEdDt'); if(ed) ed.value=compact(checkOut);"
                        + "const mode=document.querySelector('#houseCampSctin'); if(mode) mode.value=houseMode;"
                        + "const btn=document.querySelector('#srch_frm button[title=\"조회하기\"],#srch_frm button');"
                        + "if(btn) btn.click();"
                        + "await sleep(5500);"
                        + "if(isCamping){"
                        + "const campingLink=[...document.querySelectorAll('a')].find(a=>(a.innerText||'').trim()==='야영');"
                        + "if(campingLink)campingLink.click();"
                        + "else{const f=document.querySelector('#filter2');if(f)f.click();"
                        + "else if(typeof fn_switchFilter==='function')fn_switchFilter('2');}"
                        + "await sleep(5500);"
                        + "}"
                        + "await sleep(1500);"
                        + "for(let p=0;p<90;p++){"
                        + "if(document.querySelectorAll('#searchResultMap .rc_item').length>0)break;"
                        + "await sleep(300);"
                        + "}"
                        + "const countLine=/^예약가능\\s*객실\\s*수\\s*:\\s*\\d+/;"
                        + "const items=[...document.querySelectorAll('#searchResultMap .rc_item')].map(item=>{"
                        + "const b=item.querySelector('.rc_ti b');"
                        + "const ti=item.querySelector('.rc_ti');"
                        + "const name=((b?b.textContent:ti?ti.textContent:'')||'').replace(/\\s+/g,' ').trim();"
                        + "const cntEl=item.querySelector('.rc_util .ut_roomcount')||item.querySelector('.ut_roomcount');"
                        + "const countText=((cntEl?cntEl.textContent:'')||'').replace(/\\s+/g,' ').trim();"
                        + "const count=Number((countText.match(/\\d+/)||['0'])[0]);"
                        + "return {facilityName:name,availableCount:countText,count};"
                        + "}).filter(x=>x.facilityName&&countLine.test(x.availableCount)&&x.count>0);"
                        + "ForestTripAndroid.postSearchResult(JSON.stringify({url:location.href,items:items}));"
                        + "}catch(e){"
                        + "ForestTripAndroid.postSearchResult(JSON.stringify({url:location.href||'',items:[],error:String(e)}));"
                        + "}"
                        + "};"
                        + "run();"
                        + "})();";

        webView.evaluateJavascript(script, null);
    }

    private void handleSearchResultFromJson(String jsonText) {
        final String region = pendingRegion;
        final String checkIn = pendingCheckIn;
        final String checkOut = pendingCheckOut;
        final boolean camping = pendingCamping;

        try {
            String raw = jsonText == null ? "" : jsonText.trim();
            if (raw.isEmpty() || "{}".equals(raw)) {
                appendLog(
                        "결과 수신 실패(빈 JSON). 구버전 APK이면 삭제 후 releases의 foresttrip-monitor-"
                                + BuildConfig.VERSION_NAME
                                + "-debug.apk 을 설치하세요.");
                scheduleNext();
                return;
            }

            JSONObject result = new JSONObject(raw);
            if (result.has("error")) {
                appendLog("조회 스크립트 오류: " + result.optString("error"));
            }
            JSONArray items = result.optJSONArray("items");
            if (items == null) {
                items = new JSONArray();
            }
            if (items.length() == 0) {
                appendLog("예약 가능 항목 없음");
                scheduleNext();
                return;
            }

            StringBuilder message = new StringBuilder();
            message.append("[foresttrip] 예약가능 시설\n");
            message.append("지역: ").append(region).append("\n");
            message.append("예약 유형: ").append(camping ? "야영" : "숙박").append("\n");
            message.append("체크인: ").append(checkIn).append("\n");
            message.append("체크아웃: ").append(checkOut).append("\n");
            message.append("확인 시각: ").append(now()).append("\n\n");

            StringBuilder keyBuilder = new StringBuilder();
            for (int index = 0; index < items.length(); index++) {
                JSONObject item = items.optJSONObject(index);
                if (item == null) {
                    continue;
                }
                String facilityName = item.optString("facilityName", "").trim();
                String availableCount = item.optString("availableCount", "").trim();
                if (facilityName.isEmpty()) {
                    continue;
                }
                message.append("- ").append(facilityName).append(" / ").append(availableCount).append("\n");
                keyBuilder.append(facilityName).append(":").append(availableCount).append("|");
            }

            String alertKey = keyBuilder.toString();
            if (keyBuilder.length() == 0) {
                appendLog("예약 가능 항목 없음(시설명 파싱 실패)");
                scheduleNext();
                return;
            }
            if (!alertKey.equals(lastAlertKey)) {
                lastAlertKey = alertKey;
                sendTelegram(message.toString());
                appendLog("예약 가능 알림 전송: " + items.length() + "건");
            } else {
                appendLog("예약 가능 항목 유지 중, 중복 알림 생략");
            }
        } catch (Exception error) {
            String hint = jsonText != null && jsonText.length() > 120 ? jsonText.substring(0, 120) + "…" : jsonText;
            appendLog("결과 처리 실패: " + error.getMessage() + " · 수신일부: " + hint);
        }

        scheduleNext();
    }

    private void sendTelegram(String text) {
        final String token = botTokenInput.getText().toString().trim();
        final String chatId = chatIdInput.getText().toString().trim();

        if (token.isEmpty() || chatId.isEmpty()) {
            appendLog("텔레그램 토큰 또는 채팅 ID가 비어 있어 알림을 보내지 않았습니다.");
            return;
        }

        new Thread(
                        () -> {
                            try {
                                URL url = new URL("https://api.telegram.org/bot" + token + "/sendMessage");
                                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                                connection.setRequestMethod("POST");
                                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                                connection.setDoOutput(true);

                                JSONObject body = new JSONObject();
                                body.put("chat_id", chatId);
                                body.put("text", text);
                                body.put("disable_web_page_preview", true);

                                try (OutputStream outputStream = connection.getOutputStream()) {
                                    outputStream.write(body.toString().getBytes(StandardCharsets.UTF_8));
                                }

                                int statusCode = connection.getResponseCode();
                                appendLog(
                                        statusCode >= 200 && statusCode < 300
                                                ? "텔레그램 전송 완료"
                                                : "텔레그램 전송 실패: " + statusCode);
                                connection.disconnect();
                            } catch (Exception error) {
                                appendLog("텔레그램 전송 오류: " + error.getMessage());
                            }
                        })
                .start();
    }

    private void appendLog(String message) {
        handler.post(() -> logView.append("[" + now() + "] " + message + "\n"));
    }

    private String now() {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.KOREA).format(new Date());
    }

    @Override
    protected void onDestroy() {
        stopMonitoring();
        webView.removeJavascriptInterface("ForestTripAndroid");
        webView.destroy();
        super.onDestroy();
    }
}
