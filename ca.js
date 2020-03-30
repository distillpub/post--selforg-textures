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

const CHANNEL_N = 16;
const MAX_ACTIVATION_VALUE = 4.0;

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
    precision mediump float;

    // "Hash without Sine" by David Hoskins (https://www.shadertoy.com/view/4djSRW)
    float hash13(vec3 p3) {
      p3  = fract(p3 * .1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
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
        vec2 p = fract(pos/tensor.size);
        ch += 0.5;
        float tx = floor(mod(ch, tensor.gridSize.x));
        float ty = floor(ch / tensor.gridSize.x);
        p += vec2(tx, ty);
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
    }

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
    ${defInput('u_control')}
    uniform float u_angle;
    const mat3 sobel = mat3(-1.0, 0.0, 1.0, -2.0, 0.0, 2.0, -1.0, 0.0, 1.0)/8.0;

    mat2 rotate(float ang) {
        float s = sin(ang), c=cos(ang);
        return mat2(c, s, -s, c);
    }

    void main() {
        vec2 xy = getOutputXY();
        float ch = getOutputChannel();
        float filterBand = floor(ch/u_input.depth4);
        float inputCh = mod(ch, u_input.depth4);
        if (filterBand == 0.0) {
            setOutput(u_input_read(xy, inputCh));
        } else {
          vec4 dx = vec4(0.0), dy = vec4(0.0);
          for (int y=0; y<3; ++y)
          for (int x=0; x<3; ++x) {
            vec2 p = xy+vec2(float(x-1), float(y-1));
            vec4 a = u_input_read(p, inputCh);
            dx += sobel[y][x]*a;
            dy += sobel[x][y]*a;
          }
          //vec2 dir = u_control_read(xy, 0.0).zw;
          vec2 dir = normalize(xy-vec2(96.0, 96.0));
          dir = rotate(u_angle) * dir;
          float s = dir.x, c = dir.y;
          //float ang = u_angle;
          //float s = sin(ang), c = cos(ang);
          setOutput(filterBand == 1.0 ? dx*c-dy*s : dx*s+dy*c);
        }
    }`,
    dense: `
    ${defInput('u_control')}
    uniform sampler2D u_weightTex;
    uniform vec2 u_weightCoefs; // weigthScale, center
    
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
    
      float dy = 1.0/(u_input.depth+1.0);
      vec2 p = vec2((ch+0.5)/u_output.depth4, dy*0.5);
      p += u_control_read(xy, 0.0).xy;
      p /= vec2(3.0, 1.0);
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
      vec4 update = u_update_readUV(uv);
      update *= float(hash13(vec3(xy, u_seed)) <= u_updateProbability);
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
            gl_FragColor = vec4(rgba.rgb/2.0+0.5, 1.0);//1.0-rgba.a + rgba;
            vec2 diff = abs(xy-u_lastDamage.xy+0.5);
            diff = min(diff, u_input.size-diff);
            if (length(diff) < u_lastDamage.z) {
                gl_FragColor.rgb *= 0.7;
                gl_FragColor.rgb += vec3(0.3, 0.3, 0.0);
            }
        }
    }`
}


export function createCA(gl, models, gridSize) {
    gridSize = gridSize || [96, 96];
    const [gridW, gridH] = gridSize;

    function createPrograms() {
        const res = {};
        for (const name in PROGRAMS) {
            const fs_code = PREFIX + PROGRAMS[name];
            res[name] = twgl.createProgramInfo(gl, [vs_code, fs_code]);
        }
        return res;
    }

    function createTensor(h, w, depth, activation) {
        const depth4 = Math.ceil(depth / 4);
        const gridW = Math.ceil(Math.sqrt(depth4));
        const gridH = Math.floor((depth4 + gridW - 1) / gridW);
        const texW = w * gridW, texH = h * gridH;

        const attachments = [{ minMag: gl.NEAREST }];
        const fbi = twgl.createFramebufferInfo(gl, attachments, texW, texH);
        const tex = fbi.attachments[0];
        let packScaleBias = [4.0, 127.0/255.0];
        if (activation == 'relu') {
            packScaleBias = [2.0, 0.0];
        }
        return { _type: 'tensor',
            fbi, w, h, depth, gridW, gridH, depth4, tex,
            activation, packScaleBias};
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
        //const [in_ch, out_ch] = params.shape;
        const coefs = [params.scale, 127.0/255.0];
        const tex = twgl.createTexture(gl, {
            minMag: gl.NEAREST, src: params.data, flipY: false, premultiplyAlpha: false,
        });
        return {tex, coefs};
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


    const progs = createPrograms();
    const quad = twgl.createBufferInfoFromArrays(gl, {
        position: [-1, -1, 0, 1, -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, 1, 0],
    });
    

    let stateBuf = createTensor(gridW, gridH, CHANNEL_N);
    let newStateBuf = createTensor(gridW, gridH, CHANNEL_N);
    const controlBuf = createTensor(gridW, gridH, 4);
    const perceptionBuf = createTensor(gridW, gridH, CHANNEL_N*3);
    const hiddenBuf = createTensor(gridW, gridH, 128, 'relu');
    const updateBuf = createTensor(gridW, gridH, CHANNEL_N);
    
    let rotationAngle = 0.0;
    function setAngle(v) {
      rotationAngle = v/180.0*Math.PI;
    }

    const ops = [
        ()=>runLayer('perception', perceptionBuf, {u_input: stateBuf, u_control: controlBuf,
            u_angle: rotationAngle}),
        ()=>runLayer('dense', hiddenBuf, {u_input: perceptionBuf, u_control: controlBuf,
            u_weightTex: layerTex1.tex, u_weightCoefs: layerTex1.coefs}),
        ()=>runLayer('dense', updateBuf, {u_input: hiddenBuf, u_control: controlBuf,
            u_weightTex: layerTex2.tex, u_weightCoefs: layerTex2.coefs}),
        ()=>runLayer('update', newStateBuf, {u_input: stateBuf, u_update: updateBuf,
            u_seed: Math.random()*1000, u_updateProbability: 0.5}),
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
    function paint(x, y, r, brush, direction) {
        let [dx, dy] = direction;
        const norm = Math.max(Math.sqrt(dx*dx+dy*dy), 1e-8);
        dx /= norm; dy /= norm;
        runLayer('paint', controlBuf, {
            u_pos: [x, y], u_r: r,
            u_brush: [brush, 0, dx, dy],
        });
        // if (brush == 'clear' && r < 1000) {
        //     lastDamage = [x, y, r]; 
        // }
    }
    function reset() {
      //paint(0, 0, 10000, 'clear');
      totalStepCount = 0;
    }
    paint(0, 0, 10000, 0, [0.5, 0.5]);
    paint(40, 100, 20, 1, [1.0, 0.0])
    paint(80, 30, 30, 2, [0.0, -1.0])
    //reset();

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

    const visModes = ['color', 'state', 'perception', 'hidden', 'update', 'control'];

    function draw(visMode) {
        visMode = visMode || 'color';
        gl.useProgram(progs.vis.program);
        twgl.setBuffersAndAttributes(gl, progs.vis, quad);
        const uniforms = {u_raw: 0.0, u_lastDamage: lastDamage}
        lastDamage[2] = Math.max(-0.1, lastDamage[2]-1.0);
        let inputBuf = stateBuf;
        if (visMode != 'color') {
            inputBuf = {stateBuf, perceptionBuf, hiddenBuf, updateBuf, controlBuf}[visMode+'Buf'];
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

    return {reset, step, draw, benchmark, setWeights, paint, visModes, gridSize, 
      fps, flush, getStepCount, setAngle};
}
