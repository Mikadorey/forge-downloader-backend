// bg.js
(function(){
  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let width = window.innerWidth;
  let height = window.innerHeight;
  canvas.width = width;
  canvas.height = height;

  window.addEventListener('resize', () => {
    width = window.innerWidth; height = window.innerHeight;
    canvas.width = width; canvas.height = height;
  });

  const mouse = { x: width/2, y: height/2 };
  canvas.addEventListener('mousemove', e => {
    mouse.x = e.clientX; mouse.y = e.clientY;
  });

  const MODES = ['sineWave','galaxy','constellation','fireflies'];
  let currentMode = 0;
  let nextMode = null;
  let transitionProgress = 0;
  const TRANSITION_SPEED = 0.02;

  const waves = [];
  for(let i=0;i<3;i++){
    waves.push({ offset: Math.random()*Math.PI*2, amplitude: 20 + Math.random()*30, speed: 0.02 + Math.random()*0.02, yPos: height/4 + i*height/4 });
  }

  const stars = [];
  for(let i=0;i<150;i++){
    stars.push({ x: Math.random()*width, y: Math.random()*height, r: Math.random()*1.5+0.5, dx: (Math.random()-0.5)*0.2, dy: (Math.random()-0.5)*0.2, hue: Math.random()*360 });
  }

  const nodes = [];
  for(let i=0;i<60;i++){
    nodes.push({ x: Math.random()*width, y: Math.random()*height, vx: (Math.random()-0.5)*0.5, vy: (Math.random()-0.5)*0.5 });
  }

  const fireflies = [];
  for(let i=0;i<80;i++){
    fireflies.push({ x: Math.random()*width, y: Math.random()*height, r: Math.random()*2+1, dx: (Math.random()-0.5)*0.3, dy: (Math.random()-0.5)*0.3, alpha: Math.random(), dAlpha: 0.005 + Math.random()*0.01 });
  }

  function drawSineWave(alpha=1){
    ctx.globalAlpha = alpha;
    for(let w of waves){
      const grad = ctx.createLinearGradient(0,0,width,0);
      grad.addColorStop(0,'#ff00ff'); grad.addColorStop(0.5,'#00ffff'); grad.addColorStop(1,'#ffff00');
      ctx.strokeStyle = grad; ctx.lineWidth = 2; ctx.beginPath();
      for(let x=0;x<width;x+=2){ ctx.lineTo(x, w.yPos + Math.sin(x*0.02 + w.offset)*w.amplitude); }
      ctx.stroke(); w.offset += w.speed;
    }
    ctx.globalAlpha = 1;
  }

  function drawGalaxy(alpha=1){
    ctx.globalAlpha = alpha;
    for(let s of stars){
      ctx.beginPath(); ctx.fillStyle = `hsl(${s.hue},80%,60%)`; ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.fill();
      s.x += s.dx; s.y += s.dy;
      if(s.x<0||s.x>width) s.dx *= -1; if(s.y<0||s.y>height) s.dy *= -1;
      s.hue = (s.hue + 0.5) % 360;
    }
    ctx.globalAlpha = 1;
  }

  function drawConstellation(alpha=1){
    ctx.globalAlpha = alpha;
    for(let n of nodes){
      ctx.beginPath(); ctx.fillStyle = '#00ffff'; ctx.arc(n.x,n.y,2,0,Math.PI*2); ctx.fill();
      n.x += n.vx; n.y += n.vy;
      if(n.x<0||n.x>width) n.vx *= -1; if(n.y<0||n.y>height) n.vy *= -1;
    }
    for(let i=0;i<nodes.length;i++){
      for(let j=i+1;j<nodes.length;j++){
        const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if(dist < 120){
          ctx.strokeStyle = `rgba(0,255,255,${1-dist/120})`; ctx.lineWidth = 1; ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke();
        }
      }
    }
    for(let n of nodes){
      const dx = n.x - mouse.x, dy = n.y - mouse.y, dist = Math.sqrt(dx*dx + dy*dy);
      if(dist<100){
        ctx.strokeStyle = `rgba(255,255,0,${1-dist/100})`; ctx.beginPath();
        ctx.moveTo(n.x,n.y); ctx.lineTo(mouse.x,mouse.y); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawFireflies(alpha=1){
    ctx.globalAlpha = alpha;
    for(let f of fireflies){
      ctx.beginPath(); ctx.fillStyle = `rgba(255,215,0,${f.alpha})`; ctx.arc(f.x,f.y,f.r,0,Math.PI*2); ctx.fill();
      f.x += f.dx; f.y += f.dy; f.alpha += f.dAlpha;
      if(f.alpha>1||f.alpha<0) f.dAlpha *= -1;
      if(f.x<0||f.x>width) f.dx *= -1; if(f.y<0||f.y>height) f.dy *= -1;
    }
    ctx.globalAlpha = 1;
  }

  function animate(){
    ctx.fillStyle = 'rgba(15,15,15,0.16)';
    ctx.fillRect(0,0,width,height);

    if(nextMode !== null){
      transitionProgress += TRANSITION_SPEED;
      if(transitionProgress >= 1){
        currentMode = nextMode; nextMode = null; transitionProgress = 0;
      }
    }

    const alphaCurrent = nextMode ? 1 - transitionProgress : 1;
    const alphaNext = nextMode ? transitionProgress : 0;

    switch(MODES[currentMode]){
      case 'sineWave': drawSineWave(alphaCurrent); break;
      case 'galaxy': drawGalaxy(alphaCurrent); break;
      case 'constellation': drawConstellation(alphaCurrent); break;
      case 'fireflies': drawFireflies(alphaCurrent); break;
    }
    if(nextMode !== null){
      switch(MODES[nextMode]){
        case 'sineWave': drawSineWave(alphaNext); break;
        case 'galaxy': drawGalaxy(alphaNext); break;
        case 'constellation': drawConstellation(alphaNext); break;
        case 'fireflies': drawFireflies(alphaNext); break;
      }
    }
    requestAnimationFrame(animate);
  }
  animate();

  const bgToggleEl = document.getElementById('bgToggle');
  if (bgToggleEl) bgToggleEl.addEventListener('click', () => {
    nextMode = (currentMode + 1) % MODES.length;
    transitionProgress = 0;
    localStorage.setItem('bgMode', String(nextMode));
  });

  setInterval(() => {
    nextMode = (currentMode + 1) % MODES.length;
    transitionProgress = 0;
    localStorage.setItem('bgMode', String(nextMode));
  }, 60000 + Math.random()*120000);

  const savedBgMode = localStorage.getItem('bgMode');
  if (savedBgMode !== null) {
    const idx = parseInt(savedBgMode);
    if (!Number.isNaN(idx) && idx >= 0 && idx < MODES.length){
      currentMode = idx;
    }
  }

  window.bg = {
    setMode: (idx) => {
      if (typeof idx === 'number' && idx >=0 && idx < MODES.length) {
        nextMode = idx; transitionProgress = 1;
        currentMode = idx; nextMode = null; transitionProgress = 0;
        localStorage.setItem('bgMode', String(idx));
      }
    },
    nextMode: () => {
      nextMode = (currentMode + 1) % MODES.length;
      transitionProgress = 0;
      localStorage.setItem('bgMode', String(nextMode));
    },
    getCurrentMode: () => currentMode,
    modes: MODES.slice()
  };
})();
