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
  canvas.width = W;
  canvas.height = H;
  const gl = canvas.getContext("webgl");

  const maxZoom = 32.0;

  const params = {
    modelSet: 'demo/models.json',
    models: null,
    model: 35,
    modelname: "mixed",
    brushSize: 20,
    autoFill: true,
    debug: false,
    zoom: 1.0,
  };
  let gui = null;
  let currentTexture = null;
  
  async function initLegend(models) {
    const brush2idx = Object.fromEntries(models.model_names.map((s, i) => [s, i]));
    function setModel(name) {
      console.log(name);
      ca.clearCircle(0, 0, 1000);
      params.model = brush2idx[name];
      params.modelname = name;
      ca.paint(0, 0, 10000, brush2idx[name], [0, 0]);
      updateUI();   
    }

    const w = Math.ceil(Math.sqrt(models.model_names.length));
    const h = Math.ceil(models.model_names.length/w);
    models.model_names.forEach((name, idx, _) => {
      const texture = document.createElement('div');
      let x = 100.0*(idx % w)/(w-1);
      let y = 100.0*Math.floor(idx / w)/(h-1);
      texture.style.background = "url('demo/sprites.jpeg') " + x + "% " + y + "%";
      texture.style.backgroundSize = "" + (w*100) + "% " + (h*100) + "%";
      texture.id = name; //html5 support arbitrary id:s
      texture.className = 'texture-square';
      texture.onclick = () => {
        currentTexture.style.borderColor = "white";
        currentTexture = texture;
        texture.style.borderColor = "rgb(245 140 44)";
        if (!window.matchMedia('(min-width: 500px)').matches){
          texture.scrollIntoView({behavior: "smooth", block: "nearest", inline: "center"})
        }
        setModel(name);
      };
      if (name.startsWith('mixed')){ 
        $("#inception").appendChild(texture);
      } else {
        $('#dtd').appendChild(texture);
      }
      currentTexture = texture;
    });
    setModel('interlaced_0172');
    $$(".pattern-selector").forEach(sel => {
      sel.onscroll = () => {
        console.log(sel)
        $$(".overlaygrad").forEach(sel2 => {
          if (window.matchMedia('(min-width: 500px)').matches){
            console.log('x')
            sel2.style.backgroundImage = "linear-gradient(to bottom, rgb(255,255,255) 0%, rgba(255,255,255,0) 10%, rgba(255,255,255,0) 90%, rgb(255,255,255) 100%)";
          } else {
            console.log('y')
            sel2.style.backgroundImage = "linear-gradient(to right, rgb(255,255,255) 0%, rgba(255,255,255,0) 10%, rgba(255,255,255,0) 90%, rgb(255,255,255) 100%)";
          }
          })
        sel.onscroll = null;
      }
    })
  }

  function createGUI(models) {
    if (gui != null) {
      gui.destroy();
    }
    gui = new dat.GUI();
    if (!params.debug) {
      dat.GUI.toggleHide();
    }
    const brush2idx = Object.fromEntries(models.model_names.map((s, i) => [s, i]));
    params.modelname = models.model_names[params.model];
    gui.add(params, 'brushSize').min(1).max(32).step(1);
    gui.add(params, 'zoom').min(1).max(20);
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
    ca.clearCircle(x, y, params.brushSize);
    // ca.paint(x, y, params.brushSize, params.model, [x - px, y - py]);
    prevPos = pos;
  }


  function updateUI() {
    $$('#model-hints span').forEach(e => {
      e.style.display = e.id.startsWith(experiment) ? "inline" : "none";
    });
    $('#play').style.display = paused ? "inline" : "none";
    $('#pause').style.display = !paused ? "inline" : "none";

    const speed = parseInt($('#speed').value);
    $('#speedLabel').innerHTML = ['1/60 x', '1/10 x', '1/2 x', '1x', '2x', '4x', '<b>max</b>'][speed + 3];
    ca.rotationAngle = parseInt($('#rotation').value);
    $('#rotationLabel').innerHTML = ca.rotationAngle + " deg";
    const w = Math.ceil(Math.sqrt(params.models.model_names.length));
    const h = Math.ceil(params.models.model_names.length/w);
    let x = 100.0*(params.model % w)/(w-1);
    let y = 100.0*Math.floor(params.model / w)/(h-1);
    $("#origtex").style.background = "url('demo/dtd_sprites.jpeg') " + x + "% " + y + "%";
    $("#origtex").style.backgroundSize = "" + (w*100) + "% " + (h*100) + "%";
    if (params.modelname.startsWith('mixed')){
      let oai = document.createElement('a')
      oai.innerHTML = params.modelname + " (OpenAI Microscope)"
      oai.href = "https://microscope.openai.com/models/inceptionv1/" + params.modelname.substring(0,8) + "0/" + params.modelname.substring(8)
      $("#texhinttext").innerHTML = '';
      $("#texhinttext").appendChild(oai);
    } else {
      let dtd = document.createElement('a')
      dtd.innerHTML = params.modelname + " (DTD)"
      dtd.href = "https://www.robots.ox.ac.uk/~vgg/data/dtd/"
      $("#texhinttext").innerHTML = '';
      $("#texhinttext").appendChild(dtd);
    }
    $('#zoomOut').classList.toggle('disabled', params.zoom <= 1.0);
    $('#zoomIn').classList.toggle('disabled', params.zoom >= maxZoom );
  }

  function initUI() {
    let spriteX = 0;
    $('#play-pause').onclick = () => {
      paused = !paused;
      updateUI();
    };
    $('#reset').onclick = () => {
      ca.clearCircle(0, 0, 1000);
      ca.paint(0, 0, 10000, params.model, [0, 0]);
    };
    $$('#alignSelect input').forEach((sel, i)=>{
      sel.onchange = () => {ca.alignment = i;}
    });
    $$('#gridSelect input').forEach(sel=>{
      sel.onchange = () => {ca.hexGrid = sel.id == 'gridHex';}
    });
    $('#speed').onchange = updateUI;
    $('#speed').oninput = updateUI;
    $('#rotation').onchange = updateUI;
    $('#rotation').oninput = updateUI;
    $('#zoomIn').onclick = () => {
      if (params.zoom < maxZoom) {
        params.zoom *= 2.0;
      }
      updateUI();
    };
    $('#zoomOut').onclick = () => {
      if (params.zoom > 1.0) {
        params.zoom /= 2.0;
      }
      updateUI();
    };



    canvas.onmousedown = e => {
      e.preventDefault();
      if (e.buttons == 1) {
        click(getMousePos(e));
      }
    }
    canvas.onmousemove = e => {
      e.preventDefault();
      if (e.buttons == 1) {
        click(getMousePos(e));
      }
    }
    canvas.addEventListener("touchstart", e => {
      e.preventDefault();
      click(getTouchPos(e.changedTouches[0]));
    });
    canvas.addEventListener("touchmove", e => {
      e.preventDefault();
      for (const t of e.touches) {
        click(getTouchPos(t));
      }
    });
    updateUI();
  }

  async function updateCA() {
    const r = await fetch(params.modelSet);
    const models = await r.json();
    params.models = models;
    const firstTime = ca == null;
    createGUI(models);
    ca = new CA(gl, models, [W, H], gui);
    ca.paint(0, 0, 10000, params.model, [0.5, 0.5]);

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
    ca.draw(params.zoom);
    requestAnimationFrame(render);
  }
}
