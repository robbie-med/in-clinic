package org.robbiemed.clinic

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** One DDx group: ">Non-hormonal: OSA, iron deficiency anemia". [label] "" = unlabelled ("DDx: a, b"). */
data class Ddx(val label: String, val items: List<String>)

/** One "#Problem" in the plan: status lines, supporting lines, DDx, then "- " plan items. */
data class Problem(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    /** [Library] key whose chips this problem offers ("" = free-typed problem). */
    val lib: String = "",
    val novelty: String = "",
    val course: String = "",
    val trend: String = "",
    /** No status lines at all (Health maintenance). */
    val noStatus: Boolean = false,
    val notes: List<String> = emptyList(),
    val ddx: List<Ddx> = emptyList(),
    val plan: List<String> = emptyList(),
) {
    /** Key for learned chips: the library entry, else the problem's own name. */
    val learnKey get() = lib.ifEmpty { "name:" + name.trim().lowercase() }

    fun ddxItems(label: String) = ddx.firstOrNull { it.label == label }?.items.orEmpty()

    /** Sets one DDx group's items (empty removes the group), keeping group order. */
    fun withDdx(label: String, items: List<String>): Problem {
        val rest = ddx.filter { it.label != label }
        if (items.isEmpty()) return copy(ddx = rest)
        val i = ddx.indexOfFirst { it.label == label }
        return copy(ddx = if (i < 0) ddx + Ddx(label, items) else ddx.map { if (it.label == label) Ddx(label, items) else it })
    }
}

/** One clinic visit. No names or MRNs: the slot time and age/sex are the only identifiers. */
data class Visit(
    val id: String = UUID.randomUUID().toString(),
    val created: Long = System.currentTimeMillis(),
    /** Appointment time, "0830". */
    val slot: String = "",
    val age: String = "",
    val sex: String = "",
    val relation: String = "known to me",
    val type: String = "follow-up",
    val cc: String = "",
    /** Typed one-liner that replaces the generated one ("" = generate). */
    val oneLiner: String = "",
    val hpi: List<String> = emptyList(),
    /** Vital label ("BP") → value ("128/82"). */
    val vitals: Map<String, String> = emptyMap(),
    /** Exam system name → [Exam.NL] or the abnormal findings picked / typed. */
    val exam: Map<String, List<String>> = emptyMap(),
    val problems: List<Problem> = emptyList(),
    val fuWhen: String = "",
    val fuWhy: List<String> = emptyList(),
    val copiedAt: Long = 0,
) {
    fun problem(id: String) = problems.firstOrNull { it.id == id }
    fun withProblem(p: Problem) = copy(problems = problems.map { if (it.id == p.id) p else it })
    fun withExam(system: String, picks: List<String>) = copy(exam = if (picks.isEmpty()) exam - system else exam + (system to picks))
    fun withVital(k: String, value: String) = copy(vitals = if (value.isBlank()) vitals - k else vitals + (k to value.trim()))
}

object Json {
    private fun strs(a: JSONArray?) = if (a == null) emptyList() else (0 until a.length()).map { a.getString(it) }

    fun encode(v: Visit): JSONObject = JSONObject().apply {
        put("id", v.id); put("created", v.created); put("slot", v.slot); put("age", v.age); put("sex", v.sex)
        put("relation", v.relation); put("type", v.type); put("cc", v.cc); put("oneLiner", v.oneLiner)
        put("hpi", JSONArray(v.hpi)); put("vitals", JSONObject(v.vitals as Map<*, *>))
        put("exam", JSONObject().apply { v.exam.forEach { (k, l) -> put(k, JSONArray(l)) } }); put("fuWhen", v.fuWhen); put("fuWhy", JSONArray(v.fuWhy)); put("copiedAt", v.copiedAt)
        put("problems", JSONArray(v.problems.map { p ->
            JSONObject().put("id", p.id).put("name", p.name).put("lib", p.lib).put("novelty", p.novelty).put("course", p.course)
                .put("trend", p.trend).put("noStatus", p.noStatus).put("notes", JSONArray(p.notes)).put("plan", JSONArray(p.plan))
                .put("ddx", JSONArray(p.ddx.map { JSONObject().put("label", it.label).put("items", JSONArray(it.items)) }))
        }))
    }

    fun decode(o: JSONObject): Visit {
        val ps = o.optJSONArray("problems") ?: JSONArray()
        return Visit(
            id = o.getString("id"), created = o.optLong("created"), slot = o.optString("slot"), age = o.optString("age"),
            sex = o.optString("sex"), relation = o.optString("relation"), type = o.optString("type"), cc = o.optString("cc"),
            oneLiner = o.optString("oneLiner"), hpi = strs(o.optJSONArray("hpi")),
            vitals = o.optJSONObject("vitals")?.let { j -> j.keys().asSequence().associateWith { j.optString(it) } }.orEmpty(),
            exam = o.optJSONObject("exam")?.let { j -> j.keys().asSequence().associateWith { strs(j.optJSONArray(it)) } }.orEmpty(),
            fuWhen = o.optString("fuWhen"),
            fuWhy = strs(o.optJSONArray("fuWhy")), copiedAt = o.optLong("copiedAt"),
            problems = (0 until ps.length()).map { i ->
                val p = ps.getJSONObject(i); val dd = p.optJSONArray("ddx") ?: JSONArray()
                Problem(
                    id = p.getString("id"), name = p.getString("name"), lib = p.optString("lib"), novelty = p.optString("novelty"),
                    course = p.optString("course"), trend = p.optString("trend"), noStatus = p.optBoolean("noStatus"),
                    notes = strs(p.optJSONArray("notes")), plan = strs(p.optJSONArray("plan")),
                    ddx = (0 until dd.length()).map { j -> dd.getJSONObject(j).let { Ddx(it.optString("label"), strs(it.optJSONArray("items"))) } },
                )
            },
        )
    }
}
