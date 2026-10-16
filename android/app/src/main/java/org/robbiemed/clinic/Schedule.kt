package org.robbiemed.clinic

/**
 * Pasted schedule → visits. Keeps only the slot time, age, sex and visit type. Names, MRNs, DOBs and everything else
 * on the line are dropped. A line with a time starts a visit; the lines after it (until the next time) fill in age/sex/type,
 * because EMR schedules often spread one patient over several lines.
 */
object Schedule {
    private val time = Regex("\\b(\\d{1,2}):(\\d{2})\\s*([AaPp])\\.?[Mm]?\\.?\\b|\\b(\\d{1,2}):(\\d{2})\\b")
    private val ageSex = Regex("\\b(\\d{1,3})\\s?(?:y\\.?o\\.?|yo|y/o|yrs?|years?(?: old)?|Y)?\\s?(F|M|female|male)\\b", RegexOption.IGNORE_CASE)
    private val ageOnly = Regex("\\b(\\d{1,3})\\s?(?:y\\.?o\\.?|yo|y/o|yrs?|years? old|Y)\\b", RegexOption.IGNORE_CASE)
    private val sexOnly = Regex("\\b(Female|Male)\\b", RegexOption.IGNORE_CASE)

    private val types = listOf(
        Regex("hosp|tcm|transition", RegexOption.IGNORE_CASE) to "hospital",
        Regex("\\b(ED|ER)\\b|emergency") to "ed",
        Regex("new pat|establish|\\bNP\\b|new patient", RegexOption.IGNORE_CASE) to "establish",
        Regex("annual|physical|wellness|\\bAWV\\b|\\bCPE\\b|preventive", RegexOption.IGNORE_CASE) to "annual",
        Regex("pre-?op", RegexOption.IGNORE_CASE) to "preop",
        Regex("acute|sick|same.?day|urgent", RegexOption.IGNORE_CASE) to "acute",
        Regex("follow|f/u|\\bFU\\b|return|chronic", RegexOption.IGNORE_CASE) to "follow-up",
    )

    /** "8:30 AM" → "0830", "1:15 PM" → "1315", "13:15" → "1315". */
    fun slot(m: MatchResult): String {
        val g = m.groupValues
        var h = (g[1].ifEmpty { g[4] }).toInt(); val min = g[2].ifEmpty { g[5] }
        val ap = g[3].lowercase()
        if (ap == "p" && h < 12) h += 12
        if (ap == "a" && h == 12) h = 0
        return "%02d%s".format(h, min)
    }

    fun extract(text: String): List<Visit> {
        val out = mutableListOf<Visit>()
        var cur: Visit? = null
        var typed = false
        fun fill(v: Visit, line: String): Visit {
            var x = v
            ageSex.find(line)?.let { m ->
                if (x.age.isEmpty()) x = x.copy(age = m.groupValues[1])
                if (x.sex.isEmpty()) x = x.copy(sex = m.groupValues[2].take(1).uppercase())
            }
            if (x.age.isEmpty()) ageOnly.find(line)?.let { x = x.copy(age = it.groupValues[1]) }
            if (x.sex.isEmpty()) sexOnly.find(line)?.let { x = x.copy(sex = it.groupValues[1].take(1).uppercase()) }
            if (!typed) types.firstOrNull { it.first.containsMatchIn(line) }?.let { x = x.copy(type = it.second); typed = true }
            return x
        }
        for (raw in text.replace("\r", "").lines()) {
            val line = raw.trim()
            if (line.isEmpty()) continue
            val m = time.find(line)
            if (m != null) {
                cur?.let { out += it }
                typed = false
                cur = fill(Visit(slot = slot(m), created = System.currentTimeMillis() + out.size),
                    line.removeRange(m.range))
            } else cur = cur?.let { fill(it, line) }
        }
        cur?.let { out += it }
        return out
    }
}
