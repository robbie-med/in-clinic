package org.robbiemed.clinic

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.os.PersistableBundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher

/**
 * Two screens: the day's panel, and one visit's editor. The editor builds the note live as you tap
 * (one-liner, HPI lines, #problems with status / notes / DDx / plan, follow-up); "Copy note" puts it on the clipboard.
 */
class MainActivity : Activity() {
    private lateinit var frame: FrameLayout
    private var openId: String? = null
    private val back = OnBackInvokedCallback { closeVisit() }
    private var backOn = false

    // Editor state
    private var v = Visit()
    private val expanded = mutableSetOf<String>()
    private lateinit var scroll: ScrollView
    private lateinit var titleT: TextView
    private lateinit var oneLinerT: TextView
    private lateinit var notePv: TextView
    private lateinit var problemsBox: LinearLayout
    private lateinit var hpiLines: Lines
    private lateinit var fuLines: Lines

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        window.decorView.setBackgroundColor(BG)
        frame = FrameLayout(this).apply { setBackgroundColor(BG) }
        frame.setOnApplyWindowInsetsListener { f, ins ->
            val i = ins.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout())
            f.setPadding(i.left + dp(14), i.top + dp(6), i.right + dp(14), i.bottom + dp(8)); WindowInsets.CONSUMED
        }
        setContentView(frame)
        val id = b?.getString("open")
        if (id != null && Store.find(this, id) != null) openVisit(id) else showPanel()
        handle(intent)
    }

    override fun onSaveInstanceState(out: Bundle) { super.onSaveInstanceState(out); openId?.let { out.putString("open", it) } }

    override fun onNewIntent(i: Intent) { super.onNewIntent(i); setIntent(i); handle(i) }

    /** Text shared to the app = a schedule to import. */
    private fun handle(i: Intent?) {
        if (i?.action != Intent.ACTION_SEND) return
        val text = i.getStringExtra(Intent.EXTRA_TEXT).orEmpty()
        i.action = null
        if (openId != null) closeVisit()
        importSchedule(text)
    }

    private fun setBack(on: Boolean) {
        if (on == backOn) return
        backOn = on
        if (on) onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, back)
        else onBackInvokedDispatcher.unregisterOnBackInvokedCallback(back)
    }

    // ================================================================ view helpers

    private fun vertical() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    private fun horizontal() = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    private fun scroller(child: View) = ScrollView(this).apply { addView(child); isVerticalScrollBarEnabled = false }
    private fun fill() = LinearLayout.LayoutParams(-1, 0, 1f)
    private fun small(t: TextView) = t.apply { textSize = 13f; setPadding(dp(11), dp(7), dp(11), dp(7)) }
    private fun sub(s: String) = label(s, 13f, DIM, true).apply { setPadding(0, dp(10), 0, dp(4)) }

    private fun watch(f: (String) -> Unit) = object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        override fun afterTextChanged(s: Editable?) = f(s.toString())
    }

    private fun field(hint: String, value: String, type: Int, onChange: (String) -> Unit) = EditText(this).apply {
        this.hint = hint; setText(value); setTextColor(INK); setHintTextColor(FAINT); textSize = 16f; inputType = type
        setPadding(dp(12), dp(10), dp(12), dp(10)); background = rounded(SURFACE, 12)
        addTextChangedListener(watch(onChange))
    }

    /** Single-choice pills; tapping the picked one clears it. */
    private fun choice(opts: List<Pair<String, String>>, cur: () -> String, box: ViewGroup = Flow(this, dp(8)), set: (String) -> Unit): ViewGroup {
        fun draw() {
            box.removeAllViews()
            for ((k, l) in opts) box.addView(pill(l, cur() == k) {
                box.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                set(if (cur() == k) "" else k); draw()
            })
        }
        draw(); return box
    }

    private fun keyboard(e: EditText) = e.postDelayed({ e.requestFocus(); getSystemService(InputMethodManager::class.java).showSoftInput(e, 0) }, 120)

    private fun hideKeyboard() = currentFocus?.let { getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(it.windowToken, 0) }

    /** Puts [text] in [e] with its first `***` selected, so typing replaces it. */
    private fun fillBlank(e: EditText, text: String) {
        e.setText(text)
        val i = text.indexOf("***")
        if (i >= 0) e.setSelection(i, i + 3) else e.setSelection(text.length)
        keyboard(e)
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()

    // ================================================================ panel

    private fun showPanel() {
        openId = null; setBack(false); hideKeyboard()
        val root = vertical()
        val head = horizontal()
        head.addView(label("Clinic", 26f, INK, true), LinearLayout.LayoutParams(0, -2, 1f))
        head.addView(chip("Import") { importSchedule("") })
        head.addView(chip("⋯") { panelMenu() })
        root.addView(head)

        val visits = Store.panel(this)
        val copied = visits.count { it.copiedAt > 0 }
        root.addView(header("${visits.size} visits · $copied notes copied"))
        root.addView(chip("+  New visit", BG, ACCENT) { newVisit() }.apply {
            textSize = 17f; gravity = Gravity.CENTER; setPadding(dp(14), dp(14), dp(14), dp(14))
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) }
        })
        val list = vertical()
        if (visits.isEmpty()) list.addView(label("No visits yet. Tap + New visit in the room, or Import a pasted schedule " +
            "tonight to pre-chart (only times, age, sex and visit type are kept).", 15f, DIM).apply { setPadding(dp(4), dp(12), dp(4), 0) })
        for (x in visits) list.addView(visitCard(x))
        root.addView(scroller(list), fill())
        frame.removeAllViews(); frame.addView(root)
    }

    private fun visitCard(x: Visit): View {
        val c = vertical().apply {
            setPadding(dp(14), dp(12), dp(14), dp(12)); background = rounded(SURFACE, 16)
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) }
            setOnClickListener { openVisit(x.id) }
            setOnLongClickListener { visitMenu(x); true }
        }
        val top = horizontal()
        top.addView(label(x.slot.ifEmpty { "----" }, 18f, INK, true))
        val what = listOf((x.age + x.sex), Note.type(x.type)?.label.orEmpty(), x.cc).filter { it.isNotBlank() }.joinToString(" · ")
        top.addView(label("   $what", 16f, INK), LinearLayout.LayoutParams(0, -2, 1f))
        c.addView(top)
        if (x.problems.isNotEmpty()) c.addView(label(x.problems.joinToString("  ") { "#" + it.name }, 14f, DIM).apply { setPadding(0, dp(4), 0, 0) })
        c.addView(label(if (x.copiedAt > 0) "✓ copied ${hm(x.copiedAt)}" else "not copied yet", 13f, if (x.copiedAt > 0) ACCENT else FAINT)
            .apply { setPadding(0, dp(4), 0, 0) })
        return c
    }

    private fun newVisit() {
        val x = Visit()
        Store.put(this, x)
        openVisit(x.id)
    }

    private fun visitMenu(x: Visit) {
        AlertDialog.Builder(this).setTitle("${x.slot.ifEmpty { "Visit" }} ${x.age}${x.sex}")
            .setItems(arrayOf("Copy note", "Delete visit")) { _, w ->
                when (w) {
                    0 -> copyNote(x)
                    1 -> AlertDialog.Builder(this).setTitle("Delete this visit?")
                        .setPositiveButton("Delete") { _, _ -> Store.delete(this, x.id); showPanel() }.setNegativeButton("Cancel", null).show()
                }
            }.show()
    }

    private fun panelMenu() {
        val items = arrayOf("Import schedule…", "Clear panel (end of clinic)…", "Copy learned chips (backup)")
        AlertDialog.Builder(this).setItems(items) { _, w ->
            when (w) {
                0 -> importSchedule("")
                1 -> {
                    val n = Store.visits(this).size; val un = Store.visits(this).count { it.copiedAt == 0L }
                    AlertDialog.Builder(this).setTitle("Clear all $n visits?")
                        .setMessage((if (un > 0) "$un notes were never copied.\n\n" else "") + "Learned plan chips are kept.")
                        .setPositiveButton("Clear") { _, _ -> Store.clear(this); showPanel() }.setNegativeButton("Cancel", null).show()
                }
                2 -> copyText("learned", Store.learnedDump(this), "Learned chips copied")
            }
        }.show()
    }

    private fun importSchedule(prefill: String) {
        val body = vertical().apply { setPadding(dp(20), dp(8), dp(20), 0) }
        val pv = label("", 14f, DIM).apply { setPadding(0, dp(8), 0, 0) }
        fun preview(s: String) {
            val vs = Schedule.extract(s)
            pv.text = if (vs.isEmpty()) "No times found" else "${vs.size} visits: " +
                vs.joinToString(", ") { "${it.slot} ${it.age}${it.sex} ${Note.type(it.type)?.label.orEmpty()}".trim() }
        }
        val f = EditText(this).apply {
            hint = "Paste the schedule (8:30 AM … 41 y.o. F … Follow Up)"; setTextColor(INK); setHintTextColor(FAINT); minLines = 5; gravity = Gravity.TOP
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            setText(prefill); addTextChangedListener(watch { preview(it) })
        }
        body.addView(f); body.addView(pv)
        body.addView(label("Only time, age, sex and visit type are kept. Names, MRNs and DOBs are dropped.", 12f, FAINT).apply { setPadding(0, dp(6), 0, 0) })
        preview(prefill)
        AlertDialog.Builder(this).setTitle("Import schedule").setView(scroller(body))
            .setPositiveButton("Add") { _, _ ->
                val vs = Schedule.extract(f.text.toString())
                Store.putAll(this, vs); toast("Added ${vs.size} visits"); showPanel()
            }.setNegativeButton("Cancel", null).show()
    }

    // ================================================================ visit editor

    private fun closeVisit() { openId = null; showPanel() }

    private fun update(f: (Visit) -> Visit) {
        v = f(v)
        Store.put(this, v)
        refresh()
    }

    private fun refresh() {
        notePv.text = Note.render(v)
        oneLinerT.text = Note.oneLiner(v)
        titleT.text = listOf(v.slot, v.age + v.sex).filter { it.isNotBlank() }.joinToString(" · ").ifEmpty { "New visit" }
    }

    private fun openVisit(id: String) {
        v = Store.find(this, id) ?: return showPanel()
        if (openId != id) expanded.clear()
        openId = id; setBack(true)
        val root = vertical()

        val top = horizontal().apply { setPadding(0, 0, 0, dp(6)) }
        top.addView(chip("‹") { closeVisit() })
        titleT = label("", 19f, INK, true)
        top.addView(titleT, LinearLayout.LayoutParams(0, -2, 1f))
        top.addView(chip("Paste last note") { pasteLast() })
        root.addView(top)

        val body = vertical().apply { setPadding(0, 0, 0, dp(24)) }
        scroll = scroller(body)
        root.addView(scroll, fill())

        val bar = horizontal().apply { setPadding(0, dp(8), 0, 0) }
        bar.addView(chip("Copy note", BG, ACCENT) { copyNote(v) }.apply { textSize = 17f; gravity = Gravity.CENTER; setPadding(dp(14), dp(12), dp(14), dp(12)) },
            LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = dp(8) })
        bar.addView(chip("Note ↓") { hideKeyboard(); scroll.post { scroll.smoothScrollTo(0, notePv.top) } })
        bar.addView(chip("Share") { share() })
        root.addView(bar)

        // ---- visit
        body.addView(header("Visit"))
        val r1 = horizontal()
        r1.addView(field("Time 0830", v.slot, InputType.TYPE_CLASS_NUMBER) { s -> update { it.copy(slot = s.trim()) } },
            LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = dp(8) })
        r1.addView(field("Age", v.age, InputType.TYPE_CLASS_NUMBER) { s -> update { it.copy(age = s.trim()) } },
            LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = dp(8) })
        r1.addView(choice(listOf("F" to "F", "M" to "M"), { v.sex }, horizontal()) { s -> update { it.copy(sex = s) } })
        body.addView(r1)
        body.addView(choice(Note.relations.map { it to it }, { v.relation }) { s -> update { it.copy(relation = s) } }.apply { setPadding(0, dp(10), 0, 0) })
        body.addView(choice(Note.types.map { it.key to it.label }, { v.type }) { s -> update { it.copy(type = s) } }.apply { setPadding(0, dp(8), 0, 0) })
        body.addView(field("Chief complaint, e.g. fatigue", v.cc, InputType.TYPE_CLASS_TEXT) { s -> update { it.copy(cc = s) } },
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        oneLinerT = label("", 15f, INK).apply {
            setPadding(dp(12), dp(10), dp(12), dp(10)); background = rounded(RAISED, 12)
            setOnClickListener { editOneLiner() }
        }
        body.addView(oneLinerT, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })

        // ---- HPI
        body.addView(header("HPI"))
        hpiLines = Lines({ v.hpi }, { l -> update { it.copy(hpi = l) } }, { Library.hpiGeneric + libs().flatMap { it.hpi } },
            learnKey = { null }, kind = "hpi", hint = "Complains of… (type or dictate, Enter adds)")
        body.addView(hpiLines.view)

        // ---- plan
        val ph = horizontal()
        ph.addView(header("Plan"), LinearLayout.LayoutParams(0, -2, 1f))
        ph.addView(small(chip("+ Problem", BG, ACCENT) { addProblem() }))
        body.addView(ph)
        problemsBox = vertical()
        body.addView(problemsBox)
        body.addView(small(chip("+ Problem", ACCENT, SURFACE) { addProblem() }).apply {
            layoutParams = LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(2) }
        })

        // ---- follow-up
        body.addView(header("Follow-up"))
        body.addView(choice(Library.fuWhen.map { it to it }, { v.fuWhen }) { s -> update { it.copy(fuWhen = s) } })
        fuLines = Lines({ v.fuWhy }, { l -> update { it.copy(fuWhy = l) } }, { Library.fuGeneric + libs().flatMap { it.fu } },
            learnKey = { "fu" }, kind = "fu", hint = "to… e.g. confirm sleep study scheduled")
        body.addView(fuLines.view)

        // ---- note
        body.addView(header("Note"))
        notePv = label("", 13f, INK).apply {
            typeface = Typeface.MONOSPACE; setPadding(dp(12), dp(10), dp(12), dp(10)); background = rounded(SURFACE, 12); setTextIsSelectable(true)
        }
        body.addView(notePv)

        frame.removeAllViews(); frame.addView(root)
        drawProblems()
        refresh()
    }

    private fun libs() = v.problems.mapNotNull { Library.get(it.lib) }

    /** Problems change the HPI / follow-up suggestions too. */
    private fun drawProblems() {
        problemsBox.removeAllViews()
        if (v.problems.isEmpty()) problemsBox.addView(label("No problems yet. + Problem, or Paste last note to carry the old plan forward.", 14f, DIM)
            .apply { setPadding(dp(4), 0, 0, dp(8)) })
        for (p in v.problems) problemsBox.addView(problemCard(p.id))
        hpiLines.draw(); fuLines.draw()
    }

    private fun problemCard(id: String): View {
        val p0 = v.problem(id)!!
        val lib = Library.get(p0.lib)
        fun cur() = v.problem(id)
        fun upd(f: (Problem) -> Problem) { val p = cur() ?: return; update { it.withProblem(f(p)) } }
        val open = id in expanded

        val card = vertical().apply {
            setPadding(dp(14), dp(8), dp(14), dp(12)); background = rounded(SURFACE, 16)
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) }
        }
        val head = horizontal()
        head.addView(label("#" + p0.name, 19f, INK, true).apply { setOnClickListener { problemMenu(id) } }, LinearLayout.LayoutParams(0, -2, 1f))
        head.addView(small(chip(if (open) "▴ less" else "▾ more") { toggleOpen(id) }))
        head.addView(small(chip("⋯") { problemMenu(id) }).apply { (layoutParams as LinearLayout.LayoutParams).marginEnd = 0 })
        card.addView(head)

        if (!p0.noStatus) {
            card.addView(choice(Note.novelty.map { it to it }, { cur()?.novelty.orEmpty() }) { s -> upd { it.copy(novelty = s) } }.apply { setPadding(0, dp(6), 0, 0) })
            card.addView(choice(Note.course.map { it to it }, { cur()?.course.orEmpty() }) { s -> upd { it.copy(course = s) } }.apply { setPadding(0, dp(6), 0, 0) })
            card.addView(choice(Note.trend.map { it to it }, { cur()?.trend.orEmpty() }) { s -> upd { it.copy(trend = s) } }.apply { setPadding(0, dp(6), 0, 0) })
        }

        if (!open) {
            val rest = Note.problem(p0).drop(if (p0.noStatus) 1 else 4).joinToString("\n").trim()
            card.addView(label(rest.ifEmpty { "Tap to add notes, DDx, plan" }, 13f, if (rest.isEmpty()) FAINT else DIM).apply {
                typeface = Typeface.MONOSPACE; setPadding(0, dp(10), 0, 0); setOnClickListener { toggleOpen(id) }
            })
            return card
        }

        card.addView(sub("Notes"))
        card.addView(Lines({ cur()?.notes.orEmpty() }, { l -> upd { it.copy(notes = l) } }, { lib?.notes.orEmpty() },
            learnKey = { null }, kind = "notes", hint = "Supporting line (history, data)").view)
        card.addView(ddxView(id, lib))
        card.addView(sub("Plan"))
        card.addView(Lines({ cur()?.plan.orEmpty() }, { l -> upd { it.copy(plan = l) } }, { lib?.plan.orEmpty() },
            learnKey = { cur()?.learnKey }, kind = "plan", hint = "Order / action (Enter adds)", prefixes = Library.medVerbs, dash = true).view)
        return card
    }

    private fun toggleOpen(id: String) {
        if (!expanded.add(id)) expanded.remove(id)
        hideKeyboard(); drawProblems()
    }

    private fun ddxView(id: String, lib: Lib?): View {
        val box = vertical()
        fun p() = v.problem(id)
        fun set(label: String, items: List<String>) { val x = p() ?: return; update { it.withProblem(x.withDdx(label, items)) } }
        fun annotate(label: String, item: String, redraw: () -> Unit) {
            val e = EditText(this).apply { setText(item); setTextColor(INK); setSelection(text.length) }
            AlertDialog.Builder(this).setTitle("Edit DDx item").setView(e)
                .setPositiveButton("Save") { _, _ ->
                    val t = e.text.toString().trim()
                    set(label, p()?.ddxItems(label).orEmpty().mapNotNull { if (it == item) t.ifEmpty { null } else it }); redraw()
                }.setNeutralButton("Remove") { _, _ -> set(label, p()?.ddxItems(label).orEmpty() - item); redraw() }
                .setNegativeButton("Cancel", null).show().also { keyboard(e) }
        }
        fun addItems(label: String?, redraw: () -> Unit) {
            val body = vertical().apply { setPadding(dp(20), dp(8), dp(20), 0) }
            val lab = EditText(this).apply { hint = "Group label (optional), e.g. Hormonal"; setTextColor(INK); setHintTextColor(FAINT) }
            val items = EditText(this).apply { hint = "Items, comma-separated"; setTextColor(INK); setHintTextColor(FAINT) }
            if (label == null) body.addView(lab)
            body.addView(items)
            AlertDialog.Builder(this).setTitle(if (label == null) "New DDx group" else "Add to " + label.ifEmpty { "DDx" }).setView(body)
                .setPositiveButton("Add") { _, _ ->
                    val l = label ?: lab.text.toString().trim()
                    val add = Note.split(items.text.toString())
                    if (add.isNotEmpty()) { set(l, p()?.ddxItems(l).orEmpty() + add); redraw() }
                }.setNegativeButton("Cancel", null).show().also { keyboard(items) }
        }
        fun draw() {
            box.removeAllViews()
            val x = p() ?: return
            val labels = (lib?.ddx.orEmpty().map { it.label } + x.ddx.map { it.label }).distinct()
            box.addView(sub("DDx" + if (labels.isEmpty()) "" else " · tap to include · hold to annotate"))
            for (g in labels) {
                if (g.isNotEmpty()) box.addView(label(">$g", 13f, DIM).apply { setPadding(0, dp(4), 0, dp(4)) })
                val opts = lib?.ddx?.firstOrNull { it.label == g }?.items.orEmpty()
                val chosen = x.ddxItems(g)
                fun matchOf(o: String) = chosen.firstOrNull { it == o || it.startsWith("$o (") }
                val flow = Flow(this, dp(6))
                for (o in opts) {
                    val m = matchOf(o)
                    flow.addView(small(pill(m ?: o, m != null) {
                        set(g, if (m != null) chosen - m else chosen + o); draw()
                    }).apply { if (m != null) setOnLongClickListener { annotate(g, m) { draw() }; true } })
                }
                for (extra in chosen.filter { c -> opts.none { c == it || c.startsWith("$it (") } })
                    flow.addView(small(pill(extra, true) { set(g, chosen - extra); draw() }).apply {
                        setOnLongClickListener { annotate(g, extra) { draw() }; true }
                    })
                flow.addView(small(chip("+ other", ACCENT, SURFACE) { addItems(g) { draw() } }))
                box.addView(flow)
            }
            box.addView(small(chip("+ DDx group", ACCENT, SURFACE) { addItems(null) { draw() } }).apply {
                layoutParams = LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(6) }
            })
        }
        draw()
        return box
    }

    private fun problemMenu(id: String) {
        val p = v.problem(id) ?: return
        val i = v.problems.indexOfFirst { it.id == id }
        val items = arrayOf("Rename", "Move up", "Move down", if (p.noStatus) "Show status lines" else "No status lines", "Remove problem")
        AlertDialog.Builder(this).setTitle("#" + p.name).setItems(items) { _, w ->
            when (w) {
                0 -> {
                    val e = EditText(this).apply { setText(p.name); setTextColor(INK); setSelection(text.length) }
                    AlertDialog.Builder(this).setTitle("Rename").setView(e).setPositiveButton("Save") { _, _ ->
                        val n = e.text.toString().trim().removePrefix("#")
                        if (n.isNotEmpty()) { update { it.withProblem(p.copy(name = n)) }; drawProblems() }
                    }.setNegativeButton("Cancel", null).show().also { keyboard(e) }
                }
                1, 2 -> {
                    val j = if (w == 1) i - 1 else i + 1
                    if (j in v.problems.indices) {
                        val l = v.problems.toMutableList(); l[i] = l[j].also { l[j] = l[i] }
                        update { it.copy(problems = l) }; drawProblems()
                    }
                }
                3 -> { update { it.withProblem(p.copy(noStatus = !p.noStatus)) }; drawProblems() }
                4 -> { update { it.copy(problems = it.problems.filter { x -> x.id != id }) }; drawProblems() }
            }
        }.show()
    }

    private fun addProblem() {
        hideKeyboard()
        val body = vertical().apply { setPadding(dp(20), dp(8), dp(20), dp(8)) }
        val results = vertical()
        lateinit var dlg: AlertDialog
        fun add(p: Problem) {
            dlg.dismiss()
            expanded += p.id
            update { it.copy(problems = it.problems + p) }
            drawProblems()
            problemsBox.post { scroll.smoothScrollTo(0, problemsBox.top + (problemsBox.getChildAt(problemsBox.childCount - 1)?.top ?: 0)) }
        }
        fun row(text: String, note: String, onTap: () -> Unit) = label(text, 17f, INK).apply {
            if (note.isNotEmpty()) this.text = "$text   ·  $note"
            setPadding(dp(4), dp(11), dp(4), dp(11)); setOnClickListener { onTap() }
        }
        val q = EditText(this).apply {
            hint = "Search or type a new problem"; setTextColor(INK); setHintTextColor(FAINT); textSize = 17f; isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES; imeOptions = EditorInfo.IME_ACTION_DONE
        }
        var first: (() -> Unit)? = null
        fun draw() {
            results.removeAllViews(); first = null
            val s = q.text.toString().trim()
            val taps = mutableListOf<Pair<View, () -> Unit>>()
            for (l in Library.search(s)) {
                val f = { add(Library.problem(l)) }
                taps += row(l.name, l.aliases.take(2).joinToString(", "), f) to f
            }
            for (n in Store.customProblems(this).filter { s.isEmpty() || it.contains(s, ignoreCase = true) }) {
                val f = { add(Problem(name = n)) }
                taps += row(n, "yours", f) to f
            }
            if (s.isNotEmpty() && Library.match(s) == null && Store.customProblems(this).none { it.equals(s, true) }) {
                val f = { Store.addCustomProblem(this, s); add(Problem(name = s)) }
                // Enter takes the first row: a library / earlier match when there is one, else this new problem
                val r = row("+ Add \"$s\"", "", f).apply { setTextColor(ACCENT) } to f
                if (taps.isEmpty()) taps += r else taps.add(r)
            }
            first = taps.firstOrNull()?.second
            taps.forEach { results.addView(it.first) }
        }
        q.addTextChangedListener(watch { draw() })
        q.setOnEditorActionListener { _, a, _ -> if (a == EditorInfo.IME_ACTION_DONE) { first?.invoke(); true } else false }
        body.addView(q); body.addView(results)
        draw()
        dlg = AlertDialog.Builder(this).setTitle("Add problem").setView(scroller(body)).setNegativeButton("Cancel", null).create()
        dlg.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
        dlg.show()
        q.requestFocus()
    }

    private fun editOneLiner() {
        val e = EditText(this).apply { setText(Note.oneLiner(v)); setTextColor(INK); setSelection(text.length) }
        AlertDialog.Builder(this).setTitle("One-liner").setView(e)
            .setPositiveButton("Save") { _, _ ->
                val t = e.text.toString().trim()
                update { it.copy(oneLiner = if (t == Note.oneLiner(it.copy(oneLiner = ""))) "" else t) }
            }
            .setNeutralButton("Use generated") { _, _ -> update { it.copy(oneLiner = "") } }
            .setNegativeButton("Cancel", null).show().also { keyboard(e) }
    }

    /** Paste the last note → its problems come back as Known, trend cleared, plan and notes kept. */
    private fun pasteLast() {
        hideKeyboard()
        val e = EditText(this).apply {
            hint = "Paste the previous note (the PLAN with #problems)"; setTextColor(INK); setHintTextColor(FAINT); minLines = 6; gravity = Gravity.TOP
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        }
        AlertDialog.Builder(this).setTitle("Carry forward").setView(scroller(e))
            .setMessage("Problems become Known; trend is cleared for today. Plan, notes and DDx are kept to edit.")
            .setPositiveButton("Carry forward") { _, _ ->
                val parsed = Note.parse(e.text.toString())
                val have = v.problems.map { it.name.lowercase() }.toSet()
                val add = Note.carryForward(parsed.problems).filter { it.name.lowercase() !in have }
                update { it.copy(problems = it.problems + add, age = it.age.ifEmpty { parsed.age }, sex = it.sex.ifEmpty { parsed.sex }) }
                openVisit(v.id)   // age/sex fields too
                toast(if (add.isEmpty()) "No #problems found" else "Added ${add.size} problems")
            }.setNegativeButton("Cancel", null).show()
    }

    // ================================================================ output

    private fun copyText(label: String, text: String, toast: String) {
        val clip = ClipData.newPlainText(label, text)
        clip.description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
        getSystemService(ClipboardManager::class.java).setPrimaryClip(clip)
        toast(toast)
    }

    private fun copyNote(x: Visit) {
        copyText("note", Note.render(x), "Note copied")
        val now = System.currentTimeMillis()
        if (x.id == v.id && openId == v.id) update { it.copy(copiedAt = now) } else { Store.put(this, x.copy(copiedAt = now)); showPanel() }
        window.decorView.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
    }

    private fun share() {
        val i = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, Note.render(v))
        startActivity(Intent.createChooser(i, "Send note"))
    }

    // ================================================================ line lists

    /**
     * Editable list of lines (HPI, a problem's notes / plan, follow-up reasons). Rows: tap to edit, move or delete.
     * Chips: tap toggles that line in or out; a chip with `***` goes into the field with the blank selected so you type over it.
     * Prefix chips (med verbs) start the field. Enter adds what's typed and keeps the keyboard up for the next line.
     * With a [learnKey], typed lines are remembered and come back as chips (hold one to forget it).
     */
    private inner class Lines(
        private val get: () -> List<String>,
        private val set: (List<String>) -> Unit,
        private val chips: () -> List<String>,
        private val learnKey: () -> String?,
        private val kind: String,
        hint: String,
        prefixes: List<String> = emptyList(),
        private val dash: Boolean = false,
    ) {
        val view = vertical()
        private val rows = vertical()
        private val chipBox = Flow(this@MainActivity, dp(6))
        private val field = EditText(this@MainActivity).apply {
            this.hint = hint; setTextColor(INK); setHintTextColor(FAINT); textSize = 16f; isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
            imeOptions = EditorInfo.IME_ACTION_DONE
            setPadding(dp(12), dp(10), dp(12), dp(10)); background = rounded(RAISED, 12)
            setOnEditorActionListener { _, a, _ -> if (a == EditorInfo.IME_ACTION_DONE) { add(); true } else false }
        }

        init {
            view.addView(rows)
            val r = horizontal().apply { setPadding(0, dp(4), 0, 0) }
            r.addView(field, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = dp(6) })
            r.addView(chip("+", BG, ACCENT) { add() }.apply { (layoutParams as LinearLayout.LayoutParams).marginEnd = 0 })
            view.addView(r)
            if (prefixes.isNotEmpty()) view.addView(Flow(this@MainActivity, dp(6)).apply {
                setPadding(0, dp(6), 0, 0)
                for (pre in prefixes) addView(small(chip(pre.trim(), ACCENT, SURFACE) {
                    val rest = field.text.toString().let { t -> prefixes.firstOrNull { t.startsWith(it) }?.let { t.removePrefix(it) } ?: t }
                    field.setText(pre + rest); field.setSelection(field.text.length); keyboard(field)
                }))
            })
            view.addView(chipBox.apply { setPadding(0, dp(6), 0, 0) })
            draw()
        }

        fun draw() { drawRows(); drawChips() }

        private fun drawRows() {
            rows.removeAllViews()
            get().forEachIndexed { i, s ->
                rows.addView(label((if (dash) "- " else "• ") + s, 15f, INK).apply {
                    setPadding(dp(10), dp(7), dp(10), dp(7)); background = rounded(RAISED, 10)
                    layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(4) }
                    setOnClickListener { edit(i) }
                })
            }
        }

        private fun drawChips() {
            chipBox.removeAllViews()
            val cur = get()
            val base = chips()
            val key = learnKey()
            val learned = key?.let { Store.learned(this@MainActivity, it, kind) }.orEmpty().filter { it !in base }
            for (c in (base + learned).distinct()) {
                val blank = "***" in c
                val on = c in cur
                chipBox.addView(small(pill(c, on) {
                    if (blank && !on) fillBlank(field, c)
                    else { set(if (on) cur - c else cur + c); draw() }
                }).apply {
                    if (blank && !on) setTextColor(0xFFB8C4D6.toInt())
                    if (key != null && c in learned) setOnLongClickListener {
                        AlertDialog.Builder(this@MainActivity).setMessage("Forget \"$c\"?")
                            .setPositiveButton("Forget") { _, _ -> Store.forget(this@MainActivity, key, kind, c); draw() }
                            .setNegativeButton("Cancel", null).show(); true
                    }
                })
            }
        }

        private fun add() {
            val t = field.text.toString().trim()
            if (t.isEmpty()) return
            set(get() + t)
            learnKey()?.let { Store.learn(this@MainActivity, it, kind, t) }
            field.setText("")
            draw()
        }

        private fun edit(i: Int) {
            val l = get(); val s = l.getOrNull(i) ?: return
            val e = EditText(this@MainActivity).apply { setText(s); setTextColor(INK); isSingleLine = false }
            val star = s.indexOf("***"); if (star >= 0) e.setSelection(star, star + 3) else e.setSelection(s.length)
            AlertDialog.Builder(this@MainActivity).setView(e)
                .setPositiveButton("Save") { _, _ ->
                    val t = e.text.toString().trim()
                    set(get().toMutableList().also { if (t.isEmpty()) it.removeAt(i) else it[i] = t }); draw()
                }
                .setNegativeButton("Delete") { _, _ -> set(get().toMutableList().also { it.removeAt(i) }); draw() }
                .setNeutralButton("Move up") { _, _ -> if (i > 0) { set(get().toMutableList().also { it[i] = it[i - 1].also { _ -> it[i - 1] = it[i] } }); draw() } }
                .show().also { keyboard(e) }
        }
    }
}
