package de.nova.lauf;

import android.content.Context;
import android.content.SharedPreferences;

/** Gespeicherte Einstellungen von Nova Lauf. */
final class Einstellungen {
    static final String ROBLOX = "com.roblox.client";

    private final SharedPreferences p;

    Einstellungen(Context c) {
        p = c.getSharedPreferences("lauf", Context.MODE_PRIVATE);
    }

    /** Wo der Joystick ist – als Anteil der Bildschirmbreite/-höhe (Querformat in Roblox). */
    float zielX() { return p.getFloat("zielX", 0.18f); }
    float zielY() { return p.getFloat("zielY", 0.72f); }
    void setZiel(float x, float y) { p.edit().putFloat("zielX", x).putFloat("zielY", y).apply(); }

    /** Wie weit der Joystick nach vorne geschoben wird (dp). */
    int wegDp() { return p.getInt("wegDp", 90); }
    void setWegDp(int dp) { p.edit().putInt("wegDp", dp).apply(); }

    /** Alle wie viele Minuten kurz loslassen und neu drücken (0 = nie). */
    int afkMinuten() { return p.getInt("afk", 5); }
    void setAfkMinuten(int m) { p.edit().putInt("afk", m).apply(); }

    /** Den schwebenden Knopf nur in Roblox zeigen. */
    boolean nurInRoblox() { return p.getBoolean("nurRoblox", true); }
    void setNurInRoblox(boolean b) { p.edit().putBoolean("nurRoblox", b).apply(); }

    /** Lage des schwebenden Knopfs (Pixel); -1 = Standard (oben in der Mitte). */
    int knopfX() { return p.getInt("knopfX", -1); }
    int knopfY() { return p.getInt("knopfY", -1); }
    void setKnopf(int x, int y) { p.edit().putInt("knopfX", x).putInt("knopfY", y).apply(); }
}
