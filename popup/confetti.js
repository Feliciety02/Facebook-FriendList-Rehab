(() => {
  const COLORS = ['#0866ff','#22c55e','#f59e0b','#ef4444','#a855f7','#ec4899'];
  const canvas = document.getElementById('confettiCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let particles = [];
  let raf = null;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  function createParticle() {
    return {
      x: Math.random() * canvas.width,
      y: -10,
      w: Math.random() * 6 + 4,
      h: Math.random() * 4 + 3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      vx: (Math.random() - .5) * 3,
      vy: Math.random() * 3 + 2,
      rotation: Math.random() * 360,
      spin: (Math.random() - .5) * 8,
      opacity: 1
    };
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = particles.filter((p) => p.opacity > 0);
    for (const p of particles) {
      p.x += p.vx;
      p.vy += 0.05;
      p.y += p.vy;
      p.rotation += p.spin;
      if (p.y > canvas.height * .85) p.opacity -= 0.02;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation * Math.PI / 180);
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (particles.length) raf = requestAnimationFrame(animate);
  }

  window.fireConfetti = function(count = 80) {
    for (let i = 0; i < count; i++) particles.push(createParticle());
    if (!raf) animate();
    setTimeout(() => { cancelAnimationFrame(raf); raf = null; }, 3000);
  };
})();

(() => {
  function showAchievement(icon, text) {
    let toast = document.querySelector('.achievement-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'achievement-toast';
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<span class="achievement-icon">${icon}</span> ${text}`;
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }
  window.showAchievement = showAchievement;
})();
