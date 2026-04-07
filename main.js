(function () {
  var posts = document.getElementById("posts");
  if (!posts || !window.COOL_STEM_APPS) return;

  var html = window.COOL_STEM_APPS.map(function (app) {
    var attrs = app.external ? 'target="_blank" rel="noopener"' : "";
    var badge = app.external ? '<span class="page-link-ext">EXTERNAL</span>' : "";

    if (app.image) {
      // Image card — the SVG/PNG fills the whole 285:107 area.
      return (
        '<a class="page-link page-link-image" href="' +
        escapeAttr(app.href) +
        '" ' +
        attrs +
        ' aria-label="' +
        escapeAttr(app.title) +
        '">' +
        badge +
        '<img class="page-link-img" src="' +
        escapeAttr(app.image) +
        '" alt="' +
        escapeAttr(app.title) +
        '" loading="lazy" />' +
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
