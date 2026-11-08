package com.bxsh.workbench;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.MediaStore;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.File;
import java.util.ArrayList;

/** Camera files stay in private app cache; capture inputs never offer the gallery. */
final class NativeImageChooser {
    static final int PICK_FILE = 17;
    static final int TAKE_PHOTO = 19;
    static final int PHOTO_PERMISSION = 20;
    private final Activity activity;
    private final WebView web;
    private ValueCallback<Uri[]> callback;
    private File photo;
    private Uri photoUri;
    private AlertDialog dialog;

    NativeImageChooser(Activity activity, WebView web) {
        this.activity = activity; this.web = web;
        File directory = new File(activity.getCacheDir(), "camera");
        File[] old = directory.listFiles();
        if (old != null) for (File file : old) if (System.currentTimeMillis() - file.lastModified() > 24 * 60 * 60 * 1000L) file.delete();
    }

    void open(ValueCallback<Uri[]> valueCallback, WebChromeClient.FileChooserParams params) {
        cancel(); callback = valueCallback;
        if (!trusted()) { cancel(); return; }
        boolean images = false;
        for (String type : params.getAcceptTypes()) {
            if (type == null || type.trim().isEmpty()) continue;
            for (String accepted : type.split(",")) {
                accepted = accepted.trim();
                if (accepted.startsWith("image/") || accepted.matches("(?i)\\.(jpg|jpeg|png|webp|gif|heic|heif)")) images = true;
            }
        }
        if (params.isCaptureEnabled()) {
            if (images) takePhoto();
            else { notice("此拍摄格式暂不支持"); cancel(); }
            return;
        }
        if (!images) { pick(params); return; }
        dialog = new AlertDialog.Builder(activity).setTitle("添加图片")
            .setItems(new String[] { "拍照", "选择图片" }, (d, which) -> {
                if (which == 0) takePhoto(); else pick(params);
            }).setOnCancelListener(d -> cancel()).create();
        dialog.show();
    }

    private boolean trusted() { return WebExport.sameOrigin(Uri.parse(web.getUrl() == null ? "" : web.getUrl())); }

    private void pick(WebChromeClient.FileChooserParams params) {
        try { activity.startActivityForResult(params.createIntent(), PICK_FILE); }
        catch (Exception failure) { notice("无法打开文件选择器"); cancel(); }
    }

    private void takePhoto() {
        if (callback == null || !trusted()) { cancel(); return; }
        if (activity.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            activity.requestPermissions(new String[] { Manifest.permission.CAMERA }, PHOTO_PERMISSION);
            return;
        }
        try {
            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            if (camera.resolveActivity(activity.getPackageManager()) == null) throw new IllegalStateException("No camera");
            File directory = new File(activity.getCacheDir(), "camera");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("No cache");
            photo = File.createTempFile("capture-", ".jpg", directory);
            photoUri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".files", photo);
            camera.putExtra(MediaStore.EXTRA_OUTPUT, photoUri);
            camera.setClipData(ClipData.newRawUri("现场拍照", photoUri));
            camera.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            activity.startActivityForResult(camera, TAKE_PHOTO);
        } catch (Exception failure) { notice("无法打开相机，请检查相机权限"); cancel(); }
    }

    void permissionResult(int[] results) {
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) takePhoto();
        else { notice("未允许相机访问，可再次点击拍照"); cancel(); }
    }

    void activityResult(int request, int result, Intent data) {
        if (request != PICK_FILE && request != TAKE_PHOTO) return;
        if (callback == null || !trusted()) { cancel(); return; }
        if (request == TAKE_PHOTO) {
            if (result == Activity.RESULT_OK && photo != null && photo.length() > 0 && photoUri != null) {
                Uri resultUri = photoUri;
                activity.revokeUriPermission(photoUri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                photo = null; photoUri = null;
                // Keep only the private upload file; do not insert it into MediaStore/gallery.
                finish(new Uri[] { resultUri });
            } else cancel();
            return;
        }
        ArrayList<Uri> selected = new ArrayList<>();
        if (result == Activity.RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                for (int index = 0; index < data.getClipData().getItemCount(); index++) {
                    Uri uri = data.getClipData().getItemAt(index).getUri();
                    if (validExternalUri(uri) && !selected.contains(uri)) selected.add(uri);
                }
            } else if (validExternalUri(data.getData())) selected.add(data.getData());
        }
        finish(selected.isEmpty() ? null : selected.toArray(new Uri[0]));
        if (result == Activity.RESULT_OK && selected.isEmpty()) notice("没有读到文件，请重新选择");
    }

    private boolean validExternalUri(Uri uri) {
        return uri != null && "content".equals(uri.getScheme()) && !(activity.getPackageName() + ".files").equals(uri.getAuthority());
    }

    private void finish(Uri[] values) {
        ValueCallback<Uri[]> target = callback; callback = null;
        if (target != null) target.onReceiveValue(values);
    }

    void cancel() {
        if (dialog != null) { dialog.dismiss(); dialog = null; }
        if (photoUri != null) activity.revokeUriPermission(photoUri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if (photo != null) photo.delete();
        photo = null; photoUri = null;
        finish(null);
    }
    private void notice(String text) { Toast.makeText(activity, text, Toast.LENGTH_LONG).show(); }
}
