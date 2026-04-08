(function () {
  var posts = document.getElementById("posts");
  if (!posts || !window.COOL_STEM_APPS) return;

  var html = window.COOL_STEM_APPS.map(function (app) {
    var attrs = app.external ? 'target="_blank" rel="noopener"' : "";
    var badge = app.external ? '<span class="page-link-ext">EXTERNAL</span>' : "";

    if (app.image) {
      // Image card — the SVG/PNG fills the whole 285:107 area.
      // If the image fails to load, a hidden fallback text layer
      // becomes visible and shows the title on top of the themed
      // background (see .page-link-image-fallback in styles.css).
      var bgStyle = app.bg
        ? ' style="background:' + escapeAttr(app.bg) + '"'
        : "";
      return (
        '<a class="page-link page-link-image" href="' +
        escapeAttr(app.href) +
        '" ' +
        attrs +
        ' aria-label="' +
        escapeAttr(app.title) +
        '"' +
        bgStyle +
        ">" +
        badge +
        '<img class="page-link-img" src="' +
        escapeAttr(app.image) +
        '" alt="" loading="lazy"' +
        ' onerror="this.closest(\'.page-link\').classList.add(\'image-failed\'); this.remove();" />' +
        '<div class="page-link-inner page-link-image-fallback">' +
        '<div class="page-link-title">' +
        escapeHtml(app.title) +
        "</div>" +
        "</div>" +
        "</a>"
      );
    }

    // Text card with CSS background
    var sub = app.sub
      ? '<div class="page-link-sub">' + escapeHtml(app.sub) + "</div>"
      : "";
    return (
      '<a class="page-link" href="' +
      escapeAttr(app.href) +
      '" ' +
      attrs +
      ' style="background:' +
      escapeAttr(app.bg || "#1c2541") +
      '">' +
      badge +
      '<div class="page-link-inner">' +
      '<div class="page-link-title">' +
      escapeHtml(app.title) +
      "</div>" +
      sub +
      "</div></a>"
    );
  }).join("");

  posts.innerHTML = html;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }
})();
