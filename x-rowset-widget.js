
// ---------------------------------------------------------------------------
// rowset_widget mixin
// ---------------------------------------------------------------------------

/*
	rowset widgets must implement:
		init_rows()
		update_cell_value(ri, fi, val, old_val, ...set_value_args)
		update_cell_error(ri, fi, err, old_err, ...set_value_args)
		update_cell_focus(ri, [fi])
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
			for (let i = 0; i < e.vrows.length; i++) {
				rowmap.set(e.vrows[i].row, i)
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
			for (let i = 0; i < e.vfields.length; i++) {
				fieldmap.set(e.vfields[i].field, i)
			}
		}
		return fieldmap.get(field)
	}

	// vrows array ------------------------------------------------------------

	e.init_vrows = function() {
		e.vrows = []
		let rows = e.rowset.rows
		for (let i = 0; i < rows.length; i++) {
			let row = rows[i]
			if (!row.removed)
				e.vrows.push({row: row})
		}
	}

	// vfields array ----------------------------------------------------------

	e.init_vfields = function() {
		e.vfields = []
		let i = 0
		if (e.cols) {
			for (let fi of e.cols)
				if (e.rowset.fields[fi].visible != false)
					e.vfields.push({field: e.rowset.fields[fi], index: i++})
		} else
			for (let field of e.rowset.fields)
				if (field.visible != false)
					e.vfields.push({field: field, index: i++})
	}

	// rowset binding ---------------------------------------------------------

	e.bind_rowset = function(on) {
		// structural changes.
		e.rowset.onoff('reload'      , reload     , on)
		e.rowset.onoff('row_added'   , row_added  , on)
		e.rowset.onoff('row_removed' , row_removed, on)
		// cell & cell state changes.
		e.rowset.onoff('input_value_changed'    , input_value_changed    , on)
		e.rowset.onoff('error_changed'          , error_changed          , on)
		e.rowset.onoff('display_values_changed' , display_values_changed , on)
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
		let vrow = e.vrows[ri]
		return e.rowset.remove_row(vrow.row, e, ri, refocus, ...args)
	}

	// responding to structural updates ---------------------------------------

	function reload() {
		e.focused_row_index = null
		e.focused_field_index = null
		e.init_vrows()
		rowmap = null
		e.init_rows()
	}

	function row_added(row, source, ri, focus) {
		let vrow = {row: row}
		if (source == e && ri != null)
			e.vrows.insert(ri, vrow)
		else
			ri = e.vrows.push(vrow)
		rowmap = null
		e.init_rows()
		if (source == e && focus)
			e.focus_cell(ri, true)
	}

	function row_removed(row, source, ri, refocus) {
		e.vrows.remove(e.row_index(row, source == e && ri))
		rowmap = null
		e.init_rows()
		if (source == e && refocus)
			if (!e.focus_cell(ri, true))
				e.focus_cell(ri, true, -0)
	}

	// responding to cell updates ---------------------------------------------

	e.init_cell = function(ri, fi, ...args) {
		let row = e.vrows[ri].row
		let err = e.rowset.cell_state(row, field, 'error')
		e.update_cell_value(ri, fi, ...args)
		e.update_cell_error(ri, fi, err, ...args)
	}

	function input_value_changed(row, field, val, old_val, source, ri, fi, ...args) {
		e.update_cell_value(
			e.row_index  (row  , source == e && ri),
			e.field_index(field, source == e && fi), ...args)
	}

	function error_changed(row, field, err, old_err, source, ri, fi, ...args) {
		e.update_cell_error(
			e.row_index  (row  , source == e && ri),
			e.field_index(field, source == e && fi), ...args)
	}

	function display_values_changed(field) {
		e.init_rows()
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

		e.set_focused_row(ri != null ? e.vrows[ri].row : null, e, ri, fi, ...args)
	}

	e.property('focused_vrow', function() {
		return e.vrows[e.focused_row_index]
	})

	e.property('focused_vfield', function() {
		return e.vfields[e.focused_field_index]
	})

	e.property('focused_field', function() {
		let fi = e.focused_field_index
		return fi ? e.vfields[fi].field : null
	})

	// navigating -------------------------------------------------------------

	e.can_change_value = function(vrow, vfield) {
		return e.can_edit && e.can_change_rows
			&& e.rowset.can_change_value(vrow.row, vfield.field)
	}

	e.can_focus_cell = function(vrow, vfield, for_editing) {
		return (vfield == null || e.can_focus_cells)
			&& e.rowset.can_focus_cell(vrow.row, vfield && vfield.field)
			&& (!for_editing || e.can_change_value(vrow, vfield))
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
		let move_row = rows >= 1
		let move_col = cols >= 1
		let start_ri = ri
		let start_fi = fi

		// the default cell is the first or the last depending on direction.
		ri = or(ri, ri_inc * -1/0)
		fi = or(fi, fi_inc * -1/0)

		// clamp out-of-bound row/col indices.
		ri = clamp(ri, 0, e.vrows.length-1)
		fi = clamp(fi, 0, e.vfields.length-1)

		let last_valid_ri = null
		let last_valid_fi = null
		let last_valid_vrow

		// find the last valid row, stopping after the specified row count.
		while (ri >= 0 && ri < e.vrows.length) {
			let vrow = e.vrows[ri]
			if (e.can_focus_cell(vrow, null, for_editing)) {
				last_valid_ri = ri
				last_valid_vrow = vrow
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

		while (fi >= 0 && fi < e.vfields.length) {
			let vfield = e.vfields[fi]
			if (e.can_focus_cell(last_valid_vrow, vfield, for_editing)) {
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

		if (ri == false) { // false means remove focus only.
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
		let ri = e.value_field ? e.row_index(e.rowset.lookup(e.value_field, v)) : v
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
		if (!e.can_focus_cell(e.focused_vrow, e.focused_vfield, true))
			return false
		let field = e.focused_vfield && e.focused_vfield.field
		e.editor = e.create_editor(field, ...editor_options)
		if (!e.editor)
			return false
		e.editor.on('lost_focus', editor_lost_focus)
		if (e.editor.enter_editor)
			e.editor.enter_editor(editor_state)
		e.editor.focus()
		return true
	}

	e.exit_edit = function() {
		if (!e.editor)
			return true

		if (e.save_row_on == 'exit_edit')
			e.save(e.focused_vrow)

		if (e.prevent_exit_edit)
			if (e.focused_td.hasclass('invalid'))
				return false

		let had_focus = e.hasfocus

		let editor = e.editor
		e.editor = null // removing the editor first as a barrier for lost_focus().
		editor.remove()
		e.init_cell(e.focused_row_index, e.focused_field_index)

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

	e.save = function(vrow) {
		e.rowset.save(vrow && vrow.row)
	}

	// adding & removing rows -------------------------------------------------

	e.remove_focused_row = function(refocus) {
		if (e.focused_row)
			return e.remove_row(e.focused_row_index, refocus)
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
		e.vrows.sort(function(vrow1, vrow2) {
			return cmp(vrow1.row, vrow2.row)
		})

		rowmap = null
		e.init_rows()
		e.fire('sort_order_changed')

	}

}
