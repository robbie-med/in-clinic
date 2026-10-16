package org.robbiemed.clinic

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * Visits + learned chips in credential-encrypted SharedPreferences (unreadable until the phone is unlocked).
 * Visits live in memory and are written asynchronously on every change, so typing never waits on disk.
 * Visits older than [KEEP_MS] are dropped on load; "Clear panel" drops them all.
 */
object Store {
    private const val KEEP_MS = 3 * 24 * 3600_000L
    private const val LEARN_MAX = 20

    private fun p(c: Context): SharedPreferences = c.getSharedPreferences("clinic", Context.MODE_PRIVATE)

    private var cache: MutableList<Visit>? = null

    fun visits(c: Context): List<Visit> {
        cache?.let { return it }
        val a = runCatching { JSONArray(p(c).getString("visits", "[]")) }.getOrElse { JSONArray() }
        val cutoff = System.currentTimeMillis() - KEEP_MS
        val l = (0 until a.length()).mapNotNull { runCatching { Json.decode(a.getJSONObject(it)) }.getOrNull() }
            .filter { it.created > cutoff }.toMutableList()
        cache = l
        return l
    }

    /** Panel order: by slot time ("" last), then when added. */
    fun panel(c: Context) = visits(c).sortedWith(compareBy<Visit> { it.slot.ifEmpty { "9999" } }.thenBy { it.created })

    fun find(c: Context, id: String) = visits(c).firstOrNull { it.id == id }

    @Synchronized fun put(c: Context, v: Visit) {
        val l = visits(c).toMutableList()
        val i = l.indexOfFirst { it.id == v.id }
        if (i < 0) l += v else l[i] = v
        save(c, l)
    }

    @Synchronized fun putAll(c: Context, vs: List<Visit>) = save(c, visits(c) + vs)

    @Synchronized fun delete(c: Context, id: String) = save(c, visits(c).filter { it.id != id })

    @Synchronized fun clear(c: Context) = save(c, emptyList())

    private fun save(c: Context, l: List<Visit>) {
        cache = l.toMutableList()
        p(c).edit().putString("visits", JSONArray(l.map { Json.encode(it) }).toString()).apply()
    }

    // ---- learned chips: lines you typed for a problem come back as chips next time (most recent first)
    private fun lk(key: String, kind: String) = "learn.$kind.$key"

    fun learned(c: Context, key: String, kind: String): List<String> {
        val a = runCatching { JSONArray(p(c).getString(lk(key, kind), "[]")) }.getOrElse { JSONArray() }
        return (0 until a.length()).map { a.getString(it) }
    }

    fun learn(c: Context, key: String, kind: String, text: String) {
        val t = text.trim()
        if (t.isEmpty() || t.length > 160) return
        val l = (listOf(t) + learned(c, key, kind).filter { it != t }).take(LEARN_MAX)
        p(c).edit().putString(lk(key, kind), JSONArray(l).toString()).apply()
    }

    fun forget(c: Context, key: String, kind: String, text: String) =
        p(c).edit().putString(lk(key, kind), JSONArray(learned(c, key, kind).filter { it != text }).toString()).apply()

    // ---- settings (signature block printed above the attestation)
    fun setting(c: Context, key: String) = p(c).getString("set.$key", "").orEmpty()
    fun setSetting(c: Context, key: String, value: String) = p(c).edit().putString("set.$key", value).apply()

    /** Free-typed problem names, offered in the problem picker next time. */
    fun customProblems(c: Context) = learned(c, "names", "problem")
    fun addCustomProblem(c: Context, name: String) { if (Library.match(name) == null) learn(c, "names", "problem", name) }

    /** Everything learned, for backup/inspection (Settings → Export learned chips). */
    fun learnedDump(c: Context): String {
        val o = JSONObject()
        for ((k, v) in p(c).all) if (k.startsWith("learn.") && v is String) o.put(k, JSONArray(v))
        return o.toString(2)
    }
}
