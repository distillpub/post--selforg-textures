/*
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

const MAX_ACTIVATION = 2.0

const vs_code = `
    attribute vec4 position;
    varying vec2 uv;
    void main() {
        uv = position.xy*0.5 + 0.5;
        gl_Position = position;
    }
`

function defInput(name) {
    return `
        uniform Tensor ${name};
        uniform sampler2D ${name}_tex;

        vec4 ${name}_read(vec2 pos, float ch) {return _read(${name}, ${name}_tex, pos, ch);}
        vec4 ${name}_readUV(vec2 uv) {return _readUV(${name}, ${name}_tex, uv);}
    `
}

const PREFIX = `
    precision highp float;

    // "Hash without Sine" by David Hoskins (https://www.shadertoy.com/view/4djSRW)
    float hash13(vec3 p3) {
      p3  = fract(p3 * .1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    vec2 hash23(vec3 p3)
    {
        p3 = fract(p3 * vec3(.1031, .1030, .0973));
        p3 += dot(p3, p3.yzx+33.33);
        return fract((p3.xx+p3.yz)*p3.zy);
    }

    struct Tensor {
        vec2 size;
        vec2 gridSize;
        float depth, depth4;
        vec2 packScaleBias;
    };
    uniform Tensor u_output;
          
    vec4 _readUV(Tensor tensor, sampler2D tex, vec2 uv) {
        vec4 v = texture2D(tex, uv);
        vec2 p = tensor.packScaleBias;
        v = (v-p.y)*p.x;
        return v;
    }
    vec2 _getUV(Tensor tensor, vec2 pos, float ch) {
        ch += 0.5;
        float tx = floor(mod(ch, tensor.gridSize.x));
        float ty = floor(ch / tensor.gridSize.x);
        vec2 p = fract(pos/tensor.size) + vec2(tx, ty);
        p /= tensor.gridSize;
        return p;
    }
    vec4 _read(Tensor tensor, sampler2D tex, vec2 pos, float ch) {
        vec2 p = _getUV(tensor, pos, ch);
        return _readUV(tensor, tex, p);
    }
    vec2 getOutputXY() {
        return mod(gl_FragCoord.xy, u_output.size);
    }
    float getOutputChannel() {
        vec2 xy = floor(gl_FragCoord.xy/u_output.size);
        return xy.y*u_output.gridSize.x+xy.x;
    }

    void setOutput(vec4 v) {
        vec2 p = u_output.packScaleBias;
        v = v/p.x + p.y;
        gl_FragColor = v;
    }

    #ifdef SPARSE_UPDATE
        uniform sampler2D u_shuffleTex, u_unshuffleTex;
        uniform vec2 u_shuffleOfs;
    #endif

    ${defInput('u_input')}
`;

const PROGRAMS = {
    paint: `
    uniform vec2 u_pos;
    uniform float u_r;
    uniform vec4 u_brush;

    void main() {
        vec2 diff = abs(getOutputXY()-u_pos+0.5);
        diff = min(diff, u_output.size-diff);
        if (length(diff)>=u_r) 
          discard;
        setOutput(u_brush);
    }`,
    perception: `
    uniform float u_angle, u_alignment;
    const mat3 sobelX = mat3(-1.0, 0.0, 1.0, -2.0, 0.0, 2.0, -1.0, 0.0, 1.0)/8.0;
    const mat3 sobelY = mat3(-1.0,-2.0,-1.0, 0.0, 0.0, 0.0, 1.0, 2.0, 1.0)/8.0;
    const mat3 gauss = mat3(1.0, 2.0, 1.0, 2.0, 4.0-16.0, 2.0, 1.0, 2.0, 1.0)/8.0;

    mat2 rotate(float ang) {
        float s = sin(ang), c=cos(ang);
        return mat2(c, s, -s, c);
    }

    vec4 conv3x3(vec2 xy, float inputCh, mat3 filter) {
        vec4 a = vec4(0.0);
        for (int y=0; y<3; ++y)
        for (int x=0; x<3; ++x) {
          vec2 p = xy+vec2(float(x-1), float(y-1));
          a += filter[y][x] * u_input_read(p, inputCh);
        }
        return a;
    }

    void main() {
        vec2 xy = getOutputXY();
        #ifdef SPARSE_UPDATE
            xy = texture2D(u_shuffleTex, xy/u_output.size).xy*255.0+0.5 + u_shuffleOfs;
            xy = mod(xy, u_input.size);
        #endif
        float ch = getOutputChannel();
        if (ch >= u_output.depth4)
            return;

        float filterBand = floor((ch+0.5)/u_input.depth4);
        float inputCh = ch-filterBand*u_input.depth4;
        if (filterBand < 0.5) {
            setOutput(u_input_read(xy, inputCh));
        } else if (filterBand < 2.5) {
            vec4 dx = conv3x3(xy, inputCh, sobelX);
            vec4 dy = conv3x3(xy, inputCh, sobelY);
            vec2 dir = vec2(0.0, 1.0);
            if (u_alignment == 1.0) {
                dir = normalize(xy-0.5*u_input.size);
            } else if (u_alignment == 2.0) {
                vec2 v1 = xy-0.25*u_input.size;
                vec2 v2 = 0.75*u_input.size-xy;
                dir = normalize(v1/pow(length(v1), 3.0) +  v2/pow(length(v2), 3.0));
            }
            dir = rotate(u_angle) * dir;
            float s = dir.x, c = dir.y;
            setOutput(filterBand < 1.5 ? dx*c-dy*s : dx*s+dy*c);
        } else {
            setOutput(conv3x3(xy, inputCh, gauss));
        }
    }`,
    dense: `
    ${defInput('u_control')}
    uniform sampler2D u_weightTex;
    uniform float u_seed, u_fuzz;
    uniform vec2 u_weightCoefs; // scale, center
    uniform vec2 u_layout;
    
    const float MAX_PACKED_DEPTH = 32.0;
    
    vec4 readWeightUnscaled(vec2 p) {
        vec4 w = texture2D(u_weightTex, p);
        return w-u_weightCoefs.y;
    }
    
    void main() {
      vec2 xy = getOutputXY();
      float ch = getOutputChannel();
      if (ch >= u_output.depth4)
          return;

      float dy = 1.0/(u_input.depth+1.0)/u_layout.y;
      vec2 p = vec2((ch+0.5)/u_output.depth4, dy*0.5);
      vec2 fuzz = (hash23(vec3(xy, u_seed+ch))-0.5)*u_fuzz;

      vec2 realXY = xy;
      #ifdef SPARSE_UPDATE
        realXY = texture2D(u_shuffleTex, xy/u_output.size).xy*255.0+0.5 + u_shuffleOfs;
      #endif
      p += u_control_read(realXY+fuzz, 0.0).xy;
      p /= u_layout;
      vec4 result = vec4(0.0);
      for (float i=0.0; i < MAX_PACKED_DEPTH; i+=1.0) {
          vec4 inVec = u_input_read(xy, i);
          result += inVec.x * readWeightUnscaled(p); p.y += dy;
          result += inVec.y * readWeightUnscaled(p); p.y += dy;
          result += inVec.z * readWeightUnscaled(p); p.y += dy;
          result += inVec.w * readWeightUnscaled(p); p.y += dy;
          if (i+1.5>u_input.depth4) {
              break;
          }
      }
      result += readWeightUnscaled(p);  // bias
      setOutput(result*u_weightCoefs.x);
    }`,
    update: `
    ${defInput('u_update')}
    uniform float u_seed, u_updateProbability;

    varying vec2 uv;

    void main() {
      vec2 xy = getOutputXY();
      vec4 state = u_input_readUV(uv);
      vec4 update = vec4(0.0);
      #ifdef SPARSE_UPDATE
        vec4 shuffleInfo = texture2D(u_unshuffleTex, fract((xy-u_shuffleOfs)/u_output.size));
        if (shuffleInfo.z > 0.5) {
            update = u_update_read(shuffleInfo.xy*255.0+0.5, getOutputChannel());
        }
      #else
        if (hash13(vec3(xy, u_seed)) <= u_updateProbability) {
            update = u_update_readUV(uv);    
        }
      #endif
      setOutput(state + update);
    }`,
    vis: `
    uniform float u_raw;
    varying vec2 uv;

    void main() {
        vec2 xy = vec2(uv.x, 1.0-uv.y);
        if (u_raw > 0.5) {
            gl_FragColor = texture2D(u_input_tex, xy);
            gl_FragColor.a = 1.0;
        } else {
            xy *= u_input.size;
            vec4 rgba = u_input_read(xy, 0.0);
            gl_FragColor = vec4(rgba.rgb/2.0+0.5, 1.0);  //1.0-rgba.a + rgba;
        }
    }`
}

function createPrograms(gl, defines) {
    defines = defines || '';
    const res = {};
    for (const name in PROGRAMS) {
        const fs_code = defines + PREFIX + PROGRAMS[name];
        const progInfo = twgl.createProgramInfo(gl, [vs_code, fs_code]);
        progInfo.name = name;
        res[name] = progInfo;
    }
    return res;
}

function createTensor(gl, w, h, depth, packScaleBias) {
    packScaleBias = packScaleBias || [MAX_ACTIVATION * 2.0, 127.0 / 255.0];
    const depth4 = Math.ceil(depth / 4);
    const gridW = Math.ceil(Math.sqrt(depth4));
    const gridH = Math.floor((depth4 + gridW - 1) / gridW);
    const texW = w * gridW, texH = h * gridH;

    const attachments = [{ minMag: gl.NEAREST }];
    const fbi = twgl.createFramebufferInfo(gl, attachments, texW, texH);
    const tex = fbi.attachments[0];
    return {
        _type: 'tensor',
        fbi, w, h, depth, gridW, gridH, depth4, tex, packScaleBias
    };
}

function setTensorUniforms(uniforms, name, tensor) {
    uniforms[name + '.size'] = [tensor.w, tensor.h];
    uniforms[name + '.gridSize'] = [tensor.gridW, tensor.gridH];
    uniforms[name + '.depth'] = tensor.depth;
    uniforms[name + '.depth4'] = tensor.depth4;
    uniforms[name + '.packScaleBias'] = tensor.packScaleBias;
    if (name != 'u_output') {
        uniforms[name + '_tex'] = tensor.tex;
    }
}

function createDenseInfo(gl, params) {
    const coefs = [params.scale, 127.0 / 255.0];
    const [in_n, out_n] = params.shape;
    const info = { coefs, layout: params.layout, in_n: in_n - 1, out_n, ready: false };
    info.tex = twgl.createTexture(gl, {
        minMag: gl.NEAREST, src: params.data, flipY: false, premultiplyAlpha: false,
    }, ()=>{
        info.ready = true;
    });
    return info;
}


export class CA {
    constructor(gl, models, gridSize, gui) {
        self = this;
        this.gl = gl;
        this.gridSize = gridSize || [96, 96];

        this.updateProbability = 0.5;
        this.shuffledMode = true;

        this.rotationAngle = 0.0;
        this.alignment = 1;
        this.fuzz = 8.0;
        this.visMode = 'color';
 
        gui.add(this, 'rotationAngle').min(0.0).max(360.0);
        gui.add(this, 'alignment', { cartesian: 0, polar: 1, bipolar: 2 }).listen();
        gui.add(this, 'fuzz').min(0.0).max(128.0);
        gui.add(this, 'visMode', ['color', 'state', 'perception', 'hidden', 'update']);

        this.layerTex1 = null;
        this.layerTex2 = null;
        this.setWeights(models);

        this.progs = createPrograms(gl, this.shuffledMode ? '#define SPARSE_UPDATE\n' : '');
        this.quad = twgl.createBufferInfoFromArrays(gl, {
            position: [-1, -1, 0, 1, -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, 1, 0],
        });

        this.setupBuffers();
        this.setupOps();

        this.clearCircle(0, 0, 10000);
    }

    setupBuffers() {
        const gl = this.gl;
        const [gridW, gridH] = this.gridSize;
        const shuffleH = Math.ceil(gridH * this.updateProbability);
        const shuffleCellN = shuffleH * gridW;
        const totalCellN = gridW * gridH;
        const shuffleBuf = new Uint8Array(shuffleCellN * 4);
        const unshuffleBuf = new Uint8Array(totalCellN * 4);
        let k = 0;
        for (let i = 0; i < totalCellN; ++i) {
            if (Math.random() < (shuffleCellN - k) / (totalCellN - i)) {
                shuffleBuf[k * 4 + 0] = i % gridW;
                shuffleBuf[k * 4 + 1] = Math.floor(i / gridW);
                unshuffleBuf[i * 4 + 0] = k % gridW;
                unshuffleBuf[i * 4 + 1] = Math.floor(k / gridW);
                unshuffleBuf[i * 4 + 2] = 255;
                k += 1;
            }
        }
        this.shuffleTex = twgl.createTexture(gl, { minMag: gl.NEAREST, width: gridW, height: shuffleH, src: shuffleBuf });
        this.unshuffleTex = twgl.createTexture(gl, { minMag: gl.NEAREST, width: gridW, height: gridH, src: unshuffleBuf });
        this.shuffleOfs = [0, 0];

        const updateH = this.shuffledMode ? shuffleH : gridH;
        const perception_n = this.layerTex1.in_n;
        const hidden_n = this.layerTex1.out_n;
        const channel_n = this.layerTex2.out_n;
        this.buf = {
            control: createTensor(gl, gridW, gridH, 4, [255.0, 0.0]),
            state: createTensor(gl, gridW, gridH, channel_n),
            newState: createTensor(gl, gridW, gridH, channel_n),
            perception: createTensor(gl, gridW, updateH, perception_n),
            hidden: createTensor(gl, gridW, updateH, hidden_n, [MAX_ACTIVATION, 0.0]), // relu
            update: createTensor(gl, gridW, updateH, channel_n),
        };
    }

    setupOps() {
        const [gridW, gridH] = this.gridSize;
        this.ops = [
            () => {
                this.shuffleOfs = [Math.floor(Math.random() * gridW), Math.floor(Math.random() * gridH)];
                return this.runLayer(self.progs.perception, this.buf.perception, {
                    u_input: this.buf.state, u_angle: this.rotationAngle / 180.0 * Math.PI,
                    u_alignment: this.alignment
                })
            },
            () => this.runDense(this.buf.hidden, this.buf.perception, this.layerTex1),
            () => this.runDense(this.buf.update, this.buf.hidden, this.layerTex2),
            () => this.runLayer(this.progs.update, this.buf.newState, {
                u_input: this.buf.state, u_update: this.buf.update,
                u_unshuffleTex: this.unshuffleTex,
                u_seed: Math.random() * 1000, u_updateProbability: this.updateProbability
            }),
        ];
    }

    paint(x, y, r, brush) {
        this.runLayer(this.progs.paint, this.buf.control, {
            u_pos: [x, y], u_r: r, u_brush: [brush, 0, 0, 0],
        });
    }

    clearCircle(x, y, r, brush) {
        self.runLayer(self.progs.paint, this.buf.state, {
            u_pos: [x, y], u_r: r, u_brush: [0, 0, 0, 0],
        });
    }

    benchmark() {
        const gl = this.gl;
        const flushBuf = new Uint8Array(4);
        const flush = buf=>{
            buf = buf || this.buf.state;
            // gl.flush/finish don't seem to do anything, so reading a single 
            // pixel from the state buffer to flush the GPU command pipeline
            twgl.bindFramebufferInfo(gl, buf.fbi);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, flushBuf);
        }

        flush();
        const stepN = 100;
        const start = Date.now();
        for (let i = 0; i < stepN; ++i)
            this.step();
        flush();
        const total = (Date.now() - start) / stepN;

        let perOpTotal = 0.0;
        const perOp = [];
        for (const op of this.ops) {
            const start = Date.now();
            let r;
            for (let i = 0; i < stepN; ++i) {
                r = op();
            }
            flush(r.output);
            const dt = (Date.now() - start) / stepN;
            perOpTotal += dt
            perOp.push([r.programName, dt]);
        }
        const petOpStr = perOp.map((p) => {
            const [programName, dt] = p;
            const percent = 100.0 * dt / perOpTotal;
            return `${programName}: ${percent.toFixed(1)}%`;
        }).join(', ');
        return `${(total).toFixed(2)} ms/step, ${(1000.0 / total).toFixed(2)} step/sec\n` + petOpStr + '\n\n';
    }

    setWeights(models) {
        const gl = this.gl;
        if (this.layerTex1) {
            gl.deleteTexture(this.layerTex1.tex);
            gl.deleteTexture(this.layerTex2.tex);
        }
        this.layerTex1 = createDenseInfo(gl, models.layers[0]);
        this.layerTex2 = createDenseInfo(gl, models.layers[1]);
    }

    runLayer(program, output, inputs) {
        const gl = this.gl;
        inputs = inputs || {};
        const uniforms = {};
        for (const name in inputs) {
            const val = inputs[name];
            if (val._type == 'tensor') {
                setTensorUniforms(uniforms, name, val);
            } else {
                uniforms[name] = val;
            }
        }
        uniforms['u_shuffleTex'] = this.shuffleTex;
        uniforms['u_shuffleOfs'] = this.shuffleOfs;
        setTensorUniforms(uniforms, 'u_output', output);

        twgl.bindFramebufferInfo(gl, output.fbi);
        gl.useProgram(program.program);
        twgl.setBuffersAndAttributes(gl, program, this.quad);
        twgl.setUniforms(program, uniforms);
        twgl.drawBufferInfo(gl, this.quad);
        return { programName: program.name, output }
    }

    runDense(output, input, layer) {
        return this.runLayer(this.progs.dense, output, {
            u_input: input, u_control: this.buf.control,
            u_weightTex: layer.tex, u_weightCoefs: layer.coefs, u_layout: layer.layout,
            u_seed: Math.random() * 1000, u_fuzz: this.fuzz
        });
    }

    step() {
        if (!this.layerTex1.ready || !this.layerTex2.ready)
            return;
        for (const op of this.ops) op();
        [this.buf.state, this.buf.newState] = [this.buf.newState, this.buf.state];
    }

    draw() {
        const gl = this.gl;

        gl.useProgram(this.progs.vis.program);
        twgl.setBuffersAndAttributes(gl, this.progs.vis, this.quad);
        const uniforms = { u_raw: 0.0 }
        let inputBuf = this.buf.state;
        if (this.visMode != 'color') {
            inputBuf = this.buf[this.visMode];
            uniforms.u_raw = 1.0;
        }
        setTensorUniforms(uniforms, 'u_input', inputBuf);
        twgl.setUniforms(this.progs.vis, uniforms);
        twgl.drawBufferInfo(gl, this.quad);
    }
}