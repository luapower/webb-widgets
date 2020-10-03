
// ---------------------------------------------------------------------------
// prop layers
// ---------------------------------------------------------------------------

root_widget = null

function xmodule(opt) {

	let xm = {}
	xmodule = xm // singleton.

	//xmodule_rowsets_mixin(xm)

	let generation = 1

	xm.slots = opt.slots || {} // {name -> {color:, }}
	xm.modules = opt.modules || {} // {name -> {icon:, }}
	xm.layers = {} // {name -> {name:, props: {gid -> {k -> v}}}}
	xm.instances = {} // {gid -> [e1,...]}
	xm.selected_module = null
	xm.selected_slot = null
	xm.active_layers = {} // {'module:slot' -> layer} in override order

	function init() {
		init_prop_layers()
		init_root_widget()
	}

	// init root widget -------------------------------------------------------

	function init_root_widget() {
		if (opt.root_module) {
			root_widget = opt.root_gid
				? component.create(opt.root_gid)
				: widget_placeholder({module: opt.root_module})
			document.body.set(root_widget)
		}
	}

	// init prop layer slots --------------------------------------------------

	function slot_name(s) { assert(s.search(/[:]/) == -1); return s }
	function module_name(s) { assert(s.search(/[_:\d]/) == -1); return s }

	xm.get_active_layer = function(module, slot) {
		return xm.active_layers[module+':'+slot]
	}

	function set_active_layer(module, slot, layer) {
		let s = module_name(module)+':'+slot_name(slot)
		let layer0 = xm.active_layers[s]
		let layer1 = get_layer(layer)
		xm.active_layers[s] = layer1
		return [layer0, layer1]
	}

	function init_prop_layers() {
		for (let t of opt.layers)
			set_active_layer(t.module, t.slot, t.layer)
		document.fire('prop_layer_slots_changed')
	}

	// loading layer prop vals into instances ---------------------------------

	function prop_vals(gid) {
		let pv = {}
		let layer0
		for (let k in xm.active_layers) {
			let layer = xm.active_layers[k]
			if (layer != layer0) {
				update(pv, layer.props[gid])
				layer0 = layer
			}
		}
		delete pv.type
		return pv
	}

	xm.instance_type = function(gid) {
		for (let k in xm.active_layers) {
			let props = xm.active_layers[k].props[gid]
			if (props && props.type)
				return props.type
		}
	}

	xm.init_instance = function(e, opt) {
		let pv
		if (opt.gid === true) {
			assert(e.type)
			assert(opt.module)
			opt.gid = xm.next_gid(opt.module)
			xm.set_val(null, opt.gid, 'type', e.type, null, null, opt.module)
			pv = empty
		} else if (opt.gid) {
			pv = prop_vals(opt.gid)
			opt.module = opt.gid.match(/^[^_\d]+/)[0]
		}
		e.xmodule_noupdate = true
		e.begin_update()
		for (let k in opt)
			e.set_prop(k, opt[k])
		if (e.gid) {
			e.xmodule_generation = generation
			e.__pv0 = {} // save prop vals before overrides.
			for (let k in pv)
				e.__pv0[k] = e.get_prop(k)
			for (let k in pv)
				e.set_prop(k, pv[k])
		}
		e.end_update()
		e.xmodule_noupdate = false
	}

	function update_instance(e) {
		if (e.xmodule_generation == generation)
			return
		e.xmodule_generation = generation
		e.xmodule_noupdate = true
		e.begin_update()
		let pv = prop_vals(e.gid)
		let pv0 = attr(e, '__pv0') // initial vals of overriden props.
		// restore prop vals that are not present in this override.
		for (let k in pv0)
			if (!(k in pv)) {
				e.set_prop(k, pv0[k])
				delete pv0[k]
			}
		// apply this override, saving current vals that were not saved before.
		for (let k in pv) {
			if (!(k in pv0))
				pv0[k] = e.get_prop(k)
			e.set_prop(k, pv[k])
		}
		e.end_update()
		e.xmodule_noupdate = false
	}

	xm.bind_instance = function(e, on) {
		if (on) {
			window[e.gid] = e
			array_attr(xm.instances, e.gid).push(e)
			update_instance(e)
		} else {
			let t = xm.instances[e.gid]
			t.remove_value(e)
			if (!t.length)
				delete xm.instances[e.gid]
			delete window[e.gid]
		}
	}

	document.on('widget_bind', function(e, on) {
		xm.bind_instance(e, on)
		document.fire('widget_tree_changed')
	})

	// saving prop vals into prop layers --------------------------------------

	xm.prop_module_slot_layer = function(e, prop) {
		let attrs = e.get_prop_attrs(prop)
		let slot = xm.selected_slot || attrs.slot || 'base'
		let module = xm.selected_module || attrs.module
		let layer = xm.active_layers[module+':'+slot]
		return [module, slot, layer]
	}

	xm.set_val = function(e, gid, k, v, v0, slot, module, serialize) {
		slot = xm.selected_slot || slot || 'base'
		if (slot == 'none')
			return
		module = xm.selected_module || module
		let layer = xm.active_layers[module+':'+slot]
		if (!layer) {
			print('prop-val-lost', '['+module+':'+slot+']', gid, k, json(v))
			return
		}
		if (serialize)
			v = serialize(k, v)
		let t = attr(layer.props, gid)
		if (t[k] === v) // value already stored.
			return
		layer.modified = true
		let pv0 = e && attr(e, '__pv0')
		if (v === undefined) { // `undefined` signals removal.
			if (k in t) {
				print('prop-val-deleted', '['+module+':'+slot+'='+layer.name+']', gid, k)
				delete t[k]
				if (pv0)
					delete pv0[k] // no need to keep this anymore.
			}
		} else {
			if (pv0 && !(k in pv0)) // save current val if it wasn't saved before.
				pv0[k] = v0
			t[k] = v
			print('prop-val-set', '['+module+':'+slot+'='+layer.name+']', gid, k, json(v))
		}

		// synchronize other instances of this gid.
		let instances = xm.instances[gid] || empty_array
		for (let e1 of instances) {
			if (e1 != e) {
				e1.xmodule_noupdate = true
				let pv0 = attr(e1, '__pv0')

				if (!(k in pv0)) // save current val if it wasn't saved before.
					pv0[k] = e1.get_prop(k)
				e1.set_prop(k, v)
				e1.xmodule_noupdate = false
			}
		}
	}

	document.on('prop_changed', function(e, k, v, v0, slot) {
		if (!e.gid) return
		if (e.xmodule_noupdate) return
		xm.set_val(e, e.gid, k, v, v0, slot, e.module, e.serialize_prop)
	})

	// loading prop layers and assigning to slots -----------------------------

	xm.set_layer = function(module, slot, layer, opt) {
		opt = opt || empty
		generation++
		let [layer0, layer1] = set_active_layer(module, slot, layer)
		if (opt.update_instances !== false) {
			let gids1 = layer1 && layer1.props
			let gids0 = layer0 && layer0.props
			for (let gid in xm.instances)
				if ((gids1 && gids1[gid]) || (gids0 && gids0[gid]))
					for (let e of xm.instances[gid])
						update_instance(e)
			if (module && slot)
				document.fire('prop_layer_slots_changed')
		}
	}

	// gid generation ---------------------------------------------------------

	xm.next_gid = function(module) {
		let ret_gid
		ajax({
			url: 'xmodule-next-gid/'+assert(module),
			method: 'post',
			async: false,
			success: gid => ret_gid = gid,
		})
		return ret_gid
	}

	// loading & saving prop layers -------------------------------------------

	function get_layer(name) {
		let t = xm.layers[name]
		if (!t) {
			ajax({
				url: 'xmodule-layer.json/'+name,
				async: false,
				success: function(props) {
					t = {name: name, props: props}
				},
				fail: function(how, status) {
					assert(how == 'http' && status == 404)
					t = {name: name, props: {}}
				},
			})
			xm.layers[name] = t
		}
		return t
	}

	xm.save = function() {
		for (let name in xm.layers) {
			let t = xm.layers[name]
			if (t.modified && !t.save_request)
				t.save_request = ajax({
					url: 'xmodule-layer.json/'+name,
					upload: json(t.props, null, '\t'),
					done: () => t.save_request = null,
				})
		}
	}

	// gid-based dynamic prop binding -----------------------------------------

	xm.resolve = gid => xm.instances[gid][0]

	xm.nav_editor = function(...options) {
		return widget_select_editor(xm.instances, e => e.isnav, ...options)
	}

	init()

}

// ---------------------------------------------------------------------------
// rowsets nav
// ---------------------------------------------------------------------------

//rowsets_nav = bare_nav({rowset_name: 'rowsets'})
//rowsets_nav.reload()

// ---------------------------------------------------------------------------
// rowset types
// ---------------------------------------------------------------------------

field_types.rowset = {}

field_types.rowset.editor = function(...options) {
	function more() {
		let d = sql_rowset_editor_dialog()
		d.modal()
	}
	return list_dropdown(update({
		nolabel: true,
		rowset_name: 'rowsets',
		val_col: 'name',
		display_col: 'name',
		mode: 'fixed',
		more_action: more,
	}, ...options))
}

// col

field_types.col = {}

/*
field_types.col.editor = function(...options) {
	let rs = rowset({
		fields: [{name: 'name'}],
	})
	let e = list_dropdown(update({
		nolabel: true,
		lookup_rowset: rs,
		mode: 'fixed',
	}, ...options))
	let rs_field = e.nav.rowset.field(this.rowset_col)
	let rs_name = e.nav.rowset.value(e.nav.focused_row, rs_field)
	let rs = rs_name && global_rowset(rs_name)
	if (rs) {
		rs.once('loaded', function() {
			let rows = rs.fields.map(field => [field.name])
			e.lookup_rowset.reset({
				rows: rows,
			})
		})
		rs.load_fields()
	}
	return e
}
*/

// ---------------------------------------------------------------------------
// state toaster
// ---------------------------------------------------------------------------

window.on('load', function() {
	xmodule_state_toaster = toaster({
		timeout: null,
	})
	document.body.add(xmodule_state_toaster)
})

// ---------------------------------------------------------------------------
// prop layers inspector
// ---------------------------------------------------------------------------

component('x-prop-layers-inspector', function(e) {

	e.classes = 'x-inspector'

	grid.construct(e)
	e.cell_h = 22
	e.stay_in_edit_mode = false

	e.can_select_widget = false

	let barrier
	function reset() {
		if (barrier)
			return
		let rows = []
		for (let ms in xmodule.active_layers) {
			let layer_obj = xmodule.active_layers[ms]
			let layer = layer_obj ? layer_obj.name : null
			let [_, module, slot] = ms.match(/([^\:]+)\:(.*)/)
			let slot_obj = xmodule.slots[slot]
			let row = [true, true, true, slot_obj && slot_obj.color || '#fff', module, slot, layer]
			rows.push(row)
		}
		function format_module(module) {
			let m = xmodule.modules[module]
			return m && m.icon ? div({class: 'fa fa-'+m.icon, title: module}) : module
		}
		function format_slot(slot) {
			let s = xmodule.slots[slot]
			return s && s.icon ? div({class: 'fa fa-'+s.icon, title: slot}) : slot
		}
		function format_selected(_, row) {
			let act = e.cell_val(row, e.all_fields.active)
			if (!act) return ''
			let sel_module = e.cell_val(row, e.all_fields.module) == xmodule.selected_module
			let sel_slot   = e.cell_val(row, e.all_fields.slot)   == xmodule.selected_slot
			return div({class: 'fa fa-chevron'+(sel_module && sel_slot ? '-circle' : '')+'-right'})
		}
		function render_eye_icon() {
			return div({class: 'fa fa-eye'})
		}
		e.rowset = {
			fields: [
				{name: 'active'  , type: 'bool', visible: false},
				{name: 'selected', min_w: 24, max_w: 24, type: 'bool', format: format_selected},
				{name: 'visible' , min_w: 24, max_w: 24, type: 'bool', true_text: render_eye_icon},
				{name: 'color'   , min_w: 24, max_w: 24, type: 'color'},
				{name: 'module'  , min_w: 24, max_w: 24, format: format_module, align: 'center'},
				{name: 'slot'    , min_w: 24, max_w: 24, format: format_slot  , align: 'center'},
				{name: 'layer'   , },
			],
			rows: rows,
		}
		e.reset()
	}

	let can_change_val = e.can_change_val
	e.can_change_val = function(row, field) {
		return can_change_val(row, field)
			// TODO: restrict hiding `base` slots?
			//&& (!row || !field || e.cell_val(row, e.all_fields.slot) != 'base'
			//		|| field.name == 'selected' || field.name == 'active')
	}

	e.on('bind', function(on) {
		document.on('prop_layer_slots_changed', reset, on)
		reset()
	})

	function set_layer(row, active) {
		let module  = e.cell_val(row, e.all_fields.module)
		let slot    = e.cell_val(row, e.all_fields.slot)
		let layer   = e.cell_val(row, e.all_fields.layer)
		let visible = e.cell_val(row, e.all_fields.visible)
		let layer_obj = xmodule.layers[layer]
		xmodule.set_layer(module, slot, active && visible ? layer : null)
	}

	function set_selected_module_slot(sel_module, sel_slot) {
		if (barrier)
			return
		barrier = true

		xmodule.selected_module = sel_module
		xmodule.selected_slot   = sel_slot

		e.begin_update()
		let active = true
		for (let row of e.rows) {
			set_layer(row, active)
			let module   = e.cell_val(row, e.all_fields.module)
			let slot     = e.cell_val(row, e.all_fields.slot)
			let selected = e.cell_val(row, e.all_fields.selected)
			e.reset_cell_val(row, e.all_fields.active   , active)
			e.reset_cell_val(row, e.all_fields.selected , selected)
			if (module == sel_module && slot == sel_slot)
				active = false
		}
		e.update({vals: true})
		e.end_update()

		if (e.state_tooltip)
			e.state_tooltip.close()

		if (sel_module && sel_slot) {
			let layer_obj = xmodule.get_active_layer(sel_module, sel_slot)
			let s = sel_module+':'+sel_slot+': '+(layer_obj ? layer_obj.name : 'none')

			e.state_tooltip = xmodule_state_toaster.post(s, 'error')
			e.state_tooltip.close_button = true
			e.state_tooltip.on('closed', function() {
				e.state_tooltip = null
				if (barrier) return
				set_selected_module_slot(null, null)
			})
		}

		barrier = false
	}

	e.on('cell_val_changed_for_selected', function(row, field, val) {
		let sel_module = e.cell_val(row, e.all_fields.module)
		let sel_slot   = e.cell_val(row, e.all_fields.slot)
		set_selected_module_slot(sel_module, sel_slot)
	})

	e.on('cell_val_changed_for_visible', function(row, field, val) {
		if (barrier)
			return
		barrier = true
		let active = e.cell_val(row, e.all_fields.active)
		set_layer(row, active)
		barrier = false
	})

	e.on('cell_val_changed_for_color', function(row, field, val) {
		let slot = e.cell_val(row, e.all_fields.slot)
		xmodule.slots[slot].color = val
		document.fire('selected_widgets_changed')
	})

	e.reset_to_default = function() {
		for (let row of e.rows)
			e.reset_cell_val(row, e.all_fields.visible, true)
		if (e.state_tooltip)
			e.state_tooltip.close()
	}

})

// ---------------------------------------------------------------------------
// nav editor for prop inspector
// ---------------------------------------------------------------------------

function widget_select_editor(widgets_gid_map, filter, ...options) {
	let dd = list_dropdown({
		rowset: {
			fields: [{name: 'gid'}],
		},
		nolabel: true,
		val_col: 'gid',
		display_col: 'gid',
		mode: 'fixed',
	}, ...options)
	function reset_nav() {
		let rows = []
		for (let gid in widgets_gid_map)
			for (let te of widgets_gid_map[gid])
				if (te.can_select_widget && filter(te))
					rows.push([gid])
		dd.picker.rowset.rows = rows
		dd.picker.reset()
	}
	dd.on('bind', function(on) {
		document.on('widget_tree_changed', reset_nav, on)
	})
	reset_nav()
	return dd
}

field_types.nav = {}
field_types.nav.editor = function(...args) {
	return xmodule.nav_editor(...args)
}

// ---------------------------------------------------------------------------
// property inspector
// ---------------------------------------------------------------------------

component('x-prop-inspector', function(e) {

	e.classes = 'x-inspector'

	grid.construct(e)
	e.cell_h = 22

	e.can_add_rows = false
	e.can_remove_rows = false

	e.can_select_widget = false

	e.vertical = true

	e.exit_edit_on_lost_focus = false
	e.can_sort_rows = false
	e.enable_context_menu = false
	e.focus_cell_on_click_header = true

	// prevent getting out of edit mode.
	e.auto_edit_first_cell = true
	e.enter_edit_on_click = true
	e.exit_edit_on_escape = false
	e.exit_edit_on_enter = false
	e.stay_in_edit_mode = true

	e.empty_text = 'No widgets selected or focused'

	e.on('bind', function(on) {
		document.on('selected_widgets_changed', selected_widgets_changed, on)
		document.on('prop_changed', prop_changed, on)
		document.on('focusin', focus_changed, on)
		if (on)
			reset()
	})

	e.on('cell_val_changed', function(row, field, val, ev) {
		if (!ev)
			return // from reset()
		for (let te of widgets)
			te.set_prop(field.name, val)
	})

	function selected_widgets_changed() {
		reset()
	}

	let barrier
	function focus_changed() {
		if (barrier) return
		if (selected_widgets.size)
			return
		let fe = focused_widget()
		if (!fe || !fe.can_select_widget)
			return
		barrier = true
		reset()
		barrier = false
	}

	function prop_changed(te, k, v) {
		if (!widgets.has(te))
			return
		let field = e.all_fields[k]
		if (!field)
			return
		if (e.editor && e.focused_field == field)
			return
		e.focus_cell(0, e.field_index(field), 0, 0, {
			// NOTE: override these options because if we're in updating mode,
			// editor_state = 'toggle' from the last time would be applied,
			// which would result in an infinte loop.
			enter_edit: true,
			editor_state: 'select_all',
		})
		e.reset_val(e.focused_row, field, v)
	}

	/*
	e.on('exit_edit', function(ri, fi) {
		let field = e.fields[fi]
		e.reset_cell_val(e.rows[ri], field, e.widget[field.name])
	})
	*/

	let widgets, prop_colors

	function reset() {

		widgets = selected_widgets
		if (!selected_widgets.size && focused_widget() && !up_widget_which(focused_widget(), e => !e.can_select_widget))
			widgets = new Set([focused_widget()])

		let i = 0
		for (let te of widgets) // for debugging...
			window['$'+i++] = te

		let rs = {}
		rs.fields = []
		let row = []
		rs.rows = []

		let prop_counts = {}
		let defs = {}
		let pv0 = {}
		let pv1 = {}
		prop_colors = {}

		for (let te of widgets)
			for (let prop in te.props)
				if (widgets.size == 1 || !te.props[prop].unique) {
					prop_counts[prop] = (prop_counts[prop] || 0) + 1
					defs[prop] = te.get_prop_attrs(prop)
					let v1 = te.serialize_prop(prop, te[prop], true)
					let v0 = te.serialize_prop(prop, defs[prop].default, true)
					pv0[prop] = prop in pv0 && pv0[prop] !== v0 ? undefined : v0
					pv1[prop] = prop in pv1 && pv1[prop] !== v1 ? undefined : v1
					let [module, slot, layer] = xmodule.prop_module_slot_layer(te, prop)
					let sl = xmodule.slots[slot]
					prop_colors[prop] = sl && sl.color || '#f0f'
				}

		for (let prop in prop_counts)
			if (prop_counts[prop] == widgets.size) {
				rs.fields.push(update({}, defs[prop], {convert: null}))
				row.push(repl(pv0[prop], undefined, null))
			}

		if (row.length)
			rs.rows.push(row)

		e.rowset = rs
		e.reset()

		if (e.all_rows.length) {
			let row = e.all_rows[0]
			for (let field of e.all_fields)
				e.set_cell_val(row, field, pv1[field.name])
		}

		e.title_text = ([...widgets].map(e => e.type + (e.gid ? ' ' + e.gid : ''))).join(' ')

		e.fire('prop_inspector_changed')
	}

	let inh_do_update_cell_val = e.do_update_cell_val
	e.do_update_cell_val = function(cell, row, field, input_val) {
		inh_do_update_cell_val(cell, row, field, input_val)
		let color = prop_colors[field.name]
		let hcell = e.header.at[field.index]
		hcell.style['border-right'] = '4px solid'+color
	}

	// prevent unselecting all widgets by default on document.pointerdown.
	e.on('pointerdown', function(ev) {
		ev.stopPropagation()
	})

})

// ---------------------------------------------------------------------------
// widget tree
// ---------------------------------------------------------------------------

component('x-widget-tree', function(e) {

	e.classes = 'x-inspector'

	grid.construct(e)
	e.cell_h = 22

	function widget_tree_rows() {
		let rows = []
		function add_widget(e, pe) {
			if (!e) return
			rows.push([e, pe, e.type, e.gid, e.id])
			if (e.child_widgets)
				for (let ce of e.child_widgets())
					add_widget(ce, e)
		}
		add_widget(root_widget)
		return rows
	}

	let type_icons = {
		grid: 'table',
		cssgrid: 'th',
		split: 'columns',
		pagelist: 'sitemap',
	}
	function type_icon(type) {
		let icon = type_icons[type]
		return icon ? div({class: 'fa fa-'+icon}) : type
	}

	let rs = {
		fields: [
			{name: 'widget'       , visible: false},
			{name: 'parent_widget', visible: false},
			{name: 'type' , w: 30, format: type_icon},
			{name: 'gid'  , },
			{name: 'id'   , },
		],
		rows: widget_tree_rows(),
		pk: 'widget',
		parent_col: 'parent_widget',
	}

	e.rowset = rs
	e.cols = 'type gid'
	e.tree_col = 'gid'

	e.can_select_widget = false
	e.header_visible = false
	e.can_focus_cells = false
	e.can_change_rows = false
	e.auto_focus_first_cell = false
	e.can_select_non_siblings = false

	function get_widget() {
		return e.focused_row && e.focused_row[0]
	}
	function set_widget(widget) {
		let row = e.lookup(e.all_fields[0], widget)
		let ri = e.row_index(row)
		e.focus_cell(ri, 0)
	}
	e.property('widget', get_widget, set_widget)

	let barrier

	e.on('selected_rows_changed', function() {
		if (barrier) return
		barrier = true
		let to_unselect = new Set(selected_widgets)
		for (let [row] of e.selected_rows) {
			let ce = row[0]
			ce.set_widget_selected(true, false, false)
			to_unselect.delete(ce)
		}
		for (let ce of to_unselect)
			ce.set_widget_selected(false, false, false)
		document.fire('selected_widgets_changed')
		barrier = false
	})

	function select_widgets(widgets) {
		let rows = new Map()
		for (let ce of widgets) {
			let row = e.lookup(e.all_fields[0], ce)
			rows.set(row, true)
		}
		let focused_widget = [...widgets].pop()
		let row = e.lookup(e.all_fields[0], focused_widget)
		let ri = e.row_index(row)
		e.focus_cell(ri, null, 0, 0, {
			selected_rows: rows,
			must_not_move_row: true,
			unfocus_if_not_found: true,
			dont_select_widgets: true,
		})
	}

	function selected_widgets_changed() {
		if (barrier) return
		barrier = true
		select_widgets(selected_widgets)
		barrier = false
	}

	function widget_tree_changed() {
		rs.rows = widget_tree_rows()
		e.reset()
	}

	/* TODO: not sure what to do here...
	function focus_changed() {
		if (selected_widgets.size)
			return
		let fe = focused_widget()
		if (!fe || !fe.can_select_widget)
			return
		//select_widgets(new Set([fe]))
	}
	*/

	e.on('bind', function(on) {
		document.on('widget_tree_changed', widget_tree_changed, on)
		document.on('selected_widgets_changed', selected_widgets_changed, on)
		//document.on('focusin', focus_changed, on)
	})

})

// ---------------------------------------------------------------------------
// sql rowset editor
// ---------------------------------------------------------------------------

sql_rowset_editor = component('x-sql-rowset-editor', function(e) {



})

// ---------------------------------------------------------------------------
// sql schema editor
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// globals list
// ---------------------------------------------------------------------------

function globals_list() {

}

// ---------------------------------------------------------------------------
// toolboxes
// ---------------------------------------------------------------------------

let dev_toolbox_props = {
	text: {slot: 'none'},
}

function prop_layers_toolbox(tb_opt, insp_opt) {
	let pg = prop_layers_inspector(update({
			gid: 'dev_prop_layers_inspector',
		}, insp_opt))
	let tb = toolbox(update({
			gid: 'dev_prop_layers_toolbox',
			text: 'property layers',
			props: dev_toolbox_props,
			content: pg,
			can_select_widget: false,
		}, tb_opt))
	tb.inspector = pg
	return tb
}

function props_toolbox(tb_opt, insp_opt) {
	let pg = prop_inspector(update({
			gid: 'dev_prop_inspector',
		}, insp_opt))
	let tb = toolbox(update({
			gid: 'dev_props_toolbox',
			text: 'properties',
			props: dev_toolbox_props,
			content: pg,
			can_select_widget: false,
		}, tb_opt))
	tb.inspector = pg
	pg.on('prop_inspector_changed', function() {
		tb.text = pg.title_text + ' properties'
	})
	return tb
}

function widget_tree_toolbox(tb_opt, wt_opt) {
	let wt = widget_tree(update({
			gid: 'dev_widget_tree',
		}, wt_opt))
	let tb = toolbox(update({
			gid: 'dev_widget_tree_toolbox',
			text: 'widget tree',
			props: dev_toolbox_props,
			content: wt,
			can_select_widget: false,
		}, tb_opt))
	tb.tree = wt
	return tb
}

prop_layers_tb = null
props_tb = null
tree_tb = null

function show_toolboxes(on) {

	if (on == 'toggle')
		on = !prop_layers_tb

	if (on !== false) {
		prop_layers_tb = prop_layers_toolbox({
			popup_y: 2, w: 262, h: 225,
		})
		prop_layers_tb.show(true, true)

		props_tb = props_toolbox({
			popup_y: 230, w: 262, h: 397,
		}, {header_w: 80})
		props_tb.show(true, true)

		tree_tb = widget_tree_toolbox({
			popup_y: 630, w: 262, h: 311,
		})
		tree_tb.show(true, true)
	} else {

		prop_layers_tb.inspector.reset_to_default()

		prop_layers_tb.remove()
		props_tb.remove()
		tree_tb.remove()

		prop_layers_tb = null
		props_tb = null
		tree_tb = null
	}
}

// ---------------------------------------------------------------------------
// dialogs
// ---------------------------------------------------------------------------

function sql_rowset_editor_dialog() {
	let ed = sql_rowset_editor()
	let d = dialog({
		text: 'SQL Rowset Editor',
		content: ed,
		footer: '',
	})
	d.editor = ed
	return d
}

// ---------------------------------------------------------------------------
// global key bindings
// ---------------------------------------------------------------------------

document.on('keydown', function(key, shift, ctrl) {
	if (key == 's' && ctrl) {
		xmodule.save()
		return false
	}
})

document.on('keydown', function(key) {
	if (key == 'F9')
		show_toolboxes('toggle')
})

