/* Misfits — WebGL2 fluid: <misfits-mist> (hero mist you can push) and <misfits-ink-logo> (logo that spills into ink and reforms). */
(function () {
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h || w; return [c, c.getContext('2d', { willReadFrequently: true })]; };

  const VS = `#version 300 es
precision highp float;
in vec2 aPos; uniform vec2 texel;
out vec2 vUv, vL, vR, vT, vB;
void main(){ vUv=aPos*.5+.5; vL=vUv-vec2(texel.x,0.); vR=vUv+vec2(texel.x,0.); vT=vUv+vec2(0.,texel.y); vB=vUv-vec2(0.,texel.y); gl_Position=vec4(aPos,0.,1.); }`;
  const H = `#version 300 es
precision highp float; precision highp sampler2D;
in vec2 vUv, vL, vR, vT, vB; out vec4 o;
`;
  const FS = {
    splat: H + `uniform sampler2D uTarget; uniform float aspect, radius, alphaAmt; uniform vec3 color; uniform vec2 point;
void main(){ vec2 p=vUv-point; p.x*=aspect; float g=exp(-dot(p,p)/radius); o=texture(uTarget,vUv)+vec4(color*g, alphaAmt*g); }`,
    advect: H + `uniform sampler2D uVelocity, uSource; uniform vec2 simTexel; uniform float dt, dissipation;
void main(){ vec2 c=vUv-dt*texture(uVelocity,vUv).xy*simTexel; o=texture(uSource,c)/(1.+dissipation*dt); }`,
    divergence: H + `uniform sampler2D uVelocity;
void main(){ float L=texture(uVelocity,vL).x, R=texture(uVelocity,vR).x, T=texture(uVelocity,vT).y, B=texture(uVelocity,vB).y; vec2 C=texture(uVelocity,vUv).xy;
 if(vL.x<0.)L=-C.x; if(vR.x>1.)R=-C.x; if(vT.y>1.)T=-C.y; if(vB.y<0.)B=-C.y; o=vec4(.5*(R-L+T-B),0.,0.,1.); }`,
    curl: H + `uniform sampler2D uVelocity;
void main(){ float L=texture(uVelocity,vL).y, R=texture(uVelocity,vR).y, T=texture(uVelocity,vT).x, B=texture(uVelocity,vB).x; o=vec4(.5*(R-L-T+B),0.,0.,1.); }`,
    vorticity: H + `uniform sampler2D uVelocity, uCurl; uniform float curl, dt;
void main(){ float L=texture(uCurl,vL).x, R=texture(uCurl,vR).x, T=texture(uCurl,vT).x, B=texture(uCurl,vB).x, C=texture(uCurl,vUv).x;
 vec2 f=.5*vec2(abs(T)-abs(B), abs(R)-abs(L)); f/=length(f)+1e-4; f*=curl*C; f.y*=-1.;
 vec2 v=texture(uVelocity,vUv).xy+f*dt; o=vec4(clamp(v,-1000.,1000.),0.,1.); }`,
    pressure: H + `uniform sampler2D uPressure, uDivergence;
void main(){ float L=texture(uPressure,vL).x, R=texture(uPressure,vR).x, T=texture(uPressure,vT).x, B=texture(uPressure,vB).x; float d=texture(uDivergence,vUv).x; o=vec4((L+R+B+T-d)*.25,0.,0.,1.); }`,
    gradient: H + `uniform sampler2D uPressure, uVelocity;
void main(){ float L=texture(uPressure,vL).x, R=texture(uPressure,vR).x, T=texture(uPressure,vT).x, B=texture(uPressure,vB).x; vec2 v=texture(uVelocity,vUv).xy-vec2(R-L,T-B); o=vec4(v,0.,1.); }`,
    scale: H + `uniform sampler2D uTexture; uniform float value; void main(){ o=value*texture(uTexture,vUv); }`,
    seed: H + `uniform sampler2D uTarget, uImg; uniform vec4 rect; uniform float strength;
void main(){ vec2 q=(vUv-rect.xy)/rect.zw; vec4 base=texture(uTarget,vUv);
 if(q.x<0.||q.y<0.||q.x>1.||q.y>1.){ o=base; return; }
 vec4 im=texture(uImg, vec2(q.x,1.-q.y));
 float a=im.a*(1.-smoothstep(.86,.97,min(im.r,min(im.g,im.b))))*strength;
 o=base+vec4(im.rgb*a, a); }`,
    mist: H + `uniform sampler2D uTexture; uniform vec3 tint; uniform float gain, cap;
void main(){ float a=clamp(texture(uTexture,vUv).a*gain,0.,cap); a=a*a*(3.-2.*a); o=vec4(tint*a,a); }`,
    ink: H + `uniform sampler2D uTexture;
void main(){ vec4 d=texture(uTexture,vUv); float a=clamp(d.a,0.,1.); vec3 c=d.rgb/max(d.a,1e-3); o=vec4(clamp(c,0.,1.)*a,a); }`
  };

  class Fluid {
    constructor(canvas, opt) {
      this.opt = Object.assign({ sim: 128, dye: 512, curl: 20, iters: 18, velDiss: 0.2, dyeDiss: 0.3, pressure: 0.8 }, opt);
      const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
      if (!gl || !gl.getExtension('EXT_color_buffer_float')) { this.ok = false; return; }
      this.ok = true; this.gl = gl; this.canvas = canvas;
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(0);
      const vs = this.sh(gl.VERTEX_SHADER, VS);
      this.p = {};
      for (const k in FS) this.p[k] = this.prog(vs, this.sh(gl.FRAGMENT_SHADER, FS[k]));
      this.alloc();
    }
    sh(type, src) {
      const gl = this.gl, s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    }
    prog(vs, fs) {
      const gl = this.gl, p = gl.createProgram();
      gl.attachShader(p, vs); gl.attachShader(p, fs);
      gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
      const u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
      return { p, u };
    }
    res(r) {
      const w = this.canvas.width, h = this.canvas.height;
      let a = w / h; if (a < 1) a = 1 / a;
      const mx = Math.round(r * a), mn = Math.round(r);
      return w > h ? [mx, mn] : [mn, mx];
    }
    fbo(w, h) {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      return { t, f, w, h, tx: [1 / w, 1 / h], bind(i) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); return i; } };
    }
    dbl(w, h) {
      let a = this.fbo(w, h), b = this.fbo(w, h);
      return { get read() { return a; }, get write() { return b; }, swap() { const t = a; a = b; b = t; }, w, h, tx: a.tx };
    }
    alloc() {
      const [sw, sh] = this.res(this.opt.sim), [dw, dh] = this.res(this.opt.dye);
      this.vel = this.dbl(sw, sh); this.dye = this.dbl(dw, dh);
      this.prs = this.dbl(sw, sh); this.div = this.fbo(sw, sh); this.crl = this.fbo(sw, sh);
    }
    use(name, texel) {
      const gl = this.gl, pr = this.p[name];
      gl.useProgram(pr.p);
      if (texel && pr.u.texel) gl.uniform2f(pr.u.texel, texel[0], texel[1]);
      return pr.u;
    }
    blit(target) {
      const gl = this.gl;
      if (target) { gl.viewport(0, 0, target.w, target.h); gl.bindFramebuffer(gl.FRAMEBUFFER, target.f); }
      else { gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
    splat(x, y, dx, dy, rgb, radius, alpha) {
      const gl = this.gl, asp = this.canvas.width / this.canvas.height;
      let u = this.use('splat', this.vel.tx);
      gl.uniform1i(u.uTarget, this.vel.read.bind(0));
      gl.uniform1f(u.aspect, asp); gl.uniform2f(u.point, x, y);
      gl.uniform3f(u.color, dx, dy, 0); gl.uniform1f(u.radius, radius); gl.uniform1f(u.alphaAmt, 0);
      this.blit(this.vel.write); this.vel.swap();
      if (!rgb) return;
      u = this.use('splat', this.dye.tx);
      gl.uniform1i(u.uTarget, this.dye.read.bind(0));
      gl.uniform1f(u.aspect, asp); gl.uniform2f(u.point, x, y);
      gl.uniform3f(u.color, rgb[0] * alpha, rgb[1] * alpha, rgb[2] * alpha);
      gl.uniform1f(u.radius, radius); gl.uniform1f(u.alphaAmt, alpha);
      this.blit(this.dye.write); this.dye.swap();
    }
    seed(tex, rect, strength) {
      const gl = this.gl, u = this.use('seed', this.dye.tx);
      gl.uniform1i(u.uTarget, this.dye.read.bind(0));
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u.uImg, 1);
      gl.uniform4f(u.rect, rect[0], rect[1], rect[2], rect[3]); gl.uniform1f(u.strength, strength);
      this.blit(this.dye.write); this.dye.swap();
    }
    step(dt) {
      const gl = this.gl, o = this.opt, v = this.vel, tx = v.tx;
      gl.disable(gl.BLEND);
      let u = this.use('curl', tx); gl.uniform1i(u.uVelocity, v.read.bind(0)); this.blit(this.crl);
      u = this.use('vorticity', tx); gl.uniform1i(u.uVelocity, v.read.bind(0)); gl.uniform1i(u.uCurl, this.crl.bind(1));
      gl.uniform1f(u.curl, o.curl); gl.uniform1f(u.dt, dt); this.blit(v.write); v.swap();
      u = this.use('divergence', tx); gl.uniform1i(u.uVelocity, v.read.bind(0)); this.blit(this.div);
      u = this.use('scale', tx); gl.uniform1i(u.uTexture, this.prs.read.bind(0)); gl.uniform1f(u.value, o.pressure);
      this.blit(this.prs.write); this.prs.swap();
      u = this.use('pressure', tx); gl.uniform1i(u.uDivergence, this.div.bind(0));
      for (let i = 0; i < o.iters; i++) { gl.uniform1i(u.uPressure, this.prs.read.bind(1)); this.blit(this.prs.write); this.prs.swap(); }
      u = this.use('gradient', tx); gl.uniform1i(u.uPressure, this.prs.read.bind(0)); gl.uniform1i(u.uVelocity, v.read.bind(1));
      this.blit(v.write); v.swap();
      u = this.use('advect', tx); gl.uniform2f(u.simTexel, tx[0], tx[1]); gl.uniform1f(u.dt, dt);
      gl.uniform1i(u.uVelocity, v.read.bind(0)); gl.uniform1i(u.uSource, v.read.bind(0)); gl.uniform1f(u.dissipation, o.velDiss);
      this.blit(v.write); v.swap();
      gl.uniform1i(u.uVelocity, v.read.bind(0)); gl.uniform1i(u.uSource, this.dye.read.bind(1)); gl.uniform1f(u.dissipation, o.dyeDiss);
      this.blit(this.dye.write); this.dye.swap();
    }
    draw(mode, params) {
      const gl = this.gl, u = this.use(mode);
      gl.uniform1i(u.uTexture, this.dye.read.bind(0));
      if (mode === 'mist') { gl.uniform3f(u.tint, ...params.tint); gl.uniform1f(u.gain, params.gain); gl.uniform1f(u.cap, params.cap); }
      this.blit(null);
    }
    clear() {
      const gl = this.gl;
      for (const f of [this.dye.read, this.dye.write, this.vel.read, this.vel.write, this.prs.read, this.prs.write]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, f.f); gl.viewport(0, 0, f.w, f.h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  /* ---------------- hero mist ---------------- */
  class Mist extends HTMLElement {
    connectedCallback() {
      if (this._c) { this.waitInit(); return; }
      Object.assign(this.style, { display: 'block', position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
      const fade = 'linear-gradient(180deg,#000 0%,#000 36%,transparent 58%)';
      this.style.webkitMaskImage = fade; this.style.maskImage = fade;
      const c = this._c = document.createElement('canvas');
      Object.assign(c.style, { width: '100%', height: '100%', display: 'block' });
      this.appendChild(c);
      if (reduced()) return;
      this.waitInit();
      const ro = new ResizeObserver(() => {
        if (!this.f || !this.f.ok || this.clientWidth < 8) return;
        const w = this._c.width; this.size();
        if (Math.abs(w - this._c.width) > 40) this.f.alloc();
      });
      ro.observe(this);
    }
    waitInit() {
      if (this.f || this._waiting || reduced()) return;
      this._waiting = true;
      const check = () => {
        if (this.f) { this._waiting = false; return; }
        if (!this._waiting) return;
        if (this.isConnected && this.clientWidth > 8 && this.clientHeight > 8) { this._waiting = false; this.init(); return; }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
      const tick = () => { if (this.f) return; check(); setTimeout(tick, 300); };
      setTimeout(tick, 300);
    }
    init() {
      const c = this._c;
      this.size();
      this.f = new Fluid(c, { sim: 112, dye: 384, curl: 16, velDiss: 0.35, dyeDiss: 0.32, iters: 16 });
      if (!this.f.ok) return;
      this.setAttribute('data-live', '');
      this.em = [0, 1, 2, 3].map(i => ({ ph: i * 1.7, sp: 0.05 + i * 0.017, y: 0.58 + i * 0.08 }));
      this.t = 0; this.last = null; this.vis = true;
      new IntersectionObserver(e => { this.vis = e[0].isIntersecting; }).observe(this);
      this._mv = e => this.move(e);
      window.addEventListener('pointermove', this._mv, { passive: true });
      for (let i = 0; i < 150; i++) this.tick(1 / 60);
      let prev = performance.now();
      const loop = now => {
        if (!this.isConnected) return;
        requestAnimationFrame(loop);
        const dt = Math.min((now - prev) / 1000, 1 / 30); prev = now;
        if (!this.vis || document.hidden) return;
        this.tick(dt);
        this.f.draw('mist', { tint: [0.92, 0.94, 0.93], gain: 1.15, cap: 0.82 });
      };
      requestAnimationFrame(loop);
    }
    disconnectedCallback() { window.removeEventListener('pointermove', this._mv); }
    size() {
      const s = Math.min(window.devicePixelRatio || 1, 1.5) * 0.6;
      this._c.width = Math.max(64, Math.round(this.clientWidth * s));
      this._c.height = Math.max(64, Math.round(this.clientHeight * s));
    }
    move(e) {
      const r = this.getBoundingClientRect();
      if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) { this.last = null; return; }
      const x = (e.clientX - r.left) / r.width, y = 1 - (e.clientY - r.top) / r.height;
      if (this.last) {
        const dx = x - this.last[0], dy = y - this.last[1];
        if (Math.abs(dx) + Math.abs(dy) > 0.0004) this.f.splat(x, y, dx * 5200, dy * 5200, [1, 1, 1], 0.0032, 0.035);
      }
      this.last = [x, y];
    }
    tick(dt) {
      this.t += dt;
      for (const m of this.em) {
        const x = 0.5 + 0.56 * Math.sin(this.t * m.sp + m.ph);
        const y = m.y + 0.05 * Math.sin(this.t * m.sp * 2.3 + m.ph * 2);
        const wind = 22 + 10 * Math.sin(this.t * 0.2 + m.ph);
        this.f.splat(x, y, wind, 5 * Math.sin(this.t * 0.7 + m.ph * 3), [1, 1, 1], 0.006, 0.042 * dt * 60);
      }
      if (Math.random() < dt * 1.6) {
        this.f.splat(Math.random(), 0.55 + Math.random() * 0.35, (Math.random() - 0.5) * 140, (Math.random() - 0.3) * 70, null, 0.004, 0);
      }
      this.f.step(dt);
    }
  }

  /* ---------------- ink logo ---------------- */
  class Ink extends HTMLElement {
    static get observedAttributes() { return ['src']; }
    attributeChangedCallback(n, o, v) {
      if (!this.img || !v || o === v) return;
      if (this.img.getAttribute('src') === v) return;
      this.img.src = v;
    }
    connectedCallback() {
      if (this.img) return;
      Object.assign(this.style, { display: 'block', position: 'relative', width: '100%', pointerEvents: 'auto', cursor: 'pointer' });
      const img = this.img = document.createElement('img');
      img.alt = 'Misfits parrot';
      img.src = this.getAttribute('src') || 'assets/parrot.png';
      Object.assign(img.style, {
        width: '100%', display: 'block', position: 'relative',
        filter: 'drop-shadow(0 22px 26px rgba(6,10,8,.6))',
        transition: 'opacity .9s ease, transform 1.1s cubic-bezier(.2,.8,.2,1)'
      });
      this.appendChild(img);
      if (reduced()) return;
      const c = this._c = document.createElement('canvas');
      Object.assign(c.style, { position: 'absolute', left: '-50%', top: '-50%', width: '200%', height: '200%', pointerEvents: 'none', zIndex: '1' });
      this.appendChild(c);
      const go = () => {
        if (this.f) return;
        const s = Math.min(window.devicePixelRatio || 1, 1.5);
        c.width = Math.max(128, Math.round(this.clientWidth * 2 * s));
        c.height = Math.max(128, Math.round((this.clientHeight || this.clientWidth) * 2 * s));
        this.f = new Fluid(c, { sim: 96, dye: 512, curl: 34, velDiss: 0.6, dyeDiss: 0.08, iters: 18 });
        if (!this.f.ok) return;
        const gl = this.f.gl;
        this.tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        this.setAttribute('data-live', '');
        this.addEventListener('pointerenter', () => this.spill());
        this.addEventListener('click', () => this.spill());
        setTimeout(() => this.spill(), 1100);
      };
      const ready = () => img.complete && img.naturalWidth > 0 && this.clientWidth > 8;
      const tryGo = () => { if (ready()) go(); };
      img.addEventListener('load', tryGo);
      new ResizeObserver(tryGo).observe(this);
      requestAnimationFrame(tryGo);
    }
    spill() {
      if (!this.f || !this.f.ok || this.busy) return;
      this.busy = true;
      const f = this.f, now = performance.now();
      f.clear();
      f.opt.dyeDiss = 0.08;
      f.seed(this.tex, [0.25, 0.25, 0.5, 0.5], 1.0);
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2, r = 0.05 + Math.random() * 0.2;
        const x = 0.5 + Math.cos(a) * r, y = 0.5 + Math.sin(a) * r;
        const s = 90 + Math.random() * 160;
        f.splat(x, y, Math.cos(a + 1.2) * s, Math.sin(a + 1.2) * s + 30, null, 0.0028, 0);
      }
      f.splat(0.5, 0.42, 0, 120, null, 0.02, 0);
      this.img.style.transition = 'opacity .22s ease, transform .5s ease';
      this.img.style.opacity = '0';
      this.img.style.transform = 'scale(.9) rotate(-3deg)';
      this.t0 = now; this.back = false;
      clearTimeout(this._safeA); clearTimeout(this._safeB);
      this._safeA = setTimeout(() => {
        if (this.back) return;
        this.back = true; f.opt.dyeDiss = 2.6;
        this.img.style.transition = 'opacity 1s ease, transform 1.2s cubic-bezier(.2,.8,.2,1)';
        this.img.style.opacity = '1'; this.img.style.transform = 'none';
      }, 1600);
      this._safeB = setTimeout(() => {
        if (!this.running && !this.busy) return;
        this.running = false; this.busy = false;
        try { f.clear(); } catch (e) {}
      }, 3800);
      if (!this.running) { this.running = true; let prev = now; const loop = t => {
        const dt = Math.min((t - prev) / 1000, 1 / 30); prev = t;
        const el = t - this.t0;
        if (el > 1500 && !this.back) {
          this.back = true; f.opt.dyeDiss = 2.6;
          this.img.style.transition = 'opacity 1s ease, transform 1.2s cubic-bezier(.2,.8,.2,1)';
          this.img.style.opacity = '1'; this.img.style.transform = 'none';
        }
        f.step(dt); f.draw('ink');
        if (el < 3200 && this.running) requestAnimationFrame(loop);
        else if (this.running) { f.clear(); this.running = false; setTimeout(() => { this.busy = false; }, 900); }
      }; requestAnimationFrame(loop); }
    }
  }

  /* ---------------- WebGL particles: embers (rise, flee the cursor) / stars (twinkle, glow near cursor) ---------------- */
  class Particles extends HTMLElement {
    connectedCallback() {
      if (this._c) { this.wait(); return; }
      Object.assign(this.style, { display: 'block', position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
      const c = this._c = document.createElement('canvas');
      Object.assign(c.style, { width: '100%', height: '100%', display: 'block' });
      this.appendChild(c);
      if (reduced()) return;
      this.wait();
    }
    wait() {
      if (this.gl || this._w || reduced()) return; this._w = true;
      const chk = () => {
        if (this.gl) return;
        if (this.isConnected && this.clientWidth > 8 && this.clientHeight > 8) { this._w = false; this.init(); return; }
        setTimeout(chk, 250);
      };
      chk();
    }
    init() {
      const c = this._c, gl = c.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
      if (!gl) return; this.gl = gl;
      const vs = 'attribute vec2 p; attribute float s; attribute float a; uniform vec2 res; varying float va;' +
        'void main(){ vec2 q=p/res*2.-1.; gl_Position=vec4(q.x,-q.y,0.,1.); gl_PointSize=s; va=a; }';
      const fs = 'precision mediump float; varying float va; uniform vec3 col;' +
        'void main(){ float r=length(gl_PointCoord-.5); float g=smoothstep(.5,0.,r); g*=g; gl_FragColor=vec4(col*g*va,g*va); }';
      const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); return o; };
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(pr); gl.useProgram(pr);
      this.u = { res: gl.getUniformLocation(pr, 'res'), col: gl.getUniformLocation(pr, 'col') };
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      const lp = gl.getAttribLocation(pr, 'p'), ls = gl.getAttribLocation(pr, 's'), la = gl.getAttribLocation(pr, 'a');
      gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(ls); gl.vertexAttribPointer(ls, 1, gl.FLOAT, false, 16, 8);
      gl.enableVertexAttribArray(la); gl.vertexAttribPointer(la, 1, gl.FLOAT, false, 16, 12);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      this.mode = this.getAttribute('mode') || 'embers';
      const col = this.mode === 'embers' ? [1.0, 0.58, 0.2] : this.mode === 'snow' ? [0.92, 0.95, 1.0] : [0.96, 0.93, 0.84];
      gl.uniform3f(this.u.col, col[0], col[1], col[2]);
      this.size();
      const N = this.mode === 'stars' ? 240 : this.mode === 'snow' ? 260 : 150;
      this.P = []; for (let i = 0; i < N; i++) this.P.push(this.spawn(true));
      this.data = new Float32Array(N * 4);
      this.mouse = { x: -9999, y: -9999 };
      this._pm = e => { const r = this.getBoundingClientRect(); this.mouse.x = (e.clientX - r.left) * this.dpr; this.mouse.y = (e.clientY - r.top) * this.dpr; };
      window.addEventListener('pointermove', this._pm, { passive: true });
      new ResizeObserver(() => this.size()).observe(this);
      this.vis = true;
      new IntersectionObserver(e => { this.vis = e[0].isIntersecting; }).observe(this);
      let prev = performance.now();
      const loop = (t) => {
        if (!this.isConnected) return;
        requestAnimationFrame(loop);
        const dt = Math.min((t - prev) / 1000, 1 / 20); prev = t;
        if (this.vis && !document.hidden) this.step(dt, t / 1000);
      };
      requestAnimationFrame(loop);
    }
    disconnectedCallback() { if (this._pm) window.removeEventListener('pointermove', this._pm); }
    size() {
      this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      this._c.width = Math.max(2, Math.round(this.clientWidth * this.dpr));
      this._c.height = Math.max(2, Math.round(this.clientHeight * this.dpr));
      if (this.gl) { this.gl.viewport(0, 0, this._c.width, this._c.height); this.gl.uniform2f(this.u.res, this._c.width, this._c.height); }
    }
    spawn(any) {
      const W = this._c.width, H = this._c.height, d = this.dpr || 1;
      if (this.mode === 'stars') return { x: Math.random() * W, y: Math.random() * H, s: (0.8 + Math.random() * 2.2) * d, ph: Math.random() * 6.3, w: 0.6 + Math.random() * 2 };
      if (this.mode === 'snow') { const z = Math.random(); return { x: Math.random() * W, y: any ? Math.random() * H : -10, vx: 0, vy: (14 + z * 40) * d, z, s: (0.7 + z * 2.4) * d, ph: Math.random() * 6.3, w: 0.4 + Math.random() * 1.2 }; }
      return {
        x: Math.random() * W, y: any ? Math.random() * H : H + 10,
        vx: (Math.random() - 0.5) * 10 * d, vy: -(18 + Math.random() * 50) * d,
        s: (1.6 + Math.random() * 3.4) * d, ph: Math.random() * 6.3, w: 1 + Math.random() * 2,
        life: any ? Math.random() : 1, decay: 0.08 + Math.random() * 0.18
      };
    }
    step(dt, t) {
      const gl = this.gl, P = this.P, D = this.data, m = this.mouse, d = this.dpr, R = 150 * d;
      for (let i = 0; i < P.length; i++) {
        let q = P[i];
        const dx = q.x - m.x, dy = q.y - m.y, dist = Math.hypot(dx, dy);
        let a, s = q.s;
        if (this.mode === 'snow') {
          q.vx += Math.sin(t * q.w + q.ph) * 10 * d * dt;
          if (dist < R && dist > 0.1) { const k = 1 - dist / R; q.vx += dx / dist * k * 420 * d * dt; q.vy += dy / dist * k * 220 * d * dt; }
          q.vx *= 0.96; q.vy += ((14 + q.z * 40) * d - q.vy) * 0.03;
          q.x += q.vx * dt; q.y += q.vy * dt;
          if (q.y > this._c.height + 10 || q.x < -20 || q.x > this._c.width + 20) { P[i] = q = this.spawn(false); }
          a = 0.25 + q.z * 0.6;
        } else if (this.mode === 'stars') {
          a = 0.3 + 0.35 * Math.sin(t * q.w + q.ph);
          if (dist < R) { const k = 1 - dist / R; a += k * 0.9; s *= 1 + k * 1.8; }
        } else {
          q.vx += Math.sin(t * q.w + q.ph) * 6 * d * dt;
          if (dist < R && dist > 0.1) { const k = 1 - dist / R; q.vx += dx / dist * k * 280 * d * dt; q.vy += dy / dist * k * 280 * d * dt; }
          q.vx *= 0.985; q.vy = q.vy * 0.995 - 2 * d * dt;
          q.x += q.vx * dt; q.y += q.vy * dt; q.life -= q.decay * dt;
          if (q.life <= 0 || q.y < -20) { P[i] = q = this.spawn(false); }
          a = Math.min(1, q.life * 1.6) * (0.55 + 0.45 * Math.sin(t * q.w * 3 + q.ph));
          s *= 0.6 + q.life * 0.6;
        }
        D[i * 4] = q.x; D[i * 4 + 1] = q.y; D[i * 4 + 2] = s * 3.2; D[i * 4 + 3] = Math.max(0, a);
      }
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bufferData(gl.ARRAY_BUFFER, D, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.POINTS, 0, P.length);
    }
  }

  /* ---------------- 2.5D depth photo: parallax from an estimated depth map, dolly-push toward a door ---------------- */
  class DepthPhoto extends HTMLElement {
    static get observedAttributes() { return ['src', 'pos', 'door']; }
    attributeChangedCallback(n, o, v) {
      if (!this.gl || !v || v === o || v.indexOf('{{') >= 0) return;
      if (n === 'src') this.load(v); else this.uniformsFromAttrs();
    }
    connectedCallback() {
      if (this._c) return;
      Object.assign(this.style, { display: 'block', position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
      const c = this._c = document.createElement('canvas');
      Object.assign(c.style, { width: '100%', height: '100%', display: 'block', opacity: '0', transition: this.hasAttribute('instant') ? 'none' : 'opacity .7s ease' });
      this.appendChild(c);
      this.m = { x: 0, y: 0, tx: 0, ty: 0 };
      this.push = parseFloat(this.getAttribute('push') || '0') || 0;
      this.anim = null;
      if (reduced()) return;
      const chk = () => {
        if (this.gl || !this.isConnected) return;
        if (this.clientWidth > 8 && this.clientHeight > 8) { this.init(); return; }
        setTimeout(chk, 200);
      };
      chk();
    }
    disconnectedCallback() { this._dead = true; if (this._pm) window.removeEventListener('pointermove', this._pm); if (this._or) window.removeEventListener('deviceorientation', this._or); }
    pushTo(to, ms) { this.anim = { from: this.push, to, start: performance.now(), dur: Math.max(1, ms || 600) }; }
    init() {
      const gl = this._c.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
      if (!gl) return;
      this.gl = gl;
      const vs = 'attribute vec2 a; varying vec2 v; void main(){ v=vec2(a.x*.5+.5,.5-a.y*.5); gl_Position=vec4(a,0.,1.); }';
      const fs = [
        'precision highp float; varying vec2 v;',
        'uniform sampler2D uImg, uDepth; uniform vec2 uRes, uImgRes, uPos, uOff, uDoor; uniform float uPush;',
        'vec2 cover(vec2 p){ float rs=uRes.x/uRes.y, ri=uImgRes.x/uImgRes.y; vec2 sc = rs>ri ? vec2(1., ri/rs) : vec2(rs/ri, 1.); sc*=.93; return uPos*(1.-sc)+p*sc; }',
        'void main(){',
        '  vec2 p=v; float d0=texture2D(uDepth, cover(p)).r;',
        '  float z=1.+uPush*(1.1+d0*2.6); p=uDoor+(p-uDoor)/z;',
        '  vec2 uv=cover(p); float d=texture2D(uDepth, uv).r;',
        '  uv+=(d-.42)*uOff; uv=clamp(uv,.002,.998);',
        '  gl_FragColor=texture2D(uImg, uv);',
        '}'
      ].join('\n');
      const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(o)); return o; };
      const pr = this.pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(pr); gl.useProgram(pr);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const la = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(la); gl.vertexAttribPointer(la, 2, gl.FLOAT, false, 0, 0);
      const U = this.U = {};
      ['uImg', 'uDepth', 'uRes', 'uImgRes', 'uPos', 'uOff', 'uDoor', 'uPush'].forEach(n => { U[n] = gl.getUniformLocation(pr, n); });
      const mk = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
      this.tImg = mk(); this.tDepth = mk();
      gl.uniform1i(U.uImg, 0); gl.uniform1i(U.uDepth, 1);
      this.uniformsFromAttrs();
      this.size();
      new ResizeObserver(() => this.size()).observe(this);
      this._pm = e => { this.m.tx = e.clientX / (window.innerWidth || 1) - 0.5; this.m.ty = e.clientY / (window.innerHeight || 1) - 0.5; };
      window.addEventListener('pointermove', this._pm, { passive: true });
      this._or = e => { if (e.gamma == null) return; this.m.tx = Math.max(-0.5, Math.min(0.5, e.gamma / 50)); this.m.ty = Math.max(-0.5, Math.min(0.5, (e.beta - 45) / 60)); };
      window.addEventListener('deviceorientation', this._or, { passive: true });
      this.vis = true;
      new IntersectionObserver(e => { this.vis = e[0].isIntersecting; }).observe(this);
      const src = this.getAttribute('src');
      if (src && src.indexOf('{{') < 0) this.load(src);
      const loop = () => {
        if (this._dead) return;
        requestAnimationFrame(loop);
        if (this.vis && !document.hidden) this.draw();
      };
      requestAnimationFrame(loop);
    }
    uniformsFromAttrs() {
      if (!this.gl) return;
      const pct = (s, dx, dy) => { const p = (s || '').split(/\s+/).map(x => parseFloat(x)); return [isNaN(p[0]) ? dx : p[0] / 100, isNaN(p[1]) ? dy : p[1] / 100]; };
      this.posV = pct(this.getAttribute('pos'), 0.5, 0.5);
      this.doorV = pct(this.getAttribute('door'), 0.5, 0.6);
    }
    size() {
      const d = Math.min(window.devicePixelRatio || 1, 1.5);
      this._c.width = Math.max(2, Math.round(this.clientWidth * d));
      this._c.height = Math.max(2, Math.round(this.clientHeight * d));
      if (this.gl) { this.gl.viewport(0, 0, this._c.width, this._c.height); this.draw(); }
    }
    load(src) {
      const img = new Image();
      img.onload = () => {
        if (!this.gl) return;
        const gl = this.gl;
        this.iw = img.naturalWidth; this.ih = img.naturalHeight;
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tImg);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        const W = 180, H = Math.max(2, Math.round(W * img.naturalHeight / img.naturalWidth));
        const [cc, x] = cv(W, H); x.drawImage(img, 0, 0, W, H);
        const px = x.getImageData(0, 0, W, H).data;
        let D = new Float32Array(W * H);
        for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
          const i = (yy * W + xx) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b), bright = (r + g + b) / 765, sat = mx ? (mx - mn) / mx : 0;
          const fy = yy / H;
          let d = Math.pow(fy, 1.3);
          const sky = ((b > r + 12 && b >= g - 4 && bright > 0.42) || (bright > 0.8 && sat < 0.2)) && fy < 0.62;
          if (sky) d *= 0.08;
          D[yy * W + xx] = 0.12 + 0.88 * d;
        }
        const blur = (src, horiz, R) => {
          const out = new Float32Array(src.length);
          for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
            let s = 0, n = 0;
            for (let k = -R; k <= R; k++) {
              const X = horiz ? Math.min(W - 1, Math.max(0, xx + k)) : xx, Y = horiz ? yy : Math.min(H - 1, Math.max(0, yy + k));
              s += src[Y * W + X]; n++;
            }
            out[yy * W + xx] = s / n;
          }
          return out;
        };
        for (let pass = 0; pass < 2; pass++) { D = blur(D, true, 4); D = blur(D, false, 4); }
        const out = x.createImageData(W, H);
        for (let i = 0; i < W * H; i++) { const v = Math.round(D[i] * 255); out.data[i * 4] = v; out.data[i * 4 + 1] = v; out.data[i * 4 + 2] = v; out.data[i * 4 + 3] = 255; }
        x.putImageData(out, 0, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tDepth);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cc);
        this.loaded = true;
        this.draw();
        this._c.style.opacity = '1';
        this.setAttribute('data-live', '');
      };
      img.src = src;
    }
    draw() {
      if (!this.loaded) return;
      const gl = this.gl, U = this.U, now = performance.now();
      if (this.anim) {
        const a = this.anim, t = Math.min(1, (now - a.start) / a.dur), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        this.push = a.from + (a.to - a.from) * e;
        if (t >= 1) this.anim = null;
      }
      const m = this.m; m.x += (m.tx - m.x) * 0.06; m.y += (m.ty - m.y) * 0.06;
      const sway = Math.sin(now / 1000 * 0.35) * 0.006;
      gl.useProgram(this.pr);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tImg);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tDepth);
      gl.uniform2f(U.uRes, this._c.width, this._c.height);
      gl.uniform2f(U.uImgRes, this.iw, this.ih);
      gl.uniform2f(U.uPos, this.posV[0], this.posV[1]);
      gl.uniform2f(U.uDoor, this.doorV[0], this.doorV[1]);
      gl.uniform2f(U.uOff, -m.x * 0.05 + sway, -m.y * 0.03);
      gl.uniform1f(U.uPush, this.push);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  if (!customElements.get('misfits-depth-photo')) customElements.define('misfits-depth-photo', DepthPhoto);
  if (!customElements.get('misfits-particles')) customElements.define('misfits-particles', Particles);
  if (!customElements.get('misfits-mist')) customElements.define('misfits-mist', Mist);
  if (!customElements.get('misfits-ink-logo')) customElements.define('misfits-ink-logo', Ink);
})();
