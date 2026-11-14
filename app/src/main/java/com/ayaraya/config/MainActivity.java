package com.ayaraya.config;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import java.io.OutputStream;

public class MainActivity extends Activity {
    private static final int REQ_PICK = 1, REQ_SAVE = 2;
    private WebView web;
    private ValueCallback<Uri[]> chooser;
    private byte[] pending;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(Color.parseColor("#1F2228"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#15171B"));
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView v, String url, String msg, final JsResult r) {
                new AlertDialog.Builder(MainActivity.this).setMessage(msg)
                        .setPositiveButton("OK", (d, i) -> r.confirm())
                        .setOnCancelListener(d -> r.cancel()).show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView v, String url, String msg, final JsResult r) {
                new AlertDialog.Builder(MainActivity.this).setMessage(msg)
                        .setPositiveButton("OK", (d, i) -> r.confirm())
                        .setNegativeButton("Batal", (d, i) -> r.cancel())
                        .setOnCancelListener(d -> r.cancel()).show();
                return true;
            }

            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (chooser != null) chooser.onReceiveValue(null);
                chooser = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                String[] acc = p.getAcceptTypes();
                if (acc != null && acc.length > 0 && acc[0] != null && acc[0].startsWith("image")) i.setType("image/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "Pilih file"), REQ_PICK);
                } catch (Exception e) {
                    chooser = null;
                    cb.onReceiveValue(null);
                    return false;
                }
                return true;
            }
        });
        web.loadUrl("file:///android_asset/index.html");
    }

    public class Bridge {
        @JavascriptInterface
        public void save(final String name, final String b64, final String mime) {
            runOnUiThread(() -> {
                try {
                    pending = Base64.decode(b64, Base64.DEFAULT);
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("application/octet-stream");
                    i.putExtra(Intent.EXTRA_TITLE, name);
                    startActivityForResult(i, REQ_SAVE);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Gagal: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        }

        @JavascriptInterface
        public void setOrientation(final int mode) {
            runOnUiThread(() -> setRequestedOrientation(mode == 1
                    ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    : mode == 2 ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                    : ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR));
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_PICK && chooser != null) {
            Uri[] r = null;
            if (res == RESULT_OK && data != null) {
                r = WebChromeClient.FileChooserParams.parseResult(res, data);
            }
            chooser.onReceiveValue(r);
            chooser = null;
        } else if (req == REQ_SAVE) {
            if (res == RESULT_OK && data != null && data.getData() != null && pending != null) {
                try (OutputStream os = getContentResolver().openOutputStream(data.getData(), "wt")) {
                    os.write(pending);
                    Toast.makeText(this, "Tersimpan", Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(this, "Gagal simpan: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
            pending = null;
        }
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.handleBack?window.handleBack():false)", v -> {
            if (!"true".equals(v)) finish();
        });
    }
}
