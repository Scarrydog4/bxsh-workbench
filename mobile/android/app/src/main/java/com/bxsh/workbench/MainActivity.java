package com.bxsh.workbench;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private static final String SITE = "https://workbench.example.com/";
    private static final int CAMERA_PERMISSION = 18;
    private WebView web;
    private View error;
    private PermissionRequest cameraRequest;
    private boolean cameraPermissionPending;
    private WebExport exports;
    private NativeImageChooser images;
    private AppUpdater updater;
    private AlertDialog jsDialog;

    private boolean internal(Uri uri) {
        return WebExport.sameOrigin(uri);
    }

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        WebView.setWebContentsDebuggingEnabled(false);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.ime() | android.view.WindowInsets.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            }
            return insets;
        });
        web = new WebView(this);
        exports = new WebExport(this, web);
        images = new NativeImageChooser(this, web);
        updater = new AppUpdater(this);
        web.setBackgroundColor(Color.WHITE);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        ProgressBar loading = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        root.addView(loading, new FrameLayout.LayoutParams(-1, 6, Gravity.TOP));
        LinearLayout offline = new LinearLayout(this);
        offline.setOrientation(LinearLayout.VERTICAL); offline.setGravity(Gravity.CENTER); offline.setBackgroundColor(Color.WHITE);
        TextView message = new TextView(this); message.setText("暂时连不上工作台"); message.setTextSize(18); offline.addView(message);
        Button retry = new Button(this); retry.setText("重新连接"); retry.setOnClickListener(v -> { offline.setVisibility(View.GONE); web.loadUrl(SITE); }); offline.addView(retry);
        root.addView(offline, new FrameLayout.LayoutParams(-1, -1)); error = offline; error.setVisibility(View.GONE);
        setContentView(root);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " BxshAndroid/" + updater.versionName());
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("bxsh://check-update".equals(uri.toString())) {
                    if (request.isForMainFrame() && request.hasGesture() && internal(Uri.parse(view.getUrl() == null ? "" : view.getUrl()))) updater.check(true);
                    return true;
                }
                if (internal(uri)) return false;
                if ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()) || "mailto".equals(uri.getScheme()) || "tel".equals(uri.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) { Toast.makeText(MainActivity.this, "无法打开链接", Toast.LENGTH_SHORT).show(); }
                }
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) { denyCameraRequest(); images.cancel(); closeJsDialog(); exports.close(); }
            @Override public void onPageFinished(WebView view, String url) { CookieManager.getInstance().flush(); if (internal(Uri.parse(url))) WebExport.rememberNames(view); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError failure) {
                if (request.isForMainFrame()) error.setVisibility(View.VISIBLE);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int progress) { loading.setProgress(progress); loading.setVisibility(progress < 100 ? View.VISIBLE : View.GONE); }
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> requestCamera(request));
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                runOnUiThread(() -> { if (cameraRequest == request) cameraRequest = null; });
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                images.open(callback, params);
                return true;
            }
            @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                return showJsDialog(url, message, result, false);
            }
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                return showJsDialog(url, message, result, true);
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> exports.start(url, disposition, mime));
        if (saved == null || web.restoreState(saved) == null) web.loadUrl(SITE);
    }
    private boolean showJsDialog(String url, String message, JsResult result, boolean confirm) {
        if (!internal(Uri.parse(url)) || !internal(Uri.parse(web.getUrl() == null ? "" : web.getUrl()))) { result.cancel(); return true; }
        closeJsDialog();
        AlertDialog.Builder builder = new AlertDialog.Builder(this).setTitle("笔下工单").setMessage(message)
            .setPositiveButton("确定", (d, which) -> result.confirm()).setOnCancelListener(d -> result.cancel());
        if (confirm) builder.setNegativeButton("取消", (d, which) -> result.cancel());
        jsDialog = builder.create();
        jsDialog.setOnDismissListener(d -> { if (jsDialog == d) jsDialog = null; });
        jsDialog.show();
        return true;
    }
    private void closeJsDialog() { if (jsDialog != null) { jsDialog.cancel(); jsDialog = null; } }
    private boolean allowedCameraRequest(PermissionRequest request) {
        String[] resources = request.getResources();
        return !isFinishing() && !isDestroyed()
            && internal(request.getOrigin())
            && internal(Uri.parse(web.getUrl() == null ? "" : web.getUrl()))
            && resources.length == 1 && PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resources[0]);
    }
    private void requestCamera(PermissionRequest request) {
        // Grant only the trusted site's camera, never microphone or future resource types.
        if (!allowedCameraRequest(request) || cameraRequest != null || cameraPermissionPending) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
            return;
        }
        cameraRequest = request;
        cameraPermissionPending = true;
        requestPermissions(new String[] { Manifest.permission.CAMERA }, CAMERA_PERMISSION);
    }
    private void denyCameraRequest() {
        PermissionRequest request = cameraRequest;
        cameraRequest = null;
        if (request != null) request.deny();
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == NativeImageChooser.PHOTO_PERMISSION) { images.permissionResult(results); return; }
        if (requestCode != CAMERA_PERMISSION) return;
        cameraPermissionPending = false;
        PermissionRequest request = cameraRequest;
        cameraRequest = null;
        if (request == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED && allowedCameraRequest(request)) {
            request.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
        } else {
            request.deny();
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        images.activityResult(request, result, data);
        if (request == AppUpdater.INSTALL_PERMISSION) updater.permissionResult();
        if (request == WebExport.SAVE_FILE) exports.saveResult(result, data);
    }
    @Override protected void onSaveInstanceState(Bundle state) { super.onSaveInstanceState(state); web.saveState(state); }
    @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }
    @Override protected void onResume() { super.onResume(); if (updater != null) updater.check(false); }
    @Override public void onBackPressed() {
        web.evaluateJavascript("(() => { if (!document.querySelector('[role=dialog], [role=menu], [role=listbox], [data-radix-popper-content-wrapper]')) return false; (document.activeElement || document).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true})); return true; })()", handled -> {
            if (!"true".equals(handled)) { if (web.canGoBack()) web.goBack(); else finish(); }
        });
    }
    @Override protected void onDestroy() { denyCameraRequest(); closeJsDialog(); images.cancel(); updater.close(); exports.close(); web.destroy(); super.onDestroy(); }
}
