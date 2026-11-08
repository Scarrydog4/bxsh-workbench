package com.bxsh.workbench;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;

/** Public release metadata only; installation always needs the employee's confirmation. */
final class AppUpdater {
    static final int INSTALL_PERMISSION = 61;
    private static final String VERSION_URL = "https://workbench.example.com/api/download/android/version";
    private static final String APK_URL = "https://workbench.example.com/api/download/android";
    private static final long CHECK_INTERVAL = 6 * 60 * 60 * 1000L;
    private static final long MAX_APK_BYTES = 150 * 1024 * 1024L;
    private final Activity activity;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private boolean busy;
    private boolean closed;
    private volatile boolean cancelled;
    private File pendingApk;
    private Release pendingRelease;
    private AlertDialog dialog;

    AppUpdater(Activity activity) { this.activity = activity; }

    String versionName() {
        try { return activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName; }
        catch (Exception ignored) { return "unknown"; }
    }

    void check(boolean manual) {
        if (closed || busy || (dialog != null && dialog.isShowing())) {
            if (manual) notice("正在检查或下载更新");
            return;
        }
        long now = System.currentTimeMillis();
        android.content.SharedPreferences preferences = activity.getSharedPreferences("app-updates", Activity.MODE_PRIVATE);
        if (!manual && now - preferences.getLong("last-check", 0) < CHECK_INTERVAL) return;
        preferences.edit().putLong("last-check", now).apply();
        busy = true;
        if (manual) notice("正在检查更新…");
        executor.execute(() -> {
            try {
                Release release = fetchRelease();
                long current = versionCode(activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0));
                onUi(() -> {
                    busy = false;
                    if (release.code > current) showRelease(release);
                    else if (manual) new AlertDialog.Builder(activity).setTitle("已是最新版本")
                        .setMessage("笔下工单 " + versionName()).setPositiveButton("知道了", null).show();
                });
            } catch (Exception failure) {
                onUi(() -> { busy = false; if (manual) notice("暂时无法检查更新，请稍后重试"); });
            }
        });
    }

    private void showRelease(Release release) {
        String description = "当前 " + versionName() + " → " + release.version;
        if (!release.notes.isEmpty()) description += "\n\n" + release.notes;
        dialog = new AlertDialog.Builder(activity).setTitle("笔下工单有新版本")
            .setMessage(description).setNegativeButton("稍后", null)
            .setPositiveButton("下载更新", (d, which) -> download(release)).create();
        dialog.show();
    }

    private Release fetchRelease() throws Exception {
        HttpsURLConnection connection = open(VERSION_URL);
        try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (connection.getResponseCode() != 200) throw new IllegalStateException("Release unavailable");
            byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > 64 * 1024) throw new IllegalStateException("Invalid metadata");
                output.write(buffer, 0, count);
            }
            JSONObject data = new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
            String sha = data.getString("sha256").toLowerCase(Locale.ROOT);
            String version = data.getString("version");
            long code = data.getLong("versionCode");
            if (!APK_URL.equals(data.getString("downloadUrl")) || !sha.matches("[a-f0-9]{64}")
                || code <= 0 || version.isEmpty() || version.length() > 40) throw new IllegalStateException("Invalid release");
            JSONArray notes = data.optJSONArray("notes");
            StringBuilder lines = new StringBuilder();
            if (notes != null) for (int i = 0; i < Math.min(notes.length(), 8); i++) {
                String note = notes.optString(i);
                if (note.length() > 240) note = note.substring(0, 240);
                if (!note.isEmpty()) { if (lines.length() > 0) lines.append('\n'); lines.append("• ").append(note); }
            }
            return new Release(code, version, sha, lines.toString());
        } finally { connection.disconnect(); }
    }

    private HttpsURLConnection open(String url) throws Exception {
        HttpsURLConnection connection = (HttpsURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(15000); connection.setReadTimeout(30000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Cache-Control", "no-cache");
        connection.setRequestProperty("User-Agent", "BxshAndroid/" + versionName());
        return connection;
    }

    private void download(Release release) {
        busy = true; cancelled = false;
        LinearLayout content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (24 * activity.getResources().getDisplayMetrics().density);
        content.setPadding(padding, padding / 2, padding, padding / 2);
        ProgressBar progress = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(true); content.addView(progress);
        TextView detail = new TextView(activity); detail.setText("正在下载 " + release.version + "…"); content.addView(detail);
        dialog = new AlertDialog.Builder(activity).setTitle("下载更新").setView(content)
            .setCancelable(false).setNegativeButton("取消", (d, which) -> cancelled = true).create();
        dialog.show();
        executor.execute(() -> {
            File file = null;
            HttpsURLConnection connection = null;
            try {
                File directory = new File(activity.getCacheDir(), "updates");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("Cannot cache update");
                file = new File(directory, "workbench-" + release.code + ".apk");
                connection = open(APK_URL);
                if (connection.getResponseCode() != 200) throw new IllegalStateException("Download unavailable");
                long length = connection.getContentLengthLong();
                if (length > MAX_APK_BYTES) throw new IllegalStateException("Download too large");
                long written = 0, lastProgress = 0;
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(file)) {
                    byte[] bytes = new byte[16384]; int count;
                    while ((count = input.read(bytes)) != -1) {
                        if (cancelled || Thread.currentThread().isInterrupted()) throw new InterruptedException();
                        written += count;
                        if (written > MAX_APK_BYTES) throw new IllegalStateException("Download too large");
                        output.write(bytes, 0, count);
                        if (written - lastProgress > 128 * 1024 || written == length) {
                            lastProgress = written;
                            long received = written;
                            onUi(() -> {
                                if (length > 0) { progress.setIndeterminate(false); progress.setProgress((int) (received * 100 / length)); }
                                detail.setText(String.format(Locale.CHINA, "已下载 %.1f MB%s", received / 1048576.0,
                                    length > 0 ? String.format(Locale.CHINA, " / %.1f MB", length / 1048576.0) : ""));
                            });
                        }
                    }
                }
                if (cancelled || (length > 0 && written != length)) throw new InterruptedException();
                verifyApk(file, release);
                File verified = file;
                onUi(() -> {
                    busy = false; if (dialog != null) dialog.dismiss();
                    if (cancelled) { verified.delete(); return; }
                    pendingApk = verified; pendingRelease = release; install();
                });
            } catch (Exception failure) {
                if (file != null) file.delete();
                onUi(() -> { busy = false; if (dialog != null) dialog.dismiss(); if (!cancelled) notice("更新未完成，未安装任何文件。请重新检查更新"); });
            } finally { if (connection != null) connection.disconnect(); }
        });
    }

    private void verifyApk(File file, Release release) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] bytes = new byte[16384]; int count;
            while ((count = input.read(bytes)) != -1) digest.update(bytes, 0, count);
        }
        if (!hex(digest.digest()).equals(release.sha)) throw new SecurityException("Checksum mismatch");
        PackageManager pm = activity.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo installed = pm.getPackageInfo(activity.getPackageName(), flags);
        PackageInfo candidate = pm.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        if (candidate == null || !activity.getPackageName().equals(candidate.packageName)
            || versionCode(candidate) != release.code || versionCode(candidate) <= versionCode(installed)
            || !release.version.equals(candidate.versionName) || !signatures(installed).equals(signatures(candidate)))
            throw new SecurityException("Package identity mismatch");
    }

    private static Set<String> signatures(PackageInfo info) throws Exception {
        Signature[] values = Build.VERSION.SDK_INT >= 28
            ? (info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()) : info.signatures;
        if (values == null || values.length == 0) throw new SecurityException("Missing signature");
        Set<String> result = new HashSet<>();
        for (Signature signature : values) result.add(hex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())));
        return result;
    }

    private static long versionCode(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }
    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }

    private void install() {
        if (pendingApk == null || !pendingApk.isFile()) return;
        if (!activity.getPackageManager().canRequestPackageInstalls()) {
            dialog = new AlertDialog.Builder(activity).setTitle("允许安装更新")
                .setMessage("安装包已验证。请在下一页允许“笔下工单”安装应用，返回后继续更新。")
                .setNegativeButton("稍后", null).setPositiveButton("去设置", (d, which) -> {
                    try { activity.startActivityForResult(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + activity.getPackageName())), INSTALL_PERMISSION); }
                    catch (Exception failure) { notice("请在系统设置中允许笔下工单安装应用"); }
                }).create();
            dialog.show(); return;
        }
        try {
            // Recheck the private cached file before granting the installer read access.
            verifyApk(pendingApk, pendingRelease);
            Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".files", pendingApk);
            activity.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
        } catch (Exception failure) { notice("无法安装，请重新下载更新"); }
    }

    void permissionResult() {
        if (activity.getPackageManager().canRequestPackageInstalls()) install();
        else notice("未允许安装，可稍后点“检查更新”重试");
    }

    private void onUi(Runnable action) {
        activity.runOnUiThread(() -> { if (!closed && !activity.isFinishing() && !activity.isDestroyed()) action.run(); });
    }
    private void notice(String text) { Toast.makeText(activity, text, Toast.LENGTH_LONG).show(); }
    void close() { closed = true; cancelled = true; if (dialog != null) dialog.dismiss(); executor.shutdownNow(); }

    private static final class Release {
        final long code; final String version; final String sha; final String notes;
        Release(long code, String version, String sha, String notes) { this.code = code; this.version = version; this.sha = sha; this.notes = notes; }
    }
}
