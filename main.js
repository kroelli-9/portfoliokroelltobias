const nav = document.querySelector(".nav");

// Live clock (Salzburg time) in the nav
const clock = document.getElementById("clock");
const clockFmt = new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" });
const tick = () => { clock.textContent = clockFmt.format(new Date()); };
tick();
setInterval(tick, 10000);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Scroll progress: accent hairline along the bottom of the nav
const progress = document.querySelector(".nav__progress");
const onScroll = () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  progress.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
};
onScroll();
addEventListener("scroll", onScroll, { passive: true });
addEventListener("resize", onScroll);

// Mark the nav link of the section currently on screen (nothing is marked in the hero)
const navLinks = [...document.querySelectorAll(".nav__links a")];
const spy = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    navLinks.forEach((a) => a.classList.toggle("is-active", a.hash === "#" + e.target.id));
  }
}, { rootMargin: "-45% 0px -50% 0px" });
document.querySelectorAll(".hero, #arbeiten, #ueber, #kontakt").forEach((s) => spy.observe(s));

// Fade elements in as they scroll into view
const revealObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      e.target.classList.add("is-in");
      revealObserver.unobserve(e.target);
    }
  }
}, { rootMargin: "0px 0px -8% 0px" });
document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

// Videos: load lazily, play only while visible.
// With reduced motion they do not autoplay and get normal controls instead.
const videos = document.querySelectorAll("video[data-src]");
// On the protected site the files are encrypted: window.decryptMedia turns a path into a playable URL
const mediaUrl = (path) => (window.decryptMedia ? window.decryptMedia(path) : Promise.resolve(path));
const loadVideo = (v) => v.getAttribute("src")
  ? Promise.resolve()
  : mediaUrl(v.dataset.src).then((url) => { if (!v.getAttribute("src")) v.src = url; });
if (reduceMotion) {
  videos.forEach((v) => { loadVideo(v); v.preload = "none"; v.controls = true; });
} else {
  // Phones in power-saving or data-saver mode refuse autoplay. Those videos are
  // remembered and started on the next tap anywhere, which the browser allows.
  const visible = new Set();
  const blocked = new Set();
  const tryPlay = (v) => {
    v.muted = true; // set as property too: iOS checks it, not only the attribute
    v.playsInline = true;
    const p = v.play();
    if (p) p.then(() => blocked.delete(v)).catch(() => {
      blocked.add(v);
      v.parentElement.classList.add("is-blocked"); // shows a play symbol
    });
  };
  // The play symbol only shows while a video is held back; once it runs, it disappears
  videos.forEach((v) => v.addEventListener("playing", () => v.parentElement.classList.remove("is-blocked")));
  const videoObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = e.target;
      if (e.isIntersecting) {
        visible.add(v);
        loadVideo(v).then(() => { if (visible.has(v)) tryPlay(v); });
      } else {
        visible.delete(v);
        if (!v.paused) v.pause();
      }
    }
  }, { rootMargin: "200px 0px", threshold: 0.15 });
  videos.forEach((v) => videoObserver.observe(v));
  const unlock = () => { blocked.forEach((v) => { if (visible.has(v)) tryPlay(v); }); };
  addEventListener("touchend", unlock, { passive: true });
  addEventListener("click", unlock);
}

// Touch screens have no hover: colour the work thumbnail that is in the middle of the screen
if (matchMedia("(hover: none)").matches) {
  const thumbObserver = new IntersectionObserver((entries) => {
    for (const e of entries) e.target.classList.toggle("is-current", e.isIntersecting);
  }, { rootMargin: "-35% 0px -35% 0px" });
  document.querySelectorAll(".index__list a").forEach((a) => thumbObserver.observe(a));
}

// Sound toggle for videos with audio (only one plays with sound at a time)
document.querySelectorAll(".sound").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation(); // don't open the lightbox
    const video = btn.parentElement.querySelector("video");
    const turnOn = video.muted;
    document.querySelectorAll(".sound").forEach((b) => {
      b.parentElement.querySelector("video").muted = true;
      b.textContent = "Ton an";
      b.setAttribute("aria-pressed", "false");
    });
    if (turnOn) {
      btn.textContent = "Ton aus";
      btn.setAttribute("aria-pressed", "true");
      loadVideo(video).then(() => {
        if (btn.getAttribute("aria-pressed") !== "true") return;
        video.muted = false;
        video.currentTime = 0;
        video.play().catch(() => {});
      });
    }
  });
});

// Mobile menu
const toggle = document.querySelector(".nav__toggle");
const setMenu = (open) => {
  nav.classList.toggle("is-open", open);
  document.body.classList.toggle("menu-open", open);
  toggle.setAttribute("aria-expanded", String(open));
  toggle.textContent = open ? "Schließen" : "Menü";
};
toggle.addEventListener("click", () => setMenu(!nav.classList.contains("is-open")));
navLinks.forEach((a) => a.addEventListener("click", () => setMenu(false)));

// Copy the e-mail address
document.querySelectorAll("[data-copy]").forEach((btn) => {
  const hint = btn.querySelector(".copy__hint");
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      hint.textContent = "Kopiert";
    } catch {
      // Clipboard blocked: select the address so it can be copied by hand
      getSelection().selectAllChildren(btn.querySelector(".copy__value"));
      hint.textContent = "Markiert";
    }
    btn.classList.add("is-copied");
    setTimeout(() => { hint.textContent = "Kopieren"; btn.classList.remove("is-copied"); }, 2000);
  });
});

// Lightbox: opens an image or video large, arrows step through the media of the same project
const lightbox = document.querySelector(".lightbox");
const lbImg = lightbox.querySelector("img");
const lbVid = lightbox.querySelector("video");
const lbCount = lightbox.querySelector(".lightbox__count");
const lbCap = lightbox.querySelector(".lightbox__cap");
let lbSet = [];
let lbIndex = 0;
let lbOpener = null;
let lbPaused = [];

const two = (n) => String(n).padStart(2, "0");
const stopLbVideo = () => { lbVid.pause(); lbVid.removeAttribute("src"); lbVid.removeAttribute("poster"); lbVid.load(); };
const showLightbox = (i) => {
  lbIndex = (i + lbSet.length) % lbSet.length;
  const btn = lbSet[lbIndex];
  const img = btn.querySelector("img");
  const vid = btn.querySelector("video");
  if (vid) {
    lbImg.hidden = true;
    lbImg.removeAttribute("src");
    lbVid.hidden = false;
    lbVid.poster = vid.poster;
    lbVid.setAttribute("aria-label", vid.getAttribute("aria-label") || "");
    lbVid.muted = !btn.querySelector(".sound"); // videos with a sound toggle open with sound
    const shown = lbIndex;
    loadVideo(vid).then(() => {
      if (lightbox.hidden || lbIndex !== shown) return; // the viewer moved on meanwhile
      lbVid.src = vid.src;
      lbVid.play().catch(() => { lbVid.muted = true; lbVid.play().catch(() => {}); });
    });
  } else {
    stopLbVideo();
    lbVid.hidden = true;
    lbImg.hidden = false;
    lbImg.src = img.currentSrc || img.src;
    lbImg.alt = img.alt;
  }
  lbCount.textContent = `${two(lbIndex + 1)} / ${two(lbSet.length)}`;
  lbCap.textContent = btn.parentElement.querySelector("figcaption span")?.textContent || "";
};
const openLightbox = (btn) => {
  lbOpener = btn;
  lbSet = [...btn.closest(".project").querySelectorAll("[data-zoom]")];
  lightbox.classList.toggle("is-single", lbSet.length < 2);
  lightbox.hidden = false;
  document.body.style.overflow = "hidden";
  // Pause the page videos while the lightbox is open
  lbPaused = [...videos].filter((v) => !v.paused);
  lbPaused.forEach((v) => v.pause());
  showLightbox(lbSet.indexOf(btn));
  lightbox.querySelector(".lightbox__close").focus();
};
const closeLightbox = () => {
  if (lightbox.hidden) return;
  lightbox.hidden = true;
  lbImg.removeAttribute("src");
  stopLbVideo();
  lbPaused.forEach((v) => v.play().catch(() => {}));
  lbPaused = [];
  document.body.style.overflow = "";
  lbOpener?.focus();
};

document.querySelectorAll("[data-zoom]").forEach((btn) => {
  const media = btn.querySelector("img, video");
  const name = media.tagName === "IMG" ? media.alt || "Bild" : media.getAttribute("aria-label") || "Video";
  btn.setAttribute("aria-label", name + " (vergrößern)");
  btn.addEventListener("click", () => openLightbox(btn));
  // Video tiles are divs (they can hold a sound button), so give them keyboard support
  if (btn.tagName !== "BUTTON") {
    btn.addEventListener("keydown", (e) => {
      if (e.target === btn && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openLightbox(btn); }
    });
  }
});
lightbox.querySelector(".lightbox__prev").addEventListener("click", () => showLightbox(lbIndex - 1));
lightbox.querySelector(".lightbox__next").addEventListener("click", () => showLightbox(lbIndex + 1));
lightbox.addEventListener("click", (e) => {
  if (!e.target.closest(".lightbox__arrow, video")) closeLightbox();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { setMenu(false); closeLightbox(); }
  if (lightbox.hidden) return;
  if (e.key === "ArrowLeft") showLightbox(lbIndex - 1);
  if (e.key === "ArrowRight") showLightbox(lbIndex + 1);
  // Keep keyboard focus inside the open lightbox
  if (e.key === "Tab") {
    const items = [...lightbox.querySelectorAll("button")].filter((b) => b.offsetParent && getComputedStyle(b).visibility !== "hidden");
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
