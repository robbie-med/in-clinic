package org.robbiemed.clinic

/**
 * The note, in the user's format:
 *
 *   41F known to me here for follow-up of fatigue.
 *
 *   <HPI lines>
 *
 *   PLAN
 *
 *   #Fatigue
 *   New
 *   Chronic
 *   Worsening
 *   <supporting lines>
 *   DDx:
 *   >Non-hormonal: OSA, ...
 *
 *   - 8 AM serum cortisol ...
 *
 *   Follow-up: 2 wk to review labs and confirm sleep study scheduled.
 *
 * A status left unpicked prints `***` (Epic's wildcard: F2 jumps to it), so nothing is silently missing.
 */
object Note {
    val novelty = listOf("New", "Known")
    val course = listOf("Acute", "Subacute", "Chronic")
    val trend = listOf("Worsening", "Stable", "Improving", "Resolved")

    val relations = listOf("known to me", "new to me", "new to clinic")

    /** Visit type → (chip label, one-liner with a chief complaint, one-liner without). */
    class Type(val key: String, val label: String, val withCc: String, val bare: String)
    val types = listOf(
        Type("follow-up", "Follow-up", "here for follow-up of %s", "here for follow-up"),
        Type("acute", "Acute", "here with %s", "here for an acute visit"),
        Type("hospital", "Hospital f/u", "here for hospital follow-up of %s", "here for hospital follow-up"),
        Type("ed", "ED f/u", "here for ED follow-up of %s", "here for ED follow-up"),
        Type("establish", "Establish care", "here to establish care and discuss %s", "here to establish care"),
        Type("annual", "Annual", "here for annual exam and %s", "here for annual exam"),
        Type("preop", "Pre-op", "here for pre-op evaluation before %s", "here for pre-op evaluation"),
        Type("labs", "Lab review", "here to review labs for %s", "here to review labs"),
    )
    fun type(key: String) = types.firstOrNull { it.key == key }

    /** "41F known to me here for follow-up of fatigue." */
    fun oneLiner(v: Visit): String {
        if (v.oneLiner.isNotBlank()) return v.oneLiner.trim()
        val who = (v.age.trim() + v.sex.trim()).ifEmpty { "***" }
        val t = type(v.type)
        val cc = v.cc.trim().trimEnd('.')
        val here = when {
            t == null -> if (cc.isEmpty()) "here for ***" else "here for $cc"
            cc.isEmpty() -> t.bare
            else -> t.withCc.format(cc)
        }
        return listOf(who, v.relation.trim(), here).filter { it.isNotEmpty() }.joinToString(" ") + "."
    }

    fun problem(p: Problem): List<String> {
        val out = mutableListOf("#" + p.name.trim())
        if (!p.noStatus) for (s in listOf(p.novelty, p.course, p.trend)) out += s.ifEmpty { "***" }
        out += p.notes.map { it.trim() }.filter { it.isNotEmpty() }
        val groups = p.ddx.filter { it.items.isNotEmpty() }
        if (groups.size == 1 && groups[0].label.isEmpty()) out += "DDx: " + groups[0].items.joinToString(", ")
        else if (groups.isNotEmpty()) {
            out += "DDx:"
            for (g in groups) out += ">" + (if (g.label.isEmpty()) "" else "${g.label}: ") + g.items.joinToString(", ")
        }
        val plan = p.plan.map { it.trim() }.filter { it.isNotEmpty() }
        if (plan.isNotEmpty()) { out += ""; out += plan.map { "- $it" } }
        return out
    }

    /** "2 wk to review labs and confirm sleep study scheduled". */
    fun followUp(v: Visit): String {
        val why = v.fuWhy.map { it.trim().trimEnd('.') }.filter { it.isNotEmpty() }
        val whenTxt = v.fuWhen.trim().ifEmpty { "***" }
        return if (why.isEmpty()) whenTxt else "$whenTxt to ${join(why)}"
    }

    fun render(v: Visit): String {
        val out = mutableListOf(oneLiner(v), "")
        val hpi = v.hpi.map { it.trim() }.filter { it.isNotEmpty() }
        if (hpi.isNotEmpty()) { out += hpi; out += "" }
        out += "PLAN"
        for (p in v.problems) { out += ""; out += problem(p) }
        out += ""
        out += "Follow-up: ${followUp(v)}."
        return plain(out.joinToString("\n"))
    }

    /** "a", "a and b", "a, b and c". */
    fun join(xs: List<String>) = when (xs.size) { 0 -> ""; 1 -> xs[0]; else -> xs.dropLast(1).joinToString(", ") + " and " + xs.last() }

    /** ASCII-safe so it pastes anywhere. */
    fun plain(s: String) = s.replace("→", "->").replace("≥", ">=").replace("≤", "<=").replace("°", "").replace("–", "-").replace("—", "-")

    // ------------------------------------------------------------ carry forward

    class Parsed(val age: String, val sex: String, val problems: List<Problem>)

    private val header = Regex("^(PLAN|A/?P|ASSESSMENT( AND|/| & )PLAN)\\s*:?$", RegexOption.IGNORE_CASE)
    private val who = Regex("^(\\d{1,3})\\s?([FM])\\b")

    /** Splits on commas outside parentheses: "topiramate effect (fatigue, mood change), OSA" → 2 items. */
    fun split(s: String): List<String> {
        val out = mutableListOf<String>(); val cur = StringBuilder(); var depth = 0
        for (ch in s) {
            when {
                ch == '(' -> { depth++; cur.append(ch) }
                ch == ')' -> { depth = (depth - 1).coerceAtLeast(0); cur.append(ch) }
                ch == ',' && depth == 0 -> { out += cur.toString().trim(); cur.clear() }
                else -> cur.append(ch)
            }
        }
        out += cur.toString().trim()
        return out.filter { it.isNotEmpty() }
    }

    private fun word(s: String, set: List<String>) = set.firstOrNull { it.equals(s.trim(), ignoreCase = true) }

    /**
     * Reads a previous note written in this format: every "#Problem" block (status words, supporting lines, DDx, "- " items).
     * Stops a block at the next "#", a "Follow-up:" line, or the end.
     */
    fun parse(text: String): Parsed {
        val lines = text.replace("\r", "").lines().map { it.trimEnd() }
        val first = lines.firstOrNull { it.isNotBlank() }?.trim().orEmpty()
        val m = who.find(first)
        val start = lines.indexOfFirst { header.matches(it.trim()) }.let { if (it < 0) 0 else it + 1 }
        val problems = mutableListOf<Problem>()
        var p: Problem? = null
        var ddxOpen = false
        fun close() { p?.let { problems += it }; p = null; ddxOpen = false }
        for (raw in lines.drop(start)) {
            val s = raw.trim()
            if (s.startsWith("#") && s.length > 1) { close(); p = Problem(name = s.drop(1).trim()); continue }
            if (s.startsWith("Follow-up", ignoreCase = true) || s.startsWith("F/U:", ignoreCase = true)) { close(); continue }
            val cur = p ?: continue
            if (s.isEmpty() || s == "***") continue
            when {
                word(s, novelty) != null && cur.novelty.isEmpty() -> p = cur.copy(novelty = word(s, novelty)!!)
                word(s, course) != null && cur.course.isEmpty() -> p = cur.copy(course = word(s, course)!!)
                word(s, trend) != null && cur.trend.isEmpty() -> p = cur.copy(trend = word(s, trend)!!)
                s.startsWith("DDx", ignoreCase = true) -> {
                    val rest = s.substringAfter(':', "").trim()
                    if (rest.isNotEmpty()) p = cur.withDdx("", cur.ddxItems("") + split(rest))
                    ddxOpen = true
                }
                ddxOpen && s.startsWith(">") -> {
                    val body = s.drop(1).trim()
                    val label = if (':' in body) body.substringBefore(':').trim() else ""
                    val items = split(if (':' in body) body.substringAfter(':') else body)
                    p = cur.withDdx(label, cur.ddxItems(label) + items)
                }
                s.startsWith("- ") || s.startsWith("• ") || (s.startsWith("-") && !s.startsWith("--")) -> {
                    ddxOpen = false; p = cur.copy(plan = cur.plan + s.trimStart('-', '•', ' '))
                }
                else -> { ddxOpen = false; p = cur.copy(notes = cur.notes + s) }
            }
        }
        close()
        return Parsed(m?.groupValues?.get(1).orEmpty(), m?.groupValues?.get(2).orEmpty(), problems)
    }

    /**
     * A previous visit's problems for today: each is now Known, its trend is cleared (it needs today's assessment),
     * and it picks up its library entry so its chips come back.
     */
    fun carryForward(ps: List<Problem>) = ps.map { p ->
        val lib = Library.match(p.name)
        val none = lib?.noStatus ?: false
        p.copy(lib = lib?.key ?: "", noStatus = none, novelty = if (none) "" else "Known", trend = "")
    }
}
