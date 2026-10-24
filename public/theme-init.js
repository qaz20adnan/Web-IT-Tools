(function () {
  try {
    var raw = localStorage.getItem('technexus.settings.v1')
    if (!raw) return
    var s = JSON.parse(raw)
    var root = document.documentElement
    var theme =
      s.theme === 'auto'
        ? window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'arctic-light'
          : 'nexus-midnight'
        : s.theme
    if (theme) root.dataset.theme = theme
    if (s.fontScale) root.dataset.font = s.fontScale
    if (s.density) root.dataset.density = s.density
    if (s.language) {
      root.lang = s.language
      root.dir = s.language === 'ar' ? 'rtl' : 'ltr'
    }
  } catch (e) {
    /* corrupted local settings should never block boot */
  }
})()
