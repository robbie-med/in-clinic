package org.robbiemed.clinic

/**
 * Problem library: what each problem offers as one-tap chips. `***` = blank to fill (Epic F2).
 * Clinical lists are starting points to tap from, not recommendations; review against local practice.
 * Free-typed lines are remembered per problem (Store.learn) and come back as chips next time.
 */
class Lib(
    val key: String,
    val name: String,
    val aliases: List<String> = emptyList(),
    val novelty: String = "",
    val course: String = "",
    val noStatus: Boolean = false,
    val hpi: List<String> = emptyList(),
    val notes: List<String> = emptyList(),
    val ddx: List<Ddx> = emptyList(),
    val plan: List<String> = emptyList(),
    val fu: List<String> = emptyList(),
)

/**
 * The entries live in library.json (shared with the web app); LibraryData.kt is generated from it by
 * `node tools/gen-library.mjs`.
 */
object Library {
    /** Med verbs: tap one, then type the drug ("CONT amlodipine 5 mg PO daily"). */
    val medVerbs = LibraryData.medVerbs
    val hpiGeneric = LibraryData.hpiGeneric
    val fuWhen = LibraryData.fuWhen
    val fuGeneric = LibraryData.fuGeneric
    val all: List<Lib> = LibraryData.problems

    private val byKey = all.associateBy { it.key }
    fun get(key: String) = byKey[key]

    /** Exact name / alias match (for carried-forward problems). */
    fun match(name: String): Lib? {
        val n = name.trim().lowercase()
        return all.firstOrNull { it.name.lowercase() == n || n in it.aliases }
    }

    /** Name or alias contains the query; names that start with it first. */
    fun search(q: String): List<Lib> {
        val n = q.trim().lowercase()
        if (n.isEmpty()) return all
        return all.filter { l -> l.name.lowercase().contains(n) || l.aliases.any { it.contains(n) } }
            .sortedBy { l -> if (l.name.lowercase().startsWith(n) || l.aliases.any { it.startsWith(n) }) 0 else 1 }
    }

    fun problem(l: Lib) = Problem(name = l.name, lib = l.key, novelty = l.novelty, course = l.course, noStatus = l.noStatus)
}
