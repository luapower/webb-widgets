/*

	WebGL 2 renderer for a 3D model editor.
	Written by Cosmin Apreutesei.

	Based on tutorials from learnopengl.com.

*/

(function() {

let gl = WebGL2RenderingContext.prototype

gl.module('mesh.vs', `

	#version 300 es

	precision highp float;
	precision highp int;

	uniform mat4 view;
	uniform mat4 proj;
	uniform mat4 view_proj;
	uniform vec2 viewport_size;

	in mat4 model;
	in vec3 pos;
	in vec3 normal;
	in vec2 uv;

	out vec3 v_pos;
	out vec3 v_normal;
	out vec2 v_uv;

	vec4 mvp_pos() {
		return view_proj * model * vec4(pos, 1.0);
	}

`)

gl.module('mesh.fs', `

	#version 300 es

	precision highp float;
	precision highp int;

	uniform vec3 view_pos;
	uniform vec2 viewport_size;
	uniform vec4 diffuse_color;
	uniform sampler2D diffuse_map;

	in vec3 v_pos;
	in vec3 v_normal;
	in vec2 v_uv;

	layout (location = 0) out vec4 frag_color;

`)

gl.module('phong.vs', `

	#include mesh.vs

	uniform mat4 sdm_view_proj;

	out vec4 v_pos_sdm_view_proj;

	void do_phong() {
		v_pos = vec3(model * vec4(pos, 1.0));
		v_pos_sdm_view_proj = sdm_view_proj * vec4(v_pos, 1.0);
		v_normal = inverse(transpose(mat3(model))) * normal;
		v_uv = uv;
		gl_Position = view_proj * vec4(v_pos, 1.0);
	}

`)

gl.module('phong.fs', `

	#include mesh.fs

	uniform vec3 sunlight_pos;
	uniform vec3 sunlight_color;
	uniform float shininess;
	uniform float ambient_strength;
	uniform float specular_strength;
	uniform bool enable_shadows;
	uniform sampler2D shadow_map;

	in vec4 v_pos_sdm_view_proj;

	void do_phong() {

		float ambient = ambient_strength;

		vec3 normal = normalize(v_normal);
		vec3 light_dir = normalize(sunlight_pos - v_pos);
		float diffuse = max(dot(normal, light_dir), 0.0);

		vec3 view_dir = normalize(view_pos - v_pos);
		vec3 reflect_dir = reflect(-light_dir, normal);
		float specular = specular_strength * pow(max(dot(view_dir, reflect_dir), 0.0), shininess);

		float shadow = 0.0;
		if (enable_shadows) {

			vec3 p = v_pos_sdm_view_proj.xyz / v_pos_sdm_view_proj.w;
			p = p * 0.5 + 0.5;
			float closest_depth = texture(shadow_map, p.xy).r;
			float current_depth = p.z;
			float bias = max(0.05 * (1.0 - dot(normal, light_dir)), 0.000001);

			// PCF: soften the shadow.
			vec2 texel_size = 1.0 / vec2(textureSize(shadow_map, 0));
			for (int x = -1; x <= 1; ++x) {
				 for (int y = -1; y <= 1; ++y) {
					  float pcf_depth = texture(shadow_map, p.xy + vec2(x, y) * texel_size).r;
					  shadow += current_depth - bias > pcf_depth ? 1.0 : 0.0;
				 }
			}
			shadow /= 9.0;
		}

		float light = (ambient + (1.0 - shadow) * (diffuse + specular));

		frag_color = vec4(light * sunlight_color, 1.0) * diffuse_color * texture(diffuse_map, v_uv);

	}

`)

gl.scene_renderer = function(r) {

	let gl = this

	r = r || {}

	r.background_color = r.background_color || v4(1, 1, 1, 1)
	r.sunlight_dir     = r.sunlight_dir || v3(1, 1, 0)
	r.sunlight_color   = r.sunlight_color || v3(1, 1, 1)
	r.diffuse_color    = r.diffuse_color || v4(1, 1, 1, 1)
	r.sdm_proj         = r.sdm_proj || mat4().ortho(-10, 10, -10, 10, -1e4, 1e4)

	let sunlight_view = mat4()
	let sdm_view_proj = mat4()
	let origin = v3.origin
	let up_dir = v3.up
	let sunlight_pos = v3()

	let sdm_prog = gl.program('shadow_map', `
		#version 300 es
		uniform mat4 sdm_view_proj;
		in vec3 pos;
		in mat4 model;
		void main() {
			gl_Position = sdm_view_proj * model * vec4(pos, 1.0);
		}
	`, `
		#version 300 es
		void main() {
			// this is what the GPU does automatically:
			// gl_FragDepth = gl_FragCoord.z;
		}
	`)

	let sdm_tex = gl.texture()
	let sdm_fbo = gl.fbo()

	let sdm_res

	r.update = function() {

		sunlight_pos.set(r.sunlight_dir).set_len(FAR)
		sunlight_view.reset()
			.translate(sunlight_pos)
			.look_at(sunlight_pos, origin, up_dir)
			.invert()

		gl.set_uni('sunlight_pos', sunlight_pos)
		gl.set_uni('sunlight_color', r.sunlight_color)
		gl.set_uni('diffuse_color', r.diffuse_color)

		gl.set_uni('enable_shadows', r.enable_shadows)

		if (r.enable_shadows) {

			mat4.mul(r.sdm_proj, sunlight_view, sdm_view_proj)
			gl.set_uni('sdm_view_proj', sdm_view_proj)

			let sdm_res1 = or(r.shadow_map_resolution, 1024)
			if (sdm_res1 != sdm_res) {
				sdm_res = sdm_res1

				sdm_tex.set_depth(sdm_res, sdm_res, true)

				sdm_fbo.bind()
				sdm_fbo.attach(sdm_tex, 'depth')
				sdm_fbo.unbind()

				gl.set_uni('shadow_map', sdm_tex, 1)

			}

		}

	}

	r.render = function(draw) {

		if (r.enable_shadows) {
			// render depth of scene to sdm texture (from light's perspective).
			sdm_fbo.bind('draw', 'none')
			gl.viewport(0, 0, sdm_res, sdm_res)
			gl.clearDepth(1)
			gl.cullFace(gl.FRONT) // to get rid of peter paning.
			gl.clear(gl.DEPTH_BUFFER_BIT)
			draw(sdm_prog)
			sdm_fbo.unbind()
		}

		// 2. render scene as normal with shadow mapping (using depth map).
		let cw = gl.canvas.cw
		let ch = gl.canvas.ch
		gl.viewport(0, 0, cw, ch)
		gl.clear_all(...r.background_color)
		draw()
	}

	r.update()

	return r
}

// render-based hit testing --------------------------------------------------

gl.face_id_renderer = function(r) {

	let gl = this

	r = r || {}

	let face_id_prog = gl.program('face_id', `

		#include mesh.vs

		in uint face_id;
		in uint inst_id;

		flat out uint v_face_id;
		flat out uint v_inst_id;

		void main() {
			gl_Position = mvp_pos();
			v_face_id = face_id;
			v_inst_id = inst_id;
		}

	`, `

		#version 300 es

		precision highp float;
		precision highp int;

		flat in uint v_face_id;
		flat in uint v_inst_id;

		layout (location = 0) out uint frag_color0;
		layout (location = 1) out uint frag_color1;

		void main() {
			frag_color0 = v_face_id;
			frag_color1 = v_inst_id;
		}

	`)

	let w, h
	let face_id_map = gl.texture()
	let inst_id_map = gl.texture()
	let depth_map = gl.rbo()
	let fbo = gl.fbo()
	let face_id_arr
	let inst_id_arr

	r.render = function(draw) {
		let w1 = gl.canvas.cw
		let h1 = gl.canvas.ch
		if (w1 != w || h1 != h) {
			w = w1
			h = h1
			face_id_map.set_u32(w, h); face_id_arr = new u32arr(w * h)
			inst_id_map.set_u32(w, h); inst_id_arr = new u32arr(w * h)
			depth_map.set_depth(w, h, true)
		}
		fbo.bind('draw', ['color', 'color'])
		fbo.attach(face_id_map, 'color', 0)
		fbo.attach(inst_id_map, 'color', 1)
		fbo.attach(depth_map)
		fbo.clear_color(0, 0xffffffff)
		fbo.clear_color(1, 0xffffffff)
		gl.clear_all()
		draw(face_id_prog)
		fbo.unbind()
		fbo.read_pixels('color', 0, face_id_arr)
		fbo.read_pixels('color', 1, inst_id_arr)
	}

	r.hit_test = function(x, y, out) {
		out.inst_id = null
		out.face_id = null
		if (!face_id_arr)
			return
		if (x < 0 || x >= w || y < 0 || y >= h)
			return
		y = (h-1) - y // textures are read upside down...
		let face_id = face_id_arr[y * w + x]
		let inst_id = inst_id_arr[y * w + x]
		if (face_id == 0xffffffff || inst_id == 0xffffffff)
			return
		out.inst_id = inst_id
		out.face_id = face_id
		return true
	}

	return r

}

// face rendering ------------------------------------------------------------

gl.module('selected_face.vs', `

	in float selected;
	flat out float frag_selected;

	void do_selected_face() {
		frag_selected = selected;
	}

`)

gl.module('selected_face.fs', `

	flat in float frag_selected;

	void do_selected_face() {
		if (frag_selected == 1.0) {
			float x = mod(gl_FragCoord.x, 4.0);
			float y = mod(gl_FragCoord.y, 8.0);
			if ((x >= 0.0 && x <= 1.1 && y >= 0.0 && y <= 0.5) ||
				 (x >= 2.0 && x <= 3.1 && y >= 4.0 && y <= 4.5))
				frag_color = vec4(0.0, 0.0, .8, 1.0);
		}
	}

`)

gl.faces_renderer = function() {
	let gl = this
	let e = {
		ambient_strength: 0.1,
		specular_strength: .2,
		shininess: 5,
		polygon_offset: .0001,
	}

	let face_prog = gl.program('face', `
		#include phong.vs
		#include selected_face.vs
		void main() {
			do_phong();
			do_selected_face();
		}
	`, `
		#include phong.fs
		#include selected_face.fs
		void main() {
			do_phong();
			do_selected_face();
		}
	`)

	let face_vao = face_prog.vao()
	let vao_set = gl.vao_set()

	e.draw = function(prog) {
		if (prog) {
			let vao = vao_set.vao(prog)
			vao.set_attr('pos'     , e.pos)
			vao.set_attr('model'   , e.model)
			vao.set_attr('face_id' , e.face_id)
			vao.set_attr('inst_id' , e.inst_id)
			vao.set_index(e.index)
			vao.use()
		} else {
			face_vao.set_uni ('ambient_strength' , e.ambient_strength)
			face_vao.set_uni ('specular_strength', e.specular_strength)
			face_vao.set_uni ('shininess'        , 1 << e.shininess) // keep this a pow2.
			face_vao.set_uni ('diffuse_map'      , e.diffuse_map)
			face_vao.set_attr('pos'              , e.pos)
			face_vao.set_attr('normal'           , e.normal)
			face_vao.set_attr('uv'               , e.uv)
			face_vao.set_attr('selected'         , e.selected)
			face_vao.set_attr('model'            , e.model)
			face_vao.set_index(e.index)
			face_vao.use()
		}
		gl.polygonOffset(e.polygon_offset, 0)
		gl.draw_triangles()
		gl.polygonOffset(0, 0)
		gl.active_vao.unuse()
	}

	e.free = function() {
		face_vao.free()
		vao_set.free()
	}

	return e
}

// solid line rendering ------------------------------------------------------

gl.solid_line_program = function() {
	return this.program('solid_line', `

		#include mesh.vs

		uniform vec3 base_color;
		uniform float point_size;
		in vec3 color;
		flat out vec4 v_color;

		void main() {
			gl_Position = mvp_pos();
			gl_PointSize = point_size;
			v_color = vec4(base_color + color, 1.0);
		}
	`, `

		#include mesh.fs

		flat in vec4 v_color;

		void main() {
			frag_color = v_color;
		}
	`)
}

// solid point rendering -----------------------------------------------------

gl.solid_point_program = function() {
	return this.solid_line_program()
}

// dashed line rendering -----------------------------------------------------

// works with gl.LINES drawing mode.
gl.dashed_line_program = function() {
	return this.program('dashed_line', `

		#include mesh.vs

		uniform vec3 base_color;
		in vec3 color;
		out vec4 v_p1;
		flat out vec4 v_p2; // because GL_LAST_VERTEX_CONVENTION.
		flat out vec4 v_color;

		void main() {
			vec4 p = mvp_pos();
			v_p1 = p;
			v_p2 = p;
			v_color = vec4(base_color + color, 1.0);
			gl_Position = p;
		}

	`, `

		#include mesh.fs

		uniform float dash;
		uniform float gap;

		in vec4 v_p1;
		flat in vec4 v_p2; // because GL_LAST_VERTEX_CONVENTION.
		flat in vec4 v_color;

		void main() {
			vec2 p1 = (v_p1.xyz / v_p1.w).xy;
			vec2 p2 = (v_p2.xyz / v_p2.w).xy;
			float dist = length((p1 - p2) * viewport_size.xy * 0.5);
			if (fract(dist / (dash + gap)) > dash / (dash + gap))
				discard;
			frag_color = v_color;
		}

	`)
}

// fat lines prop ------------------------------------------------------------

gl.fat_lines = function() {
	let gl = this
	let e = {}

	let fat_line_prog = gl.program('fat_line', `

		#include mesh.vs

		in vec3 q;
		in float dir;

		void main() {

			// line points in NDC.
			vec4 dp = view_proj * vec4(pos, 1.0);
			vec4 dq = view_proj * vec4(q, 1.0);
			dp /= dp.w;
			dq /= dq.w;

			// line normal in screen space.
			float dx = dq.x - dp.x;
			float dy = dq.y - dp.y;
			vec2 n = normalize(vec2(-dy, dx) * dir) / viewport_size * dp.w * 2.0;

			gl_Position = dp + vec4(n, 0.0, 0.0);

		}

	`, `

		#include mesh.fs

		uniform vec3 color;

		void main() {
			frag_color = vec4(color, 1.0);
		}

	`)

	let vao = fat_line_prog.vao()

	let pb = gl.dyn_v3_buffer() // 4 points per line.
	let qb = gl.dyn_v3_buffer() // 4 "other-line-endpoint" points per line.
	let db = gl.dyn_i8_buffer() // one direction sign per vertex.
	let ib = gl.dyn_index_buffer() // 1 quad = 2 triangles = 6 points per line.

	let pa = dyn_f32arr(null, 3)
	let qa = dyn_f32arr(null, 3)
	let da = dyn_i8arr(null, 1)
	let ia = dyn_u8arr(null, 1)

	e.color = v3()

	e.set_points = function(lines) {

		let vertex_count = 4 * lines.length
		let index_count  = 6 * lines.length

		ia.grow_type(vertex_count-1)

		pa.len = vertex_count
		qa.len = vertex_count
		da.len = vertex_count
		ia.len = index_count

		let ps = pa.array
		let qs = qa.array
		let ds = da.array
		let is = ia.array

		let i = 0
		let j = 0
		for (let line of lines) {

			let p1x = line[0][0]
			let p1y = line[0][1]
			let p1z = line[0][2]
			let p2x = line[1][0]
			let p2y = line[1][1]
			let p2z = line[1][2]

			// each line has 4 points: (p1, p1, p2, p2).
			ps[3*(i+0)+0] = p1x
			ps[3*(i+0)+1] = p1y
			ps[3*(i+0)+2] = p1z

			ps[3*(i+1)+0] = p1x
			ps[3*(i+1)+1] = p1y
			ps[3*(i+1)+2] = p1z

			ps[3*(i+2)+0] = p2x
			ps[3*(i+2)+1] = p2y
			ps[3*(i+2)+2] = p2z

			ps[3*(i+3)+0] = p2x
			ps[3*(i+3)+1] = p2y
			ps[3*(i+3)+2] = p2z

			// each point has access to its opposite point, so (p2, p2, p1, p1).
			qs[3*(i+0)+0] = p2x
			qs[3*(i+0)+1] = p2y
			qs[3*(i+0)+2] = p2z

			qs[3*(i+1)+0] = p2x
			qs[3*(i+1)+1] = p2y
			qs[3*(i+1)+2] = p2z

			qs[3*(i+2)+0] = p1x
			qs[3*(i+2)+1] = p1y
			qs[3*(i+2)+2] = p1z

			qs[3*(i+3)+0] = p1x
			qs[3*(i+3)+1] = p1y
			qs[3*(i+3)+2] = p1z

			// each point has an alternating normal direction.
			ds[i+0] =  1
			ds[i+1] = -1
			ds[i+2] = -1
			ds[i+3] =  1

			// each line is made of 2 triangles (0, 1, 2) and (1, 3, 2).
			is[j+0] = i+0
			is[j+1] = i+1
			is[j+2] = i+2
			is[j+3] = i+1
			is[j+4] = i+3
			is[j+5] = i+2

			i += 4
			j += 6
		}

		ib.grow_type(vertex_count-1)

		pb.len = ps.len; pb.buffer.upload(ps)
		qb.len = qs.len; qb.buffer.upload(qs)
		db.len = ds.len; db.buffer.upload(ds)
		ib.len = is.len; ib.buffer.upload(is)

	}

	e.draw = function() {
		vao.use()
		vao.set_uni('color', e.color)
		vao.set_attr('pos', pb.buffer)
		vao.set_attr('q'  , qb.buffer)
		vao.set_attr('dir', db.buffer)
		vao.set_index(ib.buffer)
		gl.draw_triangles()
		vao.unuse()
	}

	e.free = function() {
		vao.free()
		pb.free()
		qb.free()
		db.free()
		ib.free()
	}

	return e
}

// parametric geometry generators --------------------------------------------

{
	let pos_template = new f32arr([
		-.5,  -.5,  -.5,
		 .5,  -.5,  -.5,
		 .5,   .5,  -.5,
		-.5,   .5,  -.5,
		-.5,  -.5,   .5,
		 .5,  -.5,   .5,
		 .5,   .5,   .5,
		-.5,   .5,   .5,
	])

	let triangle_pis = new u8arr([
		3, 2, 1,  1, 0, 3,
		6, 7, 4,  4, 5, 6,
		2, 3, 7,  7, 6, 2,
		1, 5, 4,  4, 0, 1,
		7, 3, 0,  0, 4, 7,
		2, 6, 5,  5, 1, 2,
	])

	triangle_pis.max_index = pos_template.length - 1

	let normal = new f32arr(pos_template.length)

	compute_smooth_mesh_normals({
		points: pos_template,
		triangle_point_indices: triangle_pis,
		normals: normal,
	})

	normal.n_components = 3
	let len = 6 * 3 * 2
	let pos = new f32arr(len * 3)

	gl.box_geometry = function() {

		let pos = new f32arr(pos_template.length)
		pos.n_components = 3

		let e = {
			pos: pos,
			index: triangle_pis,
			normal: normal,
			len: len,
		}

		e.set = function(xd, yd, zd) {
			for (let i = 0; i < len * 3; i += 3) {
				pos[i+0] = pos_template[i+0] * xd
				pos[i+1] = pos_template[i+1] * yd
				pos[i+2] = pos_template[i+2] * zd
			}
			return this
		}

		return e
	}
}

// skybox prop ---------------------------------------------------------------

gl.skybox = function(opt) {

	let gl = this
	let e = {}
	events_mixin(e)

	let prog = gl.program('skybox', `

		#include mesh.vs

		out vec3 v_model_pos;

		void main() {
			v_model_pos = pos.xyz;
			gl_Position = mvp_pos();
		}

	`, `

		#include mesh.fs

		uniform vec3 sky_color;
		uniform vec3 horizon_color;
		uniform vec3 ground_color;
		uniform float exponent;
		uniform bool use_difuse_cube_map;

		uniform samplerCube diffuse_cube_map;

		in vec3 v_model_pos;

		void main() {
			float h = normalize(v_model_pos).y;
			frag_color = vec4(
				mix(
					mix(horizon_color, sky_color * texture(diffuse_cube_map, v_model_pos).xyz, pow(max(h, 0.0), exponent)),
					ground_color,
					1.0-step(0.0, h)
			), 1.0);
		}

	`)

	let geo = gl.box_geometry().set(1, 1, 1)
	let vao = prog.vao()
	let pos_buf = gl.buffer(geo.pos)
	let model = mat4f32().scale(FAR)
	let inst_buf = gl.mat4_instance_buffer(model)
	let index_buf = gl.index_buffer(geo.index)
	vao.set_attr('pos', pos_buf)
	vao.set_attr('model', inst_buf)
	vao.set_index(index_buf)

	let cube_map_tex

	e.update_view = function(view_pos) {
		model.reset().set_position(view_pos).scale(FAR * 2)
		inst_buf.upload(model, 0)
	}

	e.update = function() {

		vao.set_uni('sky_color', e.sky_color || 0xccddff)
		vao.set_uni('horizon_color', e.horizon_color || 0xffffff)
		vao.set_uni('ground_color', e.ground_color || 0xe0dddd)
		vao.set_uni('exponent', or(e.exponent, 1))

		let n_loaded
		let on_load = function() {
			n_loaded++
			if (n_loaded == 6) {
				vao.set_uni('use_difuse_cube_map', true)
				e.fire('load')
			}
		}
		if (e.images && !e.loaded) {
			e.loaded = true
			cube_map_tex = cube_map_tex || gl.texture('cubemap')
			cube_map_tex.set_wrap('clamp', 'clamp')
			cube_map_tex.set_filter('linear', 'linear')
			vao.set_uni('diffuse_cube_map', cube_map_tex)
			vao.set_uni('use_difuse_cube_map', false)
			n_loaded = 0
			for (let side in e.images) {
				let img = e.images[side]
				if (isstr(img))
					cube_map_tex.load(img, 1, on_load, side)
				else
					cube_map_tex.set_image(image, 1, on_load)
			}
		}

	}

	e.draw = function() {
		vao.use()
		gl.draw_triangles()
		vao.unuse()
	}

	assign(e, opt)
	e.update()

	return e
}

// texture quad prop ---------------------------------------------------------

gl.texture_quad = function(tex, imat) {
	let gl = this

	let quad = poly3({mode: 'flat'}, [
		-1, -1, 0,
		 1, -1, 0,
		 1, 1, 0,
		-1, 1, 0
	])

	let uvs = quad.uvs(null, v2(.5, .5))
	let tris = quad.triangulate()
	imat = imat || mat4f32()

	let pos = gl.v3_buffer(quad)
	let uv = gl.v2_buffer(uvs)
	let index = gl.index_buffer(tris)
	let model = gl.mat4_instance_buffer(imat)

	let pr = gl.program('texture_quad_prop', `
		#include mesh.vs
		out vec2 v_uv;
		void main() {
			v_uv = uv;
			gl_Position = mvp_pos();
		}
	`, `
		#include mesh.fs
		in vec2 v_uv;
		void main() {
			frag_color = vec4(vec3(texture(diffuse_map, v_uv).r), 1.0);
		}
	`)

	let vao = pr.vao()
	vao.bind()
	vao.set_attr('pos', pos)
	vao.set_attr('uv', uv)
	vao.set_attr('model', model)
	vao.set_index(index)
	vao.set_uni('diffuse_map', tex)
	vao.unbind()

	quad.draw = function() {
		vao.use()
		gl.draw_triangles()
		vao.unuse()
	}

	quad.free = function() {
		vao.free()
		pos.free()
		index.free()
		uv.free()
		model.free()
	}

	quad.model = imat
	quad.update_model = function() {
		model.update(imat, 0, model.n_components)
	}

	return quad
}

// points renderer -----------------------------------------------------------

gl.points_renderer = function() {
	let gl = this
	let e = {
		base_color: 0x000000,
	}

	let vao = gl.solid_point_program().vao()

	e.draw = function() {
		vao.use()
		vao.set_uni('base_color', e.base_color)
		vao.set_attr('color', e.color)
		vao.set_attr('pos', e.pos)
		vao.set_attr('model', e.model)
		vao.set_index(e.index)
		gl.draw_points()
		vao.unuse()
	}

	return e
}

// axes prop -----------------------------------------------------------------

gl.axes_renderer = function(opt) {
	let gl = this
	let e = assign({
		dash: 1,
		gap: 3,
		x_color: 0x990000,
		y_color: 0x000099,
		z_color: 0x006600,
	}, opt)

	let line_vao = gl.solid_line_program().vao()
	let dash_vao = gl.dashed_line_program().vao()

	let pos_poz = [
		...v3.zero, ...v3(FAR,   0,   0),
		...v3.zero, ...v3(  0, FAR,   0),
		...v3.zero, ...v3(  0,   0, FAR),
	]
	pos_poz = gl.v3_buffer(pos_poz)

	let pos_neg = [
		...v3.zero, ...v3(-FAR,    0,    0),
		...v3.zero, ...v3(   0, -FAR,    0),
		...v3.zero, ...v3(   0,    0, -FAR),
	]
	pos_neg = gl.v3_buffer(pos_neg)

	let color = [
		...v3().from_rgb(e.x_color),
		...v3().from_rgb(e.x_color),
		...v3().from_rgb(e.y_color),
		...v3().from_rgb(e.y_color),
		...v3().from_rgb(e.z_color),
		...v3().from_rgb(e.z_color),
	]
	color = gl.v3_buffer(color)

	let model = gl.dyn_mat4_instance_buffer()

	e.add_instance = function() {
		let i = model.len
		model.len = i+1
		e.upload_model(i, mat4f32())
		line_vao.set_attr('model', model.buffer)
		dash_vao.set_attr('model', model.buffer)
		return i
	}

	e.upload_model = function(i, m) {
		model.buffer.upload(m, i)
	}

	line_vao.set_attr('pos', pos_poz)
	line_vao.set_attr('color', color)

	dash_vao.set_attr('pos', pos_neg)
	dash_vao.set_attr('color', color)

	dash_vao.set_uni('dash', e.dash)
	dash_vao.set_uni('gap' , e.gap)

	e.draw = function() {
		line_vao.use(); gl.draw_lines(); line_vao.unuse()
		dash_vao.use(); gl.draw_lines(); dash_vao.unuse()
	}

	return e
}

})() // module scope.
