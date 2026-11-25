package de.nova.lauf;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Point;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.Display;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.inputmethod.InputMethodInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Der eigentliche „W-Halter“: ein Bedienungshilfe-Dienst, der in Roblox einen Finger auf den
 * Joystick legt, ihn nach vorne schiebt und dort festhält. Bedient wird er über einen kleinen
 * schwebenden Knopf im Spiel.
 *
 * Halten funktioniert über aneinandergehängte Gesten-Stücke (continueStroke): Der Finger bleibt
 * unten, jedes Stück wackelt nur 1 Pixel. Kurze Stücke (0,8 s) sorgen dafür, dass Stopp schnell greift.
 */
public class LaufDienst extends AccessibilityService {

    /** Der laufende Dienst (für den Status in der App), sonst null. */
    static volatile LaufDienst instanz;

    private static final long ANDRUECKEN_MS = 150;  // Joystick nach vorne schieben
    private static final long HALTE_MS = 800;       // Länge eines Halte-Stücks
    private static final long NEUSTART_MS = 1000;   // nach einer Unterbrechung (z. B. du tippst aufs Display)
    private static final long LOSLASSEN_PAUSE_MS = 300;

    private final Handler h = new Handler(Looper.getMainLooper());
    private final Map<String, Boolean> istAppCache = new HashMap<>();
    private final Set<String> tastaturen = new HashSet<>();
    private Einstellungen e;
    private WindowManager wm;
    private String homePaket = "";
    private String vorne = "";       // App, die gerade vorne ist (soweit bekannt)

    // schwebender Knopf
    private LinearLayout panel;
    private WindowManager.LayoutParams panelLp;
    private TextView knopfW;
    private TextView knopfZiel;
    private boolean panelDa;

    // Kreis zum Einstellen, wo der Joystick ist
    private ZielAnzeige ziel;
    private WindowManager.LayoutParams zielLp;
    private int zielSeite;
    private int korrX, korrY;        // Abweichung Fenster-Koordinaten ↔ Bildschirm (z. B. Kamera-Loch)
    private boolean zielDa;

    // Laufen
    private boolean laeuft;
    private int lauf;                // zählt bei Start/Stopp hoch – alte Rückmeldungen werden ignoriert
    private GestureDescription.StrokeDescription strich;   // der gehaltene Finger
    private int endX, endY;
    private boolean wackel;
    private long gedruecktSeit, gestartet;
    private String startPaket = "";

    private final Runnable uhr = new Runnable() {
        @Override public void run() {
            if (!laeuft) return;
            aktualisiereKnopf();
            h.postDelayed(this, 1000);
        }
    };

    // ------------------------------------------------------------------ Lebenslauf des Dienstes

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        e = new Einstellungen(this);
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        homePaket = findeHome();
        try {
            InputMethodManager imm = getSystemService(InputMethodManager.class);
            if (imm != null) {
                for (InputMethodInfo i : imm.getEnabledInputMethodList()) tastaturen.add(i.getPackageName());
            }
        } catch (RuntimeException ignored) { }
        bauePanel();
        instanz = this;
        if (!e.nurInRoblox()) zeigePanel();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent ev) {
        if (ev == null || ev.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED || e == null) return;
        CharSequence cs = ev.getPackageName();
        if (cs == null) return;
        String pkg = cs.toString();
        if (pkg.equals(getPackageName())) return;          // unsere App/Fenster – regelt MainActivity
        if (pkg.equals(Einstellungen.ROBLOX)) {
            vorne = pkg;
            zeigePanel();
            return;
        }
        if (!istApp(pkg)) return;                            // Tastatur, Statusleiste, System-Dialoge
        vorne = pkg;
        if (laeuft && !pkg.equals(startPaket)) stoppe();     // App gewechselt → sicherheitshalber aufhören
        if (e.nurInRoblox()) {
            versteckeZiel();
            versteckePanel();
        } else {
            zeigePanel();
        }
    }

    @Override
    public void onInterrupt() { }

    @Override
    public void onDestroy() {
        stoppe();
        versteckeZiel();
        versteckePanel();
        h.removeCallbacksAndMessages(null);
        if (instanz == this) instanz = null;
        super.onDestroy();
    }

    /** Die Nova-Lauf-App wurde geöffnet: nichts festhalten, Knopf weg. */
    void eigeneAppVorne() {
        vorne = getPackageName();
        stoppe();
        versteckeZiel();
        versteckePanel();
    }

    /** In der App wurde eine Einstellung geändert. */
    void einstellungenGeaendert() {
        if (!laeuft && e.nurInRoblox() && !Einstellungen.ROBLOX.equals(vorne)) versteckePanel();
    }

    // ------------------------------------------------------------------ Laufen (Joystick halten)

    private void starte() {
        if (laeuft) return;
        if (zielDa) {
            speichereZiel();
            versteckeZiel();
        }
        laeuft = true;
        lauf++;
        gestartet = SystemClock.uptimeMillis();
        startPaket = vorne;
        setzeWachBleiben(true);
        aktualisiereKnopf();
        final int l = lauf;
        h.postDelayed(() -> druecke(l), 300);   // erst wenn dein Finger vom Knopf weg ist
        h.postDelayed(uhr, 1000);
    }

    private void stoppe() {
        if (!laeuft) return;
        laeuft = false;
        lauf++;
        h.removeCallbacks(uhr);
        GestureDescription.StrokeDescription s = strich;
        strich = null;
        if (s != null && s.willContinue()) {
            // Finger sauber anheben: ein kurzes Schluss-Stück ohne „weiter“.
            Path p = new Path();
            p.moveTo(endX, endY + (wackel ? 1 : 0));
            p.lineTo(endX, endY + (wackel ? 0 : 1));
            try {
                dispatchGesture(new GestureDescription.Builder()
                        .addStroke(s.continueStroke(p, 0, 40, false)).build(), null, null);
            } catch (RuntimeException ignored) { }
        }
        setzeWachBleiben(false);
        aktualisiereKnopf();
    }

    /** Finger auf den Joystick legen und nach vorne schieben. */
    private void druecke(int l) {
        if (!laeuft || l != lauf) return;
        Point s = bildschirm();
        int x = klemme(Math.round(e.zielX() * s.x), 1, s.x - 2);
        int y = klemme(Math.round(e.zielY() * s.y), 2, s.y - 2);
        // Ganze Pixel: dann passt das Ende eines Stücks exakt auf den Anfang des nächsten.
        endX = x;
        endY = Math.max(1, y - dp(e.wegDp()));
        wackel = false;
        Path p = new Path();
        p.moveTo(x, y);
        p.lineTo(endX, endY);
        gedruecktSeit = SystemClock.uptimeMillis();
        sende(new GestureDescription.StrokeDescription(p, 0, ANDRUECKEN_MS, true), l, false);
    }

    /** Nächstes Halte-Stück anhängen (oder zum Schutz vor dem AFK-Kick einmal kurz loslassen). */
    private void halte(int l) {
        if (!laeuft || l != lauf || strich == null) return;
        long afk = e.afkMinuten() * 60_000L;
        boolean loslassen = afk > 0 && SystemClock.uptimeMillis() - gedruecktSeit >= afk;
        Path p = new Path();
        p.moveTo(endX, endY + (wackel ? 1 : 0));
        wackel = !wackel;
        p.lineTo(endX, endY + (wackel ? 1 : 0));
        GestureDescription.StrokeDescription weiter;
        try {
            weiter = strich.continueStroke(p, 0, loslassen ? 60 : HALTE_MS, !loslassen);
        } catch (RuntimeException ex) {
            strich = null;
            h.postDelayed(() -> druecke(l), NEUSTART_MS);
            return;
        }
        sende(weiter, l, loslassen);
    }

    private void sende(GestureDescription.StrokeDescription s, int l, boolean letztes) {
        strich = s;
        GestureDescription g = new GestureDescription.Builder().addStroke(s).build();
        boolean ok = dispatchGesture(g, new GestureResultCallback() {
            @Override public void onCompleted(GestureDescription d) {
                if (!laeuft || l != lauf) return;
                if (letztes) {
                    strich = null;
                    h.postDelayed(() -> druecke(l), LOSLASSEN_PAUSE_MS);
                } else {
                    halte(l);
                }
            }

            @Override public void onCancelled(GestureDescription d) {
                // Passiert z. B., wenn du selbst auf den Bildschirm tippst. Gleich neu ansetzen.
                if (strich == s) strich = null;
                if (!laeuft || l != lauf) return;
                h.postDelayed(() -> druecke(l), NEUSTART_MS);
            }
        }, h);
        if (!ok) {
            strich = null;
            if (laeuft && l == lauf) h.postDelayed(() -> druecke(l), 2 * NEUSTART_MS);
        }
    }

    // ------------------------------------------------------------------ schwebender Knopf

    private void bauePanel() {
        panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.HORIZONTAL);
        panel.setGravity(Gravity.CENTER_VERTICAL);
        panel.setPadding(dp(4), dp(4), dp(4), dp(4));
        panel.setBackground(rund(0xD0202124, dp(26)));

        TextView griff = knopf("⋮⋮", 0x00000000);
        griff.setTextColor(0xFFBDBDBD);
        griff.setPadding(dp(10), dp(8), dp(8), dp(8));

        knopfW = knopf("", 0xFF2E7D32);
        knopfW.setMinWidth(dp(96));
        knopfW.setOnClickListener(v -> {
            if (laeuft) stoppe(); else starte();
        });

        knopfZiel = knopf("◎", 0xFF455A64);
        knopfZiel.setOnClickListener(v -> {
            if (zielDa) {
                speichereZiel();
                versteckeZiel();
                Toast.makeText(this, "Joystick-Platz gespeichert.", Toast.LENGTH_SHORT).show();
            } else {
                stoppe();
                zeigeZiel();
            }
        });

        panel.addView(griff);
        panel.addView(knopfW, abstand());
        panel.addView(knopfZiel, abstand());

        panelLp = fensterLp(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT);
        griff.setOnTouchListener(zieher(panel, panelLp, () -> e.setKnopf(panelLp.x, panelLp.y)));
        aktualisiereKnopf();
    }

    private void zeigePanel() {
        if (panelDa || panel == null) return;
        Point s = bildschirm();
        int x = e.knopfX(), y = e.knopfY();
        if (x < 0 || y < 0) {
            x = s.x / 2 - dp(90);
            y = dp(6);
        }
        panelLp.x = klemme(x, 0, Math.max(0, s.x - dp(120)));
        panelLp.y = klemme(y, 0, Math.max(0, s.y - dp(56)));
        try {
            wm.addView(panel, panelLp);
            panelDa = true;
        } catch (RuntimeException ex) {
            panelDa = false;
        }
        aktualisiereKnopf();
    }

    private void versteckePanel() {
        if (!panelDa) return;
        try { wm.removeView(panel); } catch (RuntimeException ignored) { }
        panelDa = false;
    }

    private void aktualisiereKnopf() {
        if (knopfW == null) return;
        if (laeuft) {
            long s = (SystemClock.uptimeMillis() - gestartet) / 1000;
            String zeit = s >= 3600
                    ? String.format(Locale.GERMANY, "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60)
                    : String.format(Locale.GERMANY, "%d:%02d", s / 60, s % 60);
            knopfW.setText("■ " + zeit);
            knopfW.setBackground(rund(0xFFC62828, dp(20)));
        } else {
            knopfW.setText("▶︎ W");
            knopfW.setBackground(rund(0xFF2E7D32, dp(20)));
        }
    }

    private void setzeWachBleiben(boolean an) {
        if (panelLp == null) return;
        if (an) panelLp.flags |= WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON;
        else panelLp.flags &= ~WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON;
        if (panelDa) {
            try { wm.updateViewLayout(panel, panelLp); } catch (RuntimeException ignored) { }
        }
    }

    // ------------------------------------------------------------------ Joystick-Platz einstellen

    private void zeigeZiel() {
        if (zielDa) return;
        int weg = dp(e.wegDp());
        zielSeite = 2 * (weg + dp(34));
        ziel = new ZielAnzeige(this, dp(30), weg, getResources().getDisplayMetrics().density);
        zielLp = fensterLp(zielSeite, zielSeite);
        Point s = bildschirm();
        final int linksSoll = Math.round(e.zielX() * s.x) - zielSeite / 2;
        final int obenSoll = Math.round(e.zielY() * s.y) - zielSeite / 2;
        zielLp.x = linksSoll - korrX;
        zielLp.y = obenSoll - korrY;
        ziel.setOnTouchListener(zieher(ziel, zielLp, this::speichereZiel));
        try {
            wm.addView(ziel, zielLp);
            zielDa = true;
        } catch (RuntimeException ex) {
            zielDa = false;
            return;
        }
        // Fenster-Koordinaten können leicht vom echten Bildschirm abweichen – einmal nachmessen.
        final ZielAnzeige diese = ziel;
        ziel.postDelayed(() -> {
            if (!zielDa || ziel != diese) return;
            int[] o = new int[2];
            diese.getLocationOnScreen(o);
            korrX = o[0] - zielLp.x;
            korrY = o[1] - zielLp.y;
            if (o[0] != linksSoll || o[1] != obenSoll) {
                zielLp.x = linksSoll - korrX;
                zielLp.y = obenSoll - korrY;
                try { wm.updateViewLayout(diese, zielLp); } catch (RuntimeException ignored) { }
            }
        }, 150);
        knopfZiel.setBackground(rund(0xFFF9A825, dp(20)));
        Toast.makeText(this, "Schieb den Kreis auf deinen Joystick (links unten). "
                + "Der gelbe Pfeil zeigt, wohin gedrückt wird. Fertig: ◎ nochmal tippen.", Toast.LENGTH_LONG).show();
    }

    private void speichereZiel() {
        if (!zielDa || zielLp == null) return;
        Point s = bildschirm();
        float mx = zielLp.x + korrX + zielSeite / 2f;
        float my = zielLp.y + korrY + zielSeite / 2f;
        e.setZiel(klemme(mx / s.x, 0.01f, 0.99f), klemme(my / s.y, 0.01f, 0.99f));
    }

    private void versteckeZiel() {
        if (!zielDa) return;
        try { wm.removeView(ziel); } catch (RuntimeException ignored) { }
        zielDa = false;
        ziel = null;
        if (knopfZiel != null) knopfZiel.setBackground(rund(0xFF455A64, dp(20)));
    }

    /** Kreis mit Fadenkreuz und gelbem Pfeil nach oben (= Laufrichtung). */
    private static final class ZielAnzeige extends View {
        private final Paint fuell = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint rand = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint pfeil = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint spitzeFarbe = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint schrift = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path spitze = new Path();
        private final float radius, weg, d;

        ZielAnzeige(Context c, float radius, float weg, float d) {
            super(c);
            this.radius = radius;
            this.weg = weg;
            this.d = d;
            fuell.setColor(0x6633B5E5);
            rand.setStyle(Paint.Style.STROKE);
            rand.setStrokeWidth(3 * d);
            rand.setColor(0xFFFFFFFF);
            pfeil.setStyle(Paint.Style.STROKE);
            pfeil.setStrokeWidth(5 * d);
            pfeil.setStrokeCap(Paint.Cap.ROUND);
            pfeil.setColor(0xFFFFEB3B);
            spitzeFarbe.setColor(0xFFFFEB3B);
            schrift.setColor(0xFFFFFFFF);
            schrift.setTextSize(13 * d);
            schrift.setTextAlign(Paint.Align.CENTER);
            schrift.setTypeface(Typeface.DEFAULT_BOLD);
            schrift.setShadowLayer(3 * d, 0, 0, 0xFF000000);
        }

        @Override
        protected void onDraw(Canvas c) {
            float cx = getWidth() / 2f, cy = getHeight() / 2f;
            c.drawCircle(cx, cy, radius, fuell);
            c.drawCircle(cx, cy, radius, rand);
            c.drawLine(cx - radius * 0.5f, cy, cx + radius * 0.5f, cy, rand);
            c.drawLine(cx, cy - radius * 0.5f, cx, cy + radius * 0.5f, rand);
            float spitzeY = cy - weg;
            if (weg > radius + 16 * d) c.drawLine(cx, cy - radius, cx, spitzeY + 12 * d, pfeil);
            spitze.reset();
            spitze.moveTo(cx, spitzeY);
            spitze.lineTo(cx - 11 * d, spitzeY + 16 * d);
            spitze.lineTo(cx + 11 * d, spitzeY + 16 * d);
            spitze.close();
            c.drawPath(spitze, spitzeFarbe);
            c.drawText("Joystick", cx, cy + radius + 20 * d, schrift);
        }
    }

    // ------------------------------------------------------------------ Helfer

    private boolean istApp(String pkg) {
        if (pkg.equals("com.android.systemui") || pkg.equals("android") || tastaturen.contains(pkg)) return false;
        if (pkg.equals(homePaket)) return true;
        Boolean b = istAppCache.get(pkg);
        if (b == null) {
            b = getPackageManager().getLaunchIntentForPackage(pkg) != null;
            istAppCache.put(pkg, b);
        }
        return b;
    }

    private String findeHome() {
        try {
            Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
            ResolveInfo ri = getPackageManager().resolveActivity(i, PackageManager.MATCH_DEFAULT_ONLY);
            if (ri != null && ri.activityInfo != null) return ri.activityInfo.packageName;
        } catch (RuntimeException ignored) { }
        return "";
    }

    /** Echte Bildschirmgröße in der aktuellen Drehung (Pixel). */
    @SuppressWarnings("deprecation")
    private Point bildschirm() {
        Point p = new Point();
        DisplayManager dm = getSystemService(DisplayManager.class);
        Display d = dm != null ? dm.getDisplay(Display.DEFAULT_DISPLAY) : null;
        if (d != null) d.getRealSize(p);
        if (p.x <= 0 || p.y <= 0) {
            p.x = getResources().getDisplayMetrics().widthPixels;
            p.y = getResources().getDisplayMetrics().heightPixels;
        }
        return p;
    }

    private WindowManager.LayoutParams fensterLp(int w, int hoehe) {
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(w, hoehe,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.LEFT;
        lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        return lp;
    }

    /** Fenster mit dem Finger verschieben; beim Loslassen wird {@code fertig} ausgeführt. */
    private View.OnTouchListener zieher(View fenster, WindowManager.LayoutParams lp, Runnable fertig) {
        return new View.OnTouchListener() {
            private float sx, sy;
            private int lx, ly;

            @Override
            public boolean onTouch(View v, MotionEvent m) {
                switch (m.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        sx = m.getRawX();
                        sy = m.getRawY();
                        lx = lp.x;
                        ly = lp.y;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        lp.x = lx + Math.round(m.getRawX() - sx);
                        lp.y = ly + Math.round(m.getRawY() - sy);
                        try { wm.updateViewLayout(fenster, lp); } catch (RuntimeException ignored) { }
                        return true;
                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_CANCEL:
                        if (fertig != null) fertig.run();
                        return true;
                    default:
                        return false;
                }
            }
        };
    }

    private TextView knopf(String text, int farbe) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextColor(0xFFFFFFFF);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setGravity(Gravity.CENTER);
        t.setMinHeight(dp(44));
        t.setMinWidth(dp(44));
        t.setPadding(dp(14), dp(8), dp(14), dp(8));
        t.setBackground(rund(farbe, dp(20)));
        return t;
    }

    private LinearLayout.LayoutParams abstand() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.leftMargin = dp(6);
        return lp;
    }

    private static GradientDrawable rund(int farbe, float radius) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(farbe);
        g.setCornerRadius(radius);
        return g;
    }

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private static int klemme(int v, int min, int max) { return Math.max(min, Math.min(max, v)); }

    private static float klemme(float v, float min, float max) { return Math.max(min, Math.min(max, v)); }
}
