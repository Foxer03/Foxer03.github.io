// One reusable interaction layer for every station, metric and time range.
window.monitorChart = (() => {
  const svg = document.getElementById('chart');
  const wrap = svg.parentElement;
  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  tooltip.id = 'chart-tooltip';
  tooltip.hidden = true;
  tooltip.setAttribute('role', 'tooltip');
  const station = document.createElement('span');
  const value = document.createElement('strong');
  const time = document.createElement('span');
  tooltip.append(station, value, time);
  wrap.append(tooltip);
  const announcement = document.createElement('span');
  announcement.className = 'sr-only';
  announcement.setAttribute('aria-live', 'polite');
  wrap.append(announcement);
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-describedby', 'chart-help');
  let points = [], meta = {}, active = -1, marker;
  const ns = 'http://www.w3.org/2000/svg';
  function hide() {
    tooltip.hidden = true;
    marker?.setAttribute('visibility', 'hidden');
    active = -1;
  }
  function reset() {
    hide(); points = []; meta = {}; marker?.remove(); marker = null;
    announcement.textContent = '';
  }
  function update(nextPoints, nextMeta) {
    reset(); points = nextPoints; meta = nextMeta;
    marker = document.createElementNS(ns, 'g');
    marker.setAttribute('visibility', 'hidden');
    marker.setAttribute('pointer-events', 'none');
    marker.setAttribute('aria-hidden', 'true');
    const guide = document.createElementNS(ns, 'line');
    guide.setAttribute('y1', '26'); guide.setAttribute('y2', '232');
    guide.setAttribute('stroke', '#139d9180'); guide.setAttribute('stroke-dasharray', '4 4');
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('r', '5'); dot.setAttribute('fill', '#139d91');
    dot.setAttribute('stroke', '#fff'); dot.setAttribute('stroke-width', '2');
    marker.append(guide, dot); svg.append(marker);
  }
  function show(index, speak = false) {
    if (!points.length) return hide();
    active = Math.max(0, Math.min(points.length - 1, index));
    const point = points[active], matrix = svg.getScreenCTM();
    if (!matrix) return hide();
    const [guide, dot] = marker.children;
    guide.setAttribute('x1', point.x); guide.setAttribute('x2', point.x);
    dot.setAttribute('cx', point.x); dot.setAttribute('cy', point.y);
    marker.setAttribute('visibility', 'visible');
    station.textContent = 'SmartŽilina · ' + meta.station;
    value.textContent = meta.name + ': ' + point.value.toLocaleString('sk-SK', {maximumFractionDigits: 6}) + ' ' + meta.unit;
    time.textContent = new Intl.DateTimeFormat('sk-SK', {timeZone: 'Europe/Bratislava', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'}).format(point.time) + ' · Bratislava';
    tooltip.hidden = false;
    const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    const box = wrap.getBoundingClientRect();
    const left = Math.max(8, Math.min(screen.x - box.left - tooltip.offsetWidth / 2, wrap.clientWidth - tooltip.offsetWidth - 8));
    const preferredTop = screen.y - box.top - tooltip.offsetHeight - 14;
    const top = Math.max(8, Math.min(preferredTop < 8 ? screen.y - box.top + 14 : preferredTop, wrap.clientHeight - tooltip.offsetHeight - 8));
    tooltip.style.left = left + 'px'; tooltip.style.top = top + 'px';
    if (speak) announcement.textContent = station.textContent + '. ' + value.textContent + '. ' + time.textContent;
  }
  function inspect(event) {
    if (!points.length) return hide();
    const matrix = svg.getScreenCTM(); if (!matrix) return;
    const cursor = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    if (cursor.x < 54 || cursor.x > 974 || cursor.y < 20 || cursor.y > 240) return hide();
    let index = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].x - cursor.x) < Math.abs(points[index].x - cursor.x)) index = i;
    // Do not imply a value exists in long gaps or beyond the recorded history.
    if (Math.abs(points[index].x - cursor.x) > meta.maxDistance) return hide();
    show(index);
  }
  svg.addEventListener('pointermove', inspect);
  svg.addEventListener('pointerdown', inspect);
  svg.addEventListener('pointerleave', event => { if (event.pointerType !== 'touch') hide(); });
  svg.addEventListener('pointercancel', hide);
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', event => {
    if (event.key === 'Escape') return hide();
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !points.length) return;
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : active < 0 ? (event.key === 'ArrowLeft' ? points.length - 1 : 0) : active + (event.key === 'ArrowRight' ? 1 : -1);
    show(index, true);
  });
  document.addEventListener('pointerdown', event => { if (!wrap.contains(event.target)) hide(); });
  window.addEventListener('resize', hide);
  return {reset, update};
})();
