package org.robbiemed.clinic

/** One exam system: one tap for its normal, plus any findings. [optional] systems (GU) aren't filled by "All untouched → nL". */
class ExamSystem(val name: String, val normal: String, val abnormal: List<String>, val optional: Boolean = false)

/**
 * Physical exam in the clinic's template: vitals fields, then per system nL and/or findings.
 * Systems and findings live in library.json. Only examined systems print; nL plus findings appends them:
 *   General: No acute distress, pleasant, conversant, well-groomed
 *   MSK: Normal ambulation, no clubbing or cyanosis, myofascial trigger points
 *   Respiratory: crackles and diminished bases
 */
object Exam {
    const val NL = "nL"
    val systems get() = LibraryData.exam
    val vitals get() = LibraryData.vitals

    /** nL and each finding toggle on their own; findings keep tap order (typed "other" findings too). */
    fun toggle(v: Visit, s: ExamSystem, item: String): Visit {
        val cur = v.exam[s.name].orEmpty()
        val next = when {
            item in cur -> cur - item
            item == NL -> listOf(NL) + cur
            else -> cur + item
        }
        return v.withExam(s.name, next)
    }

    /** Every system not yet examined → nL (optional systems only when examined). */
    fun allNormal(v: Visit) = systems.fold(v) { acc, s -> if (s.optional || !acc.exam[s.name].isNullOrEmpty()) acc else acc.withExam(s.name, listOf(NL)) }

    fun lines(v: Visit) = systems.mapNotNull { s ->
        val p = v.exam[s.name].orEmpty()
        val found = p - NL
        when { p.isEmpty() -> null; NL in p -> "${s.name}: " + (listOf(s.normal) + found).joinToString(", "); else -> "${s.name}: " + Note.join(found) }
    }

    fun vitalsText(v: Visit) = vitals.mapNotNull { k -> v.vitals[k]?.trim()?.takeIf { it.isNotEmpty() }?.let { "$k $it" } }.joinToString(", ")
}
