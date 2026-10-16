package org.robbiemed.clinic

/**
 * The note, in the clinic's template (same rules as js/note.js). Each section is copied on its own into the EMR's
 * matching section, so the section titles are not part of the text:
 *
 *   Chief Complaint            fatigue
 *   History of Present Illness 52F known to me presents for follow-up of fatigue.
 *                              <HPI lines>
 *   Physical Exam              General: No acute distress, ...   (examined systems only)
 *   Assessment/Plan            1. Fatigue
 *                              New / Chronic / Worsening        (one per line; unpicked = ***)
 *                              <supporting lines>
 *                              DDx: ...
 *
 *                              - plan item
 *
 *                              F/u w Dr. X in 2 wk to review labs
 *   Signature                  <signature from settings> + the teaching-physician attestation for the billed level
 *
 * The status lines also drive the billing level ([Billing]).
 */
object Note {
    val novelty = listOf("New", "Known")
    val course = listOf("Acute", "Subacute", "Chronic")
    val trend = listOf("Worsening", "Stable", "Improving", "Resolved")

    val relations = listOf("known to me", "new to me", "new to clinic")

    /** Visit type → (chip label, one-liner with a chief complaint, one-liner without). */
    class Type(val key: String, val label: String, val withCc: String, val bare: String)
    val types = listOf(
        Type("follow-up", "Follow-up", "presents for follow-up of %s", "presents for follow-up"),
        Type("acute", "Acute", "presents for %s", "presents for an acute visit"),
        Type("hospital", "Hospital f/u", "presents for hospital follow-up of %s", "presents for hospital follow-up"),
        Type("ed", "ED f/u", "presents for ED follow-up of %s", "presents for ED follow-up"),
        Type("establish", "Establish care", "presents to establish care and discuss %s", "presents to establish care"),
        Type("annual", "Annual", "presents for annual exam and %s", "presents for annual exam"),
        Type("preop", "Pre-op", "presents for pre-op evaluation before %s", "presents for pre-op evaluation"),
        Type("labs", "Lab review", "presents to review labs for %s", "presents to review labs"),
    )
    fun type(key: String) = types.firstOrNull { it.key == key }

    /** "New to me" prints this line under the one-liner instead of the words "new to me". */
    const val RECORDS = "This was my first time seeing this patient, but records were available for review and the patient is well-known to our clinic."

    /** "41F known to me presents for follow-up of fatigue." */
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
        val rel = v.relation.trim().let { if (it == "new to me") "" else it }
        return listOf(who, rel, here).filter { it.isNotEmpty() }.joinToString(" ") + "."
    }

    /** "1. Fatigue", status lines (unpicked = ***), supporting lines, DDx, then a blank line and the "- " plan items. [n] is 1-based. */
    fun problem(p: Problem, n: Int = 1): List<String> {
        val out = mutableListOf("$n. " + p.name.trim())
        if (!p.noStatus) for (s in listOf(p.novelty, p.course, p.trend)) out += s.ifEmpty { "***" }
        out += p.notes.map { it.trim() }.filter { it.isNotEmpty() }
        val groups = p.ddx.filter { it.items.isNotEmpty() }
        if (groups.size == 1 && groups[0].label.isEmpty()) out += "DDx: " + groups[0].items.joinToString(", ")
        else if (groups.isNotEmpty()) {
            out += "DDx:"
            for (g in groups) out += ">" + (if (g.label.isEmpty()) "" else "${g.label}: ") + g.items.joinToString(", ")
        }
        val plan = p.plan.map { it.trim() }.filter { it.isNotEmpty() }
        if (plan.isNotEmpty()) { if (out.size > 1) out += ""; out += plan.map { "- $it" } }
        return out
    }

    // A typed reason that already starts with its own connector ("after OSU visit") doesn't get "to" in front.
    private val connector = Regex("^(to|after|for|before|once|when|if|in|at|with|w/|re:?|;)(\\s|$)", RegexOption.IGNORE_CASE)

    /** "F/u w Dr. Richard in 2 mo to review labs and reassess symptoms". Nothing picked at all → "F/u ***". */
    fun followUp(v: Visit): String {
        val why = v.fuWhy.map { it.trim().trimEnd('.') }.filter { it.isNotEmpty() }
        val who = v.fuWith.trim(); val whenTxt = v.fuWhen.trim()
        val out = mutableListOf("F/u")
        if (who.isNotEmpty()) out += "w $who"
        if (whenTxt.isNotEmpty()) out += if (whenTxt.equals("PRN", true) || whenTxt.equals("as needed", true)) "PRN" else "in $whenTxt"
        if (why.isNotEmpty()) out += (if (connector.containsMatchIn(why[0])) "" else "to ") + join(why)
        if (out.size == 1) out += "***"
        return out.joinToString(" ")
    }

    class Section(val key: String, val title: String, val short: String, val text: String)

    val sectionTitles = listOf(
        Triple("cc", "Chief Complaint", "CC"), Triple("hpi", "History of Present Illness", "HPI"), Triple("exam", "Physical Exam", "Exam"),
        Triple("ap", "Assessment/Plan", "A/P"), Triple("sign", "Signature", "Sign"),
    )

    /** The note as separately copyable sections. Empty CC / exam are left out. */
    fun sections(v: Visit, signature: String = ""): List<Section> {
        val text = mutableMapOf<String, String>()
        if (v.cc.isNotBlank()) text["cc"] = v.cc.trim().trimEnd('.')
        text["hpi"] = (listOf(oneLiner(v)) + (if (v.relation == "new to me") listOf(RECORDS) else emptyList()) +
            v.hpi.map { it.trim() }.filter { it.isNotEmpty() }).joinToString("\n")
        val vit = Exam.vitalsText(v); val exam = Exam.lines(v)
        if (vit.isNotEmpty() || exam.isNotEmpty()) text["exam"] = ((if (vit.isNotEmpty()) listOf("Vitals: $vit") else emptyList()) + exam).joinToString("\n")
        val ap = mutableListOf<String>()
        v.problems.forEachIndexed { i, p -> if (i > 0) ap += ""; ap += problem(p, i + 1) }
        if (ap.isNotEmpty()) ap += ""
        ap += followUp(v)
        text["ap"] = ap.joinToString("\n")
        text["sign"] = listOf(signature.trim(), Billing.attestation(v)).filter { it.isNotEmpty() }.joinToString("\n\n")
        return sectionTitles.mapNotNull { (k, t, s) -> text[k]?.let { Section(k, t, s, plain(it)) } }
    }

    /** The whole note with section titles (for Share). */
    fun render(v: Visit, signature: String = "") = sections(v, signature).joinToString("\n\n") { "${it.title}\n${it.text}" }

    /** "a", "a and b", "a, b and c". */
    fun join(xs: List<String>) = when (xs.size) { 0 -> ""; 1 -> xs[0]; else -> xs.dropLast(1).joinToString(", ") + " and " + xs.last() }

    /** ASCII-safe so it pastes anywhere. */
    fun plain(s: String) = s.replace("→", "->").replace("≥", ">=").replace("≤", "<=").replace("°", "").replace("–", "-").replace("—", "-")

    // ------------------------------------------------------------ carry forward

    class Parsed(val age: String, val sex: String, val problems: List<Problem>)

    private val header = Regex("^(PLAN|A/?P|ASSESSMENT( AND|/| & )PLAN)\\s*:?$", RegexOption.IGNORE_CASE)
    private val who = Regex("^(\\d{1,3})\\s?([FM])\\b")
    private val numbered = Regex("^\\d{1,2}[.)]\\s+(\\S.*)$")
    private val signed = Regex("^By the addition of|^[A-Z][A-Za-z.' -]+, (MD|DO|NP|PA|PA-C|APRN|FNP)\\b")

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
     * Reads a previous note: every "1. Problem" (or older "#Problem") block after the Assessment/Plan header
     * (supporting lines, DDx, "- " items). A block ends at the next problem, an "F/u" / "Follow-up" line, or the signature.
     */
    fun parse(text: String): Parsed {
        val lines = text.replace("\r", "").lines().map { it.trimEnd() }
        val m = lines.firstNotNullOfOrNull { who.find(it.trim()) }
        val start = lines.indexOfFirst { header.matches(it.trim()) }.let { if (it < 0) 0 else it + 1 }
        val problems = mutableListOf<Problem>()
        var p: Problem? = null
        var ddxOpen = false
        fun close() { p?.let { problems += it }; p = null; ddxOpen = false }
        for (raw in lines.drop(start)) {
            val s = raw.trim()
            if (signed.containsMatchIn(s)) break
            if (s.startsWith("#") && s.length > 1) { close(); p = Problem(name = s.drop(1).trim()); continue }
            val num = numbered.find(s)
            if (num != null) { close(); p = Problem(name = num.groupValues[1].trim()); continue }
            if (s.startsWith("Follow-up", ignoreCase = true) || Regex("^f/u\\b", RegexOption.IGNORE_CASE).containsMatchIn(s)) { close(); continue }
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
