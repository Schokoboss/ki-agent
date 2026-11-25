package de.nova.lauf;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.util.function.IntConsumer;

/** Startbildschirm: einschalten, Roblox öffnen, ein paar Einstellungen. */
public class MainActivity extends Activity {

    private Einstellungen e;
    private TextView status;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        e = new Einstellungen(this);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);

        ScrollView sv = new ScrollView(this);
        sv.setClipToPadding(false);
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(dp(20), dp(16), dp(20), dp(28));
        sv.addView(l, new ScrollView.LayoutParams(ScrollView.LayoutParams.MATCH_PARENT, ScrollView.LayoutParams.WRAP_CONTENT));

        TextView titel = text(l, "Nova Lauf", 28);
        titel.setTypeface(Typeface.DEFAULT_BOLD);
        text(l, "Hält in Roblox den Joystick nach vorne gedrückt – als würdest du W gedrückt halten.", 16);

        status = text(l, "", 17);
        status.setTypeface(Typeface.DEFAULT_BOLD);
        status.setPadding(0, dp(14), 0, dp(4));

        ueberschrift(l, "1. Einschalten (nur einmal)");
        text(l, "Tipp auf den Knopf, dann auf „Nova Lauf“ (steht evtl. unter „Heruntergeladene Apps“) "
                + "und schalte es ein.", 15);
        knopf(l, "Bedienungshilfen öffnen", v -> oeffne(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        text(l, "Ist der Schalter grau oder kommt „Eingeschränkte Einstellung“? Dann: App-Info öffnen → "
                + "oben rechts ⋮ → „Eingeschränkte Einstellungen zulassen“ → nochmal einschalten.", 14);
        knopf(l, "App-Info öffnen", v -> oeffne(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getPackageName()))));

        ueberschrift(l, "2. Laufen lassen");
        text(l, "• Roblox öffnen und ins Spiel gehen. Oben erscheint ein kleiner Knopf:  ⋮⋮  ▶︎ W  ◎\n"
                + "• Beim ersten Mal ◎ tippen und den Kreis auf deinen Joystick schieben (links unten). "
                + "◎ nochmal tippen = gespeichert.\n"
                + "• ▶︎ W tippen: Dein Charakter läuft geradeaus. Nochmal tippen = Stopp.\n"
                + "• An ⋮⋮ kannst du den Knopf woandershin ziehen.", 15);
        knopf(l, "Roblox öffnen", v -> {
            Intent i = getPackageManager().getLaunchIntentForPackage(Einstellungen.ROBLOX);
            if (i != null) oeffne(i);
            else Toast.makeText(this, "Roblox ist nicht installiert.", Toast.LENGTH_SHORT).show();
        });

        ueberschrift(l, "Einstellungen");
        text(l, "Gegen den AFK-Kick: alle paar Minuten kurz loslassen und wieder drücken", 15);
        auswahl(l, new String[]{"Nie", "2 min", "5 min", "10 min"}, new int[]{0, 2, 5, 10},
                e.afkMinuten(), e::setAfkMinuten);
        text(l, "Wie weit der Joystick nach vorne geschoben wird", 15);
        auswahl(l, new String[]{"Wenig", "Mittel", "Weit"}, new int[]{60, 90, 130},
                e.wegDp(), e::setWegDp);
        Switch nurRoblox = new Switch(this);
        nurRoblox.setText("Knopf nur in Roblox zeigen");
        nurRoblox.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        nurRoblox.setChecked(e.nurInRoblox());
        nurRoblox.setPadding(0, dp(12), 0, dp(4));
        nurRoblox.setOnCheckedChangeListener((btn, an) -> {
            e.setNurInRoblox(an);
            LaufDienst d = LaufDienst.instanz;
            if (d != null) d.einstellungenGeaendert();
        });
        l.addView(nurRoblox);

        ueberschrift(l, "Gut zu wissen");
        text(l, "• Tippst du beim Laufen selbst auf den Bildschirm (z. B. Kamera drehen), hört er kurz auf "
                + "und läuft nach 1 Sekunde von allein weiter.\n"
                + "• Wechselst du die App, stoppt er automatisch.\n"
                + "• Der Bildschirm bleibt beim Laufen an – am besten Ladekabel dran.\n"
                + "• Die App liest nichts vom Bildschirm. Sie merkt nur, welche App gerade offen ist.\n"
                + "• Roblox verbietet Bots in seinen Regeln. Nimm lieber einen Zweit-Account.", 14);

        sv.setOnApplyWindowInsetsListener((v, in) -> {
            int li, ob, re, un;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                li = i.left; ob = i.top; re = i.right; un = i.bottom;
            } else {
                li = in.getSystemWindowInsetLeft(); ob = in.getSystemWindowInsetTop();
                re = in.getSystemWindowInsetRight(); un = in.getSystemWindowInsetBottom();
            }
            v.setPadding(li, ob, re, un);
            return in;
        });
        setContentView(sv);
    }

    @Override
    protected void onResume() {
        super.onResume();
        LaufDienst d = LaufDienst.instanz;
        if (d != null) d.eigeneAppVorne();
        boolean an = d != null;
        status.setText(an ? "✓ Nova Lauf ist eingeschaltet" : "✗ Noch nicht eingeschaltet – siehe Schritt 1");
        status.setTextColor(an ? 0xFF43A047 : 0xFFE53935);
    }

    // ------------------------------------------------------------------ Helfer

    private void oeffne(Intent i) {
        try {
            startActivity(i);
        } catch (ActivityNotFoundException ex) {
            Toast.makeText(this, "Ließ sich nicht öffnen.", Toast.LENGTH_SHORT).show();
        }
    }

    private TextView text(LinearLayout l, String s, int sp) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setLineSpacing(dp(3), 1f);
        t.setPadding(0, dp(6), 0, dp(2));
        l.addView(t);
        return t;
    }

    private void ueberschrift(LinearLayout l, String s) {
        TextView t = text(l, s, 19);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(22), 0, dp(2));
    }

    private void knopf(LinearLayout l, String s, View.OnClickListener klick) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setOnClickListener(klick);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(6);
        l.addView(b, lp);
    }

    private void auswahl(LinearLayout l, String[] namen, int[] werte, int aktuell, IntConsumer setzen) {
        RadioGroup g = new RadioGroup(this);
        g.setOrientation(RadioGroup.HORIZONTAL);
        for (int i = 0; i < namen.length; i++) {
            RadioButton r = new RadioButton(this);
            r.setId(View.generateViewId());
            r.setText(namen[i]);
            r.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            r.setMinHeight(dp(44));
            r.setPadding(0, 0, dp(14), 0);
            final int wert = werte[i];
            g.addView(r);
            if (wert == aktuell) g.check(r.getId());
            r.setOnCheckedChangeListener((btn, an) -> {
                if (an) setzen.accept(wert);
            });
        }
        l.addView(g);
    }

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }
}
