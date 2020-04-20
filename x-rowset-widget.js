
// ---------------------------------------------------------------------------
// rowset_widget mixin
// ---------------------------------------------------------------------------

/*
	rowset widgets must implement:
		init_rows()
		update_cell_value(ri, fi, old_val, ...set_value_args)
		update_cell_error(ri, fi, err, old_err, ...set_value_args)
		update_cell_focus(ri, [fi])
		update_cell_editing(ri, [fi], editing)
		scroll_to_cell(ri, [fi])
*/

function rowset_widget(e) {

	e.can_edit = true
	e.can_add_rows = true
	e.can_remove_rows = true
	e.can_change_rows = true

	e.can_focus_cells = true
	e.auto_advance_row = true   // jump row on horiz. navigation limits
	e.save_row_on = 'exit_edit' // save row on 'input'|'exit_edit'|'exit_row'|false
	e.prevent_exit_edit = false // prevent exiting edit mode on validation errors
	e.prevent_exit_row = true   // prevent changing row on validation errors

	focused_row_mixin(e)
	value_widget(e)

	// row -> row_index mapping -----------------------------------------------

	let rowmap

	e.row_index = function(row, ri) {
		if (!row)
			return null
		if (ri != null && ri != false)
			return ri
		if (row == e.focused_row) // most likely true (avoid maiking a rowmap).
			return e.focused_row_index
		if (!rowmap) {
			rowmap = new Map()
			for (let i = 0; i < e.rows.length; i++) {
				rowmap.set(e.rows[i], i)
			}
		}
		return rowmap.get(row)
	}

	// field -> field_index mapping -------------------------------------------

	let fieldmap

	e.field_index = function(field, fi) {
		if (!field)
			return null
		if (fi != null && fi != false)
			return fi
		if (field == e.focused_field) // most likely true (avoid maiking a fieldmap).
			return e.focused_field_index
		if (!fieldmap) {
			fieldmap = new Map()
			for (let i = 0; i < e.fields.length; i++) {
				fieldmap.set(e.fields[i], i)
			}
		}
		return fieldmap.get(field)
	}

	// rows array -------------------------------------------------------------

	e.init_rows_array = function() {
		e.rows = []
		let i = 0
		for (let row of e.rowset.rows) {
			if (!row.removed)
				e.rows.push(row)
		}
	}

	// fields array -----------------------------------------------------------

	e.init_fields_array = function() {
		e.fields = []
		if (e.cols) {
			for (let col of e.cols.split(' ')) {
				let field = e.rowset.field(col)
				if (field && field.visible != false)
					e.fields.push(field)
			}
		} else
			for (let field of e.rowset.fields)
				if (field.visible != false)
					e.fields.push(field)
	}

	// rowset binding ---------------------------------------------------------

	e.bind_rowset = function(on) {
		// structural changes.
		e.rowset.onoff('reload'      , reload     , on)
		e.rowset.onoff('row_added'   , row_added  , on)
		e.rowset.onoff('row_removed' , row_removed, on)
		// cell value & state changes.
		e.rowset.onoff('cell_state_changed'     , cell_state_changed     , on)
		e.rowset.onoff('display_values_changed' , display_values_changed , on)
		// network events
		e.rowset.on('loading', rowset_loading, on)
		e.rowset.on('load_slow', rowset_load_slow, on)
		e.rowset.on('load_progress', rowset_load_progress, on)
		// misc.
		e.rowset.on('notify', rowset_notify, on)
	}

	// adding & removing rows -------------------------------------------------

	e.insert_row = function(ri, focus_it, ...args) {
		if (!e.can_edit || !e.can_add_rows)
			return false
		if (ri == true)
			ri = e.focused_row_index
		let adjust_ri = e.focused_row && ri != null
		if (adjust_ri)
			e.focused_row_index++
		let row = e.rowset.add_row(e, ri, focus_it, ...args)
		if (!row && adjust_ri)
			e.focused_row_index--
		return row != null
	}

	e.remove_row = function(ri, refocus, ...args) {
		if (!e.can_edit || !e.can_remove_rows)
			return false
		let row = e.rows[ri]
		return e.rowset.remove_row(row, e, ri, refocus, ...args)
	}

	e.remove_focused_row = function(refocus) {
		if (e.focused_row)
			return e.remove_row(e.focused_row_index, refocus)
	}

	// responding to structural updates ---------------------------------------

	function reload() {
		e.focused_row_index = null
		e.focused_field_index = null
		e.init_rows_array()
		rowmap = null
		e.init_rows()
	}

	function row_added(row, source, ri, focus) {
		if (source == e && ri != null)
			e.rows.insert(ri, row)
		else
			ri = e.rows.push(row)
		rowmap = null
		e.init_rows()
		if (source == e && focus)
			e.focus_cell(ri, true)
	}

	function row_removed(row, source, ri, refocus) {
		e.rows.remove(e.row_index(row, source == e && ri))
		rowmap = null
		e.init_rows()
		if (source == e && refocus)
			if (!e.focus_cell(ri, true))
				e.focus_cell(ri, true, -0)
	}

	// responding to cell updates ---------------------------------------------

	e.init_cell = function(ri, fi, ...args) {
		let row = e.rows[ri]
		let err = e.rowset.cell_state(row, field, 'error')
		e.update_cell_value(ri, fi, ...args)
		e.update_cell_error(ri, fi, err, ...args)
	}

	function cell_state_changed(row, field, key, val, old_val, source, ri, fi, ...args) {
		ri = e.row_index  (row  , source == e && ri)
		fi = e.field_index(field, source == e && fi)
		if (key == 'input_value')
			e.update_cell_value(ri, fi, ...args)
		else if (key == 'error')
			e.update_cell_error(ri, fi, val, ...args)
	}

	function display_values_changed(field) {
		e.init_rows()
	}

	// responding to notifications from rowset --------------------------------

	function rowset_notify(type, message) {
		console.log(type, message)
	}

	function rowset_loading(on) {
		e.disabled = !on
		e.class('loading', on)
	}

	e.update_load_progress = noop // stub
	function rowset_load_progress(...args) {
		e.update_load_progress(...args)
	}

	e.update_load_slow = noop // stub
	function rowset_load_slow(on) {
		e.update_load_slow(on)
	}

	function rowset_saving(on) {
		//
	}

	// focusing ---------------------------------------------------------------

	e.focused_row_index = null
	e.focused_field_index = null

	function set_focused_cell(ri, fi, ...args) {

		let ri0 = e.focused_row_index

		e.focused_row_index   = ri
		e.focused_field_index = fi

		if (ri0 == ri) {
			// row didn't change, set_focused_row() will do nothing.
			e.update_cell_focus(ri, fi)
			return
		}

		e.set_focused_row(ri != null ? e.rows[ri] : null, e, ri, fi, ...args)
	}

	e.property('focused_field', function() {
		return e.fields[e.focused_field_index]
	})

	// navigating -------------------------------------------------------------

	e.can_change_value = function(row, field) {
		return e.can_edit && e.can_change_rows
			&& e.rowset.can_change_value(row, field)
	}

	e.can_focus_cell = function(row, field, for_editing) {
		return (field == null || e.can_focus_cells)
			&& e.rowset.can_focus_cell(row, field)
			&& (!for_editing || e.can_change_value(row, field))
	}

	e.first_focusable_cell = function(ri, fi, rows, cols, options) {

		if (ri === true) ri = e.focused_row_index
		if (fi === true) fi = e.focused_field_index
		rows = or(rows, 0) // by default find the first focusable row.
		cols = or(cols, 0) // by default find the first focusable col.

		let for_editing = options && options.for_editing // skip non-editable cells.
		let must_move = options && options.must_move // return only if moved.
		let must_not_move_row = options && options.must_not_move_row // return only if row not moved.
		let must_not_move_col = options && options.must_not_move_col // return only if col not moved.

		let ri_inc = strict_sign(rows)
		let fi_inc = strict_sign(cols)
		rows = abs(rows)
		cols = abs(cols)

		// if starting from nowhere, include the first/last row/col into the count.
		if (ri == null && rows)
			rows--
		if (fi == null && cols)
			cols--

		let move_row = rows >= 1
		let move_col = cols >= 1
		let start_ri = ri
		let start_fi = fi

		// the default cell is the first or the last depending on direction.
		ri = or(ri, ri_inc * -1/0)
		fi = or(fi, fi_inc * -1/0)

		// clamp out-of-bound row/col indices.
		ri = clamp(ri, 0, e.rows.length-1)
		fi = clamp(fi, 0, e.fields.length-1)

		let last_valid_ri = null
		let last_valid_fi = null
		let last_valid_row

		// find the last valid row, stopping after the specified row count.
		while (ri >= 0 && ri < e.rows.length) {
			let row = e.rows[ri]
			if (e.can_focus_cell(row, null, for_editing)) {
				last_valid_ri = ri
				last_valid_row = row
				if (rows <= 0)
					break
			}
			rows--
			ri += ri_inc
		}

		if (last_valid_ri == null)
			return [null, null]

		// if wanted to move the row but couldn't, don't move the col either.
		let row_moved = last_valid_ri != start_ri
		if (move_row && !row_moved)
			cols = 0

		while (fi >= 0 && fi < e.fields.length) {
			let field = e.fields[fi]
			if (e.can_focus_cell(last_valid_row, field, for_editing)) {
				last_valid_fi = fi
				if (cols <= 0)
					break
			}
			cols--
			fi += fi_inc
		}

		let col_moved = last_valid_fi != start_fi

		if (must_move && !(row_moved || col_moved))
			return [null, null]

		if ((must_not_move_row && row_moved) || (must_not_move_col && col_moved))
			return [null, null]

		return [last_valid_ri, last_valid_fi]
	}

	e.focus_cell = function(ri, fi, rows, cols, options) {

		if (ri === false) { // explicit `false` means remove focus only.
			[ri, fi] = [null, null]
		} else {
			[ri, fi] = e.first_focusable_cell(ri, fi, rows, cols, options)
			if (ri == null) // failure to find cell means cancel.
				return false
		}

		if (e.focused_row_index != ri) {
			if (!e.exit_row())
				return false
		} else if (e.focused_field_index != fi) {
			if (!e.exit_edit())
				return false
		} else if (!(options && options.force))
			return true // same cell.

		set_focused_cell(ri, fi)

		if (!options || options.make_visible != false)
			if (e.isConnected)
				e.scroll_to_cell(ri, fi)

		return true
	}

	e.focus_next_cell = function(cols, auto_advance_row, for_editing) {
		let dir = strict_sign(cols)
		return e.focus_cell(true, true, dir * 0, cols, {must_move: true, for_editing: for_editing})
			|| ((auto_advance_row || e.auto_advance_row)
				&& e.focus_cell(true, true, dir, dir * -1/0, {for_editing: for_editing}))
	}

	e.is_last_row_focused = function() {
		let [ri] = e.first_focusable_cell(true, true, 1, 0, {must_move: true})
		return ri == null
	}

	// responding to navigation -----------------------------------------------

	e.on('focused_row_changed', function(row, source, ri, fi, source1, do_update) {
		if (source1 == e && do_update == false) // got here from update_value().
			return
		if (source != e || ri == null) // didn't get here from set_focused_cell().
			ri = e.row_index(row)
		let v = e.value_field ? e.rowset.value(e.focused_row, e.value_field) : ri
		e.set_value(v, false)
		e.update_cell_focus(ri, fi)
	})

	// responding to value changes --------------------------------------------

	e.update_value = function(source, do_update) {
		if (source == e && do_update == false) // got here from `focused_row_changed`.
			return
		let v = e.input_value
		let ri
		if (e.value_field)
			ri = e.row_index(e.rowset.lookup(e.value_field, v))
		else {
			ri = v
			if (!(typeof(v) == 'number' && v >= 0 && v < e.rows.length))
				ri = null
		}
		set_focused_cell(ri, null, e, false)
		e.update_cell_focus(ri)
	}

	// editing ----------------------------------------------------------------

	e.editor = null

	e.create_editor = function(field, ...editor_options) {
		return e.rowset.create_editor(field, {
			nav: e,
			field: field,
		}, ...editor_options)
	}

	e.enter_edit = function(editor_state, ...editor_options) {
		if (e.editor)
			return true
		if (!e.can_focus_cell(e.focused_row, e.focused_field, true))
			return false
		e.editor = e.create_editor(e.focused_field, ...editor_options)
		if (!e.editor)
			return false
		e.update_cell_editing(e.focused_row_index, e.focused_field_index, true)
		e.editor.on('lost_focus', editor_lost_focus)
		if (e.editor.enter_editor)
			e.editor.enter_editor(editor_state)
		e.editor.focus()
		return true
	}

	e.free_editor = function() {}

	e.exit_edit = function() {
		if (!e.editor)
			return true

		if (e.save_row_on == 'exit_edit')
			e.save(e.focused_row)

		if (e.prevent_exit_edit)
			if (e.focused_td.hasclass('invalid'))
				return false

		let had_focus = e.hasfocus

		let editor = e.editor
		e.editor = null // removing the editor first as a barrier for lost_focus().
		editor.remove()
		e.update_cell_editing(e.focused_row_index, e.focused_field_index, false)

		if (had_focus)
			e.focus()

		return true
	}

	function editor_lost_focus(ev) {
		if (!e.editor) // editor is being removed.
			return
		if (ev.target != e.editor) // other input that bubbled up.
			return
		e.exit_edit()
	}

	e.exit_row = function() {
		/*
		let tr = e.focused_tr
		if (!tr)
			return true
		let td = e.focused_td
		if (e.save_row_on == 'exit_row')
			e.save_row(tr)
		if (e.prevent_exit_row)
			if (tr.hasclass('invalid_values') || tr.hasclass('invalid'))
				return false
		*/
		if (!e.exit_edit())
			return false
		return true
	}

	e.save = function(row) {
		e.rowset.save(row)
	}

	// sorting ----------------------------------------------------------------

	let order_by = new Map()

	e.late_property('order_by',
		function() {
			let a = []
			for (let [field, dir] of order_by) {
				a.push(field.name + (dir == 'asc' ? '' : ' desc'))
			}
			return a.join(', ')
		},
		function(s) {
			order_by = new Map()
			let ea = s.split(/\s*,\s*/)
			for (let e of ea) {
				let m = e.match(/^([^\s]*)\s*(.*)$/)
				let name = m[1]
				let field = e.rowset.field(name)
				if (field && field.sortable) {
					let dir = m[2] || 'asc'
					if (dir == 'asc' || dir == 'desc')
						order_by.set(field, dir)
				}
			}
		}
	)

	e.order_by_priority = function(field) {
		let i = order_by.size-1
		for (let [field1] of order_by) {
			if (field1 == field)
				return i
			i--
		}
	}

	e.order_by_dir = function(field) {
		return order_by.get(field)
	}

	e.toggle_order = function(field, keep_others) {
		if (!field.sortable)
			return
		let dir = order_by.get(field)
		dir = dir == 'asc' ? 'desc' : 'asc'
		if (!keep_others)
			order_by.clear()
		order_by.set(field, dir)
		sort()
	}

	e.clear_order = function() {
		order_by.clear()
		sort()
	}

	function sort() {

		if (!order_by || !order_by.size)
			return

		let cmp = e.rowset.comparator(order_by)
		e.rows.sort(cmp)

		rowmap = null
		e.init_rows()
		e.fire('sort_order_changed')

	}

	// crude quick-search only for the first letter ---------------------------

	let found_row_index
	function quicksearch(c, field, again) {
		if (e.focused_row_index != found_row_index)
			found_row_index = null // user changed selection, start over.
		let ri = found_row_index != null ? found_row_index+1 : 0
		if (ri >= e.rows.length)
			ri = null
		while (ri != null) {
			let s = e.rowset.display_value(e.rows[ri], field)
			if (s.starts(c.lower()) || s.starts(c.upper())) {
				e.focus_cell(ri, true)
				break
			}
			ri++
			if (ri >= e.rows.length)
				ri = null
		}
		found_row_index = ri
		if (found_row_index == null && !again)
			quicksearch(c, field, true)
	}

	e.quicksearch = function(c, field) {
		field = field
			||	e.quicksearch_field
			|| (e.quicksearch_col && e.rowset.field(e.quicksearch_col))
		if (field)
			quicksearch(c, field)
	}

	// picker protocol --------------------------------------------------------

	e.pick_near_value = function(delta) {
		if (e.focus_cell(e.focused_row_index, e.focused_field_index, delta))
			e.fire('value_picked')
	}

}

