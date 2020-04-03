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

    vec4 _read(Tensor tensor, sampler2D tex, vec2 pos, float ch) {
        ch += 0.5;
        float tx = floor(mod(ch, tensor.gridSize.x));
        float ty = floor(ch / tensor.gridSize.x);
        vec2 p = fract(pos/tensor.size) + vec2(tx, ty);
        return _readUV(tensor, tex, p/tensor.gridSize);
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
        //gl_FragColor = vec4(getOutputXY()/u_output.size, getOutputChannel()/u_output.depth4, 1.0);
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
    uniform vec2 u_weightCoefs; // weigthScale, center
    uniform vec2 u_layout;
    
    const float MAX_PACKED_DEPTH = 32.0;
    
    vec4 readWeight(vec2 p) {
        vec4 w = texture2D(u_weightTex, p);
        return (w-u_weightCoefs.y)*u_weightCoefs.x; 
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
          result += inVec.x * readWeight(p); p.y += dy;
          result += inVec.y * readWeight(p); p.y += dy;
          result += inVec.z * readWeight(p); p.y += dy;
          result += inVec.w * readWeight(p); p.y += dy;
          if (i+1.5>u_input.depth4) {
              break;
          }
      }
      result += readWeight(p);  // bias
      setOutput(result);
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
    uniform vec3 u_lastDamage;
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
            vec2 diff = abs(xy-u_lastDamage.xy+0.5);
            diff = min(diff, u_input.size-diff);
            if (length(diff) < u_lastDamage.z) {
                gl_FragColor.rgb *= 0.7;
                gl_FragColor.rgb += vec3(0.3, 0.3, 0.0);
            }
        }
    }`
}


export function createCA(gl, models, gridSize, gui) {
    gridSize = gridSize || [96, 96];
    const [gridW, gridH] = gridSize;

    const params = {
        alignment: 1,
        fuzz: 8.0,
        visMode: 'color'
    };
    gui.add(params, 'fuzz').min(0.0).max(128.0);
    gui.add(params, 'visMode', ['color', 'state', 'perception', 'hidden', 'update']);
    gui.add(params, 'alignment', {cartesian:0, polar:1, bipolar:2});

    function createPrograms(defines) {
        defines = defines || '';
        const res = {};
        for (const name in PROGRAMS) {
            const fs_code = defines + PREFIX + PROGRAMS[name];
            res[name] = twgl.createProgramInfo(gl, [vs_code, fs_code]);
        }
        return res;
    }

    function createTensor(w, h, depth, packScaleBias) {
        packScaleBias = packScaleBias || [MAX_ACTIVATION*2.0, 127.0/255.0];
        const depth4 = Math.ceil(depth / 4);
        const gridW = Math.ceil(Math.sqrt(depth4));
        const gridH = Math.floor((depth4 + gridW - 1) / gridW);
        const texW = w * gridW, texH = h * gridH;

        const attachments = [{ minMag: gl.NEAREST }];
        const fbi = twgl.createFramebufferInfo(gl, attachments, texW, texH);
        const tex = fbi.attachments[0];
        return { _type: 'tensor',
            fbi, w, h, depth, gridW, gridH, depth4, tex, packScaleBias};
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

    function runLayer(programName, output, inputs) {
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
        setTensorUniforms(uniforms, 'u_output', output);

        const program = progs[programName];
        twgl.bindFramebufferInfo(gl, output.fbi);
        gl.useProgram(program.program);
        twgl.setBuffersAndAttributes(gl, program, quad);
        twgl.setUniforms(program, uniforms);
        twgl.drawBufferInfo(gl, quad);
        return {programName, output}
    }

    function createDenseInfo(params) {
        const coefs = [params.scale, 127.0/255.0];
        const tex = twgl.createTexture(gl, {
            minMag: gl.NEAREST, src: params.data, flipY: false, premultiplyAlpha: false,
        });
        const [in_n, out_n] = params.shape;
        return {tex, coefs, layout: params.layout, in_n: in_n-1, out_n};
    }

    let layerTex1 = null;
    let layerTex2 = null;

    function setWeights(models) {
        if (layerTex1) {
            gl.deleteTexture(layerTex1.tex);
            gl.deleteTexture(layerTex2.tex);
        }
        layerTex1 = createDenseInfo(models.layers[0]);
        layerTex2 = createDenseInfo(models.layers[1]);
    }
    setWeights(models);

    const shuffledMode = true;
    const progs = createPrograms(shuffledMode?'#define SPARSE_UPDATE\n':'');
    const quad = twgl.createBufferInfoFromArrays(gl, {
        position: [-1, -1, 0, 1, -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, 1, 0],
    });

    const updateProbability = 0.5;
    const shuffleH = Math.ceil(gridH * updateProbability);
    const shuffleCellN = shuffleH*gridW;
    const totalCellN = gridW*gridH;
    const shuffleBuf = new Uint8Array(shuffleCellN*4);
    const unshuffleBuf = new Uint8Array(totalCellN*4);
    let k=0;
    for (let i=0; i < totalCellN; ++i) {
        if (Math.random()<(shuffleCellN-k)/(totalCellN-i)) {
            shuffleBuf[k*4+0] = i%gridW;
            shuffleBuf[k*4+1] = Math.floor(i/gridW);
            unshuffleBuf[i*4+0] = k%gridW;
            unshuffleBuf[i*4+1] = Math.floor(k/gridW);
            unshuffleBuf[i*4+2] = 255;
            k += 1;
        }
    }
    const shuffleTex = twgl.createTexture(gl, {minMag: gl.NEAREST, width: gridW, height: shuffleH, src: shuffleBuf});
    const unshuffleTex = twgl.createTexture(gl, {minMag: gl.NEAREST, width: gridW, height: gridH, src: unshuffleBuf});

    const updateH = shuffledMode ? shuffleH : gridH;
    
    const perception_n = layerTex1.in_n;
    const hidden_n = layerTex1.out_n;
    const channel_n = layerTex2.out_n;
    const controlBuf = createTensor(gridW, gridH, 4, [255.0, 0.0]);
    let stateBuf = createTensor(gridW, gridH, channel_n);
    let newStateBuf = createTensor(gridW, gridH, channel_n);
    const perceptionBuf = createTensor(gridW, updateH, perception_n);
    const hiddenBuf = createTensor(gridW, updateH, hidden_n, [MAX_ACTIVATION, 0.0]); // relu
    const updateBuf = createTensor(gridW, updateH, channel_n);
    
    let rotationAngle = 0.0;
    function setAngle(v) {
      rotationAngle = v/180.0*Math.PI;
    }

    let shuffleOfs = [0, 0];

    function runDense(output, input, layer) {
        return runLayer('dense', output, {u_input: input, u_control: controlBuf,
            u_weightTex: layer.tex, u_weightCoefs: layer.coefs, u_layout: layer.layout,
            u_shuffleTex: shuffleTex, u_shuffleOfs: shuffleOfs,
            u_seed: Math.random()*1000, u_fuzz: params.fuzz});
    }

    const ops = [
        ()=>{
            shuffleOfs = [Math.floor(Math.random()*gridW), Math.floor(Math.random()*gridH)];
            return runLayer('perception', perceptionBuf, {
                u_input: stateBuf, u_angle: rotationAngle, u_shuffleTex: shuffleTex, u_shuffleOfs: shuffleOfs,
                u_alignment: params.alignment})
        },
        ()=>runDense(hiddenBuf, perceptionBuf, layerTex1),
        ()=>runDense(updateBuf, hiddenBuf, layerTex2),
        ()=>runLayer('update', newStateBuf, {u_input: stateBuf, u_update: updateBuf, 
            u_unshuffleTex: unshuffleTex, u_shuffleOfs: shuffleOfs,
            u_seed: Math.random()*1000, u_updateProbability: updateProbability}),
    ];


    let fpsStartTime;
    let fpsCount = 0;
    let lastFpsCount = '';
    let totalStepCount = 0;
    function fps() {
        return lastFpsCount;
    }
    function getStepCount() {
      return totalStepCount;
    }

    let lastDamage = [0, 0, -1];
    function paint(x, y, r, brush) {
        runLayer('paint', controlBuf, {
            u_pos: [x, y], u_r: r,
            u_brush: [brush, 0, 0, 0],
        });
        // if (brush == 'clear' && r < 1000) {
        //     lastDamage = [x, y, r]; 
        // }
    }
    function reset() {
      //paint(0, 0, 10000, 'clear');
      totalStepCount = 0;
    }
    //reset();
    runLayer('paint', stateBuf, {
        u_pos: [0, 0], u_r: 10000,
        u_brush: [0, 0, 0, 0],
    });

    function step() {
        for (const op of ops) op();
        [stateBuf, newStateBuf] = [newStateBuf, stateBuf]

        totalStepCount += 1;
        fpsCount += 1;
        let time = Date.now();
        if (!fpsStartTime)
            fpsStartTime = time;
        const fpsInterval = 1000;
        if (time-fpsStartTime > fpsInterval) {
            time = Date.now();
            lastFpsCount = (fpsCount * 1000/(time-fpsStartTime)).toFixed(1);
            fpsStartTime = time;
            fpsCount = 0;
        }
    }

    function draw() {
        const visMode = params.visMode;
        gl.useProgram(progs.vis.program);
        twgl.setBuffersAndAttributes(gl, progs.vis, quad);
        const uniforms = {u_raw: 0.0, u_lastDamage: lastDamage}
        lastDamage[2] = Math.max(-0.1, lastDamage[2]-1.0);
        let inputBuf = stateBuf;
        if (visMode != 'color') {
            inputBuf = {stateBuf, perceptionBuf, hiddenBuf, updateBuf}[visMode+'Buf'];
            uniforms.u_raw = 1.0;
        }
        setTensorUniforms(uniforms, 'u_input', inputBuf);
        twgl.setUniforms(progs.vis, uniforms);
        twgl.drawBufferInfo(gl, quad);
    }

    const _flushBuf = new Uint8Array(4);
    function flush(buf) {
        buf = buf || stateBuf;
        // gl.flush/finish don't seem to do anything, so reading a single 
        // pixel from the state buffer to flush the GPU command pipeline
        twgl.bindFramebufferInfo(gl, buf.fbi);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, _flushBuf);
    }

    function benchmark() {
        flush();
        const stepN = 100;
        const start = Date.now();
        for (let i = 0; i < stepN; ++i)
          step();
        flush();
        const total = (Date.now()-start) / stepN;

        let perOpTotal = 0.0;
        const perOp = [];
        for (const op of ops) {
            const start = Date.now();
            let r;
            for (let i = 0; i < stepN; ++i) {
                r = op();
            }
            flush(r.output);
            const dt = (Date.now()-start) / stepN;
            perOpTotal += dt
            perOp.push([r.programName, dt]);
        }
        const petOpStr = perOp.map((p)=>{
            const [programName, dt] = p;
            const percent = 100.0*dt/perOpTotal;
            return `${programName}: ${percent.toFixed(1)}%`;
        }).join(', ');
        return `${(total).toFixed(2)} ms/step, ${(1000.0 / total).toFixed(2)} step/sec\n`+petOpStr+'\n\n';
    }

    return {reset, step, draw, benchmark, setWeights, paint, gridSize, 
      fps, flush, getStepCount, setAngle};
}
