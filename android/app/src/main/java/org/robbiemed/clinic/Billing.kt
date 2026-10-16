package org.robbiemed.clinic

/**
 * Office E/M level from medical decision making (AMA 2021+ office E/M table; same rules as js/billing.js).
 * MDM is the 2nd-highest of its three elements: problems, data, risk (2 of 3 must meet a level).
 * Levels: 1 straightforward, 2 low, 3 moderate, 4 high. Time-based billing is not offered: with a resident,
 * only the teaching physician's time counts, and under the primary care exception only MDM may be used.
 *
 * Problems come from each problem's status pills (or its per-problem override), risk from the plan lines
 * (or the visit override), data from the counters in the Billing section. It only suggests a code;
 * the person billing decides. Picks are conservative: when unsure it counts the lower level.
 */
object Billing {
    val levels = listOf("", "Straightforward", "Low", "Moderate", "High")

    /** Problem complexity choice: key, label, MDM level of one such problem. */
    class Cx(val key: String, val label: String, val lvl: Int)
    val cxs = listOf(
        Cx("none", "Not counted", 0),
        Cx("minor", "Minor / self-limited", 1),
        Cx("stable", "Stable chronic", 2),
        Cx("acute", "Acute, uncomplicated", 2),
        Cx("chronicx", "Chronic w/ exacerbation / progression / tx side effects", 3),
        Cx("undx", "Undiagnosed new problem, uncertain prognosis", 3),
        Cx("systemic", "Acute illness w/ systemic symptoms", 3),
        Cx("complicated", "Acute complicated injury", 3),
        Cx("severe", "Chronic w/ severe exacerbation", 4),
        Cx("threat", "Threat to life or bodily function", 4),
    )
    fun cx(key: String) = cxs.firstOrNull { it.key == key }

    val risks = listOf("minimal", "low", "moderate", "high")

    /** CMS primary care exception: the teaching physician need not be present for these (lower-level) codes. */
    val pceCodes = listOf("99202", "99203", "99211", "99212", "99213")
    val codes = mapOf("new" to listOf("99202", "99203", "99204", "99205"), "est" to listOf("99212", "99213", "99214", "99215"))

    const val ATTEST_PCE = "By the addition of their electronic signature, the teaching physician certifies that they have reviewed the resident's history, physical, diagnosis, and plan and agree with the patient's care as documented in the resident note except as noted. The teaching physician will remain available for follow up to the resident or the patient if that becomes medically necessary."
    const val ATTEST_PRESENT = "By the addition of their electronic signature, the teaching physician certifies that they were physically present for the critical or key portions of the visit or re-performed these portions to their satisfaction. The teaching physician discussed the case with the resident, history was reviewed, examination performed and an assessment/plan was established. The resident's documentation was reviewed and the teaching physician agrees with the resident's findings except as noted. The teaching physician will remain available for follow-up to the resident or the patient if that becomes medically necessary."

    /** What a problem counts as when not overridden, from its status pills. */
    fun autoCx(p: Problem) = when {
        p.noStatus -> "none"
        p.trend == "Resolved" -> "minor"
        p.course == "Chronic" -> if (p.trend == "Worsening") "chronicx" else "stable"
        p.course == "Acute" || p.course == "Subacute" -> "acute"
        p.novelty == "Known" -> if (p.trend == "Worsening") "chronicx" else "stable"
        p.novelty == "New" -> "acute"
        else -> "minor"
    }
    fun problemCx(p: Problem) = if (cx(p.cx) != null) p.cx else autoCx(p)

    class Part(val lvl: Int, val why: List<String>)

    private fun problemsLevel(ps: List<Problem>): Part {
        class Row(val name: String, val c: Cx)
        val rows = ps.map { Row(it.name.trim().ifEmpty { "problem" }, cx(problemCx(it))!!) }.filter { it.c.lvl > 0 }
        fun of(key: String) = rows.filter { it.c.key == key }
        fun names(rs: List<Row>) = rs.joinToString(", ") { it.name }
        val top = rows.maxOfOrNull { it.c.lvl } ?: 0
        if (top >= 3) return Part(top, rows.filter { it.c.lvl == top }.map { "${it.name}: ${it.c.label.lowercase()}" })
        val stable = of("stable"); val acute = of("acute"); val minor = of("minor")
        if (stable.size >= 2) return Part(3, listOf("${stable.size} stable chronic: ${names(stable)}"))
        if (stable.isNotEmpty() || acute.isNotEmpty()) return Part(2, listOfNotNull(
            if (stable.isNotEmpty()) "1 stable chronic: ${names(stable)}" else null,
            if (acute.isNotEmpty()) "acute uncomplicated: ${names(acute)}" else null))
        if (minor.size >= 2) return Part(2, listOf("${minor.size} minor: ${names(minor)}"))
        return Part(1, listOf(if (rows.isNotEmpty()) "minor: ${names(minor)}" else "no problems counted"))
    }

    // ------------------------------------------------------------ data reviewed and analyzed

    // Unique tests named in plan lines (each counts once, the way a CPT code would). Matched on word boundaries;
    // short all-caps names (UA, CT, LH) only in capitals so ordinary words don't match.
    private val tests = listOf(
        "CBC", "CMP", "BMP", "A1C", "TSH", "free T4", "T3", "lipid panel", "UA", "urinalysis", "urine culture", "urine albumin",
        "UACR", "PSA", "ferritin", "iron panel", "B12", "folate", "vitamin D", "magnesium", "phosphorus", "LFTs", "hepatic panel",
        "lipase", "CRP", "ESR", "BNP", "troponin", "INR", "PT/INR", "D-dimer", "uric acid", "HIV", "hepatitis C", "HCV", "RPR",
        "GC/CT", "hCG", "pregnancy test", "prolactin", "cortisol", "ACTH", "DHEA-S", "IGF-1", "estradiol", "LH", "FSH", "testosterone",
        "ANA", "RF", "CCP", "celiac", "stool culture", "FIT", "Cologuard", "H. pylori", "strep test", "rapid strep",
        "EKG", "ECG", "echo", "echocardiogram", "Holter", "stress test", "PFT", "PFTs", "spirometry", "sleep study", "PSG",
        "CXR", "chest x-ray", "x-ray", "XR", "CT", "CTA", "MRI", "ultrasound", "US", "DEXA", "mammogram", "colonoscopy", "ABI", "EMG",
    )
    private val testRe = tests.map { t ->
        val opts = if (Regex("^[A-Z]{2,3}$").matches(t)) emptySet() else setOf(RegexOption.IGNORE_CASE)
        t to Regex("(^|[^A-Za-z0-9])" + Regex.escape(t) + "(?![A-Za-z0-9])", opts)
    }
    private val notOrder = Regex("\\b(review(ed)?|result(s|ed)?|showed|shows|was|were|normal|unremarkable|declin|defer|consider|ordered? (previously|last))", RegexOption.IGNORE_CASE)

    /** Tests named in plan lines that read as orders (not "reviewed CBC"). */
    fun testsOrdered(v: Visit): List<String> {
        val lines = v.problems.flatMap { it.plan }.filter { !notOrder.containsMatchIn(it) }
        val found = mutableListOf<String>()
        for ((t, re) in testRe) if (lines.any { re.containsMatchIn(it) } && found.none { it.equals(t, true) }) found += t
        // "x-ray" also matches inside "chest x-ray"; drop the shorter duplicate
        return found.filter { t -> found.none { o -> o != t && o.length > t.length && o.lowercase().contains(t.lowercase()) } }
    }

    class DataPart(val lvl: Int, val why: List<String>, val ordered: Int, val auto: List<String>)

    private fun dataLevel(v: Visit): DataPart {
        val d = v.data
        val auto = testsOrdered(v)
        val ordered = d.ordered ?: auto.size
        val docs = ordered + d.reviewed + d.external            // category 1 without the historian
        val cat1 = docs + if (d.historian) 1 else 0
        val cats = (if (cat1 >= 3) 1 else 0) + (if (d.interp) 1 else 0) + (if (d.discuss) 1 else 0)
        val why = mutableListOf<String>()
        if (ordered > 0) why += "$ordered ordered" + if (d.ordered == null && auto.isNotEmpty()) " (${auto.joinToString(", ")})" else ""
        if (d.reviewed > 0) why += "${d.reviewed} reviewed"
        if (d.external > 0) why += "${d.external} external source" + if (d.external > 1) "s" else ""
        if (d.historian) why += "independent historian"
        if (d.interp) why += "independent interpretation"
        if (d.discuss) why += "discussed w/ external"
        val lvl = when { cats >= 2 -> 4; cats >= 1 -> 3; docs >= 2 || d.historian -> 2; else -> 1 }
        return DataPart(lvl, why.ifEmpty { listOf("none") }, ordered, auto)
    }

    // ------------------------------------------------------------ risk of patient management

    private val rx = Regex("^(CONT|START|INCREASE|DECREASE|STOP|REFILL|TAPER|HOLD|RESUME|SWITCH)\\b|prescri|\\bRx\\b")
    private val high = Regex("\\b(admit|admission|hospitaliz|direct(ly)? to (the )?ED|sent to (the )?ED|send to (the )?ED|DNR|hospice|comfort care)", RegexOption.IGNORE_CASE)
    private val low = Regex("\\b(OTC|over[- ]the[- ]counter|physical therapy|home PT|PT referral|OT)\\b", RegexOption.IGNORE_CASE)

    private fun riskLevel(v: Visit): Part {
        val lines = v.problems.flatMap { p -> p.plan.map { it.trim() }.filter { it.isNotEmpty() } }
        fun ex(re: Regex) = lines.filter { re.containsMatchIn(it) }
        if (v.risk in risks) return Part(risks.indexOf(v.risk) + 1, listOf("set by hand"))
        if (ex(high).isNotEmpty()) return Part(4, listOf("escalation: " + ex(high)[0]))
        if (ex(rx).isNotEmpty()) return Part(3, listOf("Rx drug mgmt: " + ex(rx).take(2).joinToString("; ")))
        if (v.sdoh) return Part(3, listOf("SDOH limits dx/tx"))
        if (ex(low).isNotEmpty()) return Part(2, listOf(ex(low)[0]))
        if (lines.isNotEmpty()) return Part(2, listOf("plan without Rx"))
        return Part(1, listOf("no plan yet"))
    }

    // ------------------------------------------------------------ the code

    /** New patient: no visit with this group (same specialty) in 3 years. "New to me" in a known clinic is established. */
    fun isNew(v: Visit) = v.relation == "new to clinic"

    class Bill(val problems: Part, val data: DataPart, val risk: Part, val mdm: Int, val kind: String, val auto: String, val code: String) {
        val overridden get() = code != auto
        val pce get() = code in pceCodes
    }

    fun bill(v: Visit): Bill {
        val problems = problemsLevel(v.problems)
        val data = dataLevel(v)
        val risk = riskLevel(v)
        val mdm = listOf(problems.lvl, data.lvl, risk.lvl).sortedDescending()[1]
        val kind = if (isNew(v)) "new" else "est"
        val auto = codes.getValue(kind)[mdm - 1]
        val code = if (v.code in codes.getValue(kind)) v.code else auto   // a code for the other patient kind is ignored
        return Bill(problems, data, risk, mdm, kind, auto, code)
    }

    /** Teaching-physician attestation for the code being billed. */
    fun attestation(v: Visit) = if (bill(v).pce) ATTEST_PCE else ATTEST_PRESENT
}
