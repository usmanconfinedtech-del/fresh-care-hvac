/**
 * ScrollScrubVideo
 * Pinned, scroll-scrubbed hero video section.
 *
 * Desktop: video.currentTime maps 1:1 to scroll progress through the pin.
 * Mobile (≤768px / coarse pointer): autoplay muted loop, no pin.
 *
 * Usage:
 *   const hero = new ScrollScrubVideo({
 *     container:       document.getElementById('ssv-hero'),
 *     videoSrc:        'uploads/hero.mp4',
 *     posterSrc:       'assets/poster.png',
 *     pinScrollHeight: '300vh',
 *     headline: [
 *       { html: 'Line one with <span style="color:#F97316">color</span>' },
 *       { html: 'Line two' }
 *     ]
 *   });
 *   // hero.destroy(); when done
 */
class ScrollScrubVideo {
  constructor({ container, videoSrc, posterSrc = '', pinScrollHeight = '300vh', headline = [] }) {
    this.el = typeof container === 'string' ? document.querySelector(container) : container;
    this.videoSrc = videoSrc;
    this.posterSrc = posterSrc;
    this.pinScrollHeight = pinScrollHeight;
    this.headline = headline;

    this._rafId    = null;
    this._ready    = false;
    this._shown    = false;
    this._pending  = false;
    this._target   = 0;
    this._isMobile = false;

    this._injectStyles();
    this._build();
    this._detectMode();
    this._initVideo();
  }

  // ─── Public ──────────────────────────────────────────────────────────────

  /** True once the hero wrapper has scrolled fully above the viewport. */
  get scrolledPast() {
    return this.wrapper ? this.wrapper.getBoundingClientRect().bottom < 1 : false;
  }

  destroy() {
    this._stopRaf();
    if (this._mq && this._mqCb) this._mq.removeEventListener('change', this._mqCb);
    if (this.wrapper && this.wrapper.parentNode) this.wrapper.parentNode.removeChild(this.wrapper);
  }

  // ─── Setup ───────────────────────────────────────────────────────────────

  _injectStyles() {
    if (document.getElementById('ssv-kf')) return;
    const s = document.createElement('style');
    s.id = 'ssv-kf';
    s.textContent = '@keyframes ssv-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(7px)}}';
    document.head.appendChild(s);
  }

  _build() {
    // Wrapper: provides the scroll distance that pins the sticky child.
    this.wrapper = document.createElement('div');
    Object.assign(this.wrapper.style, {
      position: 'relative',
      background: '#06121E',
      height: this.pinScrollHeight,
    });

    // Sticky: stays in viewport while user scrolls through wrapper.
    const sticky = document.createElement('div');
    Object.assign(sticky.style, {
      position: 'sticky',
      top: '0',
      height: '100vh',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });

    // Frame: rounded card inside the sticky viewport.
    const frame = document.createElement('div');
    const br = 'clamp(16px,2vw,26px)';
    Object.assign(frame.style, {
      position: 'relative',
      width: 'calc(100% - clamp(16px,3.2vw,44px))',
      height: 'calc(100% - clamp(16px,3.2vw,44px))',
      maxWidth: '1680px',
      borderRadius: br,
      overflow: 'hidden',
      background: '#06121E',
      boxShadow: '0 50px 110px rgba(4,16,28,.62)',
    });

    // Video — hidden until first frame decoded.
    this.video = document.createElement('video');
    this.video.src = this.videoSrc;
    this.video.preload = 'auto';
    this.video.muted = true;
    this.video.setAttribute('muted', '');
    this.video.setAttribute('playsinline', '');
    this.video.loop = false;
    Object.assign(this.video.style, {
      position: 'absolute', inset: '0',
      width: '100%', height: '100%',
      objectFit: 'cover',
      opacity: '0',
      transition: 'opacity .8s ease',
    });

    // Poster cover — shown until video is ready.
    this._poster = document.createElement('div');
    Object.assign(this._poster.style, {
      position: 'absolute', inset: '0',
      zIndex: '1',
      background: this.posterSrc ? `url(${this.posterSrc}) center/cover no-repeat` : '#06121E',
      transition: 'opacity .8s ease',
      pointerEvents: 'none',
    });

    // Gradient overlays — sit above poster & video.
    const mkGrad = (css) => {
      const d = document.createElement('div');
      Object.assign(d.style, { position: 'absolute', inset: '0', zIndex: '2', pointerEvents: 'none', background: css });
      return d;
    };
    const gradT = mkGrad('linear-gradient(180deg,rgba(0,0,0,.38) 0%,transparent 36%)');
    const gradB = mkGrad('linear-gradient(0deg,rgba(0,0,0,.68) 0%,rgba(0,0,0,.30) 42%,transparent 64%)');

    // Text layer — STATIC. No scroll-linked transform or opacity.
    const textLayer = document.createElement('div');
    Object.assign(textLayer.style, { position: 'absolute', inset: '0', zIndex: '3', pointerEvents: 'none' });

    const lineY = ['80%', '85.5%'];
    this.headline.forEach((line, i) => {
      const p = document.createElement('p');
      Object.assign(p.style, {
        position: 'absolute',
        top: lineY[i] !== undefined ? lineY[i] : `${80 + i * 7}%`,
        left: '23%',
        margin: '0',
        fontFamily: "'Montserrat', sans-serif",
        fontWeight: '700',
        fontSize: 'clamp(28px,5vh,56px)',
        lineHeight: '1.1',
        color: '#fff',
        whiteSpace: 'nowrap',
      });
      p.innerHTML = line.html;
      textLayer.appendChild(p);
    });

    // Scroll cue — centred, bottom. Fades when scrolling starts.
    this._cue = document.createElement('div');
    Object.assign(this._cue.style, {
      position: 'absolute', bottom: '2.5%', left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '3',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px',
      color: 'rgba(255,255,255,.52)',
      fontFamily: "'Montserrat', sans-serif",
      fontSize: '10px', fontWeight: '600', letterSpacing: '.16em', textTransform: 'uppercase',
      pointerEvents: 'none',
      transition: 'opacity .4s ease',
    });
    this._cue.innerHTML = `<span>Keep scrolling</span>
<svg style="animation:ssv-bob 1.8s ease-in-out infinite" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

    // Border ring.
    const ring = document.createElement('div');
    Object.assign(ring.style, {
      position: 'absolute', inset: '0', zIndex: '4',
      borderRadius: br, border: '1px solid rgba(255,255,255,.08)', pointerEvents: 'none',
    });

    frame.append(this.video, this._poster, gradT, gradB, textLayer, this._cue, ring);
    sticky.appendChild(frame);
    this.wrapper.appendChild(sticky);
    this.el.appendChild(this.wrapper);
  }

  _detectMode() {
    const mq = window.matchMedia('(max-width:768px),(pointer:coarse)');
    this._isMobile = mq.matches;
    this._mqCb = (e) => { this._isMobile = e.matches; this._applyMode(); };
    mq.addEventListener('change', this._mqCb);
    this._mq = mq;
  }

  // ─── Video ───────────────────────────────────────────────────────────────

  _initVideo() {
    const v = this.video;

    v.addEventListener('loadedmetadata', () => {
      // play→pause primes the decoder so seeking actually works on all browsers.
      const p = v.play();
      if (p) p.then(() => { try { v.pause(); v.currentTime = 0; } catch (_) {} }).catch(() => {});
      this._ready = true;
      this._applyMode();
    }, { once: true });

    const reveal = () => {
      if (this._shown) return;
      this._shown = true;
      v.style.opacity = '1';
      this._poster.style.opacity = '0';
    };
    v.addEventListener('loadeddata', reveal, { once: true });
    v.addEventListener('seeked', reveal, { once: true });
    // Absolute fallback.
    setTimeout(reveal, 4000);

    v.load();
  }

  _applyMode() {
    const v = this.video;
    if (this._isMobile) {
      this._stopRaf();
      v.loop = true;
      v.play().catch(() => {});
      this.wrapper.style.height = '100vh';
      this._cue.style.display = 'none';
    } else {
      v.loop = false;
      try { v.pause(); } catch (_) {}
      this.wrapper.style.height = this.pinScrollHeight;
      this._cue.style.display = '';
      if (this._ready) this._startRaf();
    }
  }

  // ─── Scroll scrub ────────────────────────────────────────────────────────

  _startRaf() {
    if (this._rafId) return;
    const tick = () => { this._scrub(); this._rafId = requestAnimationFrame(tick); };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopRaf() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  _scrub() {
    if (!this._ready || this._isMobile) return;
    const rect = this.wrapper.getBoundingClientRect();
    const max = this.wrapper.offsetHeight - window.innerHeight;
    if (max <= 0) return;
    const p = Math.max(0, Math.min(1, -rect.top / max));
    const v = this.video;
    if (!v.duration) return;

    this._target = p * v.duration;
    if (!this._pending) this._seek();
    this._cue.style.opacity = p > 0.02 ? '0' : '1';
  }

  _seek() {
    this._pending = true;
    const go = () => {
      const v = this.video;
      if (!v) { this._pending = false; return; }
      const t = this._target;
      if (Math.abs((v.currentTime || 0) - t) > 0.015) {
        try { v.currentTime = t; } catch (_) {}
        v.addEventListener('seeked', () => {
          if (Math.abs((v.currentTime || 0) - this._target) > 0.05) {
            requestAnimationFrame(go);
          } else {
            this._pending = false;
          }
        }, { once: true });
      } else {
        this._pending = false;
      }
    };
    requestAnimationFrame(go);
  }
}
