import { CA } from './ca.js'

function isInViewport(element) {
  var rect = element.getBoundingClientRect();
  var html = document.documentElement;
  var w = window.innerWidth || html.clientWidth;
  var h = window.innerHeight || html.clientHeight;
  return rect.top < h && rect.left < w && rect.bottom > 0 && rect.right > 0;
}

export function createDemo(divId, modelsSet) {
  const root = document.getElementById(divId);
  const $ = q => root.querySelector(q);
  const $$ = q => root.querySelectorAll(q);

  const W = 256, H = 256;
  let ca = null;
  const modelDir = 'webgl_models8';
  let experiment = 'ex3';
  let paused = false;

  const canvas = $('#demo-canvas');
  const gl = canvas.getContext("webgl");
  canvas.width = W * 6;
  canvas.height = H * 6;

  const params = {
    modelSet: 'models.json',
    model: 10,
    brushSize: 8,
    autoFill: true,
    debug: false,
  };
  let gui = null;

  async function initLegend(models) {
    console.log(models);
    const brush2idx = Object.fromEntries(models.model_names.map((s, i) => [s, i]));
    for (const name of models.model_names) {

      // texture.style.backgroundImage = 'url(textures/' + name + '.jpg)';
      const video = document.createElement('video');
      video.src = 'textures/' + name + ".mp4";
      video.poster = 'textures/' + name + ".mp4.jpg";
      video.autoplay = false;
      video.playsinline = true;
      video.muted = true;
      video.loop = true;
      video.className = 'texture-video'
      video.onclick = (() => {
        console.log(name);
        ca.paint(0, 0, 10000, brush2idx[name], [0, 0]);
      })

      const texture = document.createElement('div');
      texture.id = name; //html5 support arbitrary id:s
      texture.className = 'texture-square';
      texture.onmouseover = video.play.bind(video);
      texture.onmouseout = video.pause.bind(video);
      texture.addEventListener('touchstart', video.play.bind(video), false);
      texture.addEventListener('touchend', video.pause.bind(video), false);
      // const pause = video.pause.bind(video);
      // texture.onmouseout = (()  => {pause(); video.currentTime = 0;});

      texture.appendChild(video)
      if (name.startsWith('mixed')){ 
        $("#inception").appendChild(texture);
      } else {
        $('#dtd').appendChild(texture);
      }
      console.log(name);
    }
  }

  function createGUI(models) {
    if (gui != null) {
      gui.destroy();
    }
    gui = new dat.GUI();
    if (!params.debug) {
      dat.GUI.toggleHide();
    }
    gui.add(params, 'modelSet', modelsSet).onChange(updateCA);
    const brush2idx = Object.fromEntries(models.model_names.map((s, i) => [s, i]));
    gui.add(params, 'model').options(brush2idx).onChange(() => {
      if (params.autoFill)
        ca.paint(0, 0, 10000, params.model, [0, 0]);
    });
    gui.add(params, 'autoFill')
    gui.add(params, 'brushSize').min(1).max(32).step(1);
  }


  function canvasToGrid(x, y) {
    const [w, h] = ca.gridSize;
    const gridX = x / canvas.clientWidth * w;
    const gridY = y / canvas.clientHeight * h;
    return [gridX, gridY];
  }
  function getMousePos(e) {
    return canvasToGrid(e.offsetX, e.offsetY);
  }
  function getTouchPos(touch) {
    const rect = canvas.getBoundingClientRect();
    return canvasToGrid(touch.clientX - rect.left, touch.clientY - rect.top);
  }

  let prevPos = [0, 0]
  function click(pos) {
    const [x, y] = pos;
    const [px, py] = prevPos;
    ca.paint(x, y, params.brushSize, params.model, [x - px, y - py]);
    prevPos = pos;
  }


  function updateUI() {
    $$('#model-selector input').forEach(e => {
      e.checked = e.id == experiment;
    });
    $$('#model-hints span').forEach(e => {
      e.style.display = e.id.startsWith(experiment) ? "inline" : "none";
    });
    $('#play').style.display = paused ? "inline" : "none";
    $('#pause').style.display = !paused ? "inline" : "none";
    const speed = parseInt($('#speed').value);
    $('#speedLabel').innerHTML = ['1/60 x', '1/10 x', '1/2 x', '1x', '2x', '4x', '<b>max</b>'][speed + 3];
  }

  function initUI() {
    let spriteX = 0;
    $('#play-pause').onclick = () => {
      paused = !paused;
      updateUI();
    };
    // $$('#model-selector input').forEach(sel=>{
    //   sel.onchange = ()=>{
    //     experiment = sel.id;
    //     updateModel();
    //   }
    // });
    $('#speed').onchange = updateUI;
    $('#speed').oninput = updateUI;


    // canvas.onmousedown = e => {
    //   e.preventDefault();
    //   if (e.buttons == 1) {
    //     click(getMousePos(e));
    //   }
    // }
    // canvas.onmousemove = e => {
    //   e.preventDefault();
    //   if (e.buttons == 1) {
    //     click(getMousePos(e));
    //   }
    // }
    // canvas.addEventListener("touchstart", e => {
    //   e.preventDefault();
    //   click(getTouchPos(e.changedTouches[0]));
    // });
    // canvas.addEventListener("touchmove", e => {
    //   e.preventDefault();
    //   for (const t of e.touches) {
    //     click(getTouchPos(t));
    //   }
    // });
    updateUI();
  }

  async function updateCA() {
    const r = await fetch(params.modelSet);
    const models = await r.json();
    const firstTime = ca == null;
    createGUI(models);
    ca = new CA(gl, models, [W, H], gui);
    ca.paint(0, 0, 10000, 17, [0.5, 0.5]);

    window.ca = ca;
    if (firstTime) {
      initUI();
      initLegend(models);
      requestAnimationFrame(render);
    }
    updateUI();
  }
  updateCA();

  let lastDrawTime = 0;
  let stepsPerFrame = 1;
  let frameCount = 0;

  let first = true;

  function render(time) {
    if (!isInViewport(canvas)) {
      requestAnimationFrame(render);
      return;
    }

    if (first) {
      first = false;
      requestAnimationFrame(render);
      return;
    }


    if (!paused) {
      const speed = parseInt($("#speed").value);
      if (speed <= 0) {  // slow down by skipping steps
        const skip = [1, 2, 10, 60][-speed];
        stepsPerFrame = (frameCount % skip) ? 0 : 1;
        frameCount += 1;
      } else if (speed > 0) { // speed up by making more steps per frame
        const interval = time - lastDrawTime;
        stepsPerFrame += interval < 20.0 ? 1 : -1;
        stepsPerFrame = Math.max(1, stepsPerFrame);
        stepsPerFrame = Math.min(stepsPerFrame, [1, 2, 4, Infinity][speed])
      }
      for (let i = 0; i < stepsPerFrame; ++i) {
        ca.step();
      }
      // $("#stepCount").innerText = ca.getStepCount();
      // $("#ips").innerText = ca.fps();
    }
    lastDrawTime = time;

    twgl.bindFramebufferInfo(gl);
    ca.draw();
    requestAnimationFrame(render);
  }
}
