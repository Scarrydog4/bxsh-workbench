package com.bxsh.workbench;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.webkit.URLUtil;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebView;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** A one-export message port is handed only to the trusted site's main frame. */
final class WebExport {
    static final int SAVE_FILE = 18;
    private static final Uri ORIGIN = Uri.parse("https://workbench.example.com");
    private final Activity activity;
    private final WebView web;
    private WebMessagePort port;
    private OutputStream output;
    private Uri destination;
    private String filename;
    private String mime;
    private long expected;
    private long written;

    WebExport(Activity activity, WebView web) { this.activity = activity; this.web = web; }

    static boolean sameOrigin(Uri uri) {
        return "https".equals(uri.getScheme()) && ORIGIN.getHost().equals(uri.getHost()) && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    static void rememberNames(WebView web) {
        web.evaluateJavascript("(() => { if(window.__bxshExportNames) return; const names = window.__bxshExportNames = new Map(); const remember = a => { if(a && a.download) { names.set(a.href,a.download); if(names.size>32) names.delete(names.keys().next().value); } }; document.addEventListener('click',e=>remember(e.target.closest?.('a[download]')),true); const click=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){remember(this); return click.call(this);}; })()", null);
    }

    void start(String url, String disposition, String type) {
        if (port != null) { notice("请先完成当前文件的保存"); return; }
        Uri uri = Uri.parse(url);
        boolean allowed = sameOrigin(uri) || ("blob".equals(uri.getScheme()) && sameOrigin(Uri.parse(uri.getSchemeSpecificPart()))) || url.startsWith("data:image/");
        if (!allowed || !sameOrigin(Uri.parse(web.getUrl() == null ? "" : web.getUrl()))) { notice("无法导出此文件"); return; }
        try {
            String token = UUID.randomUUID().toString();
            String script;
            try (InputStream input = activity.getAssets().open("export.js"); ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
                byte[] bytes = new byte[4096]; int count;
                while ((count = input.read(bytes)) != -1) buffer.write(bytes, 0, count);
                script = new String(buffer.toByteArray(), StandardCharsets.UTF_8);
            }
            script = script.replace("__ARGS__", new JSONArray().put(token).put(url)
                .put(URLUtil.guessFileName(url, disposition, type)).put(type == null ? "" : type).toString());
            WebMessagePort[] channel = web.createWebMessageChannel();
            port = channel[0];
            port.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
                @Override public void onMessage(WebMessagePort sender, WebMessage message) {
                    if (sender != port) return;
                    try {
                        JSONObject data = new JSONObject(message.getData());
                        switch (data.getString("type")) {
                            case "ready":
                                filename = data.getString("name").replaceAll("[\\\\/\\p{Cntrl}]", "_");
                                mime = data.getString("mime").split(";", 2)[0]; expected = data.getLong("size"); written = 0;
                                Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                                    .setType(mime).putExtra(Intent.EXTRA_TITLE, filename);
                                activity.startActivityForResult(save, SAVE_FILE);
                                break;
                            case "chunk":
                                if (output == null) throw new IllegalStateException("No destination");
                                byte[] bytes = Base64.decode(data.getString("data"), Base64.DEFAULT);
                                output.write(bytes); written += bytes.length;
                                port.postMessage(new WebMessage("next"));
                                break;
                            case "done":
                                if (output == null || written != expected) throw new IllegalStateException("Incomplete download");
                                output.close(); output = null;
                                Uri saved = destination; String savedName = filename; String savedMime = mime;
                                close();
                                new AlertDialog.Builder(activity).setTitle("已保存").setMessage(savedName)
                                    .setNegativeButton("完成", null).setPositiveButton("打开", (dialog, which) -> {
                                        try { activity.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(saved, savedMime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)); }
                                        catch (Exception failure) { notice("文件已保存，可在所选文件夹查看"); }
                                    }).show();
                                break;
                            default: fail();
                        }
                    } catch (Exception failure) { fail(); }
                }
            });
            web.evaluateJavascript(script, ignored -> {
                if (port == channel[0]) web.postWebMessage(new WebMessage(token, new WebMessagePort[] { channel[1] }), ORIGIN);
            });
        } catch (Exception failure) { fail(); }
    }

    void saveResult(int result, Intent data) {
        if (result != Activity.RESULT_OK || data == null || data.getData() == null) { close(); return; }
        try {
            if (port == null) throw new IllegalStateException("Page changed");
            destination = data.getData();
            output = activity.getContentResolver().openOutputStream(destination, "w");
            if (output == null) throw new IllegalStateException("Cannot open destination");
            port.postMessage(new WebMessage("next"));
        } catch (Exception failure) { fail(); }
    }

    void close() {
        if (port != null) { try { port.postMessage(new WebMessage("cancel")); } catch (Exception ignored) {} port.close(); port = null; }
        if (output != null) { try { output.close(); } catch (Exception ignored) {} output = null; }
        destination = null;
    }
    private void fail() { close(); notice("保存未完成，请重新导出"); }
    private void notice(String text) { Toast.makeText(activity, text, Toast.LENGTH_LONG).show(); }
}
