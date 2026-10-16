package org.robbiemed.clinic

/** One exam system: one tap for its normal, or any abnormal findings (from the On-Call app's exam). */
class ExamSystem(val name: String, val normal: String, val abnormal: List<String>)

/**
 * Physical exam, ported from the On-Call app: vitals fields, then per system nL (one tap) or abnL findings.
 * Systems and findings live in library.json. Only examined systems print:
 *   Vitals: BP 128/82, HR 76
 *   Exam:
 *   General: NAD
 *   Resp: crackles and diminished bases
 */
object Exam {
    const val NL = "nL"
    val systems get() = LibraryData.exam
    val vitals get() = LibraryData.vitals

    /** nL clears the findings and vice versa; findings toggle in tap order (typed "other" findings too). */
    fun toggle(v: Visit, s: ExamSystem, item: String): Visit {
        val cur = v.exam[s.name].orEmpty()
        val next = when {
            item == NL -> if (NL in cur) emptyList() else listOf(NL)
            item in cur -> cur - item
            else -> (cur - NL) + item
        }
        return v.withExam(s.name, next)
    }

    /** Every system not yet examined → nL. */
    fun allNormal(v: Visit) = systems.fold(v) { acc, s -> if (acc.exam[s.name].isNullOrEmpty()) acc.withExam(s.name, listOf(NL)) else acc }

    fun lines(v: Visit) = systems.mapNotNull { s ->
        val p = v.exam[s.name].orEmpty()
        when { p.isEmpty() -> null; p == listOf(NL) -> "${s.name}: ${s.normal}"; else -> "${s.name}: " + Note.join(p - NL) }
    }

    fun vitalsText(v: Visit) = vitals.mapNotNull { k -> v.vitals[k]?.trim()?.takeIf { it.isNotEmpty() }?.let { "$k $it" } }.joinToString(", ")
}
