function loadNav(){
  fetch('nav.html')
    .then(res => res.text())
    .then(html => {
      document.getElementById('nav-placeholder').innerHTML = html;
    });
}
window.addEventListener('DOMContentLoaded', loadNav);
